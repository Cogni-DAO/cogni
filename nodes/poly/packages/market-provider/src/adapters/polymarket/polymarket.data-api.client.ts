// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/adapters/polymarket/polymarket.data-api.client`
 * Purpose: Client for the public Polymarket Data API + Gamma handle resolver — leaderboard, user activity / trades / positions / value, market holders + trades, username search.
 * Scope: HTTP fetch + Zod validation. Does not load env, does not manage credentials, does not place orders, does not implement `MarketProviderPort`.
 * Invariants: PACKAGES_NO_ENV, READ_ONLY, CONTRACT_IS_SOT.
 * Side-effects: IO (HTTP fetch to https://data-api.polymarket.com and https://gamma-api.polymarket.com)
 * Links: work/items/task.0315.poly-copy-trade-prototype.md, work/items/task.0386.poly-agent-wallet-research-v0.md, docs/research/poly-copy-trading-wallets.md
 * @public
 */

import type { ZodIssue, ZodTypeAny, z } from "zod";
import {
  type ActivityEvent,
  ActivityEventsResponseSchema,
  type ActivityEventType,
  type GammaProfile,
  GammaPublicSearchResponseSchema,
  type MarketHolder,
  MarketHoldersResponseSchema,
  type MarketTrade,
  MarketTradesResponseSchema,
  type PolymarketLeaderboardEntry,
  type PolymarketLeaderboardOrderBy,
  PolymarketLeaderboardResponseSchema,
  type PolymarketLeaderboardTimePeriod,
  type PolymarketUserPosition,
  PolymarketUserPositionsResponseSchema,
  type PolymarketUserTrade,
  PolymarketUserTradesResponseSchema,
  UserValueResponseSchema,
} from "./polymarket.data-api.types.js";

/**
 * Thrown when a Data API response fails Zod validation at the client boundary.
 * Stable envelope so downstream agents can catch schema drift distinctly from HTTP failures.
 */
export class PolyDataApiValidationError extends Error {
  readonly code = "VALIDATION_FAILED" as const;
  constructor(
    readonly endpoint: string,
    readonly issues: ZodIssue[]
  ) {
    super(
      `Polymarket Data API response validation failed (${endpoint}): ${issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ")}`
    );
    this.name = "PolyDataApiValidationError";
  }
}

function parseResponse<S extends ZodTypeAny>(
  schema: S,
  json: unknown,
  endpoint: string
): z.output<S> {
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new PolyDataApiValidationError(endpoint, result.error.issues);
  }
  return result.data;
}

const DEFAULT_DATA_API_BASE_URL = "https://data-api.polymarket.com";
const DEFAULT_GAMMA_BASE_URL = "https://gamma-api.polymarket.com";

export interface PolymarketDataApiClientConfig {
  /** Data API base URL (default: https://data-api.polymarket.com) */
  baseUrl?: string;
  /**
   * Gamma API base URL (default: https://gamma-api.polymarket.com).
   * Only used by `resolveUsername` — Gamma has a different host than the Data API.
   */
  gammaBaseUrl?: string;
  /** Optional fetch implementation for tests (default: global fetch). */
  fetch?: typeof fetch;
  /**
   * Hard timeout per request in milliseconds (default 5000).
   * Protects downstream callers (dashboards, scheduler jobs) from upstream stalls —
   * empirically the API returns in <300ms, so 5s is generous but bounds the worst case.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

export interface ListTopTradersParams {
  /** Rolling time window honored by the API. `ALL` is all-time. */
  timePeriod?: PolymarketLeaderboardTimePeriod;
  /** Sort metric (default: PNL). */
  orderBy?: PolymarketLeaderboardOrderBy;
  /** Max rows (API caps at 50, default: 10). */
  limit?: number;
}

export interface ListUserActivityParams {
  /** Rows per page (API caps at ~500). Default: 100. */
  limit?: number;
  /** Optional offset for pagination. */
  offset?: number;
  /** Only return trades at or after this unix-seconds timestamp. */
  sinceTs?: number;
}

export interface ListUserTradesParams {
  /** Rows per page. Default: 20. Polymarket's `/trades` cache appears to serve a stale page at limits >20 (verified 2026-05-01: limit=1000 was 2min behind limit=20 for an active trader). Callers needing deeper history should paginate or accept staleness. */
  limit?: number;
  /** Optional offset for pagination. */
  offset?: number;
  /** Only return trades at or after this unix-seconds timestamp. */
  sinceTs?: number;
  /** When true, only include fills where the user was the TAKER. Default: false (includes maker fills — required for position tracking). */
  takerOnly?: boolean;
}

export interface ListUserPositionsParams {
  /** Optional conditionId filter. */
  market?: string;
  /** Optional minimum position size (USDC). */
  sizeThreshold?: number;
  /** Optional position cap. */
  limit?: number;
  /** Optional offset for pagination. */
  offset?: number;
}

export interface ListActivityParams {
  /** Filter by event type (TRADE/SPLIT/MERGE/REDEEM/REWARD/CONVERSION). */
  type?: ActivityEventType;
  /** Filter by side when type=TRADE. */
  side?: "BUY" | "SELL";
  /** Unix-seconds lower bound (inclusive). */
  start?: number;
  /** Unix-seconds upper bound (inclusive). */
  end?: number;
  /** Rows per page (1-500). */
  limit?: number;
  /** Pagination offset. */
  offset?: number;
}

export interface GetValueParams {
  /** Optional conditionId filter to restrict valuation to a single market. */
  market?: string;
}

export interface GetHoldersParams {
  /** Max holders to return (1-100). */
  limit?: number;
}

export interface ListMarketTradesParams {
  /** When true, only include trades where the `proxyWallet` was the taker. */
  takerOnly?: boolean;
  /** Rows per page (1-500). */
  limit?: number;
  /** Pagination offset. */
  offset?: number;
}

export interface ResolveUsernameParams {
  /** Max profile matches to return (1-20). */
  limit?: number;
}

/**
 * Polymarket Data API client.
 *
 * Endpoints:
 * - `GET /v1/leaderboard?timePeriod=DAY|WEEK|MONTH|ALL&orderBy=PNL|VOL&limit=<n>`
 * - `GET /trades?user=<wallet>&limit=<n>`
 * - `GET /positions?user=<wallet>&limit=<n>`
 *
 * All endpoints are public — no auth required.
 * Verified against live data 2026-04-17 (see research doc).
 *
 * Note: `/trades` defaults `takerOnly=true` server-side, hiding maker-side
 * fills. `listUserTrades` always sends the param explicitly and defaults to
 * `false` so position-tracking callers (mirror, audit) see every CTF-balance
 * change.

 */
export class PolymarketDataApiClient {
  private readonly baseUrl: string;
  private readonly gammaBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config?: PolymarketDataApiClientConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_DATA_API_BASE_URL;
    this.gammaBaseUrl = config?.gammaBaseUrl ?? DEFAULT_GAMMA_BASE_URL;
    this.fetchImpl = config?.fetch ?? fetch;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async listTopTraders(
    params?: ListTopTradersParams
  ): Promise<PolymarketLeaderboardEntry[]> {
    const url = new URL("/v1/leaderboard", this.baseUrl);
    url.searchParams.set("timePeriod", params?.timePeriod ?? "WEEK");
    url.searchParams.set("orderBy", params?.orderBy ?? "PNL");
    url.searchParams.set("limit", String(params?.limit ?? 10));

    const json = await this.fetchJson(url);
    return PolymarketLeaderboardResponseSchema.parse(json);
  }

  async listUserActivity(
    wallet: string,
    params?: ListUserActivityParams
  ): Promise<PolymarketUserTrade[]> {
    return this.listUserTrades(wallet, params);
  }

  async listUserTrades(
    wallet: string,
    params?: ListUserTradesParams
  ): Promise<PolymarketUserTrade[]> {
    assertWallet(wallet);
    const url = new URL("/trades", this.baseUrl);
    url.searchParams.set("user", wallet);
    url.searchParams.set("limit", String(params?.limit ?? 20));
    url.searchParams.set(
      "takerOnly",
      params?.takerOnly === true ? "true" : "false"
    );
    if (params?.offset !== undefined) {
      url.searchParams.set("offset", String(params.offset));
    }

    const json = await this.fetchJson(url);
    const trades = PolymarketUserTradesResponseSchema.parse(json);

    if (params?.sinceTs !== undefined) {
      const since = params.sinceTs;
      return trades.filter((t) => t.timestamp > since);
    }
    return trades;
  }

  async listUserPositions(
    wallet: string,
    params?: ListUserPositionsParams
  ): Promise<PolymarketUserPosition[]> {
    assertWallet(wallet);
    const url = new URL("/positions", this.baseUrl);
    url.searchParams.set("user", wallet);
    if (params?.market) url.searchParams.set("market", params.market);
    if (params?.sizeThreshold !== undefined) {
      url.searchParams.set("sizeThreshold", String(params.sizeThreshold));
    }
    if (params?.limit !== undefined) {
      url.searchParams.set("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      url.searchParams.set("offset", String(params.offset));
    }

    const json = await this.fetchJson(url);
    return PolymarketUserPositionsResponseSchema.parse(json);
  }

  /**
   * `GET /activity?user=<wallet>` — lifecycle events (TRADE/SPLIT/MERGE/REDEEM/...).
   * Distinct from `/trades`; do not delegate.
   */
  async listActivity(
    wallet: string,
    params?: ListActivityParams
  ): Promise<ActivityEvent[]> {
    assertWallet(wallet);
    const url = new URL("/activity", this.baseUrl);
    url.searchParams.set("user", wallet);
    if (params?.type) url.searchParams.set("type", params.type);
    if (params?.side) url.searchParams.set("side", params.side);
    if (params?.start !== undefined) {
      url.searchParams.set("start", String(params.start));
    }
    if (params?.end !== undefined) {
      url.searchParams.set("end", String(params.end));
    }
    if (params?.limit !== undefined) {
      url.searchParams.set("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      url.searchParams.set("offset", String(params.offset));
    }

    const json = await this.fetchJson(url);
    return parseResponse(ActivityEventsResponseSchema, json, "/activity");
  }

  /**
   * `GET /value?user=<wallet>` — cheap wallet-value probe.
   * Returns the first entry; endpoint is `[{ user, value }]`.
   */
  async getValue(
    wallet: string,
    params?: GetValueParams
  ): Promise<{ user: string; value: number }> {
    assertWallet(wallet);
    const url = new URL("/value", this.baseUrl);
    url.searchParams.set("user", wallet);
    if (params?.market) url.searchParams.set("market", params.market);

    const json = await this.fetchJson(url);
    const entries = parseResponse(UserValueResponseSchema, json, "/value");
    const first = entries[0];
    if (!first) {
      return { user: wallet, value: 0 };
    }
    return { user: first.user, value: first.value };
  }

  /**
   * `GET /holders?market=<conditionId>` — current shareholders on a market.
   * Hidden-gem discovery input for wallet research.
   */
  async getHolders(
    market: string,
    params?: GetHoldersParams
  ): Promise<MarketHolder[]> {
    if (!market || typeof market !== "string") {
      throw new Error("getHolders: market (conditionId) is required");
    }
    const url = new URL("/holders", this.baseUrl);
    url.searchParams.set("market", market);
    if (params?.limit !== undefined) {
      url.searchParams.set("limit", String(params.limit));
    }

    const json = await this.fetchJson(url);
    return parseResponse(MarketHoldersResponseSchema, json, "/holders");
  }

  /**
   * `GET /trades?market=<conditionId>` — market-level trade stream.
   * Used for counterparty harvesting (NOT per-user history — see `listUserTrades`).
   */
  async listMarketTrades(
    market: string,
    params?: ListMarketTradesParams
  ): Promise<MarketTrade[]> {
    if (!market || typeof market !== "string") {
      throw new Error("listMarketTrades: market (conditionId) is required");
    }
    const url = new URL("/trades", this.baseUrl);
    url.searchParams.set("market", market);
    if (params?.takerOnly) url.searchParams.set("takerOnly", "true");
    if (params?.limit !== undefined) {
      url.searchParams.set("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      url.searchParams.set("offset", String(params.offset));
    }

    const json = await this.fetchJson(url);
    return parseResponse(MarketTradesResponseSchema, json, "/trades?market=");
  }

  /**
   * Gamma `GET /public-search?q=<query>&profile=true` — handle → proxyWallet resolution.
   * Note: Gamma is a different host (`gamma-api.polymarket.com`) from the Data API.
   */
  async resolveUsername(
    query: string,
    params?: ResolveUsernameParams
  ): Promise<GammaProfile[]> {
    if (typeof query !== "string" || query.length < 2) {
      throw new Error("resolveUsername: query must be a string of ≥2 chars");
    }
    const url = new URL("/public-search", this.gammaBaseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("profile", "true");
    if (params?.limit !== undefined) {
      url.searchParams.set("limit", String(params.limit));
    }

    const json = await this.fetchJson(url);
    const parsed = parseResponse(
      GammaPublicSearchResponseSchema,
      json,
      "gamma:/public-search"
    );
    return parsed.profiles;
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Polymarket Data API error: ${response.status} ${response.statusText} (${url.pathname})`
        );
      }
      return await response.json();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Polymarket Data API timeout after ${this.timeoutMs}ms (${url.pathname})`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function assertWallet(wallet: string): void {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new Error(`Invalid wallet address: ${wallet}`);
  }
}
