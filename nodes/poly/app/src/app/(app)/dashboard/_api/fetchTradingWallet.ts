// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchTradingWallet`
 * Purpose: Client-side fetch for the dashboard's per-tenant trading-wallet
 *          summary card. Calls GET /api/v1/poly/wallet/overview and returns
 *          the caller's merged live wallet snapshot.
 * Scope: Data fetching only. Session-cookie auth (`credentials: include`).
 * Side-effects: IO (HTTP fetch).
 * @public
 */

import type {
  PolyWalletOverviewInterval,
  PolyWalletOverviewOutput,
} from "@cogni/poly-node-contracts";

export async function fetchTradingWallet(
  interval: PolyWalletOverviewInterval
): Promise<PolyWalletOverviewOutput> {
  const response = await fetch(
    `/api/v1/poly/wallet/overview?interval=${interval}`,
    {
      credentials: "include",
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to fetch trading wallet overview: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as PolyWalletOverviewOutput;
}
