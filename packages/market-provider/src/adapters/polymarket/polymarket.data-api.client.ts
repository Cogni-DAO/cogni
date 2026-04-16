// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket/polymarket.data-api.client`
 * Purpose: Client for the public Polymarket Data API — leaderboard, user activity, user positions.
 * Scope: HTTP fetch + Zod validation against the Polymarket Data API. Does not load env, does not manage
 *        credentials, does not place orders, does not implement `MarketProviderPort`.
 * Invariants: PACKAGES_NO_ENV, READ_ONLY, CONTRACT_IS_SOT.
 * Side-effects: IO (HTTP fetch to https://data-api.polymarket.com)
 * Links: work/items/task.0315.poly-copy-trade-prototype.md, docs/research/poly-copy-trading-wallets.md
 * @public
 */

import {
  type PolymarketLeaderboardEntry,
  type PolymarketLeaderboardOrderBy,
  PolymarketLeaderboardResponseSchema,
  type PolymarketLeaderboardTimePeriod,
  type PolymarketUserPosition,
  PolymarketUserPositionsResponseSchema,
  type PolymarketUserTrade,
  PolymarketUserTradesResponseSchema,
} from "./polymarket.data-api.types.js";

const DEFAULT_DATA_API_BASE_URL = "https://data-api.polymarket.com";

export interface PolymarketDataApiClientConfig {
  /** Data API base URL (default: https://data-api.polymarket.com) */
  baseUrl?: string;
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
  /** Only return trades at or after this unix-seconds timestamp. */
  sinceTs?: number;
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
 */
export class PolymarketDataApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config?: PolymarketDataApiClientConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_DATA_API_BASE_URL;
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
    assertWallet(wallet);
    const url = new URL("/trades", this.baseUrl);
    url.searchParams.set("user", wallet);
    url.searchParams.set("limit", String(params?.limit ?? 100));

    const json = await this.fetchJson(url);
    const trades = PolymarketUserTradesResponseSchema.parse(json);

    if (params?.sinceTs !== undefined) {
      const since = params.sinceTs;
      return trades.filter((t) => t.timestamp >= since);
    }
    return trades;
  }

  async listUserPositions(wallet: string): Promise<PolymarketUserPosition[]> {
    assertWallet(wallet);
    const url = new URL("/positions", this.baseUrl);
    url.searchParams.set("user", wallet);

    const json = await this.fetchJson(url);
    return PolymarketUserPositionsResponseSchema.parse(json);
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
