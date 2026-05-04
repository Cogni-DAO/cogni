// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@ports/market-outcomes`
 * Purpose: Persistence contract for `poly_market_outcomes` — the chain-resolution
 *   authority for whether a `(condition_id, token_id)` is a winner or loser.
 *   Populated by the redeem subscriber + catchup from `ConditionResolution`
 *   chain events; read-joined by the dashboard current-position read model so
 *   the UI never reads Polymarket Data-API `raw.redeemable` for classification.
 * Scope: Interface only. No DB access, no chain reads, no Data-API calls.
 * Invariants:
 *   - MARKET_OUTCOMES_IS_CHAIN_AUTHORITY — only the redeem subscriber + catchup
 *     write to this table, sourced from CTF `ConditionResolution` payouts.
 *   - UPSERT_IS_IDEMPOTENT — re-receiving the same chain log produces the same
 *     row state.
 * Side-effects: none (interface).
 * Links: docs/design/poly-redeem-chain-authority.md, bug.5008
 * @public
 */

export type MarketOutcomeKind = "winner" | "loser" | "unknown";

export interface MarketOutcomeUpsertInput {
  conditionId: `0x${string}`;
  /** CTF position id (bigint stringified to preserve precision). */
  tokenId: string;
  outcome: MarketOutcomeKind;
  /** payoutNumerator / payoutDenominator as a decimal string (e.g. "1.0"); null when unknown. */
  payout: string | null;
  /** Block timestamp of the resolution event when known; otherwise now(). */
  resolvedAt: Date | null;
  /** Raw chain log payload (decoded) for forensic recovery. */
  raw: Record<string, unknown>;
}

export interface MarketOutcomesPort {
  upsert(input: MarketOutcomeUpsertInput): Promise<void>;
}
