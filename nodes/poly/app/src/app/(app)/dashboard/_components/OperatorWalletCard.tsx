// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/OperatorWalletCard`
 * Purpose: Operator wallet snapshot — USDC.e available, USDC locked in Polymarket open orders, total, POL gas.
 * Scope: Client component. React Query poll. Read-only.
 * Invariants:
 *   - SINGLE_TENANT_PROTOTYPE: card reflects a single env-pinned wallet (POLY_PROTO_WALLET_ADDRESS).
 *   - READ_ONLY: no deposit/withdraw controls.
 *   - EOA_PROFILE_PITFALL: we link to Polygonscan + Data-API /positions, NOT the polymarket.com profile, because EOA-direct trades redirect the profile page to an empty Safe-proxy. See `.claude/skills/poly-dev-expert/SKILL.md`.
 * Side-effects: IO (via React Query)
 * Links: packages/node-contracts/src/poly.wallet.balance.v1.contract.ts
 * @public
 */

// TODO(task.0315 P2 / single-tenant auth):
// This card assumes one operator wallet shared across all UI sessions.
// Replace with per-user wallet resolution once multi-tenant Privy auth lands.

"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Wallet } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components";
import { cn } from "@/shared/util/cn";
import { fetchWalletBalance } from "../_api/fetchWalletBalance";
import { formatShortWallet, formatUsdc } from "./wallet-format";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

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
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-operator-wallet"],
    queryFn: fetchWalletBalance,
    refetchInterval: 15_000,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  // Two distinct "no data" states:
  //   - configured=false (wallet env unset, zero-address sentinel) → show
  //     the setup hint.
  //   - isError / !data after load                                 → show
  //     a load-failure message, NOT the setup hint (which would be a lie).
  const configured = Boolean(data && data.operator_address !== ZERO_ADDR);
  const total = data?.usdc_total ?? 0;
  const availablePct =
    total > 0 ? ((data?.usdc_available ?? 0) / total) * 100 : 0;
  const lockedPct = total > 0 ? ((data?.usdc_locked ?? 0) / total) * 100 : 0;

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
          {configured && data ? (
            <div className="flex items-center gap-1 font-mono text-muted-foreground text-xs">
              <a
                href={`https://polygonscan.com/address/${data.operator_address}`}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:underline"
                title="View on Polygonscan"
              >
                {formatShortWallet(data.operator_address)}
              </a>
              <CopyAddressButton address={data.operator_address} />
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
        ) : isError || !data ? (
          <p className="text-center text-muted-foreground text-sm">
            Couldn't load wallet balance. Will retry shortly.
          </p>
        ) : !configured ? (
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
                hint={data.stale ? "(partial data)" : "available + locked"}
              />
              <Stat
                label="Locked in orders"
                value={formatUsdc(data.usdc_locked)}
                hint={
                  data.usdc_locked > 0
                    ? `${((data.usdc_locked / total) * 100).toFixed(1)}%`
                    : "—"
                }
                tone="locked"
              />
              <Stat
                label="Available"
                value={formatUsdc(data.usdc_available)}
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
                    title={`Available: ${formatUsdc(data.usdc_available)}`}
                  />
                  <div
                    className="bg-warning/70"
                    style={{ width: `${lockedPct}%` }}
                    title={`Locked: ${formatUsdc(data.usdc_locked)}`}
                  />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
                  <Legend swatch="bg-success/70" label="Available" />
                  <Legend swatch="bg-warning/70" label="Locked" />
                </div>
              </div>
            ) : null}

            {/* POL gas + ground-truth links */}
            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                POL (gas)
                {data.pol_gas <= 0 ? (
                  <span
                    className="rounded bg-destructive/20 px-1.5 py-0.5 text-destructive text-xs"
                    title="No POL balance — operator cannot pay gas. Top up now."
                  >
                    empty
                  </span>
                ) : data.pol_gas < 0.1 ? (
                  <span
                    className="rounded bg-warning/20 px-1.5 py-0.5 text-warning text-xs"
                    title="Low POL balance — top up before the operator can't pay gas."
                  >
                    low
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums">{data.pol_gas.toFixed(4)}</span>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-xs">
              <span className="text-muted-foreground">Ground truth:</span>
              <a
                href={`https://data-api.polymarket.com/positions?user=${data.operator_address}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                positions <ExternalLink className="size-3" />
              </a>
              <a
                href={`https://data-api.polymarket.com/trades?user=${data.operator_address}&limit=10`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                trades <ExternalLink className="size-3" />
              </a>
            </div>

            {data.stale && data.error_reason ? (
              <p className="text-muted-foreground/70 text-xs">
                Partial data — {data.error_reason}
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
