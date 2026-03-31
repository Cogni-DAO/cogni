// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/graph/view`
 * Purpose: Graph visualization page — toggles between Timeline (Gource-style) and Flow (DAG) views.
 * Scope: Client-side view. Fetches run data via React Query, transforms via adapters, renders graph views.
 * Invariants:
 *   - Polls runs at 5s (matches dashboard pattern)
 *   - Default: Timeline view showing current week
 *   - Click a run node in timeline → switches to flow view for that run
 * Side-effects: IO (via React Query)
 * Links: [RunFlowView](../../../features/graph-viz/components/RunFlowView.tsx), [SystemTimelineView](../../../features/graph-viz/components/SystemTimelineView.tsx)
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { GitGraph, Network } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import type { GraphNode } from "@/components/kit/graph/types";
import { runsToTimelineSnapshot } from "@/features/graph-viz/components/adapters/langgraph.adapter";
import { RunFlowView } from "@/features/graph-viz/components/RunFlowView";
import { SystemTimelineView } from "@/features/graph-viz/components/SystemTimelineView";
import { fetchRuns } from "../dashboard/_api/fetchRuns";

type ViewMode = "timeline" | "flow";

export function GraphView() {
  const [mode, setMode] = useState<ViewMode>("timeline");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Fetch runs — same pattern as dashboard, 5s polling
  const { data: userRuns } = useQuery({
    queryKey: ["graph-runs", "user"],
    queryFn: () => fetchRuns({ tab: "user", limit: 100 }),
    refetchInterval: 5000,
  });

  const { data: systemRuns } = useQuery({
    queryKey: ["graph-runs", "system"],
    queryFn: () => fetchRuns({ tab: "system", limit: 100 }),
    refetchInterval: 5000,
  });

  // Combine all runs into a single timeline snapshot
  const allRuns = useMemo(() => {
    const runs = [...(userRuns?.runs ?? []), ...(systemRuns?.runs ?? [])];
    // Deduplicate by id
    const seen = new Set<string>();
    return runs.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [userRuns, systemRuns]);

  const timelineSnapshot = useMemo(
    () => runsToTimelineSnapshot(allRuns),
    [allRuns]
  );

  // For flow view: build a simple DAG from the selected run
  const flowSnapshot = useMemo(() => {
    if (!selectedRunId) return runsToTimelineSnapshot(allRuns.slice(0, 1));
    const run = allRuns.find((r) => r.id === selectedRunId);
    if (!run) return runsToTimelineSnapshot([]);
    // Single-run view: show the run as a flow node
    return runsToTimelineSnapshot([run]);
  }, [selectedRunId, allRuns]);

  const handleTimelineNodeClick = useCallback((node: GraphNode) => {
    setSelectedRunId(node.id);
    setMode("flow");
  }, []);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-xl">Graph</h1>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as ViewMode)}
        >
          <ToggleGroupItem value="timeline" aria-label="Timeline view">
            <Network className="mr-1.5 h-4 w-4" />
            Timeline
          </ToggleGroupItem>
          <ToggleGroupItem value="flow" aria-label="Flow view">
            <GitGraph className="mr-1.5 h-4 w-4" />
            Flow
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Main visualization */}
      <Card className="flex flex-1 flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="font-medium text-muted-foreground text-sm">
            {mode === "timeline"
              ? `System Activity — ${allRuns.length} runs`
              : selectedRunId
                ? `Run: ${selectedRunId}`
                : "Select a run from timeline"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          {mode === "timeline" ? (
            <SystemTimelineView
              snapshot={timelineSnapshot}
              onNodeSelect={handleTimelineNodeClick}
              className="h-full"
            />
          ) : (
            <RunFlowView snapshot={flowSnapshot} className="h-full" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
