// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchPolymarketRefresh`
 * Purpose: Client fetcher for the dashboard's manual Polymarket refresh action.
 * Scope: Data fetching only. Returns the route contract payload as-is.
 * Side-effects: IO (HTTP fetch)
 * @public
 */

import type { PolyWalletRefreshOutput } from "@cogni/poly-node-contracts";

export async function postPolymarketRefresh(): Promise<PolyWalletRefreshOutput> {
  const response = await fetch("/api/v1/poly/wallet/refresh", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to refresh Polymarket data: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as PolyWalletRefreshOutput;
}
