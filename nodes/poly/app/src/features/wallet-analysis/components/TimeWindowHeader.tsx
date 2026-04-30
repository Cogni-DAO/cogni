// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/TimeWindowHeader`
 * Purpose: Page-level time-window selector + plain-English narrative caption — the single control that scopes every block below it. "In the last week: up $2.5M" beats six separate range selectors and a jargon caption.
 * Scope: Presentational. Owns no state — interval + history are passed in. Renders six interval buttons + the windowed-PnL caption.
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH — this is the only time-window control on the page; per-card range tabs (PnL, distributions) hide when the parent passes them their interval.
 *   - PLAIN_ENGLISH — caption avoids "ROI", "delta", "drawdown"; just "up", "down", "flat" with a dollar number. Negative renders as "down $X" not "-$X".
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md (Checkpoint D — page narrative)
 * @public
 */

"use client";

import type { PolyWalletOverviewInterval } from "@cogni/poly-node-contracts";
import type { ReactElement } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components";
import type { WalletPnlHistoryPoint } from "../types/wallet-analysis";
import { computeWindowedPnl } from "./WalletProfitLossCard";

const INTERVALS: readonly PolyWalletOverviewInterval[] = [
  "1D",
  "1W",
  "1M",
  "1Y",
  "YTD",
  "ALL",
];

export type TimeWindowHeaderProps = {
  interval: PolyWalletOverviewInterval;
  onIntervalChange: (interval: PolyWalletOverviewInterval) => void;
  pnlHistory?: readonly WalletPnlHistoryPoint[] | undefined;
  isLoading?: boolean | undefined;
};

export function TimeWindowHeader({
  interval,
  onIntervalChange,
  pnlHistory,
  isLoading,
}: TimeWindowHeaderProps): ReactElement {
  const windowedPnl = computeWindowedPnl(pnlHistory);
  const caption = isLoading ? "Loading…" : buildCaption(interval, windowedPnl);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-base sm:text-lg">{caption}</p>
      <ToggleGroup
        type="single"
        value={interval}
        onValueChange={(value) => {
          if (value) onIntervalChange(value as PolyWalletOverviewInterval);
        }}
        className="justify-start rounded-lg border border-border/70 p-1 sm:justify-end"
      >
        {INTERVALS.map((value) => (
          <ToggleGroupItem key={value} value={value} className="px-3 text-xs">
            {value}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function buildCaption(
  interval: PolyWalletOverviewInterval,
  windowedPnl: number | null
): string {
  const prefix = labelFor(interval);
  if (windowedPnl === null) {
    return `${prefix}: no profit/loss data`;
  }
  if (Math.abs(windowedPnl) < 0.5) {
    return `${prefix}: flat`;
  }
  const direction = windowedPnl > 0 ? "up" : "down";
  const abs = Math.abs(windowedPnl);
  return `${prefix}: ${direction} ${formatBig(abs)}`;
}

function labelFor(interval: PolyWalletOverviewInterval): string {
  switch (interval) {
    case "1D":
      return "Today";
    case "1W":
      return "In the last week";
    case "1M":
      return "In the last month";
    case "1Y":
      return "In the last year";
    case "YTD":
      return "This year";
    case "ALL":
      return "All time";
  }
}

/** Plain-English numbers — $2.5M, $320k, $45 — no .00 cents on big amounts. */
function formatBig(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value.toFixed(0)}`;
}
