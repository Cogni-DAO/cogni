// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/wallet`
 * Purpose: Factory for WalletCapability — bridges ai-tools capability interface to the Polymarket Data API client.
 * Scope: Creates WalletCapability using the public Polymarket Data API (no auth). Provides windowed per-wallet
 *        stats (volume, trades, PnL) with a module-level 60s TTL cache keyed by (wallet, timePeriod).
 *        listTopTraders enriches numTrades via the windowed /trades endpoint (not /activity).
 * Invariants:
 *   - NO_SECRETS_IN_CONTEXT: Polymarket Data API is public — nothing to redact
 *   - READ_ONLY: No order placement path touched from this capability
 *   - CAPABILITY_NOT_POLICY: Raw scoreboard only; ranking policy lives in tool consumers
 * Side-effects: none (factory only; returned closures do IO); module-level cache is intentional shared state
 * Links: packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts, work/items/task.0346
 * @internal
 */

import type {
  WalletCapability,
  WalletTopTraderItem,
  WalletTopTradersOutput,
  WalletWindowStats,
} from "@cogni/ai-tools";
import { PolymarketDataApiClient } from "@cogni/market-provider/adapters/polymarket";
import pLimit from "p-limit";
import { makeLogger } from "@/shared/observability";

const log = makeLogger({ component: "wallet-capability" });

/** Fetch cap for windowed trade counts. /trades supports up to 10k rows. */
const TRADES_LIMIT = 10_000;

/** Default leaderboard size. */
const DEFAULT_TOP_N = 10;

/** Cache TTL in ms — 60s matches the spec. */
const CACHE_TTL_MS = 60_000;

/** Bounded concurrency for per-wallet enrichment fan-out. */
const ENRICH_CONCURRENCY = 4;

// ─────────────────────────────────────────────────────────────────────────────
// Module-level cache: (wallet:timePeriod) → WalletWindowStats
// Survives across requests within a single worker process.
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: WalletWindowStats;
  exp: number;
}

const statsCache = new Map<string, CacheEntry>();

function cacheGet(
  address: string,
  timePeriod: string
): WalletWindowStats | null {
  const entry = statsCache.get(`${address.toLowerCase()}:${timePeriod}`);
  if (!entry || Date.now() > entry.exp) return null;
  return entry.data;
}

function cacheSet(
  address: string,
  timePeriod: string,
  data: WalletWindowStats
): void {
  statsCache.set(`${address.toLowerCase()}:${timePeriod}`, {
    data,
    exp: Date.now() + CACHE_TTL_MS,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type TimePeriod = "DAY" | "WEEK" | "MONTH" | "ALL";

function tsForPeriod(timePeriod: TimePeriod): number | undefined {
  const now = Math.floor(Date.now() / 1000);
  if (timePeriod === "DAY") return now - 86_400;
  if (timePeriod === "WEEK") return now - 7 * 86_400;
  if (timePeriod === "MONTH") return now - 30 * 86_400;
  return undefined; // ALL — no time filter
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a WalletCapability backed by the Polymarket Data API.
 *
 * - Leaderboard: always available (public, no auth).
 * - getWalletWindowStats: windowed stats from /trades + /positions. Module-level 60s cache.
 * - listTopTraders: uses getWalletWindowStats for windowed numTrades (cache hit after first).
 */
export function createWalletCapability(config?: {
  /** Override base URL (e.g. in tests). */
  baseUrl?: string;
  /** Override fetch (e.g. in tests). */
  fetch?: typeof fetch;
}): WalletCapability {
  const client = new PolymarketDataApiClient({
    ...(config?.baseUrl !== undefined && { baseUrl: config.baseUrl }),
    ...(config?.fetch !== undefined && { fetch: config.fetch }),
  });

  async function getWalletWindowStats(params: {
    address: string;
    timePeriod: TimePeriod;
  }): Promise<WalletWindowStats> {
    const { address, timePeriod } = params;

    const cached = cacheGet(address, timePeriod);
    if (cached) return cached;

    const sinceTs = tsForPeriod(timePeriod);
    const computedAt = new Date().toISOString();

    // Fetch trades for volume + numTrades (windowed via sinceTs)
    const trades = await client.listUserTrades(address, {
      ...(sinceTs !== undefined ? { sinceTs } : {}),
      limit: TRADES_LIMIT,
    });

    const numTrades = trades.length;
    const numTradesCapped = numTrades >= TRADES_LIMIT;
    const volumeUsdc = trades.reduce((sum, t) => sum + t.size * t.price, 0);

    // Authoritative PnL: Polymarket positions API (cashPnl + realizedPnl per open position)
    // Fallback: trade cashflow (BUY outflows negative, SELL inflows positive)
    let pnlUsdc: number;
    let pnlKind: "authoritative" | "estimated";
    try {
      const positions = await client.listUserPositions(address);
      pnlUsdc = positions.reduce(
        (sum, p) => sum + p.cashPnl + p.realizedPnl,
        0
      );
      pnlKind = "authoritative";
    } catch {
      pnlUsdc = trades.reduce((sum, t) => {
        const cashflow = t.size * t.price;
        return t.side === "BUY" ? sum - cashflow : sum + cashflow;
      }, 0);
      pnlKind = "estimated";
    }

    const roiPct = volumeUsdc > 0 ? (pnlUsdc / volumeUsdc) * 100 : null;

    const result: WalletWindowStats = {
      proxyWallet: address.toLowerCase(),
      timePeriod,
      volumeUsdc,
      pnlUsdc,
      pnlKind,
      roiPct,
      numTrades,
      numTradesCapped,
      computedAt,
    };

    cacheSet(address, timePeriod, result);
    return result;
  }

  return {
    getWalletWindowStats,

    listTopTraders: async (params): Promise<WalletTopTradersOutput> => {
      const limit = params.limit ?? DEFAULT_TOP_N;
      const timePeriod = params.timePeriod ?? ("WEEK" as const);

      const entries = await client.listTopTraders({
        timePeriod,
        orderBy: params.orderBy ?? "PNL",
        limit,
      });

      // Enrich each leaderboard entry with windowed numTrades from /trades.
      // Uses the module-level cache — repeated calls within 60s are free.
      // Concurrency bounded to ENRICH_CONCURRENCY to avoid fan-out spikes.
      const limiter = pLimit(ENRICH_CONCURRENCY);

      const withTrades = await Promise.all(
        entries.map(
          (e): Promise<WalletTopTraderItem> =>
            limiter(async () => {
              let numTrades = 0;
              let numTradesCapped = false;
              try {
                const stats = await getWalletWindowStats({
                  address: e.proxyWallet,
                  timePeriod,
                });
                numTrades = stats.numTrades;
                numTradesCapped = stats.numTradesCapped;
              } catch (err) {
                log.warn(
                  {
                    wallet: e.proxyWallet,
                    err: err instanceof Error ? err.message : String(err),
                  },
                  "wallet-top-traders enrichment: getWalletWindowStats failed; numTrades reported as 0"
                );
              }
              const roiPct = e.vol > 0 ? (e.pnl / e.vol) * 100 : null;

              return {
                rank: Number.parseInt(e.rank, 10) || 0,
                proxyWallet: e.proxyWallet,
                userName: e.userName || e.proxyWallet,
                volumeUsdc: e.vol,
                pnlUsdc: e.pnl,
                roiPct,
                numTrades,
                numTradesCapped,
                verified: e.verifiedBadge,
              };
            })
        )
      );

      return {
        traders: withTrades,
        timePeriod,
        orderBy: params.orderBy ?? "PNL",
        totalCount: withTrades.length,
      };
    },
  };
}
