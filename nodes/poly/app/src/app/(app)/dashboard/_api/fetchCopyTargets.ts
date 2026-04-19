// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchCopyTargets`
 * Purpose: Client-side fetch for the monitored-wallet list. Calls GET /api/v1/poly/copy-trade/targets.
 * Scope: Data fetching only. Returns contract shape; empty on failure.
 * Side-effects: IO (HTTP fetch)
 * Links: packages/node-contracts/src/poly.copy-trade.targets.v1.contract.ts
 * @public
 */

import type {
  PolyCopyTradeTarget,
  PolyCopyTradeTargetsOutput,
} from "@cogni/node-contracts";

export type { PolyCopyTradeTarget, PolyCopyTradeTargetsOutput };

const EMPTY: PolyCopyTradeTargetsOutput = { targets: [] };

export async function fetchCopyTargets(): Promise<PolyCopyTradeTargetsOutput> {
  try {
    const res = await fetch("/api/v1/poly/copy-trade/targets");
    if (res.ok) return (await res.json()) as PolyCopyTradeTargetsOutput;
    if (res.status === 404) return EMPTY;
    throw new Error(
      `Failed to fetch copy targets: ${res.status} ${res.statusText}`
    );
  } catch (err) {
    if (err instanceof TypeError) return EMPTY;
    throw err;
  }
}
