// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchCopyTargets`
 * Purpose: Client-side helpers for the monitored-wallet list — list (GET), create
 *          (POST), and delete (DELETE) the calling user's tracked Polymarket wallets.
 * Scope: Data fetching only. Returns contract shapes; empty on failure for reads,
 *        thrown errors for mutations so React Query can surface them in the UI.
 * Side-effects: IO (HTTP fetch).
 * Links: packages/node-contracts/src/poly.copy-trade.targets.v1.contract.ts
 * @public
 */

import type {
  PolyCopyTradeTarget,
  PolyCopyTradeTargetCreateInput,
  PolyCopyTradeTargetCreateOutput,
  PolyCopyTradeTargetDeleteOutput,
  PolyCopyTradeTargetsOutput,
} from "@cogni/node-contracts";

export type {
  PolyCopyTradeTarget,
  PolyCopyTradeTargetsOutput,
  PolyCopyTradeTargetCreateInput,
  PolyCopyTradeTargetCreateOutput,
};

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

export async function createCopyTarget(
  input: PolyCopyTradeTargetCreateInput
): Promise<PolyCopyTradeTargetCreateOutput> {
  const res = await fetch("/api/v1/poly/copy-trade/targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      // ignore parse failure
    }
    throw new Error(
      `Failed to create copy target: ${res.status} ${
        detail && typeof detail === "object" && "error" in detail
          ? String((detail as { error: unknown }).error)
          : res.statusText
      }`
    );
  }
  return (await res.json()) as PolyCopyTradeTargetCreateOutput;
}

export async function deleteCopyTarget(
  id: string
): Promise<PolyCopyTradeTargetDeleteOutput> {
  const res = await fetch(
    `/api/v1/poly/copy-trade/targets/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      // ignore parse failure
    }
    throw new Error(
      `Failed to delete copy target: ${res.status} ${
        detail && typeof detail === "object" && "error" in detail
          ? String((detail as { error: unknown }).error)
          : res.statusText
      }`
    );
  }
  return (await res.json()) as PolyCopyTradeTargetDeleteOutput;
}
