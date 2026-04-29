// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchExecution`
 * Purpose: Client fetcher for the dashboard execution card's real operator-wallet positions.
 * Scope: Data fetching only. Returns the route contract payload as-is.
 * Side-effects: IO (HTTP fetch)
 * @public
 */

import type { PolyWalletExecutionOutput } from "@cogni/poly-node-contracts";

export async function fetchExecution(): Promise<PolyWalletExecutionOutput> {
  const response = await fetch("/api/v1/poly/wallet/execution", {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch wallet execution: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as PolyWalletExecutionOutput;
}
