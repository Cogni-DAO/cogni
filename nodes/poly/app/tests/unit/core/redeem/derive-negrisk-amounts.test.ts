// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: tests/unit/core/redeem/derive-negrisk-amounts
 * Purpose: Verify the YES/NO amounts derivation for NegRiskAdapter.redeemPositions.
 * Scope: Pure logic only.
 * Links: src/core/redeem/derive-negrisk-amounts.ts
 */

import { describe, expect, it } from "vitest";

import { deriveNegRiskAmounts, InvalidNegRiskOutcomeIndexError } from "@/core";

describe("deriveNegRiskAmounts", () => {
  it("YES side (index 0) → [balance, 0]", () => {
    expect(deriveNegRiskAmounts(0, 1234n)).toEqual([1234n, 0n]);
  });

  it("NO side (index 1) → [0, balance]", () => {
    expect(deriveNegRiskAmounts(1, 1234n)).toEqual([0n, 1234n]);
  });

  it("zero balance is preserved for both sides", () => {
    expect(deriveNegRiskAmounts(0, 0n)).toEqual([0n, 0n]);
    expect(deriveNegRiskAmounts(1, 0n)).toEqual([0n, 0n]);
  });

  it.each([
    2, -1, 3, 100,
  ])("throws on out-of-range outcomeIndex=%i (neg-risk markets are binary)", (idx) => {
    expect(() => deriveNegRiskAmounts(idx, 1n)).toThrow(
      InvalidNegRiskOutcomeIndexError
    );
  });
});
