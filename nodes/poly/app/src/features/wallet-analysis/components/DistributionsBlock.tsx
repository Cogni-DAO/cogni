// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/DistributionsBlock`
 * Purpose: Order-flow deep-dive — 6 stacked histograms (DCA depth, trade size, entry price, DCA window, hour-of-day, event clustering) with a count↔USDC toggle and a pending-share caption. Renders directly from the contract `WalletAnalysisDistributions` shape — no client-side bucket math.
 * Scope: Presentational. CSS-only stacked bars (no chart library) following the project's existing TradesPerDayChart pattern.
 * Invariants:
 *   - PENDING_IS_FIRST_CLASS — every per-fill chart renders three bands (won green / lost red / pending grey).
 *   - DISTRIBUTIONS_ARE_PURE_DERIVATIONS — the component never recomputes buckets; it renders what the server returned.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md (Checkpoint D), work/items/task.0431.poly-wallet-orderflow-distributions-d1.md
 * @public
 */

"use client";

import type {
  FlatHistogram,
  Histogram,
  PolyWalletOverviewInterval,
  WalletAnalysisDistributions,
} from "@cogni/poly-node-contracts";
import { type ReactElement, type ReactNode, useState } from "react";

import { cn } from "@/shared/util/cn";
import type { WalletDistributionsViewMode } from "../types/wallet-analysis";

export type DistributionsBlockProps = {
  data?: WalletAnalysisDistributions | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
  /**
   * The page-level selected window. When the live data range (`data.range`)
   * doesn't cover the selected window, we render a "missing detail" notice
   * with a stub click-handler — the persistence layer that would fetch the
   * older fills is D2/D3 work.
   */
  selectedInterval?: PolyWalletOverviewInterval | undefined;
};

export function DistributionsBlock({
  data,
  isLoading,
  isError,
  selectedInterval,
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
  const gap = selectedInterval
    ? coverageGap(selectedInterval, data.range.fromTs)
    : null;

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
      {gap ? <CoverageNotice gap={gap} /> : null}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ChartCard
          title="Entries per outcome"
          subtitle="how many trades layered into the same (market, side)"
        >
          <StackedBars histogram={data.dcaDepth} viewMode={viewMode} />
        </ChartCard>
        <ChartCard
          title="Trade size"
          subtitle="USDC notional per fill"
        >
          <StackedBars histogram={data.tradeSize} viewMode={viewMode} />
        </ChartCard>
        <ChartCard
          title="Entry price"
          subtitle="favorite (high) ↔ longshot (low)"
        >
          <StackedBars histogram={data.entryPrice} viewMode={viewMode} />
        </ChartCard>
        <ChartCard
          title="Time across a position"
          subtitle="span from first entry to last entry on one outcome"
        >
          <StackedBars histogram={data.dcaWindow} viewMode={viewMode} />
        </ChartCard>
        <ChartCard
          title="Hour of day (UTC)"
          subtitle="when do they trade"
        >
          <StackedBars
            histogram={data.hourOfDay}
            viewMode={viewMode}
            compact
            sparseLabels={3}
          />
        </ChartCard>
        <ChartCard
          title="Trades per event"
          subtitle="how many bets across one game / match (no outcome split — sub-markets resolve independently)"
        >
          <FlatBars histogram={data.eventClustering} viewMode={viewMode} />
          {data.topEvents.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1 text-xs">
              {data.topEvents.slice(0, 5).map((e) => (
                <li key={e.slug} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-right font-mono text-muted-foreground">
                    {e.tradeCount}
                  </span>
                  <span className="truncate" title={e.title}>
                    {e.title || e.slug}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </ChartCard>
      </div>
      <Legend />
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
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-sm uppercase tracking-widest">
            {title}
          </h3>
          {caption ? (
            <p className="text-muted-foreground text-xs">{caption}</p>
          ) : null}
        </div>
        {toolbar}
      </div>
      {children}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded border bg-card p-3">
      <div className="flex flex-col gap-0.5">
        <h4 className="font-medium text-foreground text-xs uppercase tracking-wider">
          {title}
        </h4>
        {subtitle ? (
          <p className="text-[11px] text-muted-foreground leading-snug">
            {subtitle}
          </p>
        ) : null}
      </div>
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

const COLORS = {
  won: "bg-emerald-500/80",
  lost: "bg-rose-500/80",
  pending: "bg-muted-foreground/40",
} as const;

function bucketTotal(
  bucket: Histogram["buckets"][number],
  viewMode: WalletDistributionsViewMode
): number {
  const v = viewMode === "count" ? bucket.values.count : bucket.values.usdc;
  return v.won + v.lost + v.pending;
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
  // Pixel heights match the established TradesPerDayChart pattern. Percentage
  // heights inside `flex flex-col items-end` collapse to 0 because the parent
  // sizes to content — same trap as `h-32` on the row.
  const chartPx = compact ? 72 : 104;
  return (
    <div
      className={cn("flex items-end gap-1", compact ? "h-24" : "h-32")}
      style={{ minHeight: `${chartPx + 16}px` }}
    >
      {histogram.buckets.map((b, i) => {
        const counts = viewMode === "count" ? b.values.count : b.values.usdc;
        const total = counts.won + counts.lost + counts.pending;
        const totalPx =
          total === 0 ? 4 : Math.max(8, Math.round((total / scaleMax) * chartPx));
        const wonPx =
          total > 0 ? Math.round((counts.won / total) * totalPx) : 0;
        const lostPx =
          total > 0 ? Math.round((counts.lost / total) * totalPx) : 0;
        const pendingPx = totalPx - wonPx - lostPx;
        const showLabel = !sparseLabels || i % sparseLabels === 0;
        const tooltip = `${b.label}: won ${fmtVal(counts.won, viewMode)} · lost ${fmtVal(counts.lost, viewMode)} · pending ${fmtVal(counts.pending, viewMode)}`;
        return (
          <div
            key={`${b.label}-${i}`}
            className="group flex flex-1 flex-col items-center justify-end gap-1"
            title={tooltip}
          >
            <div
              className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm bg-muted"
              style={{ height: `${totalPx}px` }}
            >
              {wonPx > 0 ? (
                <div
                  className={COLORS.won}
                  style={{ height: `${wonPx}px` }}
                />
              ) : null}
              {lostPx > 0 ? (
                <div
                  className={COLORS.lost}
                  style={{ height: `${lostPx}px` }}
                />
              ) : null}
              {pendingPx > 0 ? (
                <div
                  className={COLORS.pending}
                  style={{ height: `${pendingPx}px` }}
                />
              ) : null}
            </div>
            <span
              className={cn(
                "font-mono text-[10px] text-muted-foreground leading-none",
                showLabel ? "" : "invisible"
              )}
            >
              {b.label}
            </span>
          </div>
        );
      })}
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
    <div className="flex h-32 items-end gap-1" style={{ minHeight: "120px" }}>
      {histogram.buckets.map((b, i) => {
        const v = viewMode === "count" ? b.count : b.usdc;
        const heightPx =
          v === 0 ? 4 : Math.max(8, Math.round((v / scaleMax) * chartPx));
        return (
          <div
            key={`${b.label}-${i}`}
            className="group flex flex-1 flex-col items-center justify-end gap-1"
            title={`${b.label}: ${fmtVal(v, viewMode)}`}
          >
            <div
              className="w-full rounded-t-sm bg-primary/70"
              style={{ height: `${heightPx}px` }}
            />
            <span className="font-mono text-[10px] text-muted-foreground leading-none">
              {b.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Legend(): ReactElement {
  return (
    <div className="flex items-center gap-4 text-muted-foreground text-xs">
      <span className="flex items-center gap-1.5">
        <span className={cn("inline-block h-2 w-2 rounded-sm", COLORS.won)} />
        won
      </span>
      <span className="flex items-center gap-1.5">
        <span className={cn("inline-block h-2 w-2 rounded-sm", COLORS.lost)} />
        lost
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={cn("inline-block h-2 w-2 rounded-sm", COLORS.pending)}
        />
        pending
      </span>
      <span className="ml-auto">events shown without outcome split</span>
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

type CoverageGap = Readonly<{
  windowLabel: string;
  /** True when we have NO trade-detail data inside the selected window. */
  fully: boolean;
}>;

const SEC_PER_DAY = 86_400;
const INTERVAL_DAYS: Record<PolyWalletOverviewInterval, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "1Y": 365,
  YTD: 365,
  ALL: 365 * 5,
};

function coverageGap(
  interval: PolyWalletOverviewInterval,
  earliestSeenTs: number
): CoverageGap | null {
  if (earliestSeenTs <= 0) return null;
  const windowDays = INTERVAL_DAYS[interval];
  // Live mode covers the most recent ~1000 fills. If the earliest fill is
  // already older than the selected window, we cover it — no gap.
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStartSec = nowSec - windowDays * SEC_PER_DAY;
  if (earliestSeenTs <= windowStartSec) return null;

  // Window extends past what we have. If the gap covers the entire window,
  // mark `fully` so the notice copy reflects "no detail at all".
  const fully = earliestSeenTs >= nowSec - SEC_PER_DAY;
  return { windowLabel: humanWindow(interval), fully };
}

function humanWindow(interval: PolyWalletOverviewInterval): string {
  switch (interval) {
    case "1D":
      return "the last day";
    case "1W":
      return "the last week";
    case "1M":
      return "the last month";
    case "1Y":
      return "the last year";
    case "YTD":
      return "this year";
    case "ALL":
      return "the full history";
  }
}

function CoverageNotice({ gap }: { gap: CoverageGap }): ReactElement {
  const message = gap.fully
    ? `Detailed trades for ${gap.windowLabel} aren't loaded yet.`
    : `Some of ${gap.windowLabel} isn't loaded yet — bars below show only what we have.`;
  return (
    <button
      type="button"
      onClick={() => {
        // Stub for v0. The real fetch path lands with the persistence layer
        // (Doltgres `poly_target_fills` + delta job). Until then, clicking
        // surfaces a discreet placeholder via window.alert — toast system
        // isn't wired yet for this surface.
        if (typeof window !== "undefined") {
          window.alert(
            "Detailed trades for this period aren't loaded yet. Coming soon."
          );
        }
      }}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/20 px-4 py-3 text-left text-sm transition-colors",
        "hover:border-muted-foreground/60 hover:bg-muted/30"
      )}
    >
      <span className="text-muted-foreground">{message}</span>
      <span className="font-medium text-foreground text-xs">Load details →</span>
    </button>
  );
}
