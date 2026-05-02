// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/TradingWalletCard`
 * Purpose: Dashboard tile — caller's own per-tenant trading-wallet summary
 *   (address, gas, live balance model) plus first-user onboarding nudges:
 *   renders "Connect →" → `/credits` when no wallet exists, and
 *   "Enable trading →" → `/credits` when connected but `trading_ready=false`.
 * Scope: Client component. Uses the progressive dashboard overview hook for
 *   the balance snapshot and `/api/v1/poly/wallet/status` (shared cache key with
 *   `/credits` via `poly-wallet-status`) to drive the onboarding CTA branch.
 *   Read-only.
 * Invariants:
 *   - TENANT_SCOPED: the backing route resolves the caller's own wallet from
 *     the session — no address plumbing at the UI boundary.
 *   - NO_TOMBSTONE_ROUTE: never reads the legacy `/api/v1/poly/wallet/balance`
 *     route.
 *   - NO_FAKE_HISTORY: this card renders current wallet truth only.
 *   - STATE_DRIVEN_UI (task.0361): the onboarding CTA is derived from
 *     `poly.wallet.status.v1`; no persisted onboarding-progress.
 *   - FUNDED_GATES_LIVE (task.0365): when approvals are signed but the
 *     wallet has zero USDC.e, the card surfaces an "Add USDC.e" CTA in
 *     place of the balance breakdown — silent zeros let users assume
 *     "trading is on" when they actually can't place a single order.
 * Side-effects: IO (via React Query).
 * Links: work/items/task.0361.poly-first-user-onboarding-flow-v0.md
 * @public
 */

"use client";

import type {
  PolyWalletOverviewInterval,
  PolyWalletOverviewOutput,
  PolyWalletStatusOutput,
} from "@cogni/poly-node-contracts";
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
import { useTradingWalletOverview } from "../_hooks/useTradingWalletOverview";

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

async function fetchWalletStatus(): Promise<PolyWalletStatusOutput> {
  const res = await fetch("/api/v1/poly/wallet/status", {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`wallet status failed: ${res.status}`);
  }
  return (await res.json()) as PolyWalletStatusOutput;
}

export function TradingWalletCard(): ReactElement {
  const [interval, setInterval] = useState<PolyWalletOverviewInterval>("1W");
  const { data, isLoading, isError, isLiveEnriching } =
    useTradingWalletOverview(interval);
  // Shares the "poly-wallet-status" key with /credits, so navigating between
  // pages hits the cache rather than refetching.
  const { data: statusData } = useQuery({
    queryKey: ["poly-wallet-status"],
    queryFn: fetchWalletStatus,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
    enabled: data?.connected === true,
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
                className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                title="Some wallet reads are partial. Values may be incomplete."
              >
                partial
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
          <OnboardingCta
            message="No trading wallet connected yet."
            ctaLabel="Connect wallet →"
            href="/credits"
          />
        ) : statusData?.connected && !statusData.trading_ready ? (
          <OnboardingCta
            message="Trading not enabled — finish approvals to copy-trade."
            ctaLabel="Enable trading →"
            href="/credits"
          />
        ) : (data.usdc_total ?? 0) <= 0 ? (
          <OnboardingCta
            message="Wallet is empty — send USDC.e on Polygon to start trading."
            ctaLabel="Fund wallet →"
            href="/credits"
          />
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
              isLoading={isLiveEnriching}
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

/**
 * Centered, primary-accented onboarding CTA shown when the caller hasn't yet
 * reached the next step (no wallet / !trading_ready). Matches the login
 * button's `bg-primary/10 border-primary/40 text-primary` treatment so it
 * reads as the obvious next action.
 */
function OnboardingCta({
  message,
  ctaLabel,
  href,
}: {
  message: string;
  ctaLabel: string;
  href: string;
}): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-muted-foreground text-sm">{message}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-5 py-2 font-semibold text-primary text-sm transition-colors hover:bg-primary/20"
      >
        {ctaLabel}
      </Link>
    </div>
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
