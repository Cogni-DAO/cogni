// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/operator-wallet/tests/split-allocation`
 * Purpose: Unit tests for split allocation math — validates operator/DAO allocation derivation.
 * Scope: Tests calculateSplitAllocations() pure function, numberToPpm boundary helper, and exported constants. Does not test adapter or Privy integration.
 * Invariants: Allocations always sum to SPLIT_TOTAL_ALLOCATION; all inputs are bigint PPM.
 * Side-effects: none
 * Links: packages/operator-wallet/src/domain/split-allocation.ts
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  calculateSplitAllocations,
  MINIMUM_PAYMENT_USD,
  numberToPpm,
  OPENROUTER_CRYPTO_FEE_PPM,
  PPM,
  SPLIT_TOTAL_ALLOCATION,
} from "../src/domain/split-allocation.js";

describe("calculateSplitAllocations", () => {
  it("returns expected allocations with default billing params", () => {
    const { operatorAllocation, treasuryAllocation } =
      calculateSplitAllocations(
        2_000_000n,
        750_000n,
        OPENROUTER_CRYPTO_FEE_PPM
      );

    // operatorShare = (1 + 0.75) / (2.0 * 0.95) = 1.75 / 1.9 ≈ 0.921053
    expect(operatorAllocation).toBe(921_053n);
    expect(treasuryAllocation).toBe(78_947n);
  });

  it("allocations always sum to SPLIT_TOTAL_ALLOCATION", () => {
    const params = [
      { markup: 2_000_000n, revenue: 750_000n },
      { markup: 1_500_000n, revenue: 300_000n },
      { markup: 3_000_000n, revenue: 500_000n },
      { markup: 10_000_000n, revenue: 10_000n },
    ];

    for (const { markup, revenue } of params) {
      const { operatorAllocation, treasuryAllocation } =
        calculateSplitAllocations(markup, revenue, OPENROUTER_CRYPTO_FEE_PPM);
      expect(operatorAllocation + treasuryAllocation).toBe(
        SPLIT_TOTAL_ALLOCATION
      );
    }
  });

  it("throws when operatorShare >= 1", () => {
    // markup=1_000_000n (1.0x), revenue=0, fee=50_000n → share = 1/0.95 ≈ 1.053 → >= 1
    expect(() => calculateSplitAllocations(1_000_000n, 0n, 50_000n)).toThrow(
      "Invalid split"
    );
  });

  it("throws when operatorShare <= 0", () => {
    // Negative revenue share that drives share below 0
    expect(() =>
      calculateSplitAllocations(2_000_000n, -2_000_000n, 50_000n)
    ).toThrow("Invalid split");
  });

  it("handles operatorShare close to but not exceeding 1", () => {
    // markup=1_100_000n (1.1x), revenue=0, fee=50_000n → share = 1/(1.1*0.95) ≈ 0.9569
    const { operatorAllocation, treasuryAllocation } =
      calculateSplitAllocations(1_100_000n, 0n, 50_000n);
    expect(operatorAllocation + treasuryAllocation).toBe(
      SPLIT_TOTAL_ALLOCATION
    );
    expect(operatorAllocation).toBeGreaterThan(0n);
    expect(treasuryAllocation).toBeGreaterThan(0n);
  });

  it("uses OPENROUTER_CRYPTO_FEE_PPM as default provider fee", () => {
    const withExplicit = calculateSplitAllocations(
      2_000_000n,
      750_000n,
      OPENROUTER_CRYPTO_FEE_PPM
    );
    const withDefault = calculateSplitAllocations(2_000_000n, 750_000n);
    expect(withDefault.operatorAllocation).toBe(
      withExplicit.operatorAllocation
    );
    expect(withDefault.treasuryAllocation).toBe(
      withExplicit.treasuryAllocation
    );
  });

  it("largest-remainder rounds up when remainder >= half denominator", () => {
    // Verify deterministic rounding via largest-remainder method.
    // With default params: remainder = 1_200_000_000_000 > half of 1_900_000_000_000
    // So operator gets rounded up: 921_052 → 921_053
    const { operatorAllocation } = calculateSplitAllocations(
      2_000_000n,
      750_000n,
      OPENROUTER_CRYPTO_FEE_PPM
    );
    expect(operatorAllocation).toBe(921_053n);
  });

  it("largest-remainder rounds down when remainder < half denominator", () => {
    // markup=2_000_000n (2.0x), revenue=100_000n (10%), fee=50_000n
    // numerator = 1_100_000 * 1_000_000 = 1_100_000_000_000
    // denominator = 2_000_000 * 950_000 / 1_000_000 = 1_900_000
    // quotient = 578_947, remainder = 700_000
    // 2 * 700_000 = 1_400_000 < 1_900_000 → rounds down
    const { operatorAllocation, treasuryAllocation } =
      calculateSplitAllocations(2_000_000n, 100_000n, 50_000n);
    expect(operatorAllocation + treasuryAllocation).toBe(
      SPLIT_TOTAL_ALLOCATION
    );
    expect(operatorAllocation).toBe(578_947n);
  });

  it("throws when markupPpm is 0", () => {
    expect(() => calculateSplitAllocations(0n, 750_000n)).toThrow(
      "markupPpm=0"
    );
  });
});

describe("numberToPpm", () => {
  it("converts whole numbers", () => {
    expect(numberToPpm(2.0)).toBe(2_000_000n);
    expect(numberToPpm(1.0)).toBe(1_000_000n);
  });

  it("converts fractional values", () => {
    expect(numberToPpm(0.75)).toBe(750_000n);
    expect(numberToPpm(0.05)).toBe(50_000n);
  });

  it("converts zero", () => {
    expect(numberToPpm(0)).toBe(0n);
  });

  it("rounds to nearest integer", () => {
    // 0.333333... * 1e6 = 333333.333... → rounds to 333333
    expect(numberToPpm(1 / 3)).toBe(333_333n);
  });
});

describe("exported constants", () => {
  it("OPENROUTER_CRYPTO_FEE_PPM is 50_000 (5%)", () => {
    expect(OPENROUTER_CRYPTO_FEE_PPM).toBe(50_000n);
  });

  it("MINIMUM_PAYMENT_USD is $2", () => {
    expect(MINIMUM_PAYMENT_USD).toBe(2);
  });

  it("SPLIT_TOTAL_ALLOCATION is 1e6", () => {
    expect(SPLIT_TOTAL_ALLOCATION).toBe(1_000_000n);
  });

  it("PPM equals SPLIT_TOTAL_ALLOCATION", () => {
    expect(PPM).toBe(SPLIT_TOTAL_ALLOCATION);
  });
});
