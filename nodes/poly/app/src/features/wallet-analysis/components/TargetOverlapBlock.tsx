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
  rn1: number;
  swisstony: number;
};

const CHART_CONFIG = {
  rn1: {
    label: "RN1",
    color: "hsl(var(--chart-1))",
  },
  swisstony: {
    label: "swisstony",
    color: "hsl(var(--chart-2))",
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
    return (
      <section className="rounded-lg border border-primary/20 bg-card p-4">
        <div className="h-4 w-44 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-72 animate-pulse rounded bg-muted" />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="rounded-lg border border-primary/20 bg-card p-4">
        <div className="text-muted-foreground text-sm">
          {isError
            ? "Target overlap failed to load."
            : "Target overlap is not available yet."}
        </div>
      </section>
    );
  }

  const shared = data.buckets.find((bucket) => bucket.key === "shared");
  const signalClass =
    data.policy.signal === "shared_outperforms"
      ? "border-success/30 bg-success/10 text-success"
      : data.policy.signal === "solo_outperforms"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-border bg-muted text-muted-foreground";

  return (
    <section className="rounded-lg border border-primary/20 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-sm uppercase tracking-widest">
            Target overlap
          </h2>
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
            <span>RN1</span>
            <span className="h-px w-8 bg-border" aria-hidden />
            <span>Shared</span>
            <span className="h-px w-8 bg-border" aria-hidden />
            <span>swisstony</span>
          </div>
        </div>
        <div
          className={cn(
            "rounded border px-2.5 py-1 font-medium text-xs",
            signalClass
          )}
        >
          {policyLabel(data.policy.signal)}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
        <div className="flex flex-wrap gap-3 text-muted-foreground text-xs">
          <LegendDot color="hsl(var(--chart-1))" label="RN1" />
          <LegendDot color="hsl(var(--chart-2))" label="swisstony" />
          <span>{data.window} volume</span>
        </div>
      </div>

      <ChartContainer
        config={CHART_CONFIG}
        className="mt-4 aspect-auto h-72 w-full"
      >
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
            dataKey="rn1"
            stackId="targets"
            fill="var(--color-rn1)"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="swisstony"
            stackId="targets"
            fill="var(--color-swisstony)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        {data.buckets.map((bucket) => (
          <div
            key={bucket.key}
            className={cn(
              "rounded border p-2",
              bucket.key === "shared" ? "border-primary/30 bg-primary/5" : ""
            )}
          >
            <div className="font-medium">{bucket.label}</div>
            <div className="mt-1 text-muted-foreground">
              {bucket.marketCount.toLocaleString()} markets ·{" "}
              {formatSignedUsd(bucket.pnlUsdc)}
            </div>
          </div>
        ))}
      </div>

      {shared ? (
        <p className="mt-3 text-muted-foreground text-xs">
          Shared active exposure: {formatUsd(shared.currentValueUsdc)} across{" "}
          {shared.marketCount.toLocaleString()} markets.
        </p>
      ) : null}
    </section>
  );
}

function buildChartData(
  data: PolyResearchTargetOverlapResponse,
  metric: MetricKey
): ChartDatum[] {
  return data.buckets.map((bucket) => {
    const rn1 = metricValue(bucket.rn1, metric);
    const swisstony = metricValue(bucket.swisstony, metric);
    return {
      bucket: bucket.label,
      rn1,
      swisstony,
    };
  });
}

function metricValue(
  wallet: PolyResearchTargetOverlapResponse["buckets"][number]["rn1"],
  metric: MetricKey
): number {
  switch (metric) {
    case "value":
      return wallet.currentValueUsdc;
    case "volume":
      return wallet.fillVolumeUsdc;
    case "pnl":
      return wallet.pnlUsdc;
    case "markets":
      return wallet.marketCount;
    case "positions":
      return wallet.positionCount;
    default:
      return assertNever(metric);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled target overlap metric: ${value}`);
}

function LegendDot({
  color,
  label,
}: {
  color: string;
  label: string;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
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
