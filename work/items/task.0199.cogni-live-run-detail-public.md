---
id: task.0199
type: task
title: "Cogni Live: run detail page + public system dashboard"
status: needs_implement
priority: 1
rank: 2
estimate: 5
summary: Click a run → see its stream (live or replayed). Unauthenticated visitors see system runs as a public "watch Cogni work" page. Polsia-live-style workflow visibility.
outcome: Users click any run on dashboard and see the full conversation (text, tool calls, status). Public visitors see system runs live at /live. Running workflows show current step with live stream.
spec_refs:
  - spec.unified-graph-launch
  - spec.streaming-status
assignees: []
credit:
project: proj.live-dashboard
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-25
updated: 2026-03-25
labels:
  - ui
  - ai-graphs
  - streaming
  - public
external_refs:
---

# Cogni Live: run detail page + public system dashboard

## Design

### Outcome

Anyone can watch Cogni work. Authenticated users click a run → see its full stream. Public visitors see system runs live at `/live`. This is the portal into the AI's mind.

### Mental Model

```
Dashboard (table)           Run Detail (stream)         Chat (thread)
┌────────────────┐         ┌──────────────────┐        ┌──────────────┐
│ ● Poet    ✓    │──click──│ Stream replay:   │        │ Full chat    │
│ ● Brain   ✓    │         │  "Thinking..."   │──link──│ with history  │
│ ● PR #42  ⏳   │──click──│  Tool: getDiff   │        │              │
│                │         │  "Reviewing..."  │        │              │
└────────────────┘         └──────────────────┘        └──────────────┘
       ↑                          ↑
  /dashboard               /runs/{runId}                /chat?thread=
  /live (public)           /live/{runId} (public)
```

**What you see on the run detail page:**

- Run metadata header: agent name, status badge, duration, when
- Stream body: messages rendered as conversation bubbles (text_delta → assembled text, tool_call_start/result → collapsible cards, status → phase indicators)
- For running runs: live SSE subscription, events appear as they arrive
- For completed runs: replay from Redis (within 1h TTL), or show persisted thread from ai_threads (after TTL)
- Link to full chat thread if stateKey exists

**What public visitors see at `/live`:**

- System runs table (same as dashboard "System Runs" tab, but no auth)
- Click any system run → `/live/{runId}` shows the stream
- No work items, no user runs, no activity charts with spend data
- Rate-limited via `wrapPublicRoute()` (10 req/min/IP)

### Approach

**Solution**: Two new routes + one public API endpoint. Minimal new components — reuse dashboard table and build one `StreamView` component.

#### 1. Run detail page: `/runs/[runId]/page.tsx`

Server page wrapping a client `RunDetailView`. The view:

- Fetches run metadata from `GET /api/v1/ai/runs/{runId}` (new: single-run endpoint, thin wrapper around `getRunByRunId`)
- Connects to `GET /api/v1/ai/runs/{runId}/stream` via `EventSource`
- Renders events as they arrive using a `StreamRenderer` component
- Handles 410 Gone (stream expired) by loading persisted thread from `GET /api/v1/ai/threads/{stateKey}`
- Shows run metadata header (agent, status, duration, trigger)

The `StreamRenderer` is the core new component:

- `text_delta` → accumulates into message bubbles (markdown rendered)
- `tool_call_start` → collapsible card with tool name
- `tool_call_result` → expands card with result
- `status` → ephemeral phase indicator ("Thinking...", "Using getDiff...")
- `done` → final state, show usage summary if available
- `error` → error display

#### 2. Public live page: `/live/page.tsx`

Under `(public)` layout group. Server page:

- Fetches system runs from `GET /api/v1/public/ai/runs` (new public endpoint)
- Renders same table component as dashboard "System Runs"
- Click run → `/live/[runId]` (public run detail, same StreamRenderer)

#### 3. Public API endpoints

- `GET /api/v1/public/ai/runs` — system runs list, rate-limited, cached 30s
  - Uses `wrapPublicRoute()`, queries `graphRunRepository` with system actor
  - Sanitized output: no error messages, no stateKey, no user IDs

- `GET /api/v1/public/ai/runs/[runId]/stream` — SSE for system runs only
  - Uses `wrapPublicRoute()` for initial request, then upgrades to SSE
  - Verifies run belongs to system principal before streaming
  - Same Redis subscription as authenticated endpoint

#### 4. Dashboard integration

- Dashboard run rows link to `/runs/{runId}` (authenticated) or `/live/{runId}` (system runs when public)
- Running runs show status label from stream events in the table row (phase: "Thinking", "Using tools")

**Reuses**:

- `RunStreamPort.subscribe()` — existing Redis subscription with cursor replay
- `wrapPublicRoute()` — existing rate limit + cache pattern
- `(public)` layout — existing unauthenticated page shell
- `getRunByRunId` — existing repository method
- Dashboard table component — reuse for `/live` page
- EventSource browser API — no library needed

**Rejected**:

- **WebSocket**: EventSource (SSE) is simpler, already implemented, supports reconnection natively
- **Server Components for streaming**: Client component with EventSource is the standard pattern. Server-sent events don't work with React Server Components.
- **workflow_runs table**: Not yet needed. graph_runs is sufficient for current workflows. When multi-step workflows (PR review with visible steps) need parent-level cards, add then. For now, PR review appears as a single run.
- **Polling instead of SSE**: Higher latency, more server load. SSE is already built.

### Invariants

- [ ] SSE_FROM_REDIS_NOT_MEMORY: Stream subscriptions read from Redis, not in-process (spec: unified-graph-launch)
- [ ] PUMP_TO_COMPLETION_VIA_REDIS: Events are in Redis regardless of subscribers (spec: unified-graph-launch)
- [ ] STATUS_IS_EPHEMERAL: Status events shown but not persisted (spec: streaming-status)
- [ ] STATUS_NEVER_LEAKS_CONTENT: Status label is tool name only, never args (spec: streaming-status)
- [ ] PUBLIC_RATE_LIMITED: Public endpoints use wrapPublicRoute() (spec: architecture)
- [ ] RLS_NOT_BYPASSED: Public endpoint queries with system actor through normal RLS path, not BYPASSRLS
- [ ] SIMPLE_SOLUTION: EventSource + one new component (StreamRenderer), no new abstractions
- [ ] ARCHITECTURE_ALIGNMENT: page.tsx/view.tsx split, contracts-first, hexagonal layers (spec: architecture)

### Files

**Create:**

- `apps/web/src/app/(app)/runs/[runId]/page.tsx` — server wrapper with Suspense
- `apps/web/src/app/(app)/runs/[runId]/view.tsx` — authenticated run detail view
- `apps/web/src/app/(public)/live/page.tsx` — public system runs list
- `apps/web/src/app/(public)/live/[runId]/page.tsx` — public run detail
- `apps/web/src/components/kit/data-display/StreamRenderer.tsx` — event stream renderer (shared by both)
- `apps/web/src/app/api/v1/public/ai/runs/route.ts` — public system runs endpoint
- `apps/web/src/app/api/v1/public/ai/runs/[runId]/stream/route.ts` — public SSE for system runs
- `apps/web/src/contracts/ai.runs.detail.v1.contract.ts` — single-run detail contract

**Modify:**

- `apps/web/src/app/(app)/dashboard/view.tsx` — run rows link to `/runs/{runId}`
- `apps/web/src/app/api/v1/ai/runs/route.ts` — add single-run GET by runId (or separate route)

**No changes to:**

- Redis streaming infrastructure
- Temporal workflows
- graph_runs schema
- RLS policies

## Allowed Changes

- `apps/web/src/app/(app)/runs/` — new route for run detail
- `apps/web/src/app/(public)/live/` — new route for public live view
- `apps/web/src/app/api/v1/public/ai/runs/` — new public API endpoints
- `apps/web/src/components/kit/data-display/StreamRenderer.tsx` — event stream component
- `apps/web/src/contracts/ai.runs.detail.v1.contract.ts` — new contract
- `apps/web/src/app/(app)/dashboard/view.tsx` — add run links
- `apps/web/src/proxy.ts` — ensure `/live` is in public routes (should already be via `(public)`)

## Plan

### Phase B: Authenticated run detail (PR 1)

- [ ] Create `ai.runs.detail.v1.contract.ts` with single-run response shape
- [ ] Add GET handler for single run (reuse `getRunByRunId`)
- [ ] Build `StreamRenderer` component (text bubbles, tool cards, status indicators)
- [ ] Build `useRunStream(runId)` hook — EventSource with reconnection
- [ ] Create `/runs/[runId]` page (server page.tsx + client view.tsx)
- [ ] Fallback: when stream expired (410), load thread from `ai_threads` via stateKey
- [ ] Dashboard run rows link to `/runs/{runId}`
- [ ] Validation: click run → see stream events or persisted thread

### Phase C: Public Cogni Live (PR 2)

- [ ] Create `GET /api/v1/public/ai/runs` with `wrapPublicRoute()` — system runs only
- [ ] Create `GET /api/v1/public/ai/runs/[runId]/stream` — public SSE for system runs
- [ ] Create `/live` page — system runs table (reuse dashboard table component)
- [ ] Create `/live/[runId]` page — public run detail (reuse StreamRenderer)
- [ ] Validation: incognito browser → `/live` shows system runs, click → stream

## Validation

**Commands:**

```bash
pnpm check
```

**Manual (Phase B):**

- Start a chat → dashboard shows run → click → `/runs/{runId}` shows stream
- Wait for Redis TTL → refresh → see persisted thread instead of stream

**Manual (Phase C):**

- Incognito → `/live` → see system runs
- Click system run → see stream
- Verify: no user runs visible, no spend data visible

## Review Checklist

- [ ] **Work Item:** task.0199 linked in PR body
- [ ] **Spec:** unified-graph-launch and streaming-status invariants upheld
- [ ] **Tests:** StreamRenderer unit tests, public endpoint rate limiting test
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
