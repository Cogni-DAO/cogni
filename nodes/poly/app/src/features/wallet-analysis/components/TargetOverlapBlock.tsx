// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/TargetOverlapBlock`
 * Purpose: Research chart for RN1/swisstony shared-vs-solo active markets.
 * Scope: Presentational component. Receives the saved-facts overlap API shape
 * and renders Trader Comparison-style horizontal metric bars.
 * Invariants:
 *   - SHARED_BUCKET_IS_CENTER: the chart reads like a Venn in one dimension:
 *     RN1 only → shared → swisstony only.
 *   - SOLO_BUCKETS_ARE_OWNER_ONLY: solo rows render the active owner only;
 *     shared renders RN1 and swisstony as stacked account rows.
 *   - ONLY_PNL_IS_DIVERGING: PnL is zero-centered; all positive-only metrics
 *     start at the left edge so width directly means larger.
 *   - METRIC_TABS_SHARE_AXES: active USDC, fill volume, PnL, markets, and
 *     positions reuse the same bucket structure so the user can compare dimensions.
 *   - PAGE_LEVEL_INTERVAL: time-window control is the page-level
 *     IntervalToggle (rendered by DistributionsBlock at top right, the same
 *     control surface every other research tab uses). This block does not
 *     render its own toggle.
 * Side-effects: none
 * @public
 */

"use client";

import type { PolyResearchTargetOverlapResponse } from "@cogni/poly-node-contracts";
import type { ReactElement } from "react";
import { useState } from "react";
import { cn } from "@/shared/util/cn";

type MetricKey = "value" | "volume" | "pnl" | "markets" | "positions";
type Bucket = PolyResearchTargetOverlapResponse["buckets"][number];
type AccountKey = "rn1" | "swisstony";

type MetricDef = {
  key: MetricKey;
  label: string;
  unit: string;
  formatter: (value: number) => string;
};

const METRICS = [
  { key: "value", label: "Active USDC", unit: "USDC", formatter: formatUsd },
  { key: "volume", label: "Fill volume", unit: "USDC", formatter: formatUsd },
  { key: "pnl", label: "Active PnL", unit: "PnL", formatter: formatSignedUsd },
  { key: "markets", label: "Markets", unit: "markets", formatter: formatCount },
  {
    key: "positions",
    label: "Positions",
    unit: "positions",
    formatter: formatCount,
  },
] satisfies readonly MetricDef[];

const METRIC_BY_KEY = Object.fromEntries(
  METRICS.map((item) => [item.key, item])
) as Record<MetricKey, MetricDef>;

const ACCOUNT_META = {
  rn1: {
    label: "RN1",
    barClassName: "bg-destructive/70",
  },
  swisstony: {
    label: "swisstony",
    barClassName: "bg-success/70",
  },
} as const satisfies Record<
  AccountKey,
  { label: string; barClassName: string }
>;

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

  const max = maxMagnitude(data, metric);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
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
      </div>

      <div className="divide-y">
        {data.buckets.map((bucket) => (
          <TargetOverlapRow
            key={bucket.key}
            bucket={bucket}
            metric={metric}
            metricDef={metricDef}
            max={max}
          />
        ))}
      </div>
    </div>
  );
}

function TargetOverlapRow({
  bucket,
  metric,
  metricDef,
  max,
}: {
  bucket: Bucket;
  metric: MetricKey;
  metricDef: MetricDef;
  max: number;
}): ReactElement {
  if (bucket.key === "shared") {
    return (
      <SharedTargetOverlapRow
        bucket={bucket}
        metric={metric}
        metricDef={metricDef}
        max={max}
      />
    );
  }

  return (
    <SoloTargetOverlapRow
      account={bucket.key === "rn1_only" ? "rn1" : "swisstony"}
      bucket={bucket}
      metric={metric}
      metricDef={metricDef}
      max={max}
    />
  );
}

function SoloTargetOverlapRow({
  account,
  bucket,
  metric,
  metricDef,
  max,
}: {
  account: AccountKey;
  bucket: Bucket;
  metric: MetricKey;
  metricDef: MetricDef;
  max: number;
}): ReactElement {
  const meta = ACCOUNT_META[account];
  const value = sideMetricValue(bucket[account], metric);
  const valueClassName = metricValueClassName(metric, value);

  return (
    <div className="grid gap-3 py-4 md:grid-cols-5 md:items-center">
      <div className="min-w-0 md:col-span-1">
        <div className="truncate font-medium text-sm">{bucket.label}</div>
        <div className="truncate text-muted-foreground text-xs">
          {detailForBucket(bucket, metric)}
        </div>
      </div>

      <div className="flex flex-col gap-2 md:col-span-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">{meta.label}</span>
          <span className={cn("font-mono", valueClassName)}>
            {metricDef.formatter(value)}
          </span>
        </div>
        <TargetMetricBar
          account={account}
          className="h-8"
          max={max}
          metric={metric}
          value={value}
        />
      </div>

      <div className="min-w-0 text-muted-foreground text-xs md:col-span-1 md:text-right">
        <span className="font-mono">{metricDef.formatter(value)}</span>
        <span className="ml-1">{metricDef.unit}</span>
      </div>
    </div>
  );
}

function SharedTargetOverlapRow({
  bucket,
  metric,
  metricDef,
  max,
}: {
  bucket: Bucket;
  metric: MetricKey;
  metricDef: MetricDef;
  max: number;
}): ReactElement {
  const rn1 = sideMetricValue(bucket.rn1, metric);
  const swisstony = sideMetricValue(bucket.swisstony, metric);

  return (
    <div className="grid gap-3 py-4 md:grid-cols-5 md:items-center">
      <div className="min-w-0 md:col-span-1">
        <div className="truncate font-medium text-sm">{bucket.label}</div>
        <div className="truncate text-muted-foreground text-xs">
          {detailForBucket(bucket, metric)}
        </div>
      </div>

      <div className="flex flex-col gap-2 md:col-span-3">
        <SharedAccountBar
          account="rn1"
          max={max}
          metric={metric}
          metricDef={metricDef}
          value={rn1}
        />
        <SharedAccountBar
          account="swisstony"
          max={max}
          metric={metric}
          metricDef={metricDef}
          value={swisstony}
        />
      </div>

      <div className="min-w-0 text-muted-foreground text-xs md:col-span-1 md:text-right">
        <span className="font-mono">{metricDef.formatter(rn1)}</span>
        {" / "}
        <span className="font-mono">{metricDef.formatter(swisstony)}</span>
        <span className="ml-1">{metricDef.unit}</span>
      </div>
    </div>
  );
}

function SharedAccountBar({
  account,
  value,
  metric,
  metricDef,
  max,
}: {
  account: AccountKey;
  value: number;
  metric: MetricKey;
  metricDef: MetricDef;
  max: number;
}): ReactElement {
  const meta = ACCOUNT_META[account];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate text-muted-foreground">{meta.label}</span>
        <span className={cn("font-mono", metricValueClassName(metric, value))}>
          {metricDef.formatter(value)}
        </span>
      </div>
      <TargetMetricBar
        account={account}
        className="h-4"
        max={max}
        metric={metric}
        value={value}
      />
    </div>
  );
}

function TargetMetricBar({
  account,
  value,
  metric,
  max,
  className,
}: {
  account: AccountKey;
  value: number;
  metric: MetricKey;
  max: number;
  className: string;
}): ReactElement {
  if (metric === "pnl") {
    const pct = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
    return (
      <div
        className={cn(
          "flex w-full overflow-hidden rounded border bg-muted/30",
          className
        )}
      >
        <div className="flex flex-1 justify-end border-r">
          {value < 0 ? (
            <div
              className="h-full bg-destructive/70 transition-all"
              style={{ width: `${pct}%` }}
            />
          ) : null}
        </div>
        <div className="flex-1">
          {value > 0 ? (
            <div
              className="h-full bg-success/70 transition-all"
              style={{ width: `${pct}%` }}
            />
          ) : null}
        </div>
      </div>
    );
  }

  const pct = max > 0 ? Math.min(100, (Math.max(0, value) / max) * 100) : 0;
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded border bg-muted/30",
        className
      )}
    >
      <div
        className={cn(
          "h-full transition-all",
          ACCOUNT_META[account].barClassName
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function sideMetricValue(side: Bucket["rn1"], metric: MetricKey): number {
  switch (metric) {
    case "value":
      return side.currentValueUsdc;
    case "volume":
      return side.fillVolumeUsdc;
    case "pnl":
      return side.pnlUsdc;
    case "markets":
      return side.marketCount;
    case "positions":
      return side.positionCount;
    default:
      return assertNever(metric);
  }
}

function maxMagnitude(
  data: PolyResearchTargetOverlapResponse,
  metric: MetricKey
): number {
  const values = data.buckets.flatMap((bucket) =>
    displayValuesForBucket(bucket, metric).map((value) => Math.abs(value))
  );
  return Math.max(1, ...values);
}

function displayValuesForBucket(bucket: Bucket, metric: MetricKey): number[] {
  if (bucket.key === "rn1_only") {
    return [sideMetricValue(bucket.rn1, metric)];
  }
  if (bucket.key === "swisstony_only") {
    return [sideMetricValue(bucket.swisstony, metric)];
  }
  return [
    sideMetricValue(bucket.rn1, metric),
    sideMetricValue(bucket.swisstony, metric),
  ];
}

function detailForBucket(bucket: Bucket, metric: MetricKey): string {
  if (metric === "markets") {
    return `${bucket.positionCount.toLocaleString()} positions`;
  }
  return `${bucket.marketCount.toLocaleString()} markets`;
}

function metricValueClassName(
  metric: MetricKey,
  value: number
): string | undefined {
  if (metric !== "pnl") return undefined;
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "text-muted-foreground";
}

function assertNever(value: never): never {
  throw new Error(`Unhandled target overlap metric: ${value}`);
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
