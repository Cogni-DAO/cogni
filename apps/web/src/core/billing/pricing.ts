// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/billing/pricing`
 * Purpose: Protocol-level billing math with fixed-point credit conversion.
 * Scope: Pure functions for USD/cents/credits conversion and markup calculation. Does not access env or perform IO.
 * Invariants: CREDITS_PER_USD is protocol constant (10M); single ceil at pipeline end; ledger amounts are BigInt;
 *   usdCentsToCredits uses integer-only math.
 * Side-effects: none
 * Links: `src/features/ai/services/llmPricingPolicy.ts`, `src/features/payments/services/creditsConfirm.ts`
 * @public
 */

/**
 * Protocol constant: credits per USD.
 * 10,000,000 credits per $1 USD = 1 credit = $0.0000001
 *
 * This gives 7 decimal places of precision for USD costs,
 * enough for tiny LLM calls (e.g., $0.0006261 * 2 = $0.0012522 → 12522 credits exact).
 *
 * DO NOT change this value - it's a protocol constant like wei in ETH.
 */
export const CREDITS_PER_USD = 10_000_000;

/**
 * Convert USD to credits using the protocol constant.
 * Single place where ceil rounding occurs.
 *
 * @param usd - Cost in USD
 * @returns Credits as BigInt
 */
export function usdToCredits(usd: number): bigint {
  return BigInt(Math.ceil(usd * CREDITS_PER_USD));
}

/**
 * Convert credits to USD for display.
 *
 * @param credits - Credit amount
 * @returns USD value
 */
export function creditsToUsd(credits: number | bigint): number {
  return Number(credits) / CREDITS_PER_USD;
}

/** Cents per USD - used for integer division in payment conversions */
const CENTS_PER_USD = 100n;

/**
 * Convert USD cents to credits using integer math (no floats).
 * Used by payment flows where input is in cents.
 *
 * Formula: ceil(cents * CREDITS_PER_USD / 100)
 * Implemented as: (cents * CREDITS_PER_USD + 99) / 100 (integer ceil division)
 *
 * @param amountUsdCents - Amount in USD cents (integer, must be non-negative)
 * @returns Credits as BigInt
 */
export function usdCentsToCredits(amountUsdCents: number | bigint): bigint {
  const cents = BigInt(amountUsdCents);
  if (cents < 0n) {
    throw new Error("amountUsdCents must be non-negative");
  }
  // Integer ceil division: (a + b - 1) / b
  return (cents * BigInt(CREDITS_PER_USD) + CENTS_PER_USD - 1n) / CENTS_PER_USD;
}

/**
 * Calculate LLM user charge from provider cost.
 * Single entry point for all billing math (preflight, completion, stream).
 *
 * Pipeline: providerCostUsd → userCostUsd (markup, no rounding) → chargedCredits (single ceil via usdToCredits)
 *
 * @param providerCostUsd - Raw cost from LiteLLM
 * @param markupFactor - Multiplier (e.g., 2.0 = 100% markup)
 * @returns { chargedCredits, userCostUsd }
 */
/**
 * Precision scale for revenue share calculation (4 decimal places).
 * revenueShare 0.75 → 7500n / 10000n. Avoids float math on bigint credits.
 */
const REVENUE_SHARE_SCALE = 10_000n;

/**
 * Calculate bonus credits minted to the system tenant on a credit purchase.
 * Uses scaled-integer arithmetic to stay consistent with the rest of this file.
 *
 * @param purchasedCredits - Credits the user received (bigint)
 * @param revenueShare - Fraction to mint as bonus (0–1, e.g. 0.75)
 * @returns Bonus credits as BigInt (floor), or 0n when share ≤ 0
 */
export function calculateRevenueShareBonus(
  purchasedCredits: bigint,
  revenueShare: number
): bigint {
  if (revenueShare <= 0) return 0n;
  const shareScaled = BigInt(
    Math.round(revenueShare * Number(REVENUE_SHARE_SCALE))
  );
  return (purchasedCredits * shareScaled) / REVENUE_SHARE_SCALE;
}

export function calculateLlmUserCharge(
  providerCostUsd: number,
  markupFactor: number
): { chargedCredits: bigint; userCostUsd: number } {
  // Step 1: Apply markup (no rounding)
  const userCostUsd = providerCostUsd * markupFactor;

  // Step 2: Single ceil via usdToCredits (uses protocol constant)
  const chargedCredits = usdToCredits(userCostUsd);

  return { chargedCredits, userCostUsd };
}
