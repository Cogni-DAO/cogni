// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-watch/polymarket-source`
 * Purpose: `WalletActivitySource` port + Polymarket Data-API adapter. Emits normalized `Fill[]` for a target wallet since a prior cursor. Used by the mirror-coordinator (CP4.3d) and, in the future, by any feature that needs to observe a Polymarket wallet (PnL tracker, audit view, research tool).
 * Scope: Pure adapter over `@cogni/market-provider`'s `PolymarketDataApiClient` + `normalizePolymarketDataApiFill`. Does not build the HTTP client (caller injects); does not read env; does not place orders. Knows nothing about copy-trade vocabulary.
 * Invariants:
 *   - WALLET_WATCH_IS_GENERIC — MUST NOT import from `features/copy-trade/` or `features/trading/`. Emits `Fill[]` only.
 *   - DA_EMPTY_HASH_REJECTED — empty-tx rows dropped + counter-incremented; the underlying normalizer is pinned to `fill_id = "data-api:<tx>:<asset>:<side>:<ts>"`.
 *   - CURSOR_IS_MAX_TIMESTAMP — `newSince` is the max `trade.timestamp` seen in this tick (unix seconds). Callers persist + feed back on the next tick.
 * Side-effects: IO (HTTPS to `data-api.polymarket.com` via the injected client); logger + metrics.
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (CP4.3c), docs/spec/poly-copy-trade-phase1.md
 * @public
 */

import type { Fill, LoggerPort, MetricsPort } from "@cogni/market-provider";
import {
  normalizePolymarketDataApiFill,
  type PolymarketDataApiClient,
  type PolymarketNormalizeSkipReason,
} from "@cogni/market-provider/adapters/polymarket";
import { EVENT_NAMES } from "@cogni/node-shared";

/** Metric names emitted by the Polymarket activity source. */
export const WALLET_WATCH_METRICS = {
  /** `poly_mirror_data_api_skip_total{reason}` — one of `PolymarketNormalizeSkipReason`. */
  skipTotal: "poly_mirror_data_api_skip_total",
  /** `poly_mirror_data_api_fills_total` — raw trades observed + normalized. */
  fillsTotal: "poly_mirror_data_api_fills_total",
  /** `poly_mirror_data_api_fetch_duration_ms` — HTTP round-trip + parse. */
  fetchDurationMs: "poly_mirror_data_api_fetch_duration_ms",
  /**
   * `poly_mirror_data_api_normalize_error_total` — normalizer THREW (Zod
   * parse failure or unexpected shape). Skipped row + cursor still advances,
   * so a single malformed trade can't wedge the loop across ticks.
   */
  normalizeErrorsTotal: "poly_mirror_data_api_normalize_error_total",
} as const;

export interface NextFillsResult {
  /** Normalized fills ready to feed the coordinator. Empty if no new activity. */
  fills: Fill[];
  /**
   * Max `trade.timestamp` (unix seconds) seen in this tick. Pass back on the
   * next call via `fetchSince(newSince)` so already-observed rows filter out.
   * If no trades were returned, equals the input `since` (or 0 when undefined).
   */
  newSince: number;
}

/**
 * Generic port — any source of Polymarket wallet activity that produces
 * normalized `Fill[]` fits this shape. v0 = Data-API; P4 swaps in a WS
 * adapter without touching `mirror-coordinator` or the test seams.
 */
export interface WalletActivitySource {
  fetchSince(since?: number): Promise<NextFillsResult>;
}

export interface PolymarketActivitySourceDeps {
  /** Pre-built Data-API client. Bootstrap injects a singleton. */
  client: PolymarketDataApiClient;
  /** The wallet being watched. 0x-prefixed 40-hex. */
  wallet: `0x${string}`;
  /** Caller-supplied structured log sink. */
  logger: LoggerPort;
  /**
   * Caller-supplied metrics sink. Must accept the counter names in
   * `WALLET_WATCH_METRICS`. The `bootstrap/capabilities/poly-trade.ts`
   * `buildMetricsPort` shim is generic and accepts these out of the box.
   */
  metrics: MetricsPort;
  /**
   * Page size forwarded to the Data-API (cap is ~500 server-side). v0 uses
   * the client's default (100) when omitted. Callers that expect bursty
   * targets can raise this to avoid missing trades between polls.
   */
  limit?: number;
}

export function createPolymarketActivitySource(
  deps: PolymarketActivitySourceDeps
): WalletActivitySource {
  const log = deps.logger.child({
    component: "wallet-watch",
    subcomponent: "polymarket-source",
    wallet: deps.wallet,
  });

  return {
    async fetchSince(since?: number): Promise<NextFillsResult> {
      const start = Date.now();
      // Dropped phase=start debug log — low signal, fires every ~30s/target.
      // The phase=ok info log below is the terminal event for the fetch.
      const baseFields = {
        event: EVENT_NAMES.POLY_WALLET_WATCH_FETCH,
        wallet: deps.wallet,
        since: since ?? null,
      };

      const params: { sinceTs?: number; limit?: number } = {};
      if (since !== undefined) params.sinceTs = since;
      if (deps.limit !== undefined) params.limit = deps.limit;
      const trades = await deps.client.listUserActivity(deps.wallet, params);
      const duration_ms = Date.now() - start;
      deps.metrics.observeDurationMs(
        WALLET_WATCH_METRICS.fetchDurationMs,
        duration_ms,
        {}
      );

      let newSince = since ?? 0;
      const fills: Fill[] = [];
      let skipped = 0;
      const skipsByReason: Partial<
        Record<PolymarketNormalizeSkipReason, number>
      > = {};

      for (const trade of trades) {
        if (trade.timestamp > newSince) newSince = trade.timestamp;
        // Defense against upstream schema drift — normalizer does
        // `FillSchema.parse(fill)` which throws on shape violation. Without
        // this catch, a single malformed row would abort the page, leave
        // `newSince` unchanged, and the next tick would replay + re-crash.
        // Skip the row, advance past it, log, and let the loop breathe.
        let result: ReturnType<typeof normalizePolymarketDataApiFill>;
        try {
          result = normalizePolymarketDataApiFill(trade);
        } catch (err: unknown) {
          deps.metrics.incr(WALLET_WATCH_METRICS.normalizeErrorsTotal, {});
          log.warn(
            {
              event: EVENT_NAMES.POLY_WALLET_WATCH_NORMALIZE_ERROR,
              errorCode: "normalizer_threw",
              trade_timestamp: trade.timestamp,
              err: err instanceof Error ? err.message : String(err),
            },
            "normalizer threw; skipping row and advancing cursor"
          );
          continue;
        }
        if (result.ok) {
          fills.push(result.fill);
          continue;
        }
        skipped += 1;
        skipsByReason[result.reason] = (skipsByReason[result.reason] ?? 0) + 1;
        deps.metrics.incr(WALLET_WATCH_METRICS.skipTotal, {
          reason: result.reason,
        });
      }

      deps.metrics.incr(WALLET_WATCH_METRICS.fillsTotal, {});

      log.info(
        {
          ...baseFields,
          phase: "ok",
          duration_ms,
          raw: trades.length,
          fills: fills.length,
          skipped,
          skips_by_reason: skipsByReason,
          new_since: newSince,
        },
        "wallet-watch fetch: ok"
      );

      return { fills, newSince };
    },
  };
}
