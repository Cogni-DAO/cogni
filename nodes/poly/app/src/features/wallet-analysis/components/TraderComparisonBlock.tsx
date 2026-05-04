// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/TraderComparisonBlock`
 * Purpose: Presentational research header comparing up to three traders across P/L, fill count, and USDC flow.
 * Scope: Client component. Receives contract data and renders CSS-only diverging horizontal bars.
 * Invariants:
 *   - DIVERGING_BASELINE: P/L negatives render left of center, positives right; fill and flow modes use SELL left, BUY right.
 *   - NO_CLIENT_AGGREGATION: values are rendered from the API contract without recomputing trade windows.
 * Side-effects: none
 * @public
 */

"use client";

import type {
  PolyResearchTraderComparisonResponse,
  PolyResearchTraderComparisonTrader,
  PolyResearchTraderSizePnlBucket,
  PolyWalletOverviewInterval,
} from "@cogni/poly-node-contracts";
import { BarChart3, CircleDollarSign, Hash } from "lucide-react";
import { type ReactElement, type ReactNode, useMemo, useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components";
import { cn } from "@/shared/util/cn";

export type TraderMetricMode = "pnl" | "count" | "flow";
type SizePnlViewMode = "pnl" | "winrate";

export const TRADER_COMPARISON_INTERVALS: readonly PolyWalletOverviewInterval[] =
  ["1D", "1W", "1M", "ALL"] as const;

export function TraderComparisonBlock({
  data,
  isLoading,
  isError,
  interval,
  onIntervalChange,
  mode,
  onModeChange,
}: {
  data?: PolyResearchTraderComparisonResponse | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
  interval: PolyWalletOverviewInterval;
  onIntervalChange: (interval: PolyWalletOverviewInterval) => void;
  mode: TraderMetricMode;
  onModeChange: (mode: TraderMetricMode) => void;
}): ReactElement {
  if (isLoading && !data) {
    return (
      <section className="flex flex-col gap-4">
        <TraderComparisonHeader
          interval={interval}
          onIntervalChange={onIntervalChange}
          mode={mode}
          onModeChange={onModeChange}
        />
        <div className="grid gap-3">
          {["one", "two", "three"].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <TraderComparisonHeader
        interval={interval}
        onIntervalChange={onIntervalChange}
        mode={mode}
        onModeChange={onModeChange}
      />
      <TraderComparisonChart
        data={data}
        isLoading={isLoading}
        isError={isError}
        mode={mode}
      />
    </section>
  );
}

export function TraderComparisonChart({
  data,
  isLoading,
  isError,
  mode,
}: {
  data?: PolyResearchTraderComparisonResponse | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
  mode: TraderMetricMode;
}): ReactElement {
  if (isLoading && !data) {
    return (
      <div className="grid gap-3">
        {["one", "two", "three"].map((key) => (
          <div key={key} className="h-20 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  const traders = data?.traders ?? [];
  if (isError && traders.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Trader comparison is unavailable.
      </p>
    );
  }

  if (traders.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No traders selected for comparison.
      </p>
    );
  }

  const max = maxMagnitude(traders, mode);
  return (
    <div className="divide-y">
      {traders.map((trader) => (
        <TraderComparisonRow
          key={trader.address}
          trader={trader}
          mode={mode}
          max={max}
        />
      ))}
    </div>
  );
}

export function TraderSizePnlChart({
  data,
  isLoading,
  isError,
}: {
  data?: PolyResearchTraderComparisonResponse | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
}): ReactElement {
  const traders = useMemo(
    () => orderSizePnlTraders(data?.traders ?? []),
    [data?.traders]
  );
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<SizePnlViewMode>("pnl");
  const selectedTrader =
    traders.find((trader) => trader.address === selectedAddress) ?? traders[0];

  if (isLoading && !data) {
    return <div className="h-80 animate-pulse rounded bg-muted" />;
  }
  if (isError && traders.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Size P/L is unavailable.</p>
    );
  }
  if (!selectedTrader) {
    return (
      <p className="text-muted-foreground text-sm">
        No observed buy-size data available.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SizePnlTraderTabs
            traders={traders}
            selectedAddress={selectedTrader.address}
            onSelect={setSelectedAddress}
          />
          <SizePnlModeToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
        <SizePnlSummary trader={selectedTrader} />
      </div>
      <SizePnlSvg trader={selectedTrader} viewMode={viewMode} />
    </div>
  );
}

function TraderComparisonHeader({
  interval,
  onIntervalChange,
  mode,
  onModeChange,
}: {
  interval: PolyWalletOverviewInterval;
  onIntervalChange: (interval: PolyWalletOverviewInterval) => void;
  mode: TraderMetricMode;
  onModeChange: (mode: TraderMetricMode) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
          <BarChart3 className="size-3.5" />
          Trader Comparison
        </div>
        <h2 className="font-semibold text-lg">P/L and trade flow</h2>
      </div>

      <div className="flex flex-wrap gap-2">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value === "pnl" || value === "count" || value === "flow") {
              onModeChange(value);
            }
          }}
          className="rounded-lg border"
        >
          <ToggleGroupItem value="pnl" className="gap-1.5 px-3 text-xs">
            <CircleDollarSign className="size-3.5" />
            P/L
          </ToggleGroupItem>
          <ToggleGroupItem value="count" className="gap-1.5 px-3 text-xs">
            <Hash className="size-3.5" />
            Fills
          </ToggleGroupItem>
          <ToggleGroupItem value="flow" className="gap-1.5 px-3 text-xs">
            <CircleDollarSign className="size-3.5" />
            USDC
          </ToggleGroupItem>
        </ToggleGroup>

        <ToggleGroup
          type="single"
          value={interval}
          onValueChange={(value) => {
            if (
              TRADER_COMPARISON_INTERVALS.includes(
                value as PolyWalletOverviewInterval
              )
            ) {
              onIntervalChange(value as PolyWalletOverviewInterval);
            }
          }}
          className="rounded-lg border"
        >
          {TRADER_COMPARISON_INTERVALS.map((option) => (
            <ToggleGroupItem
              key={option}
              value={option}
              className="px-3 text-xs"
            >
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}

function SizePnlSummary({
  trader,
}: {
  trader: PolyResearchTraderComparisonTrader;
}): ReactElement {
  const stats = trader.tradeSizePnl;
  return (
    <div className="flex flex-wrap justify-end gap-3 text-muted-foreground text-xs">
      <span>
        <span className={cn("font-mono", pnlClassName(stats.pnlUsdc))}>
          {formatSignedUsd(stats.pnlUsdc)}
        </span>{" "}
        P/L
      </span>
      <span>
        <span className="font-mono">
          {stats.winCount.toLocaleString()}-{stats.lossCount.toLocaleString()}
        </span>{" "}
        W/L
      </span>
      {stats.flatCount > 0 ? (
        <span>
          <span className="font-mono">{stats.flatCount.toLocaleString()}</span>{" "}
          flat
        </span>
      ) : null}
      <span>
        <span className="font-mono">{formatPercent(stats.winRate)}</span> WR
      </span>
      <span>
        <span className="font-mono">{formatUsd(stats.hedgeBuyUsdc)}</span> hedge
      </span>
    </div>
  );
}

function SizePnlTraderTabs({
  traders,
  selectedAddress,
  onSelect,
}: {
  traders: readonly PolyResearchTraderComparisonTrader[];
  selectedAddress: string;
  onSelect: (address: string) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      {traders.map((trader) => (
        <button
          key={trader.address}
          type="button"
          onClick={() => onSelect(trader.address)}
          className={cn(
            "rounded border px-3 py-1.5 text-xs transition-colors",
            trader.address === selectedAddress
              ? "border-primary/50 bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {trader.label}
        </button>
      ))}
    </div>
  );
}

function SizePnlModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: SizePnlViewMode;
  onChange: (mode: SizePnlViewMode) => void;
}): ReactElement {
  return (
    <div className="inline-flex rounded border bg-muted p-0.5 text-xs">
      {(["pnl", "winrate"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={cn(
            "rounded px-2 py-1 font-medium uppercase tracking-wider transition-colors",
            viewMode === mode
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {mode === "pnl" ? "P/L" : "Win rate"}
        </button>
      ))}
    </div>
  );
}

function SizePnlSvg({
  trader,
  viewMode,
}: {
  trader: PolyResearchTraderComparisonTrader;
  viewMode: SizePnlViewMode;
}): ReactElement {
  const buckets = trader.tradeSizePnl.buckets;
  const width = 2400;
  const height = 600;
  const left = 104;
  const right = 48;
  const top = 34;
  const bottom = 108;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const zeroY = top + plotH / 2;
  const maxPnlMagnitude = Math.max(
    1,
    ...buckets.map((bucket) => Math.abs(bucket.pnlUsdc))
  );
  const pnlScale = (plotH / 2 - 18) / maxPnlMagnitude;
  const winRateBottom = height - bottom;
  const winRateScale = (plotH - 18) / 1;
  const gap = 8;
  const barW = plotW / buckets.length - gap;
  const yAxisLabel = viewMode === "pnl" ? "resolved P/L" : "win rate";

  return (
    <div className="overflow-hidden rounded border bg-card/40">
      <svg
        role="img"
        aria-label={`${trader.label} ${yAxisLabel} by buy-size percentile bucket`}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height: "520px" }}
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
          y1={viewMode === "pnl" ? zeroY : winRateBottom}
          x2={width - right}
          y2={viewMode === "pnl" ? zeroY : winRateBottom}
          stroke="rgba(148, 163, 184, 0.45)"
        />
        {viewMode === "winrate" ? (
          <line
            x1={left}
            y1={top + plotH / 2}
            x2={width - right}
            y2={top + plotH / 2}
            stroke="rgba(148, 163, 184, 0.16)"
          />
        ) : null}
        <line
          x1={left}
          y1={top}
          x2={width - right}
          y2={top}
          stroke="rgba(148, 163, 184, 0.16)"
        />
        <line
          x1={left}
          y1={height - bottom}
          x2={width - right}
          y2={height - bottom}
          stroke="rgba(148, 163, 184, 0.16)"
        />
        <text
          x={18}
          y={top + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90 18 ${top + plotH / 2})`}
          className="fill-muted-foreground font-mono text-xs"
        >
          {yAxisLabel}
        </text>
        <text
          x={left - 10}
          y={top + 4}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-xs"
        >
          {viewMode === "pnl" ? formatCompactUsd(maxPnlMagnitude) : "100%"}
        </text>
        <text
          x={left - 10}
          y={(viewMode === "pnl" ? zeroY : top + plotH / 2) + 4}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-xs"
        >
          {viewMode === "pnl" ? "$0" : "50%"}
        </text>
        <text
          x={left - 10}
          y={height - bottom + 4}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-xs"
        >
          {viewMode === "pnl" ? `-${formatCompactUsd(maxPnlMagnitude)}` : "0%"}
        </text>
        <text
          x={left + plotW / 2}
          y={height - 30}
          textAnchor="middle"
          className="fill-muted-foreground font-mono text-xs"
        >
          buy-size percentile
        </text>

        {buckets.map((bucket, index) => {
          const x = left + index * (barW + gap) + gap / 2;
          const barH =
            viewMode === "pnl"
              ? Math.max(2, Math.abs(bucket.pnlUsdc) * pnlScale)
              : Math.max(2, (bucket.winRate ?? 0) * winRateScale);
          const y =
            viewMode === "pnl"
              ? bucket.pnlUsdc >= 0
                ? zeroY - barH
                : zeroY
              : winRateBottom - barH;
          const labelX = x + barW / 2;
          const showLabel = bucket.loPercentile % 25 === 0;
          return (
            <g key={bucket.key}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx="2"
                className={cn(
                  sizeBucketFillClass(bucket, viewMode),
                  bucket.buyCount === 0 && "fill-muted-foreground/20"
                )}
              >
                <title>{bucketTooltip(bucket)}</title>
              </rect>
              {showLabel ? (
                <text
                  x={labelX}
                  y={height - 56}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono text-xs"
                >
                  p{bucket.loPercentile}
                </text>
              ) : null}
            </g>
          );
        })}
        <text
          x={width - right}
          y={height - 56}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-xs"
        >
          p100
        </text>
      </svg>
    </div>
  );
}

function TraderComparisonRow({
  trader,
  mode,
  max,
}: {
  trader: PolyResearchTraderComparisonTrader;
  mode: TraderMetricMode;
  max: number;
}): ReactElement {
  const values = valuesForMode(trader, mode);
  const leftPct = max > 0 ? Math.min(100, (values.left / max) * 100) : 0;
  const rightPct = max > 0 ? Math.min(100, (values.right / max) * 100) : 0;
  const headline = headlineForMode(trader, mode);
  const detail = detailForMode(trader, mode);

  return (
    <div className="grid gap-3 p-3 md:grid-cols-5 md:items-center">
      <div className="min-w-0 md:col-span-1">
        <div className="truncate font-medium text-sm">{trader.label}</div>
        <div className="truncate text-muted-foreground text-xs">
          {shortAddress(trader.address)}
        </div>
      </div>

      <div className="flex flex-col gap-2 md:col-span-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">{values.leftLabel}</span>
          <span className={cn("font-mono", headline.className)}>
            {headline.text}
          </span>
          <span className="text-muted-foreground">{values.rightLabel}</span>
        </div>
        <div className="flex h-8 w-full overflow-hidden rounded border bg-muted/30">
          <div className="flex flex-1 justify-end border-r">
            <div
              className={cn("h-full transition-all", values.leftClassName)}
              style={{ width: `${leftPct}%` }}
            />
          </div>
          <div className="flex-1">
            <div
              className={cn("h-full transition-all", values.rightClassName)}
              style={{ width: `${rightPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="min-w-0 text-muted-foreground text-xs md:col-span-1 md:text-right">
        {detail}
      </div>
    </div>
  );
}

function maxMagnitude(
  traders: readonly PolyResearchTraderComparisonTrader[],
  mode: TraderMetricMode
): number {
  const values = traders.flatMap((trader) => {
    const modeValues = valuesForMode(trader, mode);
    return [modeValues.left, modeValues.right];
  });
  return Math.max(1, ...values);
}

function valuesForMode(
  trader: PolyResearchTraderComparisonTrader,
  mode: TraderMetricMode
): {
  left: number;
  right: number;
  leftLabel: string;
  rightLabel: string;
  leftClassName: string;
  rightClassName: string;
} {
  if (mode === "count") {
    return {
      left: trader.trades.sellCount,
      right: trader.trades.buyCount,
      leftLabel: "SELL",
      rightLabel: "BUY",
      leftClassName: "bg-destructive/70",
      rightClassName: "bg-success/70",
    };
  }
  if (mode === "flow") {
    return {
      left: trader.trades.sellUsdc,
      right: trader.trades.buyUsdc,
      leftLabel: "SELL $",
      rightLabel: "BUY $",
      leftClassName: "bg-destructive/70",
      rightClassName: "bg-success/70",
    };
  }
  const pnl = trader.pnl.usdc ?? 0;
  return {
    left: Math.max(0, -pnl),
    right: Math.max(0, pnl),
    leftLabel: "Loss",
    rightLabel: "Profit",
    leftClassName: "bg-destructive/70",
    rightClassName: "bg-success/70",
  };
}

function headlineForMode(
  trader: PolyResearchTraderComparisonTrader,
  mode: TraderMetricMode
): { text: string; className?: string | undefined } {
  if (mode === "count") {
    return { text: `${trader.trades.count.toLocaleString()} fills` };
  }
  if (mode === "flow") {
    return { text: formatUsd(trader.trades.notionalUsdc) };
  }
  const pnl = trader.pnl.usdc;
  if (pnl === null) return { text: "--", className: "text-muted-foreground" };
  return {
    text: `${pnl >= 0 ? "+" : "-"}${formatUsd(Math.abs(pnl))}`,
    className: pnl >= 0 ? "text-success" : "text-destructive",
  };
}

function detailForMode(
  trader: PolyResearchTraderComparisonTrader,
  mode: TraderMetricMode
): ReactNode {
  if (!trader.isObserved) {
    return "Not on saved roster";
  }
  if (mode === "pnl") {
    return `${trader.trades.count.toLocaleString()} fills saved`;
  }
  if (mode === "count") {
    return `${trader.trades.marketCount.toLocaleString()} markets`;
  }
  return `${formatUsd(trader.trades.buyUsdc)} bought / ${formatUsd(
    trader.trades.sellUsdc
  )} sold`;
}

function orderSizePnlTraders(
  traders: readonly PolyResearchTraderComparisonTrader[]
): readonly PolyResearchTraderComparisonTrader[] {
  const score = (trader: PolyResearchTraderComparisonTrader) => {
    const label = trader.label.toLowerCase();
    if (label === "rn1") return 0;
    if (label === "swisstony") return 1;
    if (label === "you") return 2;
    return 3;
  };
  return [...traders].sort((a, b) => score(a) - score(b));
}

function bucketTooltip(bucket: PolyResearchTraderSizePnlBucket): string {
  const sizeRange =
    bucket.buyCount > 0
      ? `${formatUsd(bucket.minSizeUsdc)}-${formatUsd(bucket.maxSizeUsdc)}`
      : "--";
  return [
    `${bucket.label}: ${formatSignedUsd(bucket.pnlUsdc)}`,
    `${bucket.winCount.toLocaleString()}W / ${bucket.lossCount.toLocaleString()}L / ${bucket.flatCount.toLocaleString()} flat / ${bucket.pendingCount.toLocaleString()} pending`,
    `WR ${formatPercent(bucket.winRate)}`,
    `avg ${formatUsd(bucket.avgSizeUsdc)} (${sizeRange})`,
    `hedge ${formatUsd(bucket.hedgeBuyUsdc)}`,
  ].join(" · ");
}

function sizeBucketFillClass(
  bucket: PolyResearchTraderSizePnlBucket,
  viewMode: SizePnlViewMode
): string {
  if (viewMode === "pnl") {
    return bucket.pnlUsdc >= 0 ? "fill-success/80" : "fill-destructive/80";
  }
  if (bucket.winRate === null) return "fill-muted-foreground/30";
  if (bucket.winRate >= 0.55) return "fill-success/80";
  if (bucket.winRate <= 0.45) return "fill-destructive/80";
  return "fill-amber-400/80";
}

function pnlClassName(value: number): string {
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "text-muted-foreground";
}

function formatSignedUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatUsd(Math.abs(value))}`;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1_000 ? 0 : 2,
  }).format(value);
}

function formatCompactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function formatPercent(value: number | null): string {
  if (value === null) return "--";
  return `${(value * 100).toFixed(0)}%`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
