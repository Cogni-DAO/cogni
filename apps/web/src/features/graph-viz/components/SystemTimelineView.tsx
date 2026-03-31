// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/graph-viz/components/SystemTimelineView`
 * Purpose: Composes ForceGraph + TimelineScrubber + GraphInspector for Gource-style system timeline.
 * Scope: Feature composition. Manages playback state and time-filtered snapshot. Does not fetch data.
 * Invariants: KIT_IS_ONLY_API — imports from kit barrel only.
 * Side-effects: none
 * Links: [ForceGraph](../../../components/kit/graph/ForceGraph.tsx), [TimelineScrubber](../../../components/kit/graph/TimelineScrubber.tsx)
 * @public
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ForceGraph } from "@/components/kit/graph/ForceGraph";
import { GraphInspector } from "@/components/kit/graph/GraphInspector";
import { TimelineScrubber } from "@/components/kit/graph/TimelineScrubber";
import type { GraphNode, GraphSnapshot } from "@/components/kit/graph/types";

export interface SystemTimelineViewProps {
  /** Full snapshot containing all nodes across the time range */
  snapshot: GraphSnapshot;
  /** Called when a node is selected (e.g. to switch to flow view) */
  onNodeSelect?: ((node: GraphNode) => void) | undefined;
  className?: string | undefined;
}

export function SystemTimelineView({
  snapshot,
  onNodeSelect,
  className,
}: SystemTimelineViewProps) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Compute time bounds from the data
  const { minTime, maxTime } = useMemo(() => {
    const timestamps = snapshot.nodes
      .map((n) => n.timestamp)
      .filter((t): t is number => t !== undefined);
    if (timestamps.length === 0) {
      return {
        minTime: Date.now() - 7 * 24 * 60 * 60 * 1000,
        maxTime: Date.now(),
      };
    }
    return {
      minTime: Math.min(...timestamps),
      maxTime: Math.max(...timestamps, Date.now()),
    };
  }, [snapshot.nodes]);

  // Start at "now" (live). Track whether user is in live mode.
  const [currentTime, setCurrentTime] = useState(maxTime);
  const [isLive, setIsLive] = useState(true);

  // Auto-advance to maxTime when new data arrives and user is in live mode
  useEffect(() => {
    if (isLive) setCurrentTime(maxTime);
  }, [isLive, maxTime]);

  // Filter snapshot to only show nodes up to currentTime
  const filteredSnapshot = useMemo((): GraphSnapshot => {
    const visibleNodes = snapshot.nodes.filter(
      (n) => !n.timestamp || n.timestamp <= currentTime
    );
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = snapshot.edges.filter(
      (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
    );
    return { nodes: visibleNodes, edges: visibleEdges, timestamp: currentTime };
  }, [snapshot, currentTime]);

  const handleTimeChange = useCallback(
    (ts: number) => {
      setCurrentTime(ts);
      // If user scrubs away from max, exit live mode; skip-to-live re-enables it
      setIsLive(ts >= maxTime);
    },
    [maxTime]
  );

  return (
    <div className={`flex flex-col ${className ?? "h-full"}`}>
      <div className="flex-1">
        <ForceGraph
          snapshot={filteredSnapshot}
          onNodeClick={(node) => {
            setSelectedNode(node);
            onNodeSelect?.(node);
          }}
          className="h-full w-full"
        />
      </div>
      <TimelineScrubber
        min={minTime}
        max={maxTime}
        value={currentTime}
        onChange={handleTimeChange}
        className="shrink-0"
      />
      <GraphInspector
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  );
}
