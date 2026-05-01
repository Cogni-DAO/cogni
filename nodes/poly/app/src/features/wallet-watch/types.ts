// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-watch/types`
 * Purpose: Generic port shape + metric names for any source of Polymarket wallet activity. v0+ ships the WS-driven adapter (`polymarket-ws-source.ts`) as the only implementation; this module exists so the port is not coupled to one adapter.
 * Scope: Types + constants only. No IO, no env reads, no logger or metrics behavior.
 * Invariants: CURSOR_IS_MAX_TIMESTAMP — `newSince` is the max `trade.timestamp` (unix seconds) seen in the tick.
 * Side-effects: none
 * Links: docs/spec/poly-copy-trade-phase1.md
 * @public
 */

import type { Fill } from "@cogni/poly-market-provider";

/** Metric names emitted by Polymarket-flavored wallet-activity sources. */
export const WALLET_WATCH_METRICS = {
  /** `poly_mirror_data_api_skip_total{reason}` — one of `PolymarketNormalizeSkipReason`. */
  skipTotal: "poly_mirror_data_api_skip_total",
  /** `poly_mirror_data_api_fills_total` — raw trades observed + normalized. */
  fillsTotal: "poly_mirror_data_api_fills_total",
  /** `poly_mirror_data_api_fetch_duration_ms` — HTTP round-trip + parse. */
  fetchDurationMs: "poly_mirror_data_api_fetch_duration_ms",
  /** `poly_mirror_data_api_normalize_error_total` — normalizer threw; row skipped, cursor still advances. */
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

export interface WalletActivitySource {
  fetchSince(since?: number): Promise<NextFillsResult>;
}
