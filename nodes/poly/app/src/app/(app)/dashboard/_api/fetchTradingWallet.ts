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
  PolyWalletDataFreshness,
  PolyWalletOverviewInterval,
  PolyWalletOverviewOutput,
} from "@cogni/poly-node-contracts";

export async function fetchTradingWallet(
  interval: PolyWalletOverviewInterval,
  opts?: { freshness?: PolyWalletDataFreshness }
): Promise<PolyWalletOverviewOutput> {
  const searchParams = new URLSearchParams({ interval });
  if (opts?.freshness) searchParams.set("freshness", opts.freshness);
  const response = await fetch(
    `/api/v1/poly/wallet/overview?${searchParams.toString()}`,
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
