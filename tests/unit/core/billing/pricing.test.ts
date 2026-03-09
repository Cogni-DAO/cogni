// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/core/billing/pricing`
 * Purpose: Unit tests for pricing helpers and revenue share math.
 * Scope: Verifies calculateLlmUserCharge, calculateRevenueShareBonus, and CREDITS_PER_USD constant. Does not test policy layer.
 * Invariants: Single ceil at the end; markup applied before rounding.
 * Side-effects: none
 * Links: `src/core/billing/pricing.ts`
 */

import { describe, expect, it } from "vitest";
import {
  CREDITS_PER_USD,
  calculateLlmUserCharge,
  calculateRevenueShareBonus,
  usdCentsToCredits,
  usdToCredits,
} from "@/core/billing/pricing";

describe("Pricing Logic", () => {
  describe("CREDITS_PER_USD constant", () => {
    it("is 10 million (1 credit = $0.0000001)", () => {
      expect(CREDITS_PER_USD).toBe(10_000_000);
    });
  });

  describe("usdToCredits", () => {
    it("converts USD to credits using CREDITS_PER_USD constant", () => {
      // $1.00 = 10,000,000 credits
      expect(usdToCredits(1.0)).toBe(10_000_000n);
      // $0.0000001 = 1 credit
      expect(usdToCredits(0.0000001)).toBe(1n);
    });

    it("rounds up fractional credits (ceil)", () => {
      // $0.00000015 = 1.5 credits → 2 credits
      expect(usdToCredits(0.00000015)).toBe(2n);
      // $0.00000011 = 1.1 credits → 2 credits
      expect(usdToCredits(0.00000011)).toBe(2n);
    });

    it("handles zero cost", () => {
      expect(usdToCredits(0)).toBe(0n);
    });
  });

  describe("usdCentsToCredits", () => {
    it("converts cents to credits using integer math (ceil)", () => {
      // 100 cents ($1.00) = ceil(100 * 10_000_000 / 100) = 10_000_000 credits
      expect(usdCentsToCredits(100)).toBe(10_000_000n);
      // 1 cent ($0.01) = ceil(1 * 10_000_000 / 100) = 100_000 credits
      expect(usdCentsToCredits(1)).toBe(100_000n);
      // 1100 cents ($11.00) = ceil(1100 * 10_000_000 / 100) = 110_000_000 credits
      expect(usdCentsToCredits(1100)).toBe(110_000_000n);
    });

    it("handles zero cents", () => {
      expect(usdCentsToCredits(0)).toBe(0n);
    });

    it("throws on negative input", () => {
      expect(() => usdCentsToCredits(-1)).toThrow(
        "amountUsdCents must be non-negative"
      );
    });

    it("accepts bigint input", () => {
      expect(usdCentsToCredits(100n)).toBe(10_000_000n);
    });
  });

  describe("calculateLlmUserCharge", () => {
    const MARKUP = 2.0; // 100% markup

    it("applies markup then converts to credits", () => {
      // Provider cost: $0.0006261
      // User cost: $0.0006261 * 2.0 = $0.0012522
      // Credits: ceil(0.0012522 * 10_000_000) = ceil(12522) = 12522
      const result = calculateLlmUserCharge(0.0006261, MARKUP);
      expect(result.userCostUsd).toBeCloseTo(0.0012522, 10);
      expect(result.chargedCredits).toBe(12522n);
    });

    it("handles tiny costs with precision", () => {
      // Provider cost: $0.0001
      // User cost: $0.0001 * 2.0 = $0.0002
      // Credits: ceil(0.0002 * 10_000_000) = ceil(2000) = 2000
      const result = calculateLlmUserCharge(0.0001, MARKUP);
      expect(result.userCostUsd).toBeCloseTo(0.0002, 10);
      expect(result.chargedCredits).toBe(2000n);
    });

    it("handles larger costs", () => {
      // Provider cost: $1.00
      // User cost: $1.00 * 2.0 = $2.00
      // Credits: ceil(2.00 * 10_000_000) = 20_000_000
      const result = calculateLlmUserCharge(1.0, MARKUP);
      expect(result.userCostUsd).toBe(2.0);
      expect(result.chargedCredits).toBe(20_000_000n);
    });

    it("rounds up when needed (single ceil)", () => {
      // Provider cost: $0.00000001
      // User cost: $0.00000001 * 2.0 = $0.00000002
      // Credits: ceil(0.00000002 * 10_000_000) = ceil(0.2) = 1
      const result = calculateLlmUserCharge(0.00000001, MARKUP);
      expect(result.chargedCredits).toBe(1n);
    });

    it("handles zero cost", () => {
      const result = calculateLlmUserCharge(0, MARKUP);
      expect(result.userCostUsd).toBe(0);
      expect(result.chargedCredits).toBe(0n);
    });

    it("works with different markup factors", () => {
      // 1.5x markup
      const result = calculateLlmUserCharge(0.001, 1.5);
      expect(result.userCostUsd).toBeCloseTo(0.0015, 10);
      // Credits: ceil(0.0015 * 10_000_000) = 15000
      expect(result.chargedCredits).toBe(15000n);
    });
  });

  describe("calculateRevenueShareBonus", () => {
    it("computes 75% bonus using scaled integer math", () => {
      // 100,000,000 credits * 0.75 = 75,000,000
      expect(calculateRevenueShareBonus(100_000_000n, 0.75)).toBe(75_000_000n);
    });

    it("returns 0n when revenueShare is 0", () => {
      expect(calculateRevenueShareBonus(100_000_000n, 0)).toBe(0n);
    });

    it("returns 0n when revenueShare is negative", () => {
      expect(calculateRevenueShareBonus(100_000_000n, -0.5)).toBe(0n);
    });

    it("computes 100% bonus", () => {
      expect(calculateRevenueShareBonus(100_000_000n, 1.0)).toBe(100_000_000n);
    });

    it("floors fractional credits (no rounding up)", () => {
      // 3 credits * 0.75 = 2.25 → floor = 2
      expect(calculateRevenueShareBonus(3n, 0.75)).toBe(2n);
    });

    it("handles small credit amounts", () => {
      // 1 credit * 0.75 = 0.75 → floor = 0
      expect(calculateRevenueShareBonus(1n, 0.75)).toBe(0n);
    });

    it("handles typical purchase amounts", () => {
      // $10 purchase = 100,000,000 credits → 75% = 75,000,000
      expect(calculateRevenueShareBonus(100_000_000n, 0.75)).toBe(75_000_000n);
      // $100 purchase = 1,000,000,000 credits → 75% = 750,000,000
      expect(calculateRevenueShareBonus(1_000_000_000n, 0.75)).toBe(
        750_000_000n
      );
    });
  });
});
