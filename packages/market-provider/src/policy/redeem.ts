// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/policy/redeem`
 * Purpose: Pure decision policy for `redeemPositions` on Polymarket / Polygon CTF — given a snapshot of chain reads, returns a discriminated decision covering binary, neg-risk, and multi-outcome markets. Single source of truth for redeem decisions, consumed by the legacy sweep (task.0387) and the future event-driven worker (task.0388 / task.0377).
 * Scope: Pure function. Does not perform I/O, does not import SDK clients, does not read env.
 * Invariants:
 *   - PURE_POLICY_NO_IO — does not import viem, clob-client, or app/bootstrap.
 *   - WRITE_AUTHORITY_IS_CHAIN_OR_CLOB — inputs are chain-derived only.
 *   - NEG_RISK_REDEEM_IS_DISTINCT — `negativeRisk:true` never routes to `binary`.
 *   - POSITION_IDENTITY_IS_CHAIN_KEYED — caller passes `(funder, positionId)` reads.
 * Side-effects: none
 * Links: docs/design/poly-positions.md, work/items/task.0387, work/items/bug.0384
 * @public
 */

/** Standard CTF parent collection id (32-byte zero) — used for binary,
 * multi-outcome, and neg-risk-parent flavors alike. */
export const REDEEM_PARENT_COLLECTION_ID_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/** Inputs captured from chain reads. Nullables represent failed reads
 * (e.g. multicall `allowFailure: true` returning a non-success result). */
export interface RedeemPolicyInput {
  /** ERC-1155 `balanceOf(funder, positionId)` — funder's share count. */
  balance: bigint | null;
  /** CTF `payoutNumerators(conditionId, outcomeIndex)` — winning numerator
   * for our slot. Zero ⇒ losing. Null ⇒ read failed. */
  payoutNumerator: bigint | null;
  /** CTF `payoutDenominator(conditionId)` — denominator for the resolved
   * market. Zero ⇒ market not yet finalized on-chain. Null ⇒ read failed. */
  payoutDenominator: bigint | null;
  /** Our position's outcome slot index (0-based). */
  outcomeIndex: number | null | undefined;
  /** Total outcome cardinality for the condition (2 for binary; >2 for
   * multi-outcome; always 2 for neg-risk children). */
  outcomeSlotCount: number | null | undefined;
  /** True if the market was issued via the Polymarket neg-risk system. */
  negativeRisk: boolean;
}

/** Why a redeem was skipped — recoverable, not a code defect. */
export type RedeemSkipReason =
  | "zero_balance"
  | "losing_outcome"
  | "market_not_resolved"
  | "read_failed";

/** Why a redeem decision is malformed — caller should NOT retry without a
 * fixture + code fix. These are the design-bug class from bug.0384.
 * See `docs/design/poly-positions.md` § Abandoned-position runbook (Class A). */
export type RedeemMalformedReason =
  | "invalid_outcome_index"
  | "outcome_index_out_of_range"
  | "missing_outcome_slot_count";

/** Which on-chain redeem path the caller should route through.
 *
 * `binary` and `multi-outcome` both call `redeemPositions` against
 * `PARENT_COLLECTION_ID_ZERO` on the standard CTF, so the executor's dispatch
 * is identical for both today. The flavor distinction is **observability +
 * future-proofing**: Loki / Grafana can split metrics by market topology, and
 * a future neg-risk-adapter or multi-outcome-specific dispatch path can
 * switch-exhaustive without ambiguity. Lumping multi-outcome into "binary" was
 * the kind of name-vs-content confusion that produced bug.0384 — the type
 * now matches the documented categorization in `decideRedeem`'s docstring. */
export type RedeemFlavor =
  | "binary"
  | "multi-outcome"
  | "neg-risk-parent"
  /** Reserved for follow-up — neg-risk markets that require the adapter
   * contract instead of CTF. The audit script (task.0387 CP2) will surface
   * which markets need this flavor; until then, `decideRedeem` never emits
   * it. Encoded in the type so callers can switch-exhaustive once it lands. */
  | "neg-risk-adapter";

/** Discriminated decision output. `kind === 'redeem'` is the only case where
 * the caller fires `redeemPositions`; the other two are non-write outcomes. */
export type RedeemDecision =
  | {
      kind: "redeem";
      flavor: RedeemFlavor;
      /** Parent-collection id to pass to `redeemPositions`. */
      parentCollectionId: `0x${string}`;
      /** Index-set array to pass to `redeemPositions`. For neg-risk-parent
       * and multi-outcome, this targets only the winning slot
       * (`1n << outcomeIndex`); for legacy binary it is `[1n, 2n]`. */
      indexSet: bigint[];
      /** ERC-1155 shares we expect to be burned by the tx (informational,
       * for receipt verification). */
      expectedShares: bigint;
      /** USDC.e (6-dp) we expect to receive — `balance * num / den`. */
      expectedPayoutUsdc: bigint;
    }
  | { kind: "skip"; reason: RedeemSkipReason }
  | { kind: "malformed"; reason: RedeemMalformedReason };

/**
 * Decide what to do with a (possibly redeemable) Polymarket / Polygon CTF
 * position. Pure function — no I/O.
 *
 * Decision order (each gate falls through to the next on success):
 *   1. `outcomeIndex` and `outcomeSlotCount` are valid integers
 *   2. `outcomeIndex < outcomeSlotCount`
 *   3. all chain reads succeeded (no nulls) → otherwise skip:read_failed
 *   4. balance > 0 → otherwise skip:zero_balance
 *   5. payoutDenominator > 0 → otherwise skip:market_not_resolved
 *   6. payoutNumerator > 0 → otherwise skip:losing_outcome
 *   7. emit `kind: 'redeem'` with the correct flavor and index-set for the
 *      market topology.
 *
 * Notes on index-set semantics:
 *   - **binary** (slotCount === 2, !negativeRisk): emits `[1n, 2n]`. This is
 *     the historically-correct call for standard binary markets and matches
 *     the previous `BINARY_REDEEM_INDEX_SETS`. CTF only pays for the
 *     winning slot, so passing both is safe (just wasteful by one calldata
 *     element).
 *   - **multi-outcome** (slotCount > 2, !negativeRisk): emits
 *     `[1n << outcomeIndex]` — a single-element bitmask targeting only the
 *     winning slot. Standard CTF semantics.
 *   - **neg-risk-parent** (negativeRisk === true): emits
 *     `[1n << outcomeIndex]`. The bug.0384 bleed was caused by emitting
 *     the binary `[1n, 2n]` index-set against neg-risk markets, which
 *     produces a successful tx receipt with zero `TransferSingle` burn.
 *     This is the malformed-decision class the new policy makes
 *     structurally impossible.
 *   - **neg-risk-adapter**: NOT emitted by this version. Reserved for the
 *     post-audit follow-up (task.0387 CP2). If a neg-risk market truly
 *     requires the adapter contract path, the synthetic-fixture audit will
 *     surface it; until then, all neg-risk positions route through
 *     `neg-risk-parent`.
 */
export function decideRedeem(input: RedeemPolicyInput): RedeemDecision {
  // Gate 1 — outcomeIndex shape
  if (input.outcomeIndex == null || !Number.isFinite(input.outcomeIndex)) {
    return { kind: "malformed", reason: "invalid_outcome_index" };
  }
  if (
    !Number.isInteger(input.outcomeIndex) ||
    input.outcomeIndex < 0 ||
    input.outcomeIndex > 255
  ) {
    return { kind: "malformed", reason: "invalid_outcome_index" };
  }

  // Gate 2 — outcomeSlotCount must be present and outcomeIndex must fit
  if (
    input.outcomeSlotCount == null ||
    !Number.isInteger(input.outcomeSlotCount) ||
    input.outcomeSlotCount < 2
  ) {
    return { kind: "malformed", reason: "missing_outcome_slot_count" };
  }
  if (input.outcomeIndex >= input.outcomeSlotCount) {
    return { kind: "malformed", reason: "outcome_index_out_of_range" };
  }

  // Gate 3 — all chain reads succeeded
  if (
    input.balance === null ||
    input.payoutNumerator === null ||
    input.payoutDenominator === null
  ) {
    return { kind: "skip", reason: "read_failed" };
  }

  // Gate 4 — funder still holds shares
  if (input.balance === 0n) {
    return { kind: "skip", reason: "zero_balance" };
  }

  // Gate 5 — market is finalized on-chain (payoutDenominator > 0).
  // payoutDenominator === 0 means the CTF has not yet recorded a resolution,
  // even if the Polymarket Data-API is already advertising `redeemable: true`.
  // This is the bug.0383 / bug.0384 authority-confusion class.
  if (input.payoutDenominator === 0n) {
    return { kind: "skip", reason: "market_not_resolved" };
  }

  // Gate 6 — our slot won
  if (input.payoutNumerator === 0n) {
    return { kind: "skip", reason: "losing_outcome" };
  }

  // Gate 7 — emit redeem decision with the correct flavor + index-set.
  const expectedShares = input.balance;
  const expectedPayoutUsdc =
    (input.balance * input.payoutNumerator) / input.payoutDenominator;

  if (input.negativeRisk) {
    return {
      kind: "redeem",
      flavor: "neg-risk-parent",
      parentCollectionId: REDEEM_PARENT_COLLECTION_ID_ZERO,
      indexSet: [1n << BigInt(input.outcomeIndex)],
      expectedShares,
      expectedPayoutUsdc,
    };
  }

  if (input.outcomeSlotCount === 2) {
    return {
      kind: "redeem",
      flavor: "binary",
      parentCollectionId: REDEEM_PARENT_COLLECTION_ID_ZERO,
      indexSet: [1n, 2n],
      expectedShares,
      expectedPayoutUsdc,
    };
  }

  return {
    kind: "redeem",
    flavor: "multi-outcome",
    parentCollectionId: REDEEM_PARENT_COLLECTION_ID_ZERO,
    indexSet: [1n << BigInt(input.outcomeIndex)],
    expectedShares,
    expectedPayoutUsdc,
  };
}
