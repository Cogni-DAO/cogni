// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WindowedStatsStrip`
 * Purpose: Period toggle + 3-cell stat strip showing windowed numTrades / volume / PnL from
 *          POST /wallets/stats. Replaces the misleading snapshot-derived cells.
 * Scope: Presentational only. Renders skeleton cells when stats is undefined.
 * Invariants:
 *   - Always renders 3 cells; loading state shows animated skeletons.
 *   - numTradesCapped: true renders a "~" prefix on the trade count.
 *   - Period toggle renders above the cells when interval/onIntervalChange are provided.
 *   - PnL cell is always all-time (positions API has no time filter); labeled accordingly.
 * Side-effects: none
 * Links: work/items/task.0361.drawer-windowed-stats-strip.md
 * @public
 */

"use client";

import type {
  PolyWalletOverviewInterval,
  WalletWindowStats,
} from "@cogni/node-contracts";
import type { ReactElement, ReactNode } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components";
import { cn } from "@/shared/util/cn";

const INTERVALS: readonly PolyWalletOverviewInterval[] = [
  "1D",
  "1W",
  "1M",
  "1Y",
  "YTD",
  "ALL",
];

export type WindowedStatsStripProps = {
  stats?: WalletWindowStats | undefined;
  isLoading?: boolean | undefined;
  interval?: PolyWalletOverviewInterval | undefined;
  onIntervalChange?:
    | ((interval: PolyWalletOverviewInterval) => void)
    | undefined;
};

export function WindowedStatsStrip({
  stats,
  isLoading,
  interval,
  onIntervalChange,
}: WindowedStatsStripProps): ReactElement {
  const toggle =
    interval !== undefined ? (
      <ToggleGroup
        type="single"
        value={interval}
        onValueChange={(value) => {
          if (value && onIntervalChange) {
            onIntervalChange(value as PolyWalletOverviewInterval);
          }
        }}
        className="justify-start rounded-lg border border-border/70 p-1"
      >
        {INTERVALS.map((v) => (
          <ToggleGroupItem key={v} value={v} className="px-3 text-xs">
            {v}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    ) : null;

  if (isLoading || !stats) {
    return (
      <div className="flex flex-col gap-3">
        {toggle}
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton cells
              key={i}
              className="flex animate-pulse flex-col gap-1 bg-background p-4"
            >
              <span className="h-3 w-12 rounded bg-muted" />
              <span className="h-7 w-16 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const tradePrefix = stats.numTradesCapped ? "~" : "";
  const pnlTone: "success" | "warn" | "default" =
    stats.pnlUsdc > 0 ? "success" : stats.pnlUsdc < 0 ? "warn" : "default";

  return (
    <div className="flex flex-col gap-3">
      {toggle}
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
        <Cell
          label="Trades"
          value={`${tradePrefix}${stats.numTrades.toLocaleString()}`}
        />
        <Cell label="Volume" value={formatUsd(stats.volumeUsdc)} />
        <Cell
          label="PnL"
          value={formatUsdSigned(stats.pnlUsdc)}
          tone={pnlTone}
          hint="all time"
        />
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "warn" | undefined;
  hint?: string | undefined;
}): ReactElement {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warn"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="flex flex-col gap-1 bg-background p-4">
      <span className="text-muted-foreground text-xs uppercase tracking-widest">
        {label}
      </span>
      <span
        className={cn(
          "font-mono font-semibold text-2xl tabular-nums leading-none",
          toneCls
        )}
      >
        {value}
      </span>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

function formatUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(a / 1_000).toFixed(1)}k`;
  return `$${Math.round(a)}`;
}

function formatUsdSigned(n: number): string {
  const sign = n < 0 ? "-" : "+";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}
