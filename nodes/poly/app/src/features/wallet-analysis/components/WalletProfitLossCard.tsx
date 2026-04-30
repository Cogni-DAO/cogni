// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WalletProfitLossCard`
 * Purpose: Profit/loss panel — windowed-delta number + area chart for the current `interval`. Stateless presenter; the interval is owned by the parent (page-level `TimeWindowHeader` on the wallet-research page; dashboard owns its own selector via `TimeWindowHeader` too).
 * Scope: Presentational only. Accepts props; does not fetch and no longer renders an interval selector.
 * Invariants:
 *   - PNL_NOT_NAV: plots Polymarket P/L, not wallet balance.
 *   - ZERO_BASELINE_WHEN_EMPTY: funded or watched wallets with no P/L history
 *     render a flat zero-state chart panel instead of a null chart hole. The
 *     headline rule is separate — see `HEADLINE_IS_WINDOWED_DELTA` below.
 *   - HEADLINE_IS_WINDOWED_DELTA: the big PnL number is `last.pnl − first.pnl`
 *     of the current interval's series — the chart's start-to-end change. The
 *     upstream `series[last].p` is lifetime cumulative regardless of `interval`,
 *     so reading `last` alone would mislabel "Past week" with lifetime PnL
 *     (task.0389). Empty/missing history renders "—", not "$0.00".
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md
 * @public
 */

"use client";

import type { PolyWalletOverviewInterval } from "@cogni/poly-node-contracts";
import type { ReactElement } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components";
import type { WalletPnlHistoryPoint } from "../types/wallet-analysis";

const CHART_CONFIG = {
  pnl: {
    label: "Profit/Loss",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export type WalletProfitLossCardProps = {
  history?: readonly WalletPnlHistoryPoint[] | undefined;
  interval: PolyWalletOverviewInterval;
  isLoading?: boolean | undefined;
};

export function WalletProfitLossCard({
  history,
  interval,
  isLoading = false,
}: WalletProfitLossCardProps): ReactElement {
  if (isLoading) {
    return (
      <div className="space-y-4 rounded-xl border border-border/60 bg-muted/10 p-4">
        <div className="space-y-2">
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="h-14 w-48 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const windowedPnl = computeWindowedPnl(history);
  const accentClass =
    windowedPnl === null
      ? "text-muted-foreground"
      : windowedPnl > 0
        ? "text-success"
        : windowedPnl < 0
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
        Profit/Loss
      </div>

      <div className="space-y-1">
        <div className={`font-medium text-sm ${accentClass}`}>Profit/Loss</div>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          <div className="font-semibold text-4xl tabular-nums tracking-tight">
            {windowedPnl === null ? "—" : formatUsd(windowedPnl)}
          </div>
          <div className="pb-1 text-muted-foreground text-sm">
            {rangeLabel(interval)}
          </div>
        </div>
      </div>

      {history && history.length >= 2 ? (
        <ChartContainer config={CHART_CONFIG} className="h-48 w-full">
          <AreaChart
            data={history.map((point) => ({ ...point, ts: point.ts }))}
            margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
          >
            <defs>
              <linearGradient
                id="wallet-profit-loss-fill"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor="var(--color-pnl)"
                  stopOpacity={0.28}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-pnl)"
                  stopOpacity={0.04}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="ts"
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              tickMargin={8}
              tickFormatter={formatDateTick}
            />
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatDateLabel(String(value))}
                  formatter={(value) => formatUsd(Number(value))}
                  indicator="line"
                />
              }
            />
            <Area
              dataKey="pnl"
              type="linear"
              stroke="var(--color-pnl)"
              strokeWidth={3}
              fill="url(#wallet-profit-loss-fill)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ChartContainer>
      ) : (
        <div className="relative h-48 overflow-hidden rounded-xl border border-border/70 bg-card">
          <div className="absolute inset-x-6 bottom-16 h-px bg-border/60" />
          <div className="absolute inset-x-6 bottom-14 h-10 rounded-md bg-primary/15 blur-xl" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-primary/10 to-transparent" />
          <div className="absolute right-4 bottom-4 text-muted-foreground text-xs">
            No P/L history yet.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Windowed PnL = `last.pnl − first.pnl` of the upstream series for the current
 * interval. Returns `null` when the history is empty or has fewer than two
 * points (single-point series can't express a delta). Caller renders "—".
 *
 * Invariant `HEADLINE_IS_WINDOWED_DELTA` (task.0389) — `series[last].p` alone
 * is lifetime cumulative regardless of `interval`, so this delta is the only
 * reading that matches the interval label ("Past week", "Past month", etc).
 */
export function computeWindowedPnl(
  history: readonly WalletPnlHistoryPoint[] | undefined
): number | null {
  if (!history || history.length < 2) return null;
  const first = history[0]?.pnl ?? 0;
  const last = history[history.length - 1]?.pnl ?? 0;
  return last - first;
}

function formatUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTick(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateLabel(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function rangeLabel(interval: PolyWalletOverviewInterval): string {
  switch (interval) {
    case "1D":
      return "Past day";
    case "1W":
      return "Past week";
    case "1M":
      return "Past month";
    case "1Y":
      return "Past year";
    case "YTD":
      return "Year to date";
    case "ALL":
      return "All time";
  }
}
