---
id: proj.live-dashboard
type: project
primary_charter:
title: "Live Operations Dashboard — Real-time Agent Activity Feed"
state: Active
priority: 1
estimate: 8
summary: Polsia-inspired live dashboard showing running agent streams as cards with progressive drill-down, replacing the current static activity views with a real-time operations center
outcome: Users see live agent runs as cards with streaming content, status indicators, elapsed timers, and click-to-expand; system runs visible to admins; historical analytics preserved on /activity
assignees:
  - derekg1729
created: 2026-03-18
updated: 2026-03-20
labels:
  - ui
  - ai-graphs
  - observability
---

# Live Operations Dashboard

> Inspired by [Polsia](https://polsia.com/) — live multi-agent activity feed. We adopt the concept (live cards, progressive disclosure, multi-column layout) but not the styling.

## Goal

Replace the black-box "what happened" view with a "what's happening now" operations dashboard. Users see their active and recent agent runs as live cards with streaming content, status dots, elapsed timers, and click-to-expand detail. Admins also see system (DAO) runs.

## Context

### What exists today

- **`/activity`** — Historical analytics: spend/tokens/requests charts + activity table. 30s polling via React Query. No live streaming, no per-run visibility.
- **`/gov`** — Governance status: credit balance, upcoming runs, recent runs table, activity charts. Same polling pattern.
- **Backend (being built):**
  - `graph_runs` table — single ledger for all run types (task.0176 done)
  - `RunStreamPort` + `RedisRunStreamAdapter` — Redis Streams per run (task.0175 done)
  - Chat → Temporal + Redis (task.0177 in progress)
  - Run reconnection endpoint: `GET /api/v1/ai/runs/{runId}/stream` (task.0182 not started)

### What's missing

- No UI showing **active** runs in real-time
- No way to see what an agent is doing right now (content preview, tool calls, phases)
- No way to drill down into a running stream from a list view
- No run list API (`GET /api/v1/ai/runs`)
- System vs user activity not separated in any view

## Design Decisions

### System vs User: Tabs, not routes

Same `/dashboard` page with tab switcher: **"My Runs"** (default) / **"System"** (admin-only). Both query `graph_runs` — filtered by `run_kind` + `requested_by`. Reasons:

- Identical data model, just different filters
- Admin can see both in one place
- Avoids fragmenting the codebase

### /dashboard is new, /activity stays

`/activity` = retrospective analytics (how much did I spend?). `/dashboard` = live operations (what's running now?). Different use cases, both valuable.

### Per-card streaming via task.0182 reconnection endpoint

Each expanded card connects to `GET /api/v1/ai/runs/{runId}/stream` (SSE). This is the same endpoint task.0182 builds for chat reconnection — the dashboard is just another consumer. No new streaming backend.

### Run list via polling, not SSE

`GET /api/v1/ai/runs` → React Query polling at 5s. The run list changes slowly (new runs start every few seconds at most). SSE for the list itself is over-engineering.

### Progressive disclosure: card → expanded → thread

1. **Collapsed card**: Status dot (green pulse=running, gray=pending, check=done, red=error), graph name, elapsed timer, 1-line content preview from last `text_delta`
2. **Expanded card** (click): Full streaming content, tool call indicators, phase badges ("thinking", "tool_use", "compacting")
3. **Full thread** (link): Navigate to `/chat/{threadId}` for persistent conversation history

### story.0063 absorbed

The governance visibility dashboard (story.0063) becomes the "System" tab of this dashboard. Credit health, failed runs, and system run visibility all live here instead of a separate governance page.

## Roadmap

### Crawl (P0): Run List API + Card Grid

**Goal:** See your recent and active runs as cards. No live streaming yet — just status, timing, graph name from DB.

| Deliverable                                                                          | Status      | Est | Work Item |
| ------------------------------------------------------------------------------------ | ----------- | --- | --------- |
| Run list API: `GET /api/v1/ai/runs` — query `graph_runs`, filter by user/status/kind | Not Started | 2   | task.0183 |
| Dashboard page: `/dashboard` with agents table, work panel, activity charts          | In Review   | 3   | task.0184 |

**P0 delivers:** Static card grid showing runs from `graph_runs` table. Cards show graph name, status badge, started_at, duration, error message if failed. Polling at 5s. Admin tab shows system-scheduled runs.

### Walk (P1): Live Streaming Cards

**Goal:** Expanded cards show live streaming content from Redis Streams.

| Deliverable                                                                           | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Per-card SSE integration — expanded card connects to `/api/v1/ai/runs/{runId}/stream` | Not Started | 3   | (create at P1 start) |
| Content preview on collapsed cards — last `text_delta` snippet                        | Not Started | 1   | (create at P1 start) |
| Phase badges on cards — "thinking", "tool_use", "compacting" from StatusEvent         | Not Started | 1   | (create at P1 start) |

**Depends on:** task.0182 (run stream reconnection endpoint) being complete.

### Run (P2): Operational Intelligence

**Goal:** Credit health, system health indicators, and governance integration.

| Deliverable                                                                     | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Credit health widget — balance, runway, color-coded status (absorbs story.0063) | Not Started | 2   | (create at P2 start) |
| Failed run highlighting — error cards with retry action                         | Not Started | 1   | (create at P2 start) |
| Aggregate stats — active count, completed today, error rate                     | Not Started | 1   | (create at P2 start) |

## Architecture

### Data Flow

```
graph_runs (Postgres)          Redis Streams (run:{runId})
     ↓ polling (5s)                    ↓ SSE (per expanded card)
GET /api/v1/ai/runs            GET /api/v1/ai/runs/{runId}/stream
     ↓                                ↓
React Query → RunCard[]        EventSource → streaming content
     ↓                                ↓
Dashboard card grid            Expanded card live view
```

### Card Data Model

From `graph_runs` (polling):

```typescript
interface RunCard {
  id: string; // graph_runs.id
  runId: string; // correlation ID
  graphId: string; // e.g., "langgraph:poet"
  runKind: RunKind; // "user_immediate" | "system_scheduled"
  status: RunStatus; // "pending" | "running" | "success" | "error"
  requestedBy: string; // userId or "cogni_system"
  startedAt: string; // ISO timestamp
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}
```

From Redis Streams (per-card SSE, P1):

```typescript
// AiEvent types surfaced in expanded card
TextDeltaEvent    → content preview + full streaming text
StatusEvent       → phase badge ("thinking", "tool_use")
ToolCallStart     → tool indicator
ToolCallResult    → tool result display
DoneEvent         → card transitions to "completed"
ErrorEvent        → card transitions to "error"
```

### Relationship to Other Projects

| Project                             | Relationship                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proj.unified-graph-launch`         | **Backend dependency.** Provides `graph_runs`, `RunStreamPort`, `GraphRunWorkflow`. This project is the frontend consumer.                                        |
| `proj.workflow-building-monitoring` | **Complementary.** That project = admin CRUD for Temporal schedule configs. This project = live run visibility. Different concerns, may share some UI components. |
| `story.0063`                        | **Absorbed.** Governance visibility becomes the "System" tab here. story.0063 → `status: done`.                                                                   |
| `story.0128`                        | **Separate.** Admin operational controls (manual triggers) stay in story.0128 / proj.workflow-building-monitoring.                                                |

## Constraints

- **SSE_FROM_REDIS_NOT_MEMORY**: Live streaming reads from Redis Streams, never in-process memory (spec: unified-graph-launch)
- **REDIS_IS_STREAM_PLANE**: Redis holds only ephemeral data. Dashboard falls back to `graph_runs` when Redis TTL expires (spec: unified-graph-launch)
- **CONTRACTS_FIRST**: Run list API must have a Zod contract before implementation (spec: architecture)
- **POLLING_FOR_LIST**: Run list uses React Query polling, not SSE multiplexing — keeps server simple
- **AUTH_SCOPED**: Users see only their own runs. System tab requires admin role.

## Dependencies

- [x] `graph_runs` table (task.0176)
- [x] `RunStreamPort` + `RedisRunStreamAdapter` (task.0175)
- [ ] Chat → Temporal + Redis (task.0177, in progress)
- [ ] Run reconnection endpoint (task.0182, not started) — required for P1 streaming cards
- [ ] RBAC admin role check — required for System tab

## Design Notes

**Polsia concept adoption:** We adopt the live card grid concept but not Polsia's styling. Cards represent running agent executions, not abstract "tasks." The multi-column layout maps to user-vs-system run kinds rather than activity types.

**Incremental delivery:** P0 is a static card grid from DB polling — no Redis streaming dependency. P1 adds live streaming after task.0182 ships. This means the dashboard is useful immediately, not blocked on the full streaming stack.

**story.0063 absorption:** Governance visibility (credit health, failed runs, system run monitoring) becomes the "System" tab of this dashboard rather than a standalone page. This consolidates the operations surface.

## As-Built Specs

- [unified-graph-launch.md](../../docs/spec/unified-graph-launch.md) — Three-plane architecture, stream invariants
- [graph-execution.md](../../docs/spec/graph-execution.md) — GraphExecutorPort, run lifecycle
- [architecture.md](../../docs/spec/architecture.md) — Hexagonal layers, contracts-first
