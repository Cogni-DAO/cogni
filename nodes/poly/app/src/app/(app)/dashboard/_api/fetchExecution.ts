// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchExecution`
 * Purpose: Client fetcher for the dashboard execution card's real operator-wallet positions.
 * Scope: Data fetching only. Returns the route contract payload as-is.
 * Side-effects: IO (HTTP fetch)
 * @public
 */

import type {
  PolyWalletDataFreshness,
  PolyWalletExecutionOutput,
} from "@cogni/poly-node-contracts";

export async function fetchExecution(opts?: {
  freshness?: PolyWalletDataFreshness;
}): Promise<PolyWalletExecutionOutput> {
  const searchParams = new URLSearchParams();
  if (opts?.freshness) searchParams.set("freshness", opts.freshness);
  const url = `/api/v1/poly/wallet/execution${
    searchParams.size > 0 ? `?${searchParams.toString()}` : ""
  }`;
  const response = await fetch(url, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch wallet execution: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as PolyWalletExecutionOutput;
}
