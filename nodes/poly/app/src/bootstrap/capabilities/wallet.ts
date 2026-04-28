// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/wallet`
 * Purpose: Factory for WalletCapability — bridges ai-tools capability interface to the Polymarket Data API client.
 * Scope: Creates WalletCapability using the public Polymarket Data API (no auth). Enriches leaderboard entries with
 *        trade counts via one extra /trades call per wallet. Does not hold private keys or place trades.
 * Invariants:
 *   - NO_SECRETS_IN_CONTEXT: Polymarket Data API is public — nothing to redact
 *   - READ_ONLY: No order placement path touched from this capability
 *   - CAPABILITY_NOT_POLICY: Raw scoreboard only; ranking policy lives in tool consumers
 * Side-effects: none (factory only; returned closures do IO)
 * Links: packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts, work/items/task.0315
 * @internal
 */

import { PolymarketDataApiClient } from "@cogni/market-provider/adapters/polymarket";
import type {
  WalletCapability,
  WalletTopTraderItem,
  WalletTopTradersOutput,
} from "@cogni/poly-ai-tools";
import { makeLogger } from "@/shared/observability";

const log = makeLogger({ component: "wallet-capability" });

/**
 * Cap applied to the enrichment /trades call per wallet.
 * API pagination caps at 500; we set matching ceiling and surface
 * `numTradesCapped=true` when saturated so callers know the count is a lower bound.
 */
const TRADES_ENRICHMENT_LIMIT = 500;

/**
 * Max wallets we will enrich with num-trades per request. Keeps the fan-out bounded
 * (10 wallets × 1 call ≈ 2 s wall-clock against the live API).
 */
const DEFAULT_TOP_N = 10;

/**
 * Create a WalletCapability backed by the Polymarket Data API.
 *
 * - Leaderboard: always available (public, no auth).
 * - Num-trades enrichment: one `/trades?user=<wallet>&limit=500` call per wallet, concurrent.
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

  return {
    listTopTraders: async (params): Promise<WalletTopTradersOutput> => {
      const limit = params.limit ?? DEFAULT_TOP_N;
      const entries = await client.listTopTraders({
        timePeriod: params.timePeriod,
        orderBy: params.orderBy ?? "PNL",
        limit,
      });

      const withTrades = await Promise.all(
        entries.map(async (e): Promise<WalletTopTraderItem> => {
          // Enrichment is best-effort: if /trades fails for one wallet,
          // surface 0 rather than failing the whole scoreboard.
          // Logged so a systemic upstream failure (rate limit, outage) is
          // visible rather than appearing as "all wallets have 0 trades".
          let numTrades = 0;
          try {
            const trades = await client.listUserActivity(e.proxyWallet, {
              limit: TRADES_ENRICHMENT_LIMIT,
            });
            numTrades = trades.length;
          } catch (err) {
            log.warn(
              {
                wallet: e.proxyWallet,
                err: err instanceof Error ? err.message : String(err),
              },
              "wallet-top-traders enrichment: /trades call failed; numTrades reported as 0"
            );
          }
          const numTradesCapped = numTrades >= TRADES_ENRICHMENT_LIMIT;
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
      );

      return {
        traders: withTrades,
        timePeriod: params.timePeriod,
        orderBy: params.orderBy ?? "PNL",
        totalCount: withTrades.length,
      };
    },
  };
}
