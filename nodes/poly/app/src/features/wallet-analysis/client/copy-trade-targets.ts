// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/client/copy-trade-targets`
 * Purpose: Client-side helpers for the per-user copy-trade target list — list (GET), create (POST), delete (DELETE) over `/api/v1/poly/copy-trade/targets`.
 * Scope: Data fetching helpers only. Returns contract shapes; reads degrade to empty on failure, mutations throw so React Query surfaces errors. Does not render UI.
 * Invariants: RLS_SCOPED — server enforces per-user visibility + writes; client never passes user_id. COPY_TARGETS_QUERY_KEY is the single source of truth that both the Monitored Wallets card and the per-wallet toggle cross-invalidate.
 * Side-effects: IO (HTTP fetch).
 * Links: packages/node-contracts/src/poly.copy-trade.targets.v1.contract.ts, docs/spec/poly-multi-tenant-auth.md
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
  PolyCopyTradeTargetCreateInput,
  PolyCopyTradeTargetCreateOutput,
  PolyCopyTradeTargetsOutput,
};

/**
 * Shared React Query key for the user's copy-trade targets. Every caller uses
 * this key so mutations from one UI surface invalidate the list everywhere.
 */
export const COPY_TARGETS_QUERY_KEY = ["copy-trade-targets"] as const;

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
