// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/TopWalletsCard`
 * Purpose: "Top Wallets" dashboard card — live leaderboard of top Polymarket wallets by PnL.
 * Scope: Client component. Uses React Query to poll the internal API route. Does not implement business logic.
 * Invariants:
 *   - Read-only UI. Does not post orders, does not touch wallet keys.
 *   - Time-period selector drives the query key so DAY/WEEK/MONTH/ALL refetch independently.
 * Side-effects: IO (via React Query)
 * Links: [fetchTopWallets](../_api/fetchTopWallets.ts)
 * @public
 */

"use client";

import type { WalletTimePeriod } from "@cogni/ai-tools";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import { fetchTopWallets } from "../_api/fetchTopWallets";

const TIME_PERIOD_OPTIONS: readonly {
  value: WalletTimePeriod;
  label: string;
}[] = [
  { value: "DAY", label: "Day" },
  { value: "WEEK", label: "Week" },
  { value: "MONTH", label: "Month" },
  { value: "ALL", label: "All" },
] as const;

function formatShortWallet(wallet: string): string {
  if (wallet.length < 10) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function formatUsdc(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPnl(n: number): string {
  const prefix = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}$${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}$${abs.toFixed(0)}`;
}

function formatRoi(roiPct: number | null): string {
  if (roiPct === null) return "—";
  const sign = roiPct > 0 ? "+" : "";
  return `${sign}${roiPct.toFixed(1)}%`;
}

function formatNumTrades(n: number, capped: boolean): string {
  if (n === 0) return "0";
  return capped ? `${n}+` : String(n);
}

export function TopWalletsCard(): ReactElement {
  const [timePeriod, setTimePeriod] = useState<WalletTimePeriod>("WEEK");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-top-wallets", timePeriod],
    queryFn: () => fetchTopWallets({ timePeriod, limit: 10 }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const traders = data?.traders ?? [];

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Top Polymarket Wallets
            </CardTitle>
            <p className="text-muted-foreground/70 text-xs">
              PnL from Polymarket Data API — includes unrealized mark-to-market;
              may diverge from the profile page's realized-only figure.
            </p>
          </div>
          <ToggleGroup
            type="single"
            value={timePeriod}
            onValueChange={(v) => {
              if (v) setTimePeriod(v as WalletTimePeriod);
            }}
            className="rounded-lg border"
          >
            {TIME_PERIOD_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                className="px-3 text-xs"
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="animate-pulse space-y-px px-5 pb-4">
            <div className="h-9 rounded bg-muted" />
            <div className="h-9 rounded bg-muted" />
            <div className="h-9 rounded bg-muted" />
          </div>
        ) : isError ? (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">
            Failed to load top wallets. Try again shortly.
          </p>
        ) : traders.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead
                  className="text-right"
                  title="Realized + unrealized mark-to-market PnL from the Data API"
                >
                  PnL (MTM)
                </TableHead>
                <TableHead className="text-right">ROI</TableHead>
                <TableHead className="text-right"># Trades</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traders.map((t) => (
                <TableRow key={t.proxyWallet}>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {t.rank}
                  </TableCell>
                  <TableCell className="max-w-40 truncate font-medium text-sm">
                    {t.userName}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    <a
                      href={`https://polymarket.com/profile/${t.proxyWallet}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="hover:underline"
                    >
                      {formatShortWallet(t.proxyWallet)}
                    </a>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatUsdc(t.volumeUsdc)}
                  </TableCell>
                  <TableCell
                    className={`text-right text-sm tabular-nums ${
                      t.pnlUsdc >= 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {formatPnl(t.pnlUsdc)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                    {formatRoi(t.roiPct)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                    {formatNumTrades(t.numTrades, t.numTradesCapped)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">
            No top wallets to show for this window yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
