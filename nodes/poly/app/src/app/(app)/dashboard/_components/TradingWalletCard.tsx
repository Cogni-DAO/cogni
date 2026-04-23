// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/TradingWalletCard`
 * Purpose: Dashboard tile — caller's own per-tenant trading-wallet summary:
 *          address, gas, and one coherent live balance model across
 *          available cash, locked open orders, and live positions.
 * Scope: Client component. React Query poll against `/api/v1/poly/wallet/overview`.
 *        Read-only.
 * Invariants:
 *   - TENANT_SCOPED: the backing route resolves the caller's own wallet from
 *     the session — no address plumbing at the UI boundary.
 *   - NO_TOMBSTONE_ROUTE: never reads the legacy `/api/v1/poly/wallet/balance`
 *     route.
 *   - NO_FAKE_HISTORY: this card renders current wallet truth only.
 * Side-effects: IO (via React Query).
 * @public
 */

"use client";

import type {
  PolyWalletOverviewInterval,
  PolyWalletOverviewOutput,
} from "@cogni/node-contracts";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactElement } from "react";
import { useState } from "react";
import {
  AddressChip,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components";
import { BalanceBar, WalletProfitLossCard } from "@/features/wallet-analysis";
import { cn } from "@/shared/util/cn";
import { fetchTradingWallet } from "../_api/fetchTradingWallet";

function formatDecimal(n: number | null, fractionDigits: number): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatUsd(n: number | null): string {
  if (n === null) return "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function TradingWalletCard(): ReactElement {
  const [interval, setInterval] = useState<PolyWalletOverviewInterval>("ALL");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-trading-wallet", interval],
    queryFn: () => fetchTradingWallet(interval),
    refetchInterval: 15_000,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const lowGas = data?.connected === true && (data.pol_gas ?? 0) <= 0.1;
  const noGas = data?.connected === true && (data.pol_gas ?? 0) <= 0;
  const fullBreakdown = hasOverviewBreakdown(data)
    ? {
        available: data.usdc_available,
        locked: data.usdc_locked,
        positions: data.usdc_positions_mtm,
        total: data.usdc_total,
      }
    : null;

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Trading Wallet
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {data?.warnings?.length ? (
              <span
                className="rounded bg-warning/15 px-1.5 py-0.5 text-warning"
                title="Some wallet reads are partial. Values may be incomplete."
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
                    : `Low POL — ${formatDecimal(data?.pol_gas ?? null, 4)}`
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
          <div className="space-y-4">
            <div className="h-12 animate-pulse rounded bg-muted" />
            <div className="h-48 animate-pulse rounded bg-muted" />
          </div>
        ) : isError || !data ? (
          <p className="py-2 text-muted-foreground text-sm">
            Couldn&apos;t load trading wallet. Will retry shortly.
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
          <div className="space-y-5 py-1">
            {fullBreakdown ? (
              <div className="space-y-3">
                <BalanceBar balance={fullBreakdown ?? undefined} />
                <div className="flex flex-wrap items-center justify-between gap-3 text-muted-foreground text-xs">
                  <span>
                    {data.open_orders ?? 0} open order
                    {(data.open_orders ?? 0) === 1 ? "" : "s"}
                  </span>
                  <span>POL gas {formatDecimal(data.pol_gas, 4)}</span>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-4">
                <Metric
                  label="Available"
                  value={formatUsd(data.usdc_available)}
                />
                <Metric label="Locked" value={formatUsd(data.usdc_locked)} />
                <Metric
                  label="Positions"
                  value={formatUsd(data.usdc_positions_mtm)}
                />
                <Metric label="Total" value={formatUsd(data.usdc_total)} />
              </div>
            )}
            <WalletProfitLossCard
              history={data.pnlHistory}
              interval={interval}
              onIntervalChange={setInterval}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function hasOverviewBreakdown(
  data: PolyWalletOverviewOutput | undefined
): data is PolyWalletOverviewOutput & {
  usdc_available: number;
  usdc_locked: number;
  usdc_positions_mtm: number;
  usdc_total: number;
} {
  return (
    data !== undefined &&
    data.usdc_available !== null &&
    data.usdc_locked !== null &&
    data.usdc_positions_mtm !== null &&
    data.usdc_total !== null
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="font-semibold text-lg tabular-nums">{value}</div>
    </div>
  );
}
