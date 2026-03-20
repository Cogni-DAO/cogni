---
id: task.0189
type: task
title: "Dashboard P0→P1 bridge: thread linking, page consolidation, public Cogni Live, streaming status"
status: needs_implement
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
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-20
updated: 2026-03-20
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

This task bridges P0→P1 by cleaning up these gaps. It does NOT implement full SSE streaming cards (that's P1 proper).

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

- `apps/web/src/app/(app)/chat/page.tsx` — read `?thread=` searchParam
- `apps/web/src/app/(app)/dashboard/view.tsx` — public view, clickable rows, expanded running card
- `apps/web/src/app/(app)/dashboard/page.tsx` — remove auth requirement for public view
- `apps/web/src/app/(app)/activity/page.tsx` — redirect to /dashboard
- `apps/web/src/components/kit/data-display/RunCard.tsx` — expanded card variant
- `apps/web/src/features/layout/components/AppSidebar.tsx` — remove Activity nav link
- `apps/web/src/app/(app)/AGENTS.md` — update routes
- Navigation and sidebar changes

## Plan

- [ ] **Checkpoint 1: Thread deep-linking**
  - Wire `useSearchParams` in chat page to read `?thread=` and set `activeThreadKey`
  - Make dashboard agent rows clickable with `onClick` → `router.push('/chat?thread=...')`
  - Validation: click agent row → navigates to chat with that thread loaded

- [ ] **Checkpoint 2: Page consolidation**
  - Replace `/activity` page with redirect to `/dashboard`
  - Remove Activity from sidebar nav
  - Update AGENTS.md routes list
  - Validation: `/activity` → 308 redirect to `/dashboard`; sidebar shows no Activity link

- [ ] **Checkpoint 3: Public Cogni Live**
  - Dashboard page: if no session, render public view (Cogni Live only, no My Runs tab)
  - Fetch system runs without auth (or with a public API variant)
  - Activity charts: show system-only data for public view
  - Validation: unauthenticated user sees Cogni Live agents and charts

- [ ] **Checkpoint 4: Streaming status labels**
  - Populate `statusLabel` from stream events in the relay pump (deterministic phase: text_delta→"Thinking", tool_call_start→"Using tools")
  - Expanded running card component: shows status label, elapsed timer, content preview placeholder
  - Dashboard: running agents render as expanded card; completed agents as table rows
  - Validation: trigger a run, see "Thinking" / "Using tools" status on dashboard

- [ ] **Checkpoint 5: Thread dedup audit**
  - Investigate: are duplicate entries a data issue or a display issue?
  - If display: verify dedupeByThread logic handles edge cases (null stateKey, same graphId different threads)
  - If data: file separate bug
  - Validation: multiple messages to same agent → one row in agents table

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
