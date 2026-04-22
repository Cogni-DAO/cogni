// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/OperatorWalletCard`
 * Purpose: Operator wallet snapshot — one horizontal stacked bar showing USDC available vs. locked in Polymarket open orders, plus the operator address and a compact stale / low-gas pill.
 * Scope: Client component. React Query poll. Read-only.
 * Invariants:
 *   - SINGLE_TENANT_PROTOTYPE: reflects a single env-pinned wallet (POLY_PROTO_WALLET_ADDRESS).
 *   - READ_ONLY.
 *   - NO_RAW_ERRORS: backend `error_reason` string is never rendered directly — only a compact pill.
 * Side-effects: IO (via React Query)
 * Links: packages/node-contracts/src/poly.wallet.balance.v1.contract.ts
 * @public
 */

// TODO(task.0315 P2 / single-tenant auth): replace env-pinned wallet with
// per-user resolution once multi-tenant Privy auth lands.

"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import {
  AddressChip,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components";
import { BalanceBar } from "@/features/wallet-analysis";
import { cn } from "@/shared/util/cn";
import { fetchWalletBalance } from "../_api/fetchWalletBalance";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export function OperatorWalletCard(): ReactElement {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-operator-wallet"],
    queryFn: fetchWalletBalance,
    refetchInterval: 15_000,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const configured = Boolean(data && data.operator_address !== ZERO_ADDR);

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Operator Wallet
          </CardTitle>
          <div className="flex items-center gap-2 text-xs">
            {data?.stale ? (
              <span
                className="rounded bg-warning/15 px-1.5 py-0.5 text-warning"
                title="Some reads failed. Values may be partial."
              >
                stale
              </span>
            ) : null}
            {data && data.pol_gas <= 0.1 ? (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5",
                  data.pol_gas <= 0
                    ? "bg-destructive/15 text-destructive"
                    : "bg-warning/15 text-warning"
                )}
                title={
                  data.pol_gas <= 0
                    ? "No POL balance — operator cannot pay gas."
                    : `Low POL — ${data.pol_gas.toFixed(4)}`
                }
              >
                {data.pol_gas <= 0 ? "no gas" : "low gas"}
              </span>
            ) : null}
            {configured && data ? (
              <AddressChip address={data.operator_address} />
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pt-1 pb-4">
        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-muted" />
        ) : isError || !data ? (
          <p className="py-2 text-muted-foreground text-sm">
            Couldn't load wallet balance. Will retry shortly.
          </p>
        ) : !configured ? (
          <p className="py-2 text-muted-foreground text-sm">
            No operator wallet configured. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              POLY_PROTO_WALLET_ADDRESS
            </code>
            .
          </p>
        ) : (
          <BalanceBar
            balance={{
              available: data.usdc_available ?? 0,
              locked: data.usdc_locked ?? 0,
              positions: data.usdc_positions_mtm ?? 0,
              total: data.usdc_total ?? 0,
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
