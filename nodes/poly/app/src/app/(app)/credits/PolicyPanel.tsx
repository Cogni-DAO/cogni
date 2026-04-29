// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/PolicyPanel`
 * Purpose: Money-page wiring for `<PolicyControls />`. Fetches the calling user's active wallet-grants row via React Query and exposes a save mutation that translates the route's typed error envelope into a `{code: "invalid_caps"}` rejection the component knows how to render. Renders nothing when no active grant — the parent panel surfaces onboarding messaging.
 * Scope: Client component. Owns React Query lifecycle for the grants surface; delegates rendering to `<PolicyControls>`.
 * Invariants: ERROR_CONTRACT — facade-side errors come back as `{code, message}`; on save reject the component throws an Error tagged with `{code}` so the kit primitive's UI matches the contract. SAVE_INVALIDATES — successful PUT triggers `poly-wallet-grants` query invalidation.
 * Side-effects: HTTP (fetch /api/v1/poly/wallet/grants).
 * Links: nodes/poly/app/src/components/kit/policy/PolicyControls.tsx,
 *        nodes/poly/app/src/app/api/v1/poly/wallet/grants/route.ts,
 *        nodes/poly/packages/node-contracts/src/poly.wallet.grants.v1.contract.ts,
 *        work/items/task.0347.poly-wallet-preferences-sizing-config.md
 * @public
 */

"use client";

import type {
  PolyWalletGrantsErrorOutput,
  PolyWalletGrantsGetOutput,
  PolyWalletGrantsPutInput,
  PolyWalletGrantsPutOutput,
} from "@cogni/poly-node-contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { PolicyControls } from "@/components/kit/policy/PolicyControls";

export const POLY_WALLET_GRANTS_QUERY_KEY = ["poly-wallet-grants"] as const;

async function fetchGrants(): Promise<PolyWalletGrantsGetOutput> {
  const res = await fetch("/api/v1/poly/wallet/grants", {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`grants read failed: ${res.status}`);
  return (await res.json()) as PolyWalletGrantsGetOutput;
}

async function putGrants(
  input: PolyWalletGrantsPutInput
): Promise<PolyWalletGrantsPutOutput> {
  const res = await fetch("/api/v1/poly/wallet/grants", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let body: PolyWalletGrantsErrorOutput | null = null;
    try {
      body = (await res.json()) as PolyWalletGrantsErrorOutput;
    } catch {
      // Body wasn't JSON. Surface as generic save failure.
    }
    const err = new Error(
      body?.message ?? `grants write failed: ${res.status}`
    );
    if (body?.code) {
      Object.assign(err, { code: body.code });
    }
    throw err;
  }
  return (await res.json()) as PolyWalletGrantsPutOutput;
}

export function PolicyPanel(): ReactElement | null {
  const queryClient = useQueryClient();
  const grantsQuery = useQuery({
    queryKey: POLY_WALLET_GRANTS_QUERY_KEY,
    queryFn: fetchGrants,
    staleTime: 10_000,
    gcTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: putGrants,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: POLY_WALLET_GRANTS_QUERY_KEY,
      });
    },
  });

  const data = grantsQuery.data;
  if (!data || !data.connected || !data.grant) return null;

  return (
    <PolicyControls
      values={{
        per_order_usdc_cap: data.grant.per_order_usdc_cap,
        daily_usdc_cap: data.grant.daily_usdc_cap,
      }}
      onSave={async (next) => {
        await mutation.mutateAsync(next);
      }}
    />
  );
}
