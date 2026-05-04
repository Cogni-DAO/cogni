// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/TimeWindowHeader`
 * Purpose: Page-level time-window selector — the single control that scopes every block below it. Caption removed (windowed-PnL surfaces in `WalletProfitLossCard` directly beneath, so the banner duplicated the headline).
 * Scope: Presentational. Owns no state — interval is passed in. Renders six interval buttons.
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH — this is the only time-window control on the page; per-card range tabs (PnL, distributions) hide when the parent passes them their interval.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md (Checkpoint D — page narrative)
 * @public
 */

"use client";

import type { PolyWalletOverviewInterval } from "@cogni/poly-node-contracts";
import type { ReactElement } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components";
import type { WalletPnlHistoryPoint } from "../types/wallet-analysis";

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
}: TimeWindowHeaderProps): ReactElement {
  return (
    <div className="flex justify-end rounded-xl border border-border/60 bg-muted/10 p-2">
      <ToggleGroup
        type="single"
        value={interval}
        onValueChange={(value) => {
          if (value) onIntervalChange(value as PolyWalletOverviewInterval);
        }}
        className="rounded-lg border border-border/70 p-1"
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
