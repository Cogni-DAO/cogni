// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/activity/view`
 * Purpose: Client-side view for Activity dashboard with URL-driven time range and groupBy toggle.
 * Scope: Manages time range in URL and groupBy in component state, fetches data via React Query, renders charts and table. Does not implement business logic.
 * Invariants: Time range persists in URL searchParams; groupBy in component state; refetches on change
 * Side-effects: IO
 * Links: [ActivityChart](../../../components/kit/data-display/ActivityChart.tsx), [fetchActivity](./_api/fetchActivity.ts)
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { TimeRangeSelector, ToggleGroup, ToggleGroupItem } from "@/components";
import { ActivityChart } from "@/components/kit/data-display/ActivityChart";
import { ActivityTable } from "@/components/kit/data-display/ActivityTable";
import {
  buildAggregateChartData,
  buildGroupedChartData,
} from "@/components/kit/data-display/activity-chart-utils";
import type {
  ActivityGroupBy,
  TimeRange,
} from "@/contracts/ai.activity.v1.contract";
import { fetchActivity } from "./_api/fetchActivity";

export function ActivityView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = (searchParams.get("range") as TimeRange) || "1d";
  const [groupBy, setGroupBy] = useState<ActivityGroupBy | undefined>("model");

  const { data, isLoading, error } = useQuery({
    queryKey: ["activity", range, groupBy],
    queryFn: () => fetchActivity({ range, ...(groupBy && { groupBy }) }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 2,
  });

  const handleRangeChange = (newRange: TimeRange) => {
    router.replace(`/activity?range=${newRange}`, { scroll: false });
  };

  if (error) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h2 className="font-semibold text-destructive text-lg">
            Error loading activity data
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
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <div className="animate-pulse space-y-8">
          <div className="h-8 w-48 rounded-md bg-muted" />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-48 rounded-lg bg-muted" />
            <div className="h-48 rounded-lg bg-muted" />
            <div className="h-48 rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  const { chartSeries, groupedSeries, totals, rows, effectiveStep } = data;

  const hasGrouped = groupedSeries && groupedSeries.length > 0;

  const spend = hasGrouped
    ? buildGroupedChartData(groupedSeries, "spend")
    : buildAggregateChartData(
        chartSeries,
        "spend",
        "Spend ($)",
        "hsl(var(--chart-1))"
      );

  const tokens = hasGrouped
    ? buildGroupedChartData(groupedSeries, "tokens")
    : buildAggregateChartData(
        chartSeries,
        "tokens",
        "Tokens",
        "hsl(var(--chart-2))"
      );

  const requests = hasGrouped
    ? buildGroupedChartData(groupedSeries, "requests")
    : buildAggregateChartData(
        chartSeries,
        "requests",
        "Requests",
        "hsl(var(--chart-3))"
      );

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-3xl tracking-tight">Your Activity</h1>
        <div className="flex items-center gap-3">
          <ToggleGroup
            type="single"
            value={groupBy ?? ""}
            onValueChange={(v) =>
              setGroupBy((v as ActivityGroupBy) || undefined)
            }
            className="rounded-lg border"
          >
            <ToggleGroupItem value="model" className="px-3 text-xs">
              By Model
            </ToggleGroupItem>
            <ToggleGroupItem value="graphId" className="px-3 text-xs">
              By Agent
            </ToggleGroupItem>
          </ToggleGroup>
          <TimeRangeSelector
            value={range}
            onValueChange={handleRangeChange}
            className="w-40 rounded-lg"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ActivityChart
          title="Spend"
          description={`$${totals.spend.total}`}
          data={spend.data}
          config={spend.config}
          effectiveStep={effectiveStep}
        />
        <ActivityChart
          title="Tokens"
          description={totals.tokens.total.toLocaleString()}
          data={tokens.data}
          config={tokens.config}
          effectiveStep={effectiveStep}
        />
        <ActivityChart
          title="Requests"
          description={totals.requests.total.toLocaleString()}
          data={requests.data}
          config={requests.config}
          effectiveStep={effectiveStep}
        />
      </div>

      <div className="space-y-4">
        <h2 className="font-semibold text-xl tracking-tight">
          Recent Activity
        </h2>
        <ActivityTable logs={rows} />
      </div>
    </div>
  );
}
