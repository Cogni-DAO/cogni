// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@components/kit/graph/ForceGraph`
 * Purpose: Kit wrapper around react-force-graph-2d for Gource-style force-directed timeline visualization.
 * Scope: Presentational. Accepts GraphSnapshot data, renders animated force graph. Does not fetch data.
 * Invariants: VENDOR_ISOLATION — react-force-graph-2d imported only here. SSR_SAFE — dynamic import with ssr:false.
 * Side-effects: none
 * Links: [types](./types.ts)
 * @public
 */

"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef } from "react";

import type { GraphNode, GraphSnapshot } from "./types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      Loading graph…
    </div>
  ),
});

export interface ForceGraphProps {
  /** Graph data to render */
  snapshot: GraphSnapshot;
  /** Called when a node is clicked */
  onNodeClick?: ((node: GraphNode) => void) | undefined;
  /** Container className for layout overrides */
  className?: string | undefined;
}

const STATUS_COLORS: Record<string, string> = {
  running: "#22c55e",
  completed: "#16a34a",
  failed: "#ef4444",
  pending: "#a1a1aa",
};

const TYPE_COLORS: Record<string, string> = {
  "graph-node": "#3b82f6",
  tool: "#f59e0b",
  entity: "#8b5cf6",
  signal: "#ec4899",
  trigger: "#f97316",
  run: "#06b6d4",
  workflow: "#3b82f6",
  activity: "#10b981",
  commit: "#6366f1",
  branch: "#84cc16",
};

// The library's node type is generic with [others: string]: any, so we store
// our data alongside the d3-force positional fields.
interface ForceNodeData {
  id: string;
  label: string;
  nodeType: string;
  status: string;
  _graphNode: GraphNode;
  // d3-force adds x, y, vx, vy at runtime
  x?: number;
  y?: number;
  [key: string]: unknown;
}

export function ForceGraph({
  snapshot,
  onNodeClick,
  className,
}: ForceGraphProps) {
  // biome-ignore lint/suspicious/noExplicitAny: react-force-graph-2d uses generic node types with [key: string]: any
  const fgRef = useRef<any>(null);

  const graphData = useMemo(
    () => ({
      nodes: snapshot.nodes.map(
        (n): ForceNodeData => ({
          id: n.id,
          label: n.label,
          nodeType: n.type,
          status: n.status ?? "pending",
          _graphNode: n,
        })
      ),
      links: snapshot.edges.map((e) => ({
        source: e.source,
        target: e.target,
      })),
    }),
    [snapshot]
  );

  // biome-ignore lint/suspicious/noExplicitAny: react-force-graph-2d uses generic node types with [key: string]: any
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    const n = node as ForceNodeData;
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    const r = n.status === "running" ? 8 : 6;
    const color =
      STATUS_COLORS[n.status] ?? TYPE_COLORS[n.nodeType] ?? "#a1a1aa";

    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // Label
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#e4e4e7";
    const label = n.label.length > 20 ? `${n.label.slice(0, 18)}…` : n.label;
    ctx.fillText(label, x, y + r + 6);
  }, []);

  const paintPointerArea = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: react-force-graph-2d generic node type
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      const n = node as ForceNodeData;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  const handleNodeClick = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: react-force-graph-2d generic node type
    (node: any) => {
      const n = node as ForceNodeData;
      if (onNodeClick) onNodeClick(n._graphNode);
    },
    [onNodeClick]
  );

  return (
    <div className={className ?? "h-full w-full"}>
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}
        onNodeClick={handleNodeClick}
        linkColor={() => "rgba(161, 161, 170, 0.4)"}
        linkWidth={1.5}
        backgroundColor="transparent"
        cooldownTicks={100}
      />
    </div>
  );
}
