---
id: task.0184
type: task
title: "Live dashboard page: /dashboard with run card grid and tab switcher"
status: needs_design
revision: 0
priority: 1
rank: 7
estimate: 3
summary: New /dashboard page showing agent runs as cards with status dots, elapsed timers, and My Runs / System tabs
outcome: /dashboard renders a card grid of recent and active runs from the run list API; cards show graph name, status badge, timing; admin sees System tab
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.live-dashboard
blocked_by:
  - task.0183
created: 2026-03-18
updated: 2026-03-18
labels:
  - ui
  - ai-graphs
---

# Live Dashboard Page

## Context

P0 of the live operations dashboard. Static card grid powered by the run list API (task.0183). No live streaming yet — that's P1 after task.0182 ships. This task establishes the page structure, card component, and tab-based filtering.

## Requirements

### Card Component

- **Collapsed state**: Status dot (green pulse=running, gray=pending, checkmark=done, red=error), graph display name, elapsed timer (live-updating for running), 1-line summary
- **Duration display**: "Running for 2m 34s" (running) or "Completed in 45s" (done) or "Failed after 1m 12s" (error)
- **Error display**: Shows error_code badge on error cards

### Page Layout

- Tab switcher: "My Runs" (default) / "System" (admin-only, hidden for non-admins)
- Card grid: responsive (1 col mobile, 2 col tablet, 3 col desktop)
- Auto-refresh: React Query polling at 5s
- Empty state: "No active runs" with link to start a chat
- Running runs pinned to top, then recent completed sorted by started_at DESC

### Auth

- Session required (redirect to login if not authenticated)
- System tab visible only to admin role

## Allowed Changes

- `apps/web/src/app/(app)/dashboard/page.tsx` — new page
- `apps/web/src/app/(app)/dashboard/view.tsx` — client view
- `apps/web/src/app/(app)/dashboard/_api/` — API fetch functions
- `apps/web/src/components/kit/data-display/RunCard.tsx` — new card component
- `apps/web/src/features/ai/hooks/useRunList.ts` — React Query hook
- Navigation update to include /dashboard link

## Design Notes

### Polsia inspiration (concept, not styling)

- Cards as primary metaphor for agent runs
- Status indicators with elapsed timers
- Dense layout showing many cards at once
- Progressive disclosure (P1 will add click-to-expand with streaming)

### What this does NOT include (deferred to P1)

- Live streaming content in expanded cards (needs task.0182)
- Content preview from Redis Streams
- Phase badges ("thinking", "tool_use")
- Click-to-expand card interaction

## Plan

- [ ] **Checkpoint 1: RunCard component**
  - Kit component with status dot, graph name, elapsed timer, duration
  - Storybook-ready with all states (running, pending, success, error)
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 2: Dashboard page + API hook**
  - Page shell with auth, tab switcher, card grid layout
  - React Query hook calling GET /api/v1/ai/runs (5s polling)
  - Wire cards to data, running runs pinned to top
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 3: Navigation + polish**
  - Add /dashboard to sidebar navigation
  - Empty state, loading skeleton, error state
  - Responsive layout testing
  - Validation: `pnpm check` passes

## Validation

- `pnpm check` passes
- Manual: navigate to /dashboard, see card grid with status indicators and auto-refresh
- Manual: admin user sees System tab, regular user does not
