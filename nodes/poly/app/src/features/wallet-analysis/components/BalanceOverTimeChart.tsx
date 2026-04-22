// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/BalanceOverTimeChart`
 * Purpose: Reusable balance-history chart for wallet surfaces that need an equity curve above summary tables.
 * Scope: Presentational only. Uses the app-standard shadcn/Recharts wrappers.
 * Invariants:
 *   - Pure props only; no fetching, no time-range state.
 *   - Empty or 1-point datasets render an honest placeholder instead of a fake trend.
 *   - Series color stays within the app chart palette so dashboard and wallet-analysis visuals match.
 * Side-effects: none
 * @public
 */

"use client";

import type { ReactElement } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components";
import type { WalletBalanceHistoryPoint } from "../types/wallet-analysis";

const CHART_CONFIG = {
  total: {
    label: "Total balance",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export type BalanceOverTimeChartProps = {
  history?: readonly WalletBalanceHistoryPoint[] | undefined;
  isLoading?: boolean | undefined;
  rangeLabel?: string | undefined;
};

export function BalanceOverTimeChart({
  history,
  isLoading,
  rangeLabel = "Past month",
}: BalanceOverTimeChartProps): ReactElement {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-9 w-44 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-44 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!history || history.length < 2) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h4 className="font-semibold text-sm uppercase tracking-widest">
              Balance
            </h4>
            <p className="text-muted-foreground text-sm">
              Not enough history yet.
            </p>
          </div>
          <span className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
            {rangeLabel}
          </span>
        </div>
        <div className="flex h-44 items-center justify-center text-muted-foreground text-sm">
          No balance history yet.
        </div>
      </div>
    );
  }

  const first = history[0];
  const latest = history.at(-1);
  if (!first || !latest) {
    return (
      <div className="flex h-44 items-center justify-center text-muted-foreground text-sm">
        No balance history yet.
      </div>
    );
  }
  const delta = latest.total - first.total;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="font-semibold text-sm uppercase tracking-widest">
            Balance
          </h4>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold text-3xl tabular-nums">
              {formatUsd(latest?.total ?? 0)}
            </span>
            <span
              className={
                delta >= 0
                  ? "font-mono text-sm text-success"
                  : "font-mono text-destructive text-sm"
              }
            >
              {formatSignedUsd(delta)}
            </span>
          </div>
        </div>
        <span className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
          {rangeLabel}
        </span>
      </div>

      <ChartContainer config={CHART_CONFIG} className="h-44 w-full">
        <AreaChart
          data={[...history]}
          margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
        >
          <defs>
            <linearGradient id="fill-balance-total" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--color-total)"
                stopOpacity={0.35}
              />
              <stop
                offset="95%"
                stopColor="var(--color-total)"
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
            dataKey="total"
            type="natural"
            stroke="var(--color-total)"
            strokeWidth={3}
            fill="url(#fill-balance-total)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
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
