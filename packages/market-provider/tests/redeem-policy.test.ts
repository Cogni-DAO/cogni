// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tests/redeem-policy`
 * Purpose: Unit-test `decideRedeem` against the 7-class fixture matrix from docs/design/poly-positions.md (binary-winner, binary-loser, binary-already-redeemed, neg-risk-parent, neg-risk-adapter, multi-outcome-winner, multi-outcome-loser) plus malformed-input edges.
 * Scope: Pure decision function only. Does not hit any SDK or network.
 * Invariants: COVERAGE_COMPLETE — at least one assertion per design-doc class is preserved on every refactor.
 * Side-effects: none
 * Links: work/items/task.0387, docs/design/poly-positions.md
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  decideRedeem,
  REDEEM_PARENT_COLLECTION_ID_ZERO,
  type RedeemDecision,
  type RedeemPolicyInput,
} from "../src/policy/redeem.js";

const PARENT_ZERO = REDEEM_PARENT_COLLECTION_ID_ZERO;

const baseRedeemableBinary: RedeemPolicyInput = {
  balance: 1_000_000n,
  payoutNumerator: 1n,
  payoutDenominator: 1n,
  outcomeIndex: 0,
  outcomeSlotCount: 2,
  negativeRisk: false,
};

describe("decideRedeem — coverage matrix (task.0387 § ## Validation)", () => {
  // ------------------------------------------------------------------
  // 1. binary-winner — standard 2-outcome CTF, our slot won
  // ------------------------------------------------------------------
  it("binary-winner → kind=redeem, flavor=binary, indexSet=[1n,2n]", () => {
    const d = decideRedeem(baseRedeemableBinary);
    expect(d).toEqual<RedeemDecision>({
      kind: "redeem",
      flavor: "binary",
      parentCollectionId: PARENT_ZERO,
      indexSet: [1n, 2n],
      expectedShares: 1_000_000n,
      expectedPayoutUsdc: 1_000_000n,
    });
  });

  it("binary-winner with payoutNumerator/Denominator scaling", () => {
    // Pari-mutuel partial payout: 3/4 of balance pays out.
    const d = decideRedeem({
      ...baseRedeemableBinary,
      balance: 4_000_000n,
      payoutNumerator: 3n,
      payoutDenominator: 4n,
    });
    if (d.kind !== "redeem") throw new Error("expected redeem");
    expect(d.expectedPayoutUsdc).toBe(3_000_000n);
  });

  // ------------------------------------------------------------------
  // 2. binary-loser — standard 2-outcome, our slot lost
  // ------------------------------------------------------------------
  it("binary-loser → kind=skip, reason=losing_outcome", () => {
    const d = decideRedeem({
      ...baseRedeemableBinary,
      payoutNumerator: 0n,
    });
    expect(d).toEqual({ kind: "skip", reason: "losing_outcome" });
  });

  // ------------------------------------------------------------------
  // 3. binary-already-redeemed — funder's balance went to 0 after a prior
  // redeem; predicate must skip, not refire. This is the bug.0384
  // re-fire-forever class: balance==0 must short-circuit BEFORE any
  // payout-numerator inspection, so a market that was a winner but is now
  // burned cannot be classified as redeemable.
  // ------------------------------------------------------------------
  it("binary-already-redeemed (balance=0, was-winner) → skip:zero_balance", () => {
    const d = decideRedeem({
      ...baseRedeemableBinary,
      balance: 0n,
      payoutNumerator: 1n,
      payoutDenominator: 1n,
    });
    expect(d).toEqual({ kind: "skip", reason: "zero_balance" });
  });

  // ------------------------------------------------------------------
  // 4. neg-risk-parent winner — must NEVER emit binary [1n, 2n]; must
  // emit single-element index-set targeting the winning slot. This is the
  // structural fix for bug.0384.
  // ------------------------------------------------------------------
  it("neg-risk-parent winner (idx=0) → flavor=neg-risk-parent, indexSet=[1n]", () => {
    const d = decideRedeem({
      balance: 9_853_000n,
      payoutNumerator: 1n,
      payoutDenominator: 1n,
      outcomeIndex: 0,
      outcomeSlotCount: 2,
      negativeRisk: true,
    });
    expect(d).toEqual<RedeemDecision>({
      kind: "redeem",
      flavor: "neg-risk-parent",
      parentCollectionId: PARENT_ZERO,
      indexSet: [1n],
      expectedShares: 9_853_000n,
      expectedPayoutUsdc: 9_853_000n,
    });
  });

  it("neg-risk-parent winner (idx=1) → indexSet=[2n] (NEVER [1n,2n])", () => {
    const d = decideRedeem({
      balance: 5_000_000n,
      payoutNumerator: 1n,
      payoutDenominator: 1n,
      outcomeIndex: 1,
      outcomeSlotCount: 2,
      negativeRisk: true,
    });
    if (d.kind !== "redeem") throw new Error("expected redeem");
    expect(d.flavor).toBe("neg-risk-parent");
    expect(d.indexSet).toEqual([2n]);
    // Critical: must NOT be the binary [1n, 2n] that caused the bleed.
    expect(d.indexSet).not.toEqual([1n, 2n]);
  });

  it("neg-risk loser → skip:losing_outcome (not flavor=neg-risk-parent)", () => {
    const d = decideRedeem({
      balance: 60_722_640n,
      payoutNumerator: 0n,
      payoutDenominator: 1n,
      outcomeIndex: 1,
      outcomeSlotCount: 2,
      negativeRisk: true,
    });
    expect(d).toEqual({ kind: "skip", reason: "losing_outcome" });
  });

  // ------------------------------------------------------------------
  // 5. neg-risk-adapter — RESERVED for follow-up. The decideRedeem
  // function in this version never emits this flavor; it routes all
  // neg-risk traffic through neg-risk-parent. The flavor is in the
  // discriminated union so callers can switch-exhaustive once the audit
  // (task.0387 CP2) surfaces which markets need it.
  // ------------------------------------------------------------------
  it("neg-risk-adapter is reserved; current policy never emits it", () => {
    // Smoke-check: any neg-risk input we feed in does not produce an
    // `adapter` flavor today. If this ever flips, bump the test and the
    // module docstring together.
    const d = decideRedeem({
      balance: 1_000_000n,
      payoutNumerator: 1n,
      payoutDenominator: 1n,
      outcomeIndex: 0,
      outcomeSlotCount: 2,
      negativeRisk: true,
    });
    if (d.kind !== "redeem") throw new Error("expected redeem");
    expect(d.flavor).not.toBe("neg-risk-adapter");
  });

  // ------------------------------------------------------------------
  // 6. multi-outcome-winner — slotCount > 2, our slot won. Index-set is
  // a single-element bitmask, NOT [1n, 2n].
  // ------------------------------------------------------------------
  it("multi-outcome winner (slotCount=4, idx=2) → flavor=multi-outcome, indexSet=[4n]", () => {
    const d = decideRedeem({
      balance: 1_000_000n,
      payoutNumerator: 1n,
      payoutDenominator: 1n,
      outcomeIndex: 2,
      outcomeSlotCount: 4,
      negativeRisk: false,
    });
    if (d.kind !== "redeem") throw new Error("expected redeem");
    expect(d.flavor).toBe("multi-outcome");
    expect(d.indexSet).toEqual([4n]); // 1n << 2n — single-slot bitmask, NOT [1n,2n]
  });

  // ------------------------------------------------------------------
  // 7. multi-outcome-loser — slotCount > 2, our slot lost
  // ------------------------------------------------------------------
  it("multi-outcome loser → skip:losing_outcome", () => {
    const d = decideRedeem({
      balance: 1_000_000n,
      payoutNumerator: 0n,
      payoutDenominator: 1n,
      outcomeIndex: 1,
      outcomeSlotCount: 5,
      negativeRisk: false,
    });
    expect(d).toEqual({ kind: "skip", reason: "losing_outcome" });
  });
});

describe("decideRedeem — skip classes (recoverable)", () => {
  it("zero balance → skip:zero_balance", () => {
    const d = decideRedeem({ ...baseRedeemableBinary, balance: 0n });
    expect(d).toEqual({ kind: "skip", reason: "zero_balance" });
  });

  it("payoutDenominator=0 (market unresolved) → skip:market_not_resolved", () => {
    // bug.0383 / bug.0384 authority confusion: Data-API said redeemable,
    // chain says payoutDenominator==0 (no resolution recorded). We must
    // skip without firing.
    const d = decideRedeem({
      ...baseRedeemableBinary,
      payoutDenominator: 0n,
      payoutNumerator: 0n,
    });
    expect(d).toEqual({ kind: "skip", reason: "market_not_resolved" });
  });

  it("payoutDenominator=0 takes precedence over payoutNumerator value", () => {
    // Even if numerator were non-zero, denominator==0 means market not
    // resolved — division would be undefined.
    const d = decideRedeem({
      ...baseRedeemableBinary,
      payoutDenominator: 0n,
      payoutNumerator: 5n,
    });
    expect(d).toEqual({ kind: "skip", reason: "market_not_resolved" });
  });

  it("balance=null (read failed) → skip:read_failed", () => {
    const d = decideRedeem({ ...baseRedeemableBinary, balance: null });
    expect(d).toEqual({ kind: "skip", reason: "read_failed" });
  });

  it("payoutNumerator=null (read failed) → skip:read_failed", () => {
    const d = decideRedeem({
      ...baseRedeemableBinary,
      payoutNumerator: null,
    });
    expect(d).toEqual({ kind: "skip", reason: "read_failed" });
  });

  it("payoutDenominator=null (read failed) → skip:read_failed", () => {
    const d = decideRedeem({
      ...baseRedeemableBinary,
      payoutDenominator: null,
    });
    expect(d).toEqual({ kind: "skip", reason: "read_failed" });
  });
});

describe("decideRedeem — malformed inputs (design defect class)", () => {
  it("outcomeIndex=null → malformed:invalid_outcome_index", () => {
    const d = decideRedeem({ ...baseRedeemableBinary, outcomeIndex: null });
    expect(d).toEqual({ kind: "malformed", reason: "invalid_outcome_index" });
  });

  it("outcomeIndex=undefined → malformed:invalid_outcome_index", () => {
    const d = decideRedeem({
      ...baseRedeemableBinary,
      outcomeIndex: undefined,
    });
    expect(d).toEqual({ kind: "malformed", reason: "invalid_outcome_index" });
  });

  it("outcomeIndex=NaN → malformed:invalid_outcome_index", () => {
    const d = decideRedeem({
      ...baseRedeemableBinary,
      outcomeIndex: Number.NaN,
    });
    expect(d).toEqual({ kind: "malformed", reason: "invalid_outcome_index" });
  });

  it("outcomeIndex=-1 → malformed:invalid_outcome_index", () => {
    const d = decideRedeem({ ...baseRedeemableBinary, outcomeIndex: -1 });
    expect(d).toEqual({ kind: "malformed", reason: "invalid_outcome_index" });
  });

  it("outcomeIndex=1.5 (non-integer) → malformed:invalid_outcome_index", () => {
    const d = decideRedeem({ ...baseRedeemableBinary, outcomeIndex: 1.5 });
    expect(d).toEqual({ kind: "malformed", reason: "invalid_outcome_index" });
  });

  it("outcomeIndex >= outcomeSlotCount → malformed:outcome_index_out_of_range", () => {
    const d = decideRedeem({
      ...baseRedeemableBinary,
      outcomeIndex: 2,
      outcomeSlotCount: 2,
    });
    expect(d).toEqual({
      kind: "malformed",
      reason: "outcome_index_out_of_range",
    });
  });

  it("outcomeSlotCount=undefined → malformed:missing_outcome_slot_count", () => {
    const d = decideRedeem({
      ...baseRedeemableBinary,
      outcomeSlotCount: undefined,
    });
    expect(d).toEqual({
      kind: "malformed",
      reason: "missing_outcome_slot_count",
    });
  });

  it("outcomeSlotCount=1 (non-binary, non-multi) → malformed", () => {
    const d = decideRedeem({
      ...baseRedeemableBinary,
      outcomeSlotCount: 1,
    });
    expect(d).toEqual({
      kind: "malformed",
      reason: "missing_outcome_slot_count",
    });
  });
});

describe("decideRedeem — purity invariant (PURE_POLICY_NO_IO)", () => {
  it("returns consistent output for identical input across calls", () => {
    const a = decideRedeem(baseRedeemableBinary);
    const b = decideRedeem(baseRedeemableBinary);
    expect(a).toEqual(b);
  });

  it("does not mutate input object", () => {
    const input = { ...baseRedeemableBinary };
    const before = JSON.stringify(input, (_, v) =>
      typeof v === "bigint" ? v.toString() : v
    );
    decideRedeem(input);
    const after = JSON.stringify(input, (_, v) =>
      typeof v === "bigint" ? v.toString() : v
    );
    expect(after).toBe(before);
  });
});
