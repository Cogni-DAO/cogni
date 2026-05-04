// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/TargetOverlapBlock`
 * Purpose: Research chart for RN1/swisstony shared-vs-solo active markets.
 * Scope: Presentational component. Receives the saved-facts overlap API shape
 * and renders a compact comparison chart with metric tabs.
 * Invariants:
 *   - SHARED_BUCKET_IS_CENTER: the chart reads like a Venn in one dimension:
 *     RN1 only → shared → swisstony only.
 *   - METRIC_TABS_SHARE_AXES: active USDC, fill volume, PnL, and market count
 *     reuse the same bucket structure so the user can compare dimensions.
 * Side-effects: none
 * @public
 */

"use client";

import type { PolyResearchTargetOverlapResponse } from "@cogni/poly-node-contracts";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components";
import { cn } from "@/shared/util/cn";

type MetricKey = "value" | "volume" | "pnl" | "markets" | "positions";

type ChartDatum = {
  bucket: string;
  value: number;
};

const CHART_CONFIG = {
  value: {
    label: "Value",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

const METRICS = [
  { key: "value", label: "Active USDC", formatter: formatUsd },
  { key: "volume", label: "Fill volume", formatter: formatUsd },
  { key: "pnl", label: "Active PnL", formatter: formatSignedUsd },
  { key: "markets", label: "Markets", formatter: formatCount },
  { key: "positions", label: "Positions", formatter: formatCount },
] satisfies readonly {
  key: MetricKey;
  label: string;
  formatter: (value: number) => string;
}[];

const METRIC_BY_KEY = Object.fromEntries(
  METRICS.map((item) => [item.key, item])
) as Record<MetricKey, (typeof METRICS)[number]>;

export function TargetOverlapBlock({
  data,
  isLoading,
  isError,
}: {
  data?: PolyResearchTargetOverlapResponse | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
}): ReactElement {
  const [metric, setMetric] = useState<MetricKey>("value");
  const metricDef = METRIC_BY_KEY[metric];
  const chartData = useMemo<ChartDatum[]>(
    () => (data ? buildChartData(data, metric) : []),
    [data, metric]
  );

  if (isLoading) {
    return <div className="h-80 animate-pulse rounded bg-muted" aria-hidden />;
  }

  if (isError || !data) {
    return (
      <div className="text-muted-foreground text-sm">
        {isError
          ? "Target overlap failed to load."
          : "Target overlap is not available yet."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded border bg-muted p-0.5 text-xs">
          {METRICS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setMetric(item.key)}
              className={cn(
                "rounded px-2.5 py-1 font-medium transition-colors",
                metric === item.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="text-muted-foreground text-xs">
          {data.window} volume · {policyLabel(data.policy.signal)}
        </div>
      </div>

      <ChartContainer config={CHART_CONFIG} className="aspect-auto h-80 w-full">
        <BarChart data={chartData} margin={{ top: 8, right: 10, left: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="bucket" tickLine={false} axisLine={false} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={metricDef.formatter}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                indicator="dot"
                formatter={(value) => metricDef.formatter(Number(value))}
              />
            }
          />
          <Bar
            dataKey="value"
            fill="var(--color-value)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

function buildChartData(
  data: PolyResearchTargetOverlapResponse,
  metric: MetricKey
): ChartDatum[] {
  return data.buckets.map((bucket) => ({
    bucket: bucket.label,
    value: metricValue(bucket, metric),
  }));
}

function metricValue(
  bucket: PolyResearchTargetOverlapResponse["buckets"][number],
  metric: MetricKey
): number {
  switch (metric) {
    case "value":
      return bucket.currentValueUsdc;
    case "volume":
      return bucket.fillVolumeUsdc;
    case "pnl":
      return bucket.pnlUsdc;
    case "markets":
      return bucket.marketCount;
    case "positions":
      return bucket.positionCount;
    default:
      return assertNever(metric);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled target overlap metric: ${value}`);
}

function policyLabel(
  signal: PolyResearchTargetOverlapResponse["policy"]["signal"]
): string {
  switch (signal) {
    case "shared_outperforms":
      return "Shared > solo";
    case "solo_outperforms":
      return "Solo > shared";
    case "insufficient":
      return "No policy signal";
  }
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatSignedUsd(value: number): string {
  if (Math.abs(value) < 0.005) return "$0";
  const formatted = formatUsd(Math.abs(value));
  return value > 0 ? `+${formatted}` : `-${formatted}`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
