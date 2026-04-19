// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchWalletBalance`
 * Purpose: Client-side fetch for the Operator Wallet balance card. Calls GET /api/v1/poly/wallet/balance (task.0315 backend).
 * Scope: Data fetching only. Returns the Zod-contract shape straight through; graceful empty on network/404.
 * Side-effects: IO (HTTP fetch)
 * Links: packages/node-contracts/src/poly.wallet.balance.v1.contract.ts
 * @public
 */

import type { PolyWalletBalanceOutput } from "@cogni/node-contracts";

export type { PolyWalletBalanceOutput };

const EMPTY: PolyWalletBalanceOutput = {
  operator_address: "0x0000000000000000000000000000000000000000",
  usdc_available: 0,
  usdc_locked: 0,
  usdc_positions_mtm: 0,
  usdc_total: 0,
  pol_gas: 0,
  profile_url: "https://polymarket.com/profile/unconfigured",
  stale: true,
  error_reason: "unavailable",
};

export async function fetchWalletBalance(): Promise<PolyWalletBalanceOutput> {
  try {
    const res = await fetch("/api/v1/poly/wallet/balance");
    if (res.ok) {
      return (await res.json()) as PolyWalletBalanceOutput;
    }
    if (res.status === 404) return EMPTY;
    throw new Error(
      `Failed to fetch wallet balance: ${res.status} ${res.statusText}`
    );
  } catch (err) {
    if (err instanceof TypeError) return EMPTY;
    throw err;
  }
}
