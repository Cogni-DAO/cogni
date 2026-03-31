---
id: spike.0240
type: spike
status: done
priority: 0
rank: 2
estimate: 3
title: "Graph Visualization Frontend — Gource-style Interactive Viewer"
summary: "Research and design spec for interactive Gource-style graph visualization in Next.js — covers library selection, component architecture, and unified data model for Temporal/LangGraph/Dolt/agent timelines."
outcome: "Design doc with library recommendations, component architecture, and implementation plan for graph visualization MVP."
assignees: [derekg1729]
initiative: ini.mission-control
project: proj.premium-frontend-ux
created: 2026-03-30
updated: 2026-03-31
branch: worktree-spike+0240-graph-visualization
---

# spike.0240 — Graph Visualization Frontend

## Problem

We need a unified frontend for visualizing:

- **Temporal workflows** — execution timelines, retries, state transitions
- **LangGraph graphs** — node/edge flow, agent decision trees, tool calls
- **Dolt data** — schema diffs, commit history, branch topology
- **Agent timelines** — multi-agent orchestration, parallel execution, cost

We love the Gource aesthetic (animated graph of activity over time) but:

- Video generation is a non-starter (slow, not interactive, can't drill down)
- Need interactive, zoomable, filterable, real-time-capable
- Must live in our Next.js app, not an external tool

## Spike Answers

### Q1: Existing Gource-in-React package?

**No.** The only web port is "3ource" (2013, unmaintained Three.js experiment). No production-ready Gource-for-React exists. Any Gource-style viewer must be assembled from graph primitives.

### Q2: Leanest stack?

**Two libraries, orthogonal concerns:**

| Library                            | Role                                            | Rendering         | Bundle  | Stars |
| ---------------------------------- | ----------------------------------------------- | ----------------- | ------- | ----- |
| **@xyflow/react** (React Flow v12) | DAG/flow diagrams (structured graphs)           | SVG+HTML DOM      | ~1.2 MB | 35.9k |
| **react-force-graph-2d**           | Force-directed animated timeline (Gource-style) | Canvas (d3-force) | ~1.7 MB | 3k    |

**Rejected alternatives:**

- **@antv/g6** — does both but 7.6 MB, Chinese-primary docs, weaker React DX
- **Three.js / react-three-fiber** — too low-level, would be building a graph engine from scratch
- **sigma.js** — great for huge static graphs, weak timeline/animation story
- **cytoscape.js** — Canvas-only limits visual polish, fragmented plugin ecosystem
- **vis-network** — 83 MB unpacked, disqualifying
- **Single-library** — no single lib covers both structured DAG view AND organic force-directed timeline well. Two libs with orthogonal concerns is simpler than one lib forced into both roles.

### Q3: One abstraction for all four data sources?

**Yes — a unified graph data model.** All four sources reduce to the same primitives:

```typescript
interface GraphNode {
  id: string;
  type: string; // open union — adapters define their own types
  label: string;
  status?: "running" | "completed" | "failed" | "pending";
  timestamp?: number; // for timeline playback
  metadata?: Record<string, unknown>; // click-to-inspect payload
}
// Known types per adapter:
//   monitor: 'entity' | 'signal' | 'trigger' | 'run' (from monitor-core schemas)
//   langgraph: 'graph-node' | 'tool'
//   temporal: 'workflow' | 'activity'
//   dolt: 'commit' | 'branch'

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean; // active edge
}

interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  timestamp: number; // for timeline scrubbing
}
```

Each data source gets a lightweight **adapter function** that maps its native shape to `GraphSnapshot`. No ports, no services — pure mappers at the component level.

### Q4: Fastest path to MVP?

Five kit components, one new route (`/graph`), zero backend changes.

---

## Design

### Outcome

Interactive graph visualization as a first-class sidebar page: live system activity timeline (Gource-style) + click-to-inspect run DAGs. Zero video generation.

### Approach

**Solution:** Own sidebar route (`/graph`) with two visualization modes sharing a unified data model.

**Default state:** Timeline view loads the **current week** of runs/signals/entities, auto-advances to "now". New events appear live via React Query polling (5s). Scrub back through the week to replay history. Click any node in the timeline → switches to its run's DAG in flow view.

**Mode 1 — Flow View** (`@xyflow/react`): Structured DAG for a single run's execution graph. Shows LangGraph node flow, Temporal workflow steps, tool call chains. Click a node → inspect panel with metadata. This is the "what happened in this run" view. Defaults to the most recent run.

**Mode 2 — Timeline View** (`react-force-graph-2d`): Force-directed animated graph showing activity over time — Gource-style. Nodes appear/pulse as events happen, edges show relationships. Time scrubber controls playback. This is the "what's happening across the system" view.

**Reuses:**

- shadcn `Card`, `Tabs`, `Sheet`, `ScrollArea`, `Tooltip` for chrome/panels
- Existing `@/components/kit/data-display/` pattern (presentational, data passed as props)
- Existing dashboard polling pattern (React Query, 5s interval)
- Recharts stays for bar/pie charts — these libs are additive, not replacing

**Integration point:** New sidebar item in the app shell navigation, peer to Dashboard/Chat/Activity. Own route at `(app)/graph/`.

### Component Architecture

```
apps/web/src/
├── components/
│   └── kit/
│       └── graph/                          # NEW — kit graph components
│           ├── FlowGraph.tsx               # @xyflow/react wrapper (DAG view)
│           ├── ForceGraph.tsx              # react-force-graph-2d wrapper (timeline view)
│           ├── GraphInspector.tsx          # Side panel for node detail (shadcn Sheet)
│           ├── TimelineScrubber.tsx        # Playback controls for timeline view
│           └── types.ts                   # GraphNode, GraphEdge, GraphSnapshot
├── features/
│   └── graph-viz/                          # NEW — feature slice
│       └── components/
│           ├── RunFlowView.tsx             # Composes FlowGraph + Inspector for a run
│           ├── SystemTimelineView.tsx      # Composes ForceGraph + Scrubber for system view
│           └── adapters/                   # Data shape mappers (pure functions)
│               ├── langgraph.adapter.ts    # LangGraph run → GraphSnapshot
│               ├── monitor.adapter.ts      # monitor-core entities/signals/runs → GraphSnapshot
│               ├── temporal.adapter.ts     # Temporal workflow execution → GraphSnapshot
│               └── dolt.adapter.ts         # Dolt commit log → GraphSnapshot (Phase 2)
└── app/(app)/graph/                        # NEW — own sidebar route
    ├── page.tsx                            # Server component (auth gate)
    └── view.tsx                            # Client view (timeline + flow toggle)
```

### SSR Safety

Both `@xyflow/react` and `react-force-graph-2d` access browser APIs. Per architecture spec (SSR-unsafe libraries): dynamic import inside `"use client"` components, wrapped in kit. The kit wrappers (`FlowGraph.tsx`, `ForceGraph.tsx`) handle the dynamic import so consumers never think about it.

```typescript
// FlowGraph.tsx
"use client";
import dynamic from "next/dynamic";
const ReactFlow = dynamic(
  () => import("@xyflow/react").then((m) => m.ReactFlow),
  { ssr: false }
);
```

### Data Flow (No Backend Changes)

MVP data comes from **existing + in-flight APIs** — no new routes needed for graph viz itself:

1. **LangGraph runs:** `fetchRuns()` returns run data. Map to `GraphSnapshot` for flow view.
2. **Activity feed:** `fetchActivity()` provides aggregate events. Map to force-graph nodes.
3. **Monitor pipeline** (task.0227): `analysisRuns`, `signals`, `monitoredEntities`, `entitySnapshots` — continuous time-series data from the generic monitoring engine. The monitor-core schemas (`MonitoredEntity`, `Signal`, `AnalysisRun`, `TriggerCheck`) map naturally to graph nodes with IDs, timestamps, relationships, and status. API routes (`/brain/status`, `/brain/signals`) provide the data; the monitor adapter transforms to `GraphSnapshot`.
4. **Temporal workflows:** `DataStreamWorkflow` + `AnalysisRunWorkflow` execution history — workflow steps, activity calls, retries, timing. Available via Temporal API when wired.
5. **Dolt:** Phase 2 — when Dolt HTTP API available, add adapter.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] KIT_IS_ONLY_API: Graph viz libs wrapped in `components/kit/graph/`, features import from kit barrel only
- [ ] VENDOR_ISOLATION: `@xyflow/react` and `react-force-graph-2d` imported only inside kit wrappers
- [ ] SSR_SAFE: Both libs loaded via `dynamic()` with `ssr: false` inside `"use client"` components
- [ ] TOKENS_ONLY: All graph styling uses semantic tokens, no raw colors
- [ ] CLASSNAME_LAYOUT_ONLY: Graph container sizing via className, theming via tokens/variants
- [ ] NO_BACKEND_CHANGES: MVP uses existing APIs with client-side data mappers
- [ ] SIMPLE_SOLUTION: Two focused libs (2.9 MB total) vs one bloated lib (7.6 MB+)
- [ ] ARCHITECTURE_ALIGNMENT: Follows vertical slice (features/graph-viz), kit-first component pattern

### Files

- **Create:** `apps/web/src/components/kit/graph/types.ts` — unified `GraphNode`/`GraphEdge`/`GraphSnapshot` types
- **Create:** `apps/web/src/components/kit/graph/FlowGraph.tsx` — `@xyflow/react` kit wrapper
- **Create:** `apps/web/src/components/kit/graph/ForceGraph.tsx` — `react-force-graph-2d` kit wrapper
- **Create:** `apps/web/src/components/kit/graph/GraphInspector.tsx` — node detail sheet
- **Create:** `apps/web/src/components/kit/graph/TimelineScrubber.tsx` — playback controls
- **Create:** `apps/web/src/features/graph-viz/components/RunFlowView.tsx` — single-run DAG view
- **Create:** `apps/web/src/features/graph-viz/components/SystemTimelineView.tsx` — system timeline
- **Create:** `apps/web/src/features/graph-viz/components/adapters/*.ts` — data mappers
- **Create:** `apps/web/src/app/(app)/graph/page.tsx` — server component (auth gate)
- **Create:** `apps/web/src/app/(app)/graph/view.tsx` — client view (timeline + flow toggle)
- **Modify:** sidebar nav config — add Graph item (peer to Dashboard/Chat)
- **Modify:** `apps/web/src/components/index.ts` — export new kit components
- **Modify:** `package.json` — add `@xyflow/react`, `react-force-graph-2d`

### Implementation Order

1. `pnpm add @xyflow/react react-force-graph-2d` + types
2. Kit wrappers (`FlowGraph`, `ForceGraph`, `GraphInspector`, `TimelineScrubber`)
3. Feature adapters (LangGraph first — data already available)
4. Feature views (`RunFlowView`, `SystemTimelineView`)
5. Dashboard integration (new tab)
6. `pnpm check` gate

### Phase 2 (After Monitor Engine Lands)

- Dolt commit graph adapter (when Dolt HTTP API available)
- Real-time SSE streaming into force graph (live mode via `/brain/stream`)
- Graph persistence / shareable URLs
- 3D mode via `react-force-graph-3d` (same API, drop-in upgrade if needed)

## Validation

- [ ] `@xyflow/react` and `react-force-graph-2d` install cleanly, no peer dep conflicts
- [ ] Kit wrappers render without SSR errors in Next.js dev
- [ ] FlowGraph renders a sample DAG with zoom/pan/click
- [ ] ForceGraph renders animated force-directed layout with 100+ nodes without jank
- [ ] GraphInspector opens on node click with metadata
- [ ] TimelineScrubber controls playback speed and position
- [ ] Dashboard Graph tab loads existing run data through LangGraph adapter
- [ ] `pnpm check` passes
