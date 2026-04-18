// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/OperatorWalletCard`
 * Purpose: Operator wallet snapshot — USDC available, locked in orders, open-position MTM + PnL.
 * Scope: Client component. React Query poll. Read-only.
 * Invariants:
 *   - SINGLE_TENANT_PROTOTYPE: card reflects a single env-pinned wallet (POLY_PROTO_WALLET_ADDRESS).
 *   - READ_ONLY: no deposit/withdraw controls.
 * Side-effects: IO (via React Query)
 * @public
 */

// TODO(task.0315 P2 / single-tenant auth):
// This card assumes one operator wallet shared across all UI sessions.
// Replace with per-user wallet resolution once multi-tenant Privy auth lands.

"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Wallet } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components";
import { cn } from "@/shared/util/cn";
import { fetchWalletBalance } from "../_api/fetchWalletBalance";
import { formatPnl, formatShortWallet, formatUsdc } from "./wallet-format";

function CopyAddressButton({ address }: { address: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy wallet address"
      onClick={() => {
        void navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
    >
      {copied ? (
        <Check className="size-3 text-success" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  );
}

export function OperatorWalletCard(): ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-operator-wallet"],
    queryFn: fetchWalletBalance,
    refetchInterval: 15_000,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const total =
    (data?.usdcAvailable ?? 0) +
    (data?.lockedInOrders ?? 0) +
    (data?.positionsMtmValue ?? 0);

  const availablePct =
    total > 0 ? ((data?.usdcAvailable ?? 0) / total) * 100 : 0;
  const lockedPct = total > 0 ? ((data?.lockedInOrders ?? 0) / total) * 100 : 0;
  const positionsPct =
    total > 0 ? ((data?.positionsMtmValue ?? 0) / total) * 100 : 0;

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-muted-foreground" />
            <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Operator Wallet
            </CardTitle>
          </div>
          {data?.wallet ? (
            <div className="flex items-center gap-1 font-mono text-muted-foreground text-xs">
              <a
                href={`https://polygonscan.com/address/${data.wallet}`}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:underline"
              >
                {formatShortWallet(data.wallet)}
              </a>
              <CopyAddressButton address={data.wallet} />
              <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs uppercase tracking-wide">
                USDC.e · Polygon
              </span>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-16 rounded bg-muted" />
            <div className="h-2 rounded bg-muted" />
          </div>
        ) : !data?.wallet ? (
          <p className="text-center text-muted-foreground text-sm">
            No operator wallet configured. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              POLY_PROTO_WALLET_ADDRESS
            </code>{" "}
            to enable.
          </p>
        ) : (
          <>
            {/* Three-stat header */}
            <div className="grid grid-cols-3 gap-4">
              <Stat
                label="Total"
                value={formatUsdc(total)}
                hint={`${data.openOrderCount} open orders`}
              />
              <Stat
                label="Locked in orders"
                value={formatUsdc(data.lockedInOrders)}
                hint={
                  data.lockedInOrders > 0
                    ? `${((data.lockedInOrders / total) * 100).toFixed(1)}%`
                    : "—"
                }
                tone="locked"
              />
              <Stat
                label="Available"
                value={formatUsdc(data.usdcAvailable)}
                hint="USDC.e"
                tone="available"
              />
            </div>

            {/* Stacked allocation bar */}
            {total > 0 ? (
              <div className="space-y-1.5">
                <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="bg-success/70"
                    style={{ width: `${availablePct}%` }}
                    title={`Available: ${formatUsdc(data.usdcAvailable)}`}
                  />
                  <div
                    className="bg-warning/70"
                    style={{ width: `${lockedPct}%` }}
                    title={`Locked: ${formatUsdc(data.lockedInOrders)}`}
                  />
                  <div
                    className="bg-primary/60"
                    style={{ width: `${positionsPct}%` }}
                    title={`Positions MTM: ${formatUsdc(
                      data.positionsMtmValue
                    )}`}
                  />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
                  <Legend swatch="bg-success/70" label="Available" />
                  <Legend swatch="bg-warning/70" label="Locked" />
                  <Legend swatch="bg-primary/60" label="Positions (MTM)" />
                </div>
              </div>
            ) : null}

            {/* Positions PnL line */}
            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                Open positions (MTM)
              </span>
              <div className="flex items-center gap-3 tabular-nums">
                <span>{formatUsdc(data.positionsMtmValue)}</span>
                <span
                  className={cn(
                    "font-medium",
                    data.positionsPnl > 0 && "text-success",
                    data.positionsPnl < 0 && "text-destructive",
                    data.positionsPnl === 0 && "text-muted-foreground"
                  )}
                >
                  {formatPnl(data.positionsPnl)}
                </span>
              </div>
            </div>

            {data.error ? (
              <p className="text-muted-foreground/70 text-xs">
                Partial data — {data.error}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "locked" | "available";
}): ReactElement {
  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div
        className={cn(
          "font-bold text-2xl tabular-nums",
          tone === "locked" && "text-warning",
          tone === "available" && "text-success"
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="text-muted-foreground/70 text-xs">{hint}</div>
      ) : null}
    </div>
  );
}

function Legend({
  swatch,
  label,
}: {
  swatch: string;
  label: string;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", swatch)} />
      {label}
    </span>
  );
}
