// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/redeem/derive-negrisk-amounts`
 * Purpose: Translate Capability A's `outcomeIndex + funder balance` into the
 *   `[yes, no]` amounts vector that `NegRiskAdapter.redeemPositions(conditionId,
 *   amounts)` expects. Pure boundary helper — keeps `decideRedeem`'s output
 *   shape stable while letting the worker dispatch correctly to the adapter.
 * Scope: Single pure function. No I/O.
 * Invariants:
 *   - NegRiskAdapter ABI: `redeemPositions(bytes32 conditionId, uint256[] amounts)`
 *     where `amounts.length === 2` and the index is YES=0, NO=1.
 *   - Funder cannot simultaneously hold both YES and NO sides at non-zero amounts
 *     in this v0.2 path (Polymarket's neg-risk children are single-sided).
 * Side-effects: none
 * Links: docs/design/poly-positions.md § Three-subscription topology, task.0388 § Dispatch table
 * @public
 */

/** YES is index 0; NO is index 1. */
export type NegRiskAmounts = readonly [yesAmount: bigint, noAmount: bigint];

export class InvalidNegRiskOutcomeIndexError extends Error {
  constructor(outcomeIndex: number) {
    super(
      `NegRiskAdapter.redeemPositions expects outcomeIndex ∈ {0,1}; got ${outcomeIndex}`
    );
    this.name = "InvalidNegRiskOutcomeIndexError";
  }
}

/**
 * Map (outcomeIndex, balance) → `[yesAmount, noAmount]` for NegRiskAdapter.
 *
 * - `outcomeIndex === 0` (YES holder) → `[balance, 0n]`
 * - `outcomeIndex === 1` (NO holder)  → `[0n, balance]`
 *
 * Throws on any other outcomeIndex — neg-risk markets are binary by
 * construction, so any other value indicates either a bad input from
 * Capability A or a malformed market.
 */
export function deriveNegRiskAmounts(
  outcomeIndex: number,
  balance: bigint
): NegRiskAmounts {
  if (outcomeIndex === 0) {
    return [balance, 0n] as const;
  }
  if (outcomeIndex === 1) {
    return [0n, balance] as const;
  }
  throw new InvalidNegRiskOutcomeIndexError(outcomeIndex);
}
