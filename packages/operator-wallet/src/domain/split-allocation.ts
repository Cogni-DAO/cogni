// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/operator-wallet/domain/split-allocation`
 * Purpose: Pure split allocation math for 0xSplits V2 revenue distribution.
 * Scope: Derives operator/DAO allocation ratios from billing economics. Does not perform I/O or access env.
 * Invariants: Allocations sum to SPLIT_TOTAL_ALLOCATION; operator share strictly between 0 and 1.
 * Side-effects: none
 * Links: docs/spec/operator-wallet.md, scripts/deploy-split.ts
 * @public
 */

/**
 * OpenRouter crypto top-up provider fee (5%).
 * Source: spike.0090 — validated on Base mainnet.
 */
export const OPENROUTER_CRYPTO_FEE = 0.05;

/**
 * Minimum inbound USDC payment in dollars.
 * OpenRouter minimum charge is $1.00 (+ 5% fee = $1.05 USDC).
 * Set to $2.00 to ensure a clean user-facing amount above the provider minimum.
 */
export const MINIMUM_PAYMENT_USD = 2;

/**
 * 0xSplits V2 total allocation denominator.
 * 1e6 gives 0.0001% precision — matches spike.0090 validated config.
 */
export const SPLIT_TOTAL_ALLOCATION = 1_000_000n;

/**
 * Derive operator/DAO split allocations from billing economics.
 *
 * operatorShare = (1 + revenueShare) / (markup × (1 - providerFee))
 *
 * With defaults (markup=2.0, revenueShare=0.75, fee=0.05):
 *   1.75 / (2.0 × 0.95) = 0.921053 → operator 921_053 / 1_000_000
 *   DAO gets the remainder: 78_947 / 1_000_000 (7.9%)
 */
export function calculateSplitAllocations(
  markupFactor: number,
  revenueShare: number,
  providerFee: number = OPENROUTER_CRYPTO_FEE
): { operatorAllocation: bigint; treasuryAllocation: bigint } {
  const operatorShare = (1 + revenueShare) / (markupFactor * (1 - providerFee));
  if (operatorShare >= 1 || operatorShare <= 0) {
    throw new Error(
      `Invalid split: operatorShare=${operatorShare} (must be 0 < x < 1). ` +
        `Check markup=${markupFactor}, revenueShare=${revenueShare}, fee=${providerFee}`
    );
  }
  const operatorAllocation = BigInt(
    Math.round(operatorShare * Number(SPLIT_TOTAL_ALLOCATION))
  );
  return {
    operatorAllocation,
    treasuryAllocation: SPLIT_TOTAL_ALLOCATION - operatorAllocation,
  };
}
