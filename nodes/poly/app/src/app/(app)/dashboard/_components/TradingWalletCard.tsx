// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/TradingWalletCard`
 * Purpose: Dashboard tile — caller's own per-tenant Polymarket trading-wallet
 *          snapshot (funder address + USDC.e + POL gas). Replaces the
 *          purged single-operator `OperatorWalletCard`.
 * Scope: Client component. React Query poll against `/api/v1/poly/wallet/balances`
 *        (plural). Read-only.
 * Invariants:
 *   - TENANT_SCOPED: the backing route resolves the caller's own
 *     `funder_address` from the session — no address plumbing at the UI
 *     boundary.
 *   - PARTIAL_FAILURE_VISIBLE: USDC.e / POL render as "—" when the RPC
 *     read errored for just that field; the card stays up.
 *   - NO_RAW_ERRORS: adapter error strings are never rendered directly —
 *     only a compact pill / "retry shortly" copy.
 * Side-effects: IO (via React Query).
 * Links: packages/node-contracts/src/poly.wallet.balances.v1.contract.ts,
 *        nodes/poly/app/src/app/(app)/credits/TradingWalletPanel.tsx
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactElement } from "react";
import {
  AddressChip,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components";
import { cn } from "@/shared/util/cn";
import { fetchTradingWallet } from "../_api/fetchTradingWallet";

function formatDecimal(n: number | null, fractionDigits: number): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function TradingWalletCard(): ReactElement {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-trading-wallet"],
    queryFn: fetchTradingWallet,
    refetchInterval: 15_000,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const lowGas = data?.connected === true && (data.pol ?? 0) <= 0.1;
  const noGas = data?.connected === true && (data.pol ?? 0) <= 0;

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Trading Wallet
          </CardTitle>
          <div className="flex items-center gap-2 text-xs">
            {data?.errors?.length ? (
              <span
                className="rounded bg-warning/15 px-1.5 py-0.5 text-warning"
                title="Some on-chain reads failed. Values may be partial."
              >
                stale
              </span>
            ) : null}
            {lowGas ? (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5",
                  noGas
                    ? "bg-destructive/15 text-destructive"
                    : "bg-warning/15 text-warning"
                )}
                title={
                  noGas
                    ? "No POL balance — this wallet cannot pay gas."
                    : `Low POL — ${formatDecimal(data?.pol ?? null, 4)}`
                }
              >
                {noGas ? "no gas" : "low gas"}
              </span>
            ) : null}
            {data?.connected && data.address ? (
              <AddressChip address={data.address} />
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pt-1 pb-4">
        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-muted" />
        ) : isError || !data ? (
          <p className="py-2 text-muted-foreground text-sm">
            Couldn't load trading wallet. Will retry shortly.
          </p>
        ) : !data.configured ? (
          <p className="py-2 text-muted-foreground text-sm">
            Trading-wallet adapter is not configured on this pod yet.
          </p>
        ) : !data.connected ? (
          <div className="flex items-center justify-between gap-3 py-2 text-sm">
            <p className="text-muted-foreground">
              No trading wallet connected yet.
            </p>
            <Link
              href="/credits"
              className="rounded-md border border-border/60 bg-muted/40 px-3 py-1 font-medium hover:bg-muted"
            >
              Connect →
            </Link>
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-4 py-1">
            <div>
              <div className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                USDC.e
              </div>
              <div className="font-semibold text-2xl tabular-nums">
                {formatDecimal(data.usdc_e, 2)}
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                POL gas
              </div>
              <div className="font-semibold text-xl tabular-nums">
                {formatDecimal(data.pol, 4)}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
