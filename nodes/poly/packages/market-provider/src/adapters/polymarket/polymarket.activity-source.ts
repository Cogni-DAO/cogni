// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/adapters/polymarket/activity-source`
 * Purpose: Generic Polymarket Data-API wallet activity source that emits normalized fills from public wallet activity.
 * Scope: Package-level adapter helper. Caller injects client, logger, metrics, and scheduling/cursor ownership.
 * Invariants:
 *   - PACKAGES_NO_ENV: no env reads, lifecycle, or app imports.
 *   - CURSOR_IS_MAX_TIMESTAMP: `newSince` is the max trade timestamp observed in this fetch.
 * Side-effects: IO through injected Data API client plus caller-provided logger/metrics ports.
 * Links: docs/design/poly-copy-target-performance-benchmark.md, work/items/task.5005
 * @public
 */

import type { Fill } from "../../domain/order.js";
import type { LoggerPort, MetricsPort } from "../../port/observability.port.js";
import type { PolymarketDataApiClient } from "./polymarket.data-api.client.js";
import {
  normalizePolymarketDataApiFill,
  type PolymarketNormalizeSkipReason,
} from "./polymarket.normalize-fill.js";

const POLY_WALLET_WATCH_FETCH_EVENT = "poly.wallet_watch.fetch";
const POLY_WALLET_WATCH_NORMALIZE_ERROR_EVENT =
  "poly.wallet_watch.normalize_error";

/** Metric names emitted by the Polymarket activity source. */
export const POLYMARKET_ACTIVITY_SOURCE_METRICS = {
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
 * normalized `Fill[]` fits this shape.
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
  /** Caller-supplied metrics sink. */
  metrics: MetricsPort;
  /**
   * Page size forwarded to the Data-API (cap is ~500 server-side). Callers that
   * expect bursty targets can raise this to avoid missing trades between polls.
   */
  limit?: number;
  /**
   * Max Data-API pages to read per tick. Defaults to 1 for the legacy mirror
   * path; live trader observation sets this higher and stops at the prior
   * watermark.
   */
  maxPages?: number;
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
      const baseFields = {
        event: POLY_WALLET_WATCH_FETCH_EVENT,
        wallet: deps.wallet,
        since: since ?? null,
      };

      const pageLimit = deps.limit ?? 20;
      const maxPages = Math.max(1, deps.maxPages ?? 1);
      const trades: Awaited<
        ReturnType<PolymarketDataApiClient["listUserActivity"]>
      > = [];
      let reachedSince = false;
      for (let page = 0; page < maxPages; page += 1) {
        const params: { sinceTs?: number; limit: number; offset: number } = {
          limit: pageLimit,
          offset: page * pageLimit,
        };
        if (since !== undefined) params.sinceTs = since;
        const pageTrades = await deps.client.listUserActivity(
          deps.wallet,
          params
        );
        trades.push(...pageTrades);
        reachedSince =
          since !== undefined &&
          pageTrades.some((trade) => trade.timestamp <= since);
        if (pageTrades.length < pageLimit || reachedSince) break;
      }
      const duration_ms = Date.now() - start;
      deps.metrics.observeDurationMs(
        POLYMARKET_ACTIVITY_SOURCE_METRICS.fetchDurationMs,
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
        let result: ReturnType<typeof normalizePolymarketDataApiFill>;
        try {
          result = normalizePolymarketDataApiFill(trade);
        } catch (err: unknown) {
          deps.metrics.incr(
            POLYMARKET_ACTIVITY_SOURCE_METRICS.normalizeErrorsTotal,
            {}
          );
          log.warn(
            {
              event: POLY_WALLET_WATCH_NORMALIZE_ERROR_EVENT,
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
        deps.metrics.incr(POLYMARKET_ACTIVITY_SOURCE_METRICS.skipTotal, {
          reason: result.reason,
        });
      }

      deps.metrics.incr(POLYMARKET_ACTIVITY_SOURCE_METRICS.fillsTotal, {});

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
          max_pages: maxPages,
          page_limit: pageLimit,
          reached_since: reachedSince,
        },
        "wallet-watch fetch: ok"
      );

      return { fills, newSince };
    },
  };
}
