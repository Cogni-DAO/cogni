// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/view`
 * Purpose: Live operations dashboard showing agent runs as cards with status indicators and elapsed timers.
 * Scope: Client-side view managing tab state and data fetching via React Query. Does not implement business logic.
 * Invariants: Polls at 5s interval; running runs pinned to top; My Runs tab default.
 * Side-effects: IO (via React Query)
 * Links: [RunCard](../../../components/kit/data-display/RunCard.tsx), [fetchRuns](./_api/fetchRuns.ts)
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";
import { useState } from "react";

import { Button, ToggleGroup, ToggleGroupItem } from "@/components";
import type { RunCardData } from "@/components/kit/data-display/RunCard";
import { RunCard } from "@/components/kit/data-display/RunCard";
import { fetchRuns } from "./_api/fetchRuns";

type Tab = "user" | "system";

function sortRuns(runs: RunCardData[]): RunCardData[] {
  const statusOrder: Record<string, number> = {
    running: 0,
    pending: 1,
    error: 2,
    success: 3,
    skipped: 4,
    cancelled: 5,
  };
  return [...runs].sort((a, b) => {
    const aOrder = statusOrder[a.status] ?? 99;
    const bOrder = statusOrder[b.status] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    // Within same status, most recent first
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bTime - aTime;
  });
}

export function DashboardView(): ReactElement {
  const [tab, setTab] = useState<Tab>("user");

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard-runs", tab],
    queryFn: () => fetchRuns({ tab, limit: 50 }),
    refetchInterval: 5_000,
    staleTime: 3_000,
    gcTime: 60_000,
  });

  const runs = data?.runs ? sortRuns(data.runs) : [];
  const activeCount = runs.filter((r) => r.status === "running").length;

  return (
    <div className="flex flex-col gap-6 p-5 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-2xl tracking-tight">Dashboard</h1>
          {activeCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 font-medium text-sm text-success">
              <Radio className="size-3.5 animate-pulse" />
              {activeCount} active
            </span>
          )}
        </div>
        <ToggleGroup
          type="single"
          value={tab}
          onValueChange={(v) => {
            if (v) setTab(v as Tab);
          }}
          className="rounded-lg border"
        >
          <ToggleGroupItem value="user" className="px-3 text-xs">
            My Runs
          </ToggleGroupItem>
          <ToggleGroupItem value="system" className="px-3 text-xs">
            System
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h2 className="font-semibold text-destructive text-lg">
            Error loading runs
          </h2>
          <p className="text-muted-foreground text-sm">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid animate-pulse gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="h-32 rounded-lg bg-muted" />
          <div className="h-32 rounded-lg bg-muted" />
          <div className="h-32 rounded-lg bg-muted" />
          <div className="h-32 rounded-lg bg-muted" />
          <div className="h-32 rounded-lg bg-muted" />
          <div className="h-32 rounded-lg bg-muted" />
        </div>
      )}

      {/* Card grid */}
      {!isLoading && !error && runs.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && runs.length === 0 && (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            {tab === "user" ? "No recent runs" : "No system runs"}
          </p>
          <p className="mt-2 text-muted-foreground text-sm">
            {tab === "user"
              ? "Start a conversation to see your agent runs here."
              : "System-scheduled runs will appear here when they execute."}
          </p>
          {tab === "user" && (
            <Button asChild className="mt-4">
              <Link href="/chat">Start a Chat</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
