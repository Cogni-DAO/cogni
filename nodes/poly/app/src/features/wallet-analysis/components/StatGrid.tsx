// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/StatGrid`
 * Purpose: 6-cell stat grid for snapshot metrics — WR, ROI, PnL, DD, median hold, avg trades/day.
 * Scope: Presentational only. Renders skeleton cells when snapshot is undefined.
 * Invariants: Always renders 6 cells; empty cells show "—" (no value).
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
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
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
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-6">
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
      <Cell
        label="Realized ROI"
        value={snapshot.roi === null ? "—" : `+${snapshot.roi.toFixed(1)}%`}
        tone={snapshot.roi === null ? "muted" : "success"}
      />
      <Cell label="Realized PnL" value={snapshot.pnl} />
      <Cell
        label="Max DD"
        value={snapshot.dd === null ? "—" : `${snapshot.dd.toFixed(1)}%`}
        tone={
          snapshot.dd === null
            ? "muted"
            : snapshot.dd <= 10
              ? "success"
              : "warn"
        }
        hint="of peak equity"
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
