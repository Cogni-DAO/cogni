// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchTradingWallet`
 * Purpose: Client-side fetch for the dashboard's per-tenant trading-wallet
 *          snapshot card. Calls GET /api/v1/poly/wallet/balances (plural,
 *          task.0353) and returns the caller's USDC.e + POL balances.
 * Scope: Data fetching only. Session-cookie auth (`credentials: include`).
 * Side-effects: IO (HTTP fetch).
 * @public
 */

import type { PolyWalletBalancesOutput } from "@cogni/node-contracts";

export async function fetchTradingWallet(): Promise<PolyWalletBalancesOutput> {
  const response = await fetch("/api/v1/poly/wallet/balances", {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch trading wallet balances: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as PolyWalletBalancesOutput;
}
