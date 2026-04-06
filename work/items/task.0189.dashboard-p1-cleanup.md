---
id: task.0189
type: task
title: "Dashboard P0→P1 bridge: thread linking, page consolidation, public Cogni Live, streaming status"
status: needs_merge
priority: 1
rank: 7
estimate: 5
summary: Bridge between P0 static dashboard and P1 streaming — wire thread deep-links, consolidate /activity into dashboard, make Cogni Live public, add streaming statusLabel to agent rows
outcome: Dashboard agents table rows link to threads; /activity redirects to /dashboard; unauthenticated users see Cogni Live as public "watch" page; agent rows show AI-generated status text when available
spec_refs:
  - spec.unified-graph-launch
assignees: []
credit:
project: proj.live-dashboard
branch: task-0189-dashboard-p1-bridge
pr: https://github.com/Cogni-DAO/node-template/pull/626
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-20
updated: 2026-03-25
labels:
  - ui
  - ai-graphs
---

# Dashboard P0→P1 Bridge

## Context

P0 (task.0184) shipped a static dashboard with agents table, work items, and activity charts. Several gaps prevent it from being a proper operations portal:

1. Agent rows aren't clickable — no way to see what happened in a conversation
2. `/activity` and `/dashboard` overlap (charts duplicated, raw log orphaned)
3. Cogni Live (system runs) is auth-gated but should be public ("watch Cogni work")
4. Agent status is just "Completed"/"Running" — no AI-generated status text or streaming preview
5. Thread persistence feels flaky — multiple runs to same thread show as separate entries
6. Run cards have no click-through — clicking a Cogni Live run should drill into the graph run stream (Redis SSE). The `runId` is available, the stream endpoint exists at `/api/v1/ai/runs/{runId}/stream`.

This task bridges P0→P1 by closing these gaps.

## Design Review Findings (2026-03-25)

Critical bugs discovered during design review that must be fixed before building new features:

### BUG: Activity charts ignore system scope (P0)

When "Cogni Live" tab is active, runs table shows system runs (`graph_runs` via `scope=system`), but activity charts show the **logged-in user's personal spend** (`charge_receipts` via user's billing account). The activity contract has no `scope` parameter — the two data paths are completely disconnected.

- `ai.activity.v1.contract.ts` — no scope field in input
- `activity/route.ts` — no scope param parsed
- `activity.server.ts:193-201` — always resolves to authenticated user's billing account
- `dashboard/view.tsx:201-211` — `fetchActivity` never receives tab state

### BUG: Terminology mismatch

Section header says "Agents" but displays `graph_runs`. Per `temporal-patterns.md`, an Agent is an `AgentDefinition` (config). A run is a run.

### RESOLVED: GUID-in-table bug

Fixed in prior commit (15ddb4bc) — `dedupeByThread` was using `run.id` (UUID) as key. Now uses `run.stateKey ?? run.runId ?? run.id`.

### RESOLVED: Thread dedup (Checkpoint 6)

Same fix as GUID bug. `dedupeByThread` now correctly deduplicates by stateKey for chat runs and keeps system/webhook runs unique.

### NOT A BUG: RLS system scope

`withTenantScope` correctly sets `app.current_user_id` to `COGNI_SYSTEM_PRINCIPAL_USER_ID` for `scope=system` queries. If system runs don't appear, no webhook triggers have fired in this environment.

### Architecture note: Workflow-first visibility (future)

Current top-level object is `graph_runs` (LangGraph execution). The correct product abstraction is **Workflow** (Temporal) as the top-level, with graph runs as drill-down detail. For now: rename UI labels to neutral "runs", document the target model in `temporal-patterns.md`. Do NOT add `workflow_runs` table until 2-3 real multi-step workflows need parent-level visibility.

## Requirements

### 1. Thread deep-linking from dashboard

- Chat page reads `?thread=<stateKey>` from URL searchParams and loads that thread
- Dashboard agent rows (and any future run references) link to `/chat?thread=<stateKey>`
- Rows without a stateKey are not clickable

### 2. Page consolidation

- `/activity` redirects to `/dashboard` (permanent redirect)
- Activity raw invocation table accessible via `/activity?detail=true` or a "View raw logs" link on dashboard (stretch)
- Remove `/activity` from sidebar navigation
- `/gov` stays as-is (governance is a different concern)

### 3. Public Cogni Live view

- Unauthenticated visitors to `/dashboard` see the Cogni Live system runs (read-only)
- Authenticated users see the full dashboard (My Runs tab default, Cogni Live tab, work items, activity charts)
- Public view shows: agents table (system runs only), activity charts (system only). No work items panel.

### 4. Streaming status on agent rows

- `statusLabel` field on RunCardData populated from the stream when available
- Two display modes for agent entries:
  - **Table row** (current): status dot + agent name + status badge + duration + time ago — used in dashboard agents table
  - **Expanded card** (new): larger card showing streaming content preview, tool call indicators, AI-generated status text — used when an agent is actively running
- Running agents show the expanded card in the "Latest Agent" position; completed agents stay as table rows
- `statusLabel` sourced from: (a) deterministic phase labels ("Thinking", "Using tools") from stream event type, (b) future: AI-generated summary from content

### 5. Thread persistence reliability

- Investigate and fix: multiple messages to same agent creating duplicate-looking entries in agents table
- Ensure dedup by stateKey works correctly with the current data model
- If thread persistence has actual bugs (lost messages, duplicate threads), file as separate bug

## Allowed Changes

- `apps/operator/src/contracts/ai.activity.v1.contract.ts` — add scope field
- `apps/operator/src/app/api/v1/activity/route.ts` — parse scope param
- `apps/operator/src/app/_facades/ai/activity.server.ts` — resolve billing account by scope
- `apps/operator/src/app/(app)/activity/_api/fetchActivity.ts` — accept scope param
- `apps/operator/src/app/(app)/activity/page.tsx` — redirect to /dashboard
- `apps/operator/src/app/(app)/dashboard/view.tsx` — pass tab to activity, clickable rows, terminology
- `apps/operator/src/app/(app)/dashboard/page.tsx` — remove auth requirement for public view (Phase C)
- `apps/operator/src/app/(app)/chat/page.tsx` — read `?thread=` searchParam
- `apps/operator/src/components/kit/data-display/RunCard.tsx` — expanded card variant (Phase B)
- `apps/operator/src/features/layout/components/AppSidebar.tsx` — remove Activity nav link
- `apps/operator/src/app/(app)/AGENTS.md` — update routes

## Plan

### Phase A: Fix broken foundation (this PR)

- [ ] **Checkpoint 1: Activity scope fix (P0 bug)**
  - Add `scope?: "user" | "system"` to `ai.activity.v1.contract.ts` input
  - Activity route + facade: when `scope=system`, use `COGNI_SYSTEM_BILLING_ACCOUNT_ID`
  - Dashboard view: pass current `tab` to `fetchActivity`
  - `fetchActivity` sends `scope=system` when tab is system
  - Validation: switch to "System Runs" → charts reflect system spend, not user spend

- [ ] **Checkpoint 2: Page consolidation + terminology**
  - Replace `/activity` page with 308 redirect to `/dashboard`
  - Remove Activity from sidebar nav
  - Rename "Agents" section header → "Recent Runs"
  - Rename "Cogni Live" → "System Runs"
  - Update AGENTS.md routes list
  - Validation: `/activity` → redirect; sidebar clean; labels correct

- [ ] **Checkpoint 3: Thread deep-linking**
  - Run rows with `stateKey` → `Link href="/chat?thread={stateKey}"`
  - Chat page reads `?thread=<stateKey>` searchParam to load thread
  - Rows without stateKey show no link
  - Validation: click run row → navigates to chat with that thread loaded

- [x] **Checkpoint 4: Thread dedup audit** — RESOLVED
  - Fixed in prior commit (15ddb4bc). `dedupeByThread` now correct.

### Phase B: Streaming & drill-down (separate PR)

- [ ] **Checkpoint 5: Run card click-through to stream**
  - New page at `/dashboard/runs/[runId]` subscribing to SSE endpoint
  - Running runs: live SSE; Completed runs: replay from Redis or final status
  - Validation: click a run → see stream events or final result

- [ ] **Checkpoint 6: Streaming status labels**
  - Populate `statusLabel` from stream events (text_delta→"Thinking", tool_call_start→"Using tools")
  - Expanded running card component with status label + elapsed timer
  - Validation: trigger a run, see live status on dashboard

### Phase C: Public access (separate PR)

- [ ] **Checkpoint 7: Public Cogni Live**
  - Dashboard page: if no session, render public view (System Runs only, read-only)
  - Public view shows: runs table (system only) + activity charts (system only). No work items.
  - Validation: unauthenticated user sees system runs and charts

## Validation

```bash
pnpm check
pnpm test
```

- Manual: click agent row → opens thread in chat
- Manual: `/activity` redirects to `/dashboard`
- Manual: incognito → `/dashboard` shows Cogni Live (no auth required)
- Manual: start a chat → dashboard shows "Thinking" status during generation

## Review Checklist

- [ ] **Work Item:** task.0189 linked in PR body
- [ ] **Spec:** AUTH_SCOPED relaxed for public Cogni Live view — document the boundary
- [ ] **Tests:** thread deep-link, redirect, public view access
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
