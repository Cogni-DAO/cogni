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
import { Check, Copy } from "lucide-react";
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
      className="inline-flex items-center rounded px-1 py-0.5 text-muted-foreground hover:text-foreground"
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

  const configured = Boolean(data && data.operator_address !== ZERO_ADDR);
  const total = data?.usdc_total ?? 0;
  const availablePct =
    total > 0 ? ((data?.usdc_available ?? 0) / total) * 100 : 0;
  const lockedPct = total > 0 ? ((data?.usdc_locked ?? 0) / total) * 100 : 0;
  const positionsPct =
    total > 0 ? ((data?.usdc_positions_mtm ?? 0) / total) * 100 : 0;

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
              <span className="inline-flex items-center gap-1 font-mono text-muted-foreground">
                <a
                  href={`https://polygonscan.com/address/${data.operator_address}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hover:text-foreground"
                >
                  {formatShortWallet(data.operator_address)}
                </a>
                <CopyAddressButton address={data.operator_address} />
              </span>
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
        ) : total === 0 ? (
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold tabular-nums">$0.00</span>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Single-row summary: total on the left, component legend+values on the right. */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="text-muted-foreground text-xs uppercase tracking-wide">
                  Total
                </span>
                <span className="font-semibold text-base tabular-nums">
                  {formatUsdc(total)}
                </span>
              </div>
              <div className="flex items-center gap-4 text-muted-foreground text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm bg-success/70" />
                  Available{" "}
                  <span className="text-foreground tabular-nums">
                    {formatUsdc(data.usdc_available)}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm bg-warning/70" />
                  Locked{" "}
                  <span className="text-foreground tabular-nums">
                    {formatUsdc(data.usdc_locked)}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-2 rounded-sm bg-[hsl(var(--chart-1))]/70" />
                  Positions{" "}
                  <span className="text-foreground tabular-nums">
                    {formatUsdc(data.usdc_positions_mtm)}
                  </span>
                </span>
              </div>
            </div>

            {/* Horizontal stacked bar — three segments: available (on-chain
                USDC), locked (open-order notional), positions (MTM of held
                shares). Together they reconstruct the wallet's total worth. */}
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
              <div
                className="bg-[hsl(var(--chart-1))]/70"
                style={{ width: `${positionsPct}%` }}
                title={`Positions (MTM): ${formatUsdc(data.usdc_positions_mtm)}`}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
