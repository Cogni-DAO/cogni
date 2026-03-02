// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/gov/epoch/view`
 * Purpose: Client component displaying the current open epoch — countdown + EpochDetail.
 * Scope: Renders epoch data fetched via useCurrentEpoch hook. Does not perform server-side logic.
 * Invariants: BigInt units displayed via Number() for presentation only. No credit math in UI.
 * Side-effects: IO (via useCurrentEpoch hook)
 * Links: docs/spec/epoch-ledger.md, src/features/governance/types.ts
 * @public
 */

"use client";

import type { ReactElement } from "react";
import { useMemo } from "react";
import { PieChart } from "@/components";
import { EpochCountdown } from "@/features/governance/components/EpochCountdown";
import { EpochDetail } from "@/features/governance/components/EpochDetail";
import { useCurrentEpoch } from "@/features/governance/hooks/useCurrentEpoch";
import { buildPieChartData } from "@/features/governance/lib/build-pie-data";

export function CurrentEpochView(): ReactElement {
  const { data, isLoading, error } = useCurrentEpoch();

  const epoch = data?.epoch ?? null;

  const sorted = useMemo(
    () =>
      epoch
        ? [...epoch.contributors].sort(
            (a, b) => Number(b.units) - Number(a.units)
          )
        : [],
    [epoch]
  );

  const totalPoints = useMemo(
    () => sorted.reduce((s, c) => s + Math.round(Number(c.units) / 1000), 0),
    [sorted]
  );

  const { chartData, chartConfig, legendEntries } = useMemo(
    () =>
      buildPieChartData(
        sorted.map((c) => ({
          key: c.displayName ?? c.claimantLabel,
          value: c.creditShare,
        }))
      ),
    [sorted]
  );

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h2 className="font-semibold text-destructive text-lg">
            Error loading epoch data
          </h2>
          <p className="text-muted-foreground text-sm">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-8">
        <div className="animate-pulse space-y-8">
          <div className="h-8 w-48 rounded-md bg-muted" />
          <div className="h-28 rounded-lg bg-muted" />
          <div className="h-64 rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  if (!epoch) {
    return (
      <div className="flex flex-col gap-8">
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No active epoch</p>
          <p className="mt-2 text-muted-foreground text-sm">
            A new epoch will appear here when one is opened.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 font-bold text-3xl tracking-tight">
          Epoch <span className="text-primary">#{epoch.id}</span>
        </h1>
        <p className="text-muted-foreground">
          {new Date(epoch.periodStart).toLocaleDateString()} —{" "}
          {new Date(epoch.periodEnd).toLocaleDateString()}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Pie chart + vertical legend */}
        <div className="hidden items-center gap-3 sm:flex">
          <PieChart
            data={chartData}
            config={chartConfig}
            innerRadius={45}
            innerLabel={`#${epoch.id}`}
            className="aspect-square h-44 shrink-0"
          />
          <div className="flex flex-col gap-1.5">
            {legendEntries.map((e) => (
              <div key={e.label} className="flex items-center gap-2 text-xs">
                <div
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: e.color }}
                />
                <span className="text-muted-foreground">{e.label}</span>
              </div>
            ))}
          </div>
        </div>
        <EpochCountdown
          periodStart={epoch.periodStart}
          periodEnd={epoch.periodEnd}
          status={epoch.status}
          contributorCount={sorted.length}
          totalPoints={totalPoints}
        />
      </div>

      <EpochDetail epoch={epoch} hideHeader />
    </div>
  );
}
