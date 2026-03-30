---
id: proj.premium-frontend-ux
type: project
primary_charter:
title: "Premium Frontend UX — Activity Stream, Work Items, Agent Visualization"
state: Active
priority: 1
estimate: 4
summary: Top-tier UX for chat activity indicators, work item management, and animated agent visualization — from 1-line status ticker through Three.js observatory
outcome: Users see live agent activity in chat (replacing invisible thinking), work items are navigable with keyboard shortcuts and detail panels, agents have animated visual presence
assignees:
  - derekg1729
created: 2026-03-30
updated: 2026-03-30
labels:
  - ui
  - ux
  - ai-graphs
  - frontend
---

# Premium Frontend UX

> Research: [docs/research/ux-premium-frontend.md](../../docs/research/ux-premium-frontend.md)

## Goal

Deliver a top-tier frontend experience across the three core user surfaces: chat (activity visibility), work items (navigation and management), and agents (animated visual presence). Progressive enhancement from immediate UX fixes through Three.js visualization.

## Context

### What exists today

- **Chat**: `@assistant-ui/react` streaming works, but **thinking is invisible**. `StatusEvent` pipeline is complete backend-to-SSE — frontend just doesn't render it.
- **Work items** (`/work`): Functional table with filters. No row actions, detail panel, keyboard nav, or project grouping.
- **Dashboard** (`/dashboard`): `RunCard` with pulsing dots and timers. `statusLabel` exists but is always null. No live streaming content.
- **Agent visualization**: None. No animated avatars, no 3D scene.

### What's missing

- Chat activity indicator (the "invisible thinking" gap)
- Live phase labels on dashboard run cards
- Work items power-user UX (keyboard nav, detail panel, inline transitions)
- Visual agent identity (animated characters)
- Agent observatory (Three.js — future)

## Design Decisions

### Chat status line, not chat sidebar

The activity indicator is a single line above the composer, not a sidebar or panel. Reasons:
- Minimal visual weight — doesn't compete with message content
- Matches the ephemeral nature of StatusEvent (best-effort, transient)
- Easy to enhance later (expandable log, tool call history)

### Shared SSE hook for dashboard + chat

`useRunActivity(runId)` wraps EventSource with reconnection. Dashboard cards and chat both consume real-time status. Chat uses AI SDK stream for text, shared hook for phase display. DRY reconnection logic.

### TanStack Table for work items

`@tanstack/react-table` replaces hand-rolled table. Gains: sorting, column resizing, virtual scrolling, row selection, keyboard navigation. Already using `@tanstack/react-query`.

### Progressive agent visualization

1. CSS/Framer Motion status animations (P0)
2. Rive/Lottie 2D agent avatars (P1)
3. Three.js 3D observatory (P2)

Each phase delivers standalone value. No throwaway work.

## Roadmap

### Crawl (P0): Activity Visibility

**Goal:** Users see what the AI is doing. Fixes the highest-impact UX gap.

| Deliverable | Status | Est | Work Item |
|---|---|---|---|
| Chat activity status line — consume StatusEvent, show phase above composer | Not Started | 2 | task.0235 |
| Dashboard statusLabel wiring — RunCard shows live phase from SSE | Not Started | 2 | task.0236 |

**P0 delivers:** "Thinking...", "Using search_web...", "Compacting context..." visible in chat. Dashboard cards show live phase instead of static "Running".

### Walk (P1): Work Items + Agent Identity

**Goal:** Work items feel like a real product. Agents have visual identity.

| Deliverable | Status | Est | Work Item |
|---|---|---|---|
| Work items table — TanStack Table, detail panel, keyboard nav | Not Started | 3 | task.0237 |
| Agent avatars — Rive/Lottie animated characters on run cards + chat | Not Started | 3 | task.0238 |

### Run (P2): Three.js Observatory

**Goal:** Dedicated page with 3D agent characters in an isometric workspace, driven by real-time activity.

| Deliverable | Status | Est | Work Item |
|---|---|---|---|
| Three.js observatory prototype + performance budget | Not Started | 2 | spike.0239 |

## Architecture

### Data Flow (P0)

```
Graph execution → StatusEvent → Redis Streams → SSE endpoint
                                                     ↓
                                              ┌──────┴──────┐
                                              │             │
                                         Chat route    Dashboard SSE
                                         (data-status)  (EventSource)
                                              ↓             ↓
                                         StatusLine    RunCard.statusLabel
                                         (above         (live phase
                                          composer)      on card)
```

### Relationship to Other Projects

| Project | Relationship |
|---|---|
| `proj.live-dashboard` | **Complementary.** Dashboard P1 phase badges are unblocked by this project's shared SSE hook. |
| `proj.unified-graph-launch` | **Backend dependency.** Provides StatusEvent, Redis Streams, SSE endpoints. |
| `proj.workflow-building-monitoring` | **Independent.** Admin CRUD is separate from UX polish. |

## Constraints

- **STATUS_IS_EPHEMERAL**: StatusEvent is transient — never persisted, safe to skip if backpressured
- **PROGRESSIVE_ENHANCEMENT**: Each phase delivers standalone value. P1 doesn't require P0 to be "done" for work items.
- **LAZY_LOAD_HEAVY_DEPS**: Three.js loaded only on observatory route. Never in core bundle.
- **CONTRACTS_FIRST**: Any new API shapes (e.g., work item transitions) need Zod contracts first.

## Dependencies

- [x] StatusEvent pipeline (packages/ai-core → Redis → SSE)
- [x] Run stream reconnection endpoint (task.0182)
- [x] RunCard component with statusLabel field
- [ ] `@assistant-ui/react` status chunk rendering (needs prototype — task.0235)
- [ ] Rive/Lottie asset pipeline (P1)
- [ ] Three.js + @react-three/fiber (P2)

## As-Built Specs

- [unified-graph-launch.md](../../docs/spec/unified-graph-launch.md) — StatusEvent, Redis Streams, SSE
- [graph-execution.md](../../docs/spec/graph-execution.md) — GraphExecutorPort, AiEvent types
- [architecture.md](../../docs/spec/architecture.md) — Hexagonal layers, contracts-first

## Design Notes

**Progressive enhancement strategy:** Each phase (P0/P1/P2) delivers standalone value. P0 is zero new deps — pure consumption of existing StatusEvent pipeline. P1 adds a dependency (TanStack Table is lightweight; Rive/Lottie TBD). P2 adds Three.js but route-isolated.

**Relationship to proj.live-dashboard:** This project focuses on chat UX, work items UX, and agent visualization. The dashboard improvements (statusLabel wiring) are the shared seam — task.0236 in this project directly unblocks proj.live-dashboard P1 phase badges.
