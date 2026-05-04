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
  PolyWalletOverviewInterval,
} from "@cogni/poly-node-contracts";
import { BarChart3, CircleDollarSign, Hash } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components";
import { cn } from "@/shared/util/cn";

export type TraderMetricMode = "pnl" | "count" | "flow";

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

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1_000 ? 0 : 2,
  }).format(value);
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
