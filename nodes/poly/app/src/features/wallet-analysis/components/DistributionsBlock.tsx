// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/DistributionsBlock`
 * Purpose: Order-flow deep-dive — 6 stacked histograms (DCA depth, trade size, entry price, DCA window, hour-of-day, event clustering) with a count↔USDC toggle and a pending-share caption. Renders directly from the contract `WalletAnalysisDistributions` shape — no client-side bucket math.
 * Scope: Presentational. CSS-only stacked bars (no chart library) following the project's existing TradesPerDayChart pattern.
 * Invariants:
 *   - MODE_HIGHLIGHTED — every chart paints the modal bucket green and the rest neutral grey, so the dominant behaviour reads at a glance. Win/lost/pending data stays on the wire (`PENDING_IS_FIRST_CLASS`) and surfaces in tooltips.
 *   - DISTRIBUTIONS_ARE_PURE_DERIVATIONS — the component never recomputes buckets; it renders what the server returned.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md (Checkpoint D), work/items/task.0431.poly-wallet-orderflow-distributions-d1.md
 * @public
 */

"use client";

import type {
  FlatHistogram,
  Histogram,
  WalletAnalysisDistributions,
} from "@cogni/poly-node-contracts";
import { type ReactElement, type ReactNode, useState } from "react";

import { cn } from "@/shared/util/cn";
import type { WalletDistributionsViewMode } from "../types/wallet-analysis";

export type DistributionsBlockProps = {
  data?: WalletAnalysisDistributions | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
};

export type DistributionComparisonSeries = {
  label: string;
  data?: WalletAnalysisDistributions | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
};

export function DistributionsBlock({
  data,
  isLoading,
  isError,
}: DistributionsBlockProps): ReactElement {
  const [viewMode, setViewMode] =
    useState<WalletDistributionsViewMode>("count");

  if (isLoading) {
    return (
      <Section title="Order-flow distributions">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => `dist-skeleton-${i}`).map(
            (key) => (
              <div
                key={key}
                className="h-40 animate-pulse rounded bg-muted"
                aria-hidden
              />
            )
          )}
        </div>
      </Section>
    );
  }

  if (isError || !data) {
    return (
      <Section title="Order-flow distributions">
        <div className="text-muted-foreground text-sm">
          {isError
            ? "Could not load distributions — retrying on next refresh."
            : "No distributions available for this wallet yet."}
        </div>
      </Section>
    );
  }

  const pendingPct = (data.pendingShare.byCount * 100).toFixed(0);
  const pendingUsdcPct = (data.pendingShare.byUsdc * 100).toFixed(0);

  return (
    <Section
      title="Trade detail"
      caption={
        <>
          <span className="font-mono">{data.range.n}</span> trades on{" "}
          <span className="font-mono">
            {fmtRange(data.range.fromTs, data.range.toTs)}
          </span>
          {" · "}
          <span className="font-mono">{pendingPct}%</span> still waiting to
          resolve
          {viewMode === "usdc" ? (
            <>
              {" "}
              (<span className="font-mono">{pendingUsdcPct}%</span> of $)
            </>
          ) : null}
        </>
      }
      toolbar={<ViewModeToggle viewMode={viewMode} onChange={setViewMode} />}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ChartCard title="Entries per outcome">
          <StackedBars histogram={data.dcaDepth} viewMode={viewMode} />
        </ChartCard>
        <ChartCard title="Trade size">
          <StackedBars histogram={data.tradeSize} viewMode={viewMode} />
        </ChartCard>
        <ChartCard title="Entry price">
          <StackedBars histogram={data.entryPrice} viewMode={viewMode} />
        </ChartCard>
        <ChartCard title="Time in position">
          <StackedBars histogram={data.dcaWindow} viewMode={viewMode} />
        </ChartCard>
        <ChartCard title="Hour of day (UTC)">
          <StackedBars
            histogram={data.hourOfDay}
            viewMode={viewMode}
            compact
            sparseLabels={3}
          />
        </ChartCard>
        <ChartCard title="Bets per market">
          <FlatBars histogram={data.eventClustering} viewMode={viewMode} />
        </ChartCard>
      </div>
    </Section>
  );
}

export function DistributionComparisonBlock({
  series,
}: {
  series: readonly DistributionComparisonSeries[];
}): ReactElement {
  const [viewMode, setViewMode] =
    useState<WalletDistributionsViewMode>("count");
  const [activeView, setActiveView] =
    useState<DistributionComparisonViewKey>("tradeSize");
  const readySeries = series.filter(
    (
      s
    ): s is DistributionComparisonSeries & {
      data: WalletAnalysisDistributions;
    } => Boolean(s.data)
  );
  const isLoading = readySeries.length === 0 && series.some((s) => s.isLoading);
  const isError = readySeries.length === 0 && series.some((s) => s.isError);

  if (isLoading) {
    return (
      <Section title="Wallet research">
        <div className="h-80 animate-pulse rounded bg-muted" aria-hidden />
      </Section>
    );
  }

  if (isError || readySeries.length === 0) {
    return (
      <Section title="Wallet research">
        <div className="text-muted-foreground text-sm">
          {isError
            ? "Could not load distribution comparison — retrying on next refresh."
            : "No saved distributions available for comparison yet."}
        </div>
      </Section>
    );
  }

  return (
    <Section title="">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {DISTRIBUTION_COMPARISON_VIEWS.map((view) => (
              <button
                key={view.key}
                type="button"
                onClick={() => setActiveView(view.key)}
                className={cn(
                  "rounded border px-3 py-1.5 text-xs transition-colors",
                  activeView === view.key
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {view.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ComparisonLegend series={readySeries} viewMode={viewMode} />
            <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
        </div>

        <DistributionOverlayChart
          series={readySeries}
          view={DISTRIBUTION_COMPARISON_VIEWS_BY_KEY[activeView]}
          viewMode={viewMode}
        />
      </div>
    </Section>
  );
}

function Section({
  title,
  caption,
  toolbar,
  children,
}: {
  title: string;
  caption?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const hasHeader = Boolean(title || caption || toolbar);
  return (
    <div className="flex flex-col gap-4">
      {hasHeader ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-col gap-1">
            {title ? (
              <h3 className="font-semibold text-sm uppercase tracking-widest">
                {title}
              </h3>
            ) : null}
            {caption ? (
              <p className="text-muted-foreground text-xs">{caption}</p>
            ) : null}
          </div>
          {toolbar}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded border bg-card p-3">
      <h4 className="font-medium text-foreground text-xs uppercase tracking-wider">
        {title}
      </h4>
      {children}
    </div>
  );
}

function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: WalletDistributionsViewMode;
  onChange: (m: WalletDistributionsViewMode) => void;
}): ReactElement {
  return (
    <div className="inline-flex rounded border bg-muted p-0.5 text-xs">
      {(["count", "usdc"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "rounded px-2 py-1 font-medium uppercase tracking-wider transition-colors",
            viewMode === m
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {m === "count" ? "Count" : "USDC"}
        </button>
      ))}
    </div>
  );
}

const BAR_GREY = "bg-muted-foreground/30";
const BAR_HIGHLIGHT = "bg-emerald-500/80";
const SERIES_COLORS = [
  { dot: "bg-sky-500/85", stroke: "#0ea5e9" },
  { dot: "bg-emerald-500/85", stroke: "#10b981" },
  { dot: "bg-amber-400/85", stroke: "#fbbf24" },
  { dot: "bg-fuchsia-500/85", stroke: "#d946ef" },
  { dot: "bg-rose-500/85", stroke: "#f43f5e" },
  { dot: "bg-cyan-300/85", stroke: "#67e8f9" },
] as const;

function seriesColorClass(index: number): string {
  return seriesColor(index).dot;
}

function seriesColor(index: number): (typeof SERIES_COLORS)[number] {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

function bucketTotal(
  bucket: Histogram["buckets"][number],
  viewMode: WalletDistributionsViewMode
): number {
  const v = viewMode === "count" ? bucket.values.count : bucket.values.usdc;
  return v.won + v.lost + v.pending;
}

function YAxis({
  max,
  height,
  viewMode,
}: {
  max: number;
  height: number;
  viewMode: WalletDistributionsViewMode;
}): ReactElement {
  return (
    <div
      className="flex w-8 shrink-0 flex-col justify-between font-mono text-muted-foreground text-xs tabular-nums"
      style={{ height: `${height}px` }}
    >
      <span className="leading-none">{fmtVal(max, viewMode)}</span>
      <span className="leading-none">0</span>
    </div>
  );
}

function ComparisonLegend({
  series,
  viewMode,
}: {
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[];
  viewMode: WalletDistributionsViewMode;
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-3">
      {series.map((s, i) => (
        <span
          key={s.label}
          className="inline-flex items-center gap-1.5 text-muted-foreground text-xs"
        >
          <span
            className={cn("size-2 rounded-full", seriesColorClass(i))}
            aria-hidden
          />
          {s.label}
          <span className="font-mono">
            {fmtVal(
              viewMode === "count" ? s.data.range.n : totalUsdc(s.data),
              viewMode
            )}
          </span>
        </span>
      ))}
    </div>
  );
}

function totalUsdc(data: WalletAnalysisDistributions): number {
  return data.tradeSize.buckets.reduce(
    (sum, bucket) => sum + bucketTotal(bucket, "usdc"),
    0
  );
}

type DistributionComparisonViewKey =
  | "tradeSize"
  | "entryPrice"
  | "timeInPosition"
  | "entriesPerOutcome"
  | "hourOfDay"
  | "betsPerMarket";

type DistributionComparisonView = {
  key: DistributionComparisonViewKey;
  label: string;
  metric: "histogram" | "flat";
  sparseLabels?: number | undefined;
  histogram?: ((d: WalletAnalysisDistributions) => Histogram) | undefined;
  flat?: ((d: WalletAnalysisDistributions) => FlatHistogram) | undefined;
};

const DISTRIBUTION_COMPARISON_VIEWS = [
  {
    key: "tradeSize",
    label: "Trade size",
    metric: "histogram",
    histogram: (d) => d.tradeSize,
  },
  {
    key: "entryPrice",
    label: "Entry price",
    metric: "histogram",
    histogram: (d) => d.entryPrice,
  },
  {
    key: "timeInPosition",
    label: "Time in position",
    metric: "histogram",
    histogram: (d) => d.dcaWindow,
  },
  {
    key: "entriesPerOutcome",
    label: "Entries/outcome",
    metric: "histogram",
    histogram: (d) => d.dcaDepth,
  },
  {
    key: "hourOfDay",
    label: "Hour of day",
    metric: "histogram",
    sparseLabels: 3,
    histogram: (d) => d.hourOfDay,
  },
  {
    key: "betsPerMarket",
    label: "Bets/market",
    metric: "flat",
    flat: (d) => d.eventClustering,
  },
] satisfies readonly DistributionComparisonView[];

const DISTRIBUTION_COMPARISON_VIEWS_BY_KEY = Object.fromEntries(
  DISTRIBUTION_COMPARISON_VIEWS.map((view) => [view.key, view])
) as unknown as Record<
  DistributionComparisonViewKey,
  DistributionComparisonView
>;

type CurvePoint = {
  label: string;
  absolute: number;
  share: number;
};

type CurveSeries = {
  label: string;
  color: string;
  total: number;
  points: readonly CurvePoint[];
};

function DistributionOverlayChart({
  series,
  view,
  viewMode,
}: {
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[];
  view: DistributionComparisonView;
  viewMode: WalletDistributionsViewMode;
}): ReactElement {
  const curves = buildCurveSeries(series, view, viewMode);
  const maxShare = Math.max(
    0.01,
    ...curves.flatMap((curve) => curve.points.map((point) => point.share))
  );
  const labels = curves[0]?.points.map((point) => point.label) ?? [];

  return (
    <div className="rounded border bg-background p-3">
      <DistributionCurveSvg
        curves={curves}
        labels={labels}
        maxShare={maxShare}
        viewMode={viewMode}
        sparseLabels={view.sparseLabels}
        xAxisLabel={view.label}
      />
    </div>
  );
}

function buildCurveSeries(
  series: readonly (DistributionComparisonSeries & {
    data: WalletAnalysisDistributions;
  })[],
  view: DistributionComparisonView,
  viewMode: WalletDistributionsViewMode
): readonly CurveSeries[] {
  return series.map((s, i) => {
    const points =
      view.metric === "flat" && view.flat
        ? flatCurvePoints(view.flat(s.data), viewMode)
        : histogramCurvePoints(
            view.histogram?.(s.data) ?? s.data.tradeSize,
            viewMode
          );
    const total = points.reduce((sum, point) => sum + point.absolute, 0);
    const normalized = points.map((point) => ({
      ...point,
      share: total > 0 ? point.absolute / total : 0,
    }));
    return {
      label: s.label,
      color: seriesColor(i).stroke,
      total,
      points: normalized,
    };
  });
}

function histogramCurvePoints(
  histogram: Histogram,
  viewMode: WalletDistributionsViewMode
): readonly Omit<CurvePoint, "share">[] {
  return histogram.buckets.map((bucket) => ({
    label: bucket.label,
    absolute: bucketTotal(bucket, viewMode),
  }));
}

function flatCurvePoints(
  histogram: FlatHistogram,
  viewMode: WalletDistributionsViewMode
): readonly Omit<CurvePoint, "share">[] {
  return histogram.buckets.map((bucket) => ({
    label: bucket.label,
    absolute: viewMode === "count" ? bucket.count : bucket.usdc,
  }));
}

function DistributionCurveSvg({
  curves,
  labels,
  maxShare,
  viewMode,
  sparseLabels,
  xAxisLabel,
}: {
  curves: readonly CurveSeries[];
  labels: readonly string[];
  maxShare: number;
  viewMode: WalletDistributionsViewMode;
  sparseLabels?: number | undefined;
  xAxisLabel: string;
}): ReactElement {
  const width = 1000;
  const height = 430;
  const left = 78;
  const right = 28;
  const top = 30;
  const bottom = 76;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const yScaleMax = Math.min(1, Math.max(0.01, maxShare * 1.1));
  const xFor = (i: number) =>
    labels.length <= 1 ? left : left + (i / (labels.length - 1)) * plotW;
  const yFor = (share: number) => top + (1 - share / yScaleMax) * plotH;

  return (
    <div className="mt-4 overflow-hidden rounded border bg-card/40">
      <svg
        role="img"
        aria-label="Wallet distribution overlay"
        viewBox={`0 0 ${width} ${height}`}
        className="h-96 w-full"
      >
        <line
          x1={left}
          y1={top}
          x2={left}
          y2={height - bottom}
          stroke="rgba(148, 163, 184, 0.28)"
        />
        <line
          x1={left}
          y1={top}
          x2={width - right}
          y2={top}
          stroke="rgba(148, 163, 184, 0.18)"
        />
        <line
          x1={left}
          y1={top + plotH / 2}
          x2={width - right}
          y2={top + plotH / 2}
          stroke="rgba(148, 163, 184, 0.14)"
        />
        <line
          x1={left}
          y1={height - bottom}
          x2={width - right}
          y2={height - bottom}
          stroke="rgba(148, 163, 184, 0.28)"
        />
        <text
          x={18}
          y={top + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90 18 ${top + plotH / 2})`}
          className="fill-muted-foreground font-mono text-xs"
        >
          % of wallet
        </text>
        <text
          x={left - 10}
          y={top + 4}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-xs"
        >
          {(yScaleMax * 100).toFixed(0)}%
        </text>
        <text
          x={left - 10}
          y={height - bottom + 4}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-xs"
        >
          0
        </text>
        <text
          x={left + plotW / 2}
          y={height - 14}
          textAnchor="middle"
          className="fill-muted-foreground font-mono text-xs"
        >
          {xAxisLabel}
        </text>

        {curves.map((curve) => {
          const points = curve.points.map((point, i) => ({
            ...point,
            x: xFor(i),
            y: yFor(point.share),
          }));
          const path = points
            .map((point, i) => `${i === 0 ? "M" : "L"} ${point.x} ${point.y}`)
            .join(" ");
          return (
            <g key={curve.label}>
              <path
                d={path}
                fill="none"
                stroke={curve.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
                opacity="0.9"
              />
              {points.map((point, i) => (
                <circle
                  key={`${curve.label}-${point.label}-${i}`}
                  cx={point.x}
                  cy={point.y}
                  r="4"
                  fill={curve.color}
                  stroke="hsl(var(--background))"
                  strokeWidth="2"
                >
                  <title>
                    {curve.label} · {point.label}:{" "}
                    {(point.share * 100).toFixed(1)}% ·{" "}
                    {fmtVal(point.absolute, viewMode)}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}

        {labels.map((label, i) => {
          const showLabel = !sparseLabels || i % sparseLabels === 0;
          if (!showLabel) return null;
          return (
            <text
              key={label}
              x={xFor(i)}
              y={height - 20}
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-xs"
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function ChartGuides(): ReactElement {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 border-muted-foreground/15 border-t"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 border-muted-foreground/30 border-t"
      />
    </>
  );
}

function BucketLabels({
  buckets,
  sparseLabels,
}: {
  buckets: readonly { label: string }[];
  sparseLabels?: number | undefined;
}): ReactElement {
  return (
    <div className="mt-1 flex gap-1">
      {buckets.map((b, i) => {
        const showLabel = !sparseLabels || i % sparseLabels === 0;
        return (
          <span
            key={`${b.label}-label-${i}`}
            className={cn(
              "flex-1 text-center font-mono text-muted-foreground text-xs leading-none",
              showLabel ? "" : "invisible"
            )}
          >
            {b.label}
          </span>
        );
      })}
    </div>
  );
}

function StackedBars({
  histogram,
  viewMode,
  compact,
  sparseLabels,
}: {
  histogram: Histogram;
  viewMode: WalletDistributionsViewMode;
  compact?: boolean;
  /** Show only every Nth bucket label. Useful for hour-of-day where 24 ticks won't fit. */
  sparseLabels?: number;
}): ReactElement {
  const max = histogram.buckets.reduce(
    (m, b) => Math.max(m, bucketTotal(b, viewMode)),
    0
  );
  const scaleMax = Math.max(max, 1);
  const chartPx = compact ? 72 : 104;
  return (
    <div className="flex items-stretch gap-2">
      <YAxis max={max} height={chartPx} viewMode={viewMode} />
      <div className="flex flex-1 flex-col">
        <div
          className="relative flex items-end gap-1"
          style={{ height: `${chartPx}px` }}
        >
          <ChartGuides />
          {histogram.buckets.map((b, i) => {
            const counts =
              viewMode === "count" ? b.values.count : b.values.usdc;
            const total = counts.won + counts.lost + counts.pending;
            const heightPx =
              total === 0
                ? 2
                : Math.max(4, Math.round((total / scaleMax) * chartPx));
            const isMode = total > 0 && total === max;
            const tooltip = `${b.label}: won ${fmtVal(counts.won, viewMode)} · lost ${fmtVal(counts.lost, viewMode)} · pending ${fmtVal(counts.pending, viewMode)}`;
            return (
              <div
                key={`${b.label}-${i}`}
                className="flex flex-1 items-end justify-center"
                title={tooltip}
              >
                <div
                  className={cn(
                    "w-full rounded-t-sm",
                    isMode ? BAR_HIGHLIGHT : BAR_GREY
                  )}
                  style={{ height: `${heightPx}px` }}
                />
              </div>
            );
          })}
        </div>
        <BucketLabels buckets={histogram.buckets} sparseLabels={sparseLabels} />
      </div>
    </div>
  );
}

function FlatBars({
  histogram,
  viewMode,
}: {
  histogram: FlatHistogram;
  viewMode: WalletDistributionsViewMode;
}): ReactElement {
  const max = histogram.buckets.reduce(
    (m, b) => Math.max(m, viewMode === "count" ? b.count : b.usdc),
    0
  );
  const scaleMax = Math.max(max, 1);
  const chartPx = 104;
  return (
    <div className="flex items-stretch gap-2">
      <YAxis max={max} height={chartPx} viewMode={viewMode} />
      <div className="flex flex-1 flex-col">
        <div
          className="relative flex items-end gap-1"
          style={{ height: `${chartPx}px` }}
        >
          <ChartGuides />
          {histogram.buckets.map((b, i) => {
            const v = viewMode === "count" ? b.count : b.usdc;
            const heightPx =
              v === 0 ? 2 : Math.max(4, Math.round((v / scaleMax) * chartPx));
            const isMode = v > 0 && v === max;
            return (
              <div
                key={`${b.label}-${i}`}
                className="flex flex-1 items-end justify-center"
                title={`${b.label}: ${fmtVal(v, viewMode)}`}
              >
                <div
                  className={cn(
                    "w-full rounded-t-sm",
                    isMode ? BAR_HIGHLIGHT : BAR_GREY
                  )}
                  style={{ height: `${heightPx}px` }}
                />
              </div>
            );
          })}
        </div>
        <BucketLabels buckets={histogram.buckets} />
      </div>
    </div>
  );
}

function fmtVal(v: number, mode: WalletDistributionsViewMode): string {
  if (mode === "count") return String(Math.round(v));
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtRange(fromTs: number, toTs: number): string {
  if (fromTs === 0 || toTs === 0) return "—";
  const from = new Date(fromTs * 1000).toISOString().slice(0, 10);
  const to = new Date(toTs * 1000).toISOString().slice(0, 10);
  if (from === to) return from;
  return `${from} → ${to}`;
}
