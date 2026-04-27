// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/StatGrid`
 * Purpose: 3-cell stat grid for snapshot metrics — WR, median hold, avg trades/day.
 * Scope: Presentational only. Renders skeleton cells when snapshot is undefined.
 * Invariants:
 *   - Always renders 3 cells; empty cells show "—" (no value).
 *   - PnL/ROI/drawdown intentionally absent — Polymarket's user-pnl series
 *     owns those numbers via `WalletProfitLossCard` (task.0389).
 * Side-effects: none
 * @public
 */

"use client";

import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/util/cn";
import type { WalletSnapshot } from "../types/wallet-analysis";

export type StatGridProps = {
  snapshot?: WalletSnapshot | undefined;
  isLoading?: boolean | undefined;
};

export function StatGrid({ snapshot, isLoading }: StatGridProps): ReactElement {
  if (isLoading || !snapshot) {
    return (
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
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
    );
  }

  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
      <Cell
        label="True WR"
        value={snapshot.wr === null ? "—" : `${snapshot.wr.toFixed(1)}%`}
        tone={snapshot.wr === null ? "muted" : "success"}
        hint={
          snapshot.wr === null
            ? snapshot.n === 0
              ? "no resolved positions"
              : `n=${snapshot.n} — need ≥5 for stats`
            : `over n=${snapshot.n}`
        }
      />
      <Cell label="Median hold" value={snapshot.medianDur} />
      <Cell
        label="Avg trades / day"
        value={
          snapshot.avgPerDay === null || snapshot.avgPerDay === 0
            ? "—"
            : `≈ ${snapshot.avgPerDay}`
        }
        hint="30-day mean"
      />
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
  tone?: "default" | "success" | "warn" | "muted" | undefined;
  hint?: string | undefined;
}): ReactElement {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warn"
        ? "text-destructive"
        : tone === "muted"
          ? "text-muted-foreground"
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
