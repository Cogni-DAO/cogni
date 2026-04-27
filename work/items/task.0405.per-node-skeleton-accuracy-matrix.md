---
id: task.0405
type: task
title: "Per-node skeleton-accuracy matrix — make each `loading.tsx` actually match its page"
status: needs_design
priority: 1
rank: 1
estimate: 3
branch:
summary: "After task.0403 + task.0404 land, every route renders a *generic* `PageSkeleton` (one heading bar + a few rows). For routes whose actual content is a sidebar table, a chat composer, a data grid, or a wallet widget, that generic skeleton is visibly wrong — flashes one shape, then snaps to a different shape on RSC arrival. Lay out a per-node × per-route matrix of (page, what its skeleton shows now, what it should show, accuracy verdict), then drive each high-traffic route to a layout-accurate skeleton."
outcome: "A scorecard, then code: for each high-traffic route per node, the `loading.tsx` skeleton matches the rendered page's macro layout (column count, table-vs-card, sidebar-vs-form) closely enough that there is no perceptible 'shape pop' between skeleton and content. Top priority: node-template + operator routes (per derek). Skeleton accuracy is graded by a 4-state scorecard (🟢 accurate · 🟡 close · 🔴 wrong shape · ⚪ generic). Net change is a tree of per-route or per-section `loading.tsx` files overriding the route-group default where needed."
spec_refs:
assignees: derekg1729
credit:
project:
pr:
reviewer:
revision: 0
blocked_by: [task.0404]
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [frontend, perf, ux, nextjs, ssr, app-router]
external_refs:
  - work/items/task.0403.operator-loading-error-boundaries.md
  - work/items/task.0404.port-loading-error-boundaries-other-nodes.md
  - work/items/spike.0401.nextjs-frontend-perf.md
---

## Problem

Task.0403 + task.0404 deliver "instant skeleton on click" — but it's
the **same generic skeleton** (one heading bar + 3 short rows from
`PageSkeleton`) regardless of what the route actually renders. Per
human validation on operator candidate-a:

> "most of our page's skeletons are not actually accurate"

Concretely: nav from `/dashboard` → `/work` flashes the generic
skeleton, then snaps into a tabular work-item list that looks nothing
like the skeleton — the user sees a "shape pop" that, while
functionally faster than the pre-fix freeze, still feels visually
broken. Same on `/credits` (table), `/profile` (form), `/chat`
(composer + thread list), `/gov/*` (graphs / cards), etc.

Goal: make each `loading.tsx` (or sub-route override) match the
target page's macro layout closely enough that there is no
perceptible shape pop.

## Design

### Outcome

A per-node × per-route matrix lives in this work item with the four
verdicts below, and a corresponding tree of skeleton files:

| Verdict        | Meaning                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 accurate    | Skeleton matches macro layout (column count, table-vs-card, sidebar-vs-form). No perceptible shape pop.                                   |
| 🟡 close       | Same macro shape, off in detail (e.g. wrong number of skeleton rows but right kind).                                                      |
| 🔴 wrong shape | Skeleton shows a different layout class than the page (e.g. centered card skeleton for a full-width table page). User-visible regression. |
| ⚪ generic     | Default `PageSkeleton` — neither right nor wrong, just unspecific. Acceptable for low-traffic pages but flag for follow-up.               |

### Approach

This is a **two-phase** task:

#### Phase 1 — Build the matrix

Per node, walk every route under `(app)/` and `(public)/`. Open the
real page on candidate-a-<node> with throttling enabled, click in,
observe the current generic skeleton, then observe the rendered
content. Score the verdict.

Capture as a markdown matrix in this work item:

```
| ROUTE         | PAGE TYPE           | CURRENT SKELETON | VERDICT | NOTES                |
| ------------- | ------------------- | ---------------- | ------- | -------------------- |
| /dashboard    | sidebar + cards     | generic 4-row    | 🔴      | needs card-grid skel |
| /work         | full-width table    | generic 4-row    | 🔴      | needs table skel     |
| /chat         | composer + thread   | generic 4-row    | 🔴      | needs chat skel     |
| /credits      | balance card + log  | generic 4-row    | 🟡      | shape close, off rows|
...
```

#### Phase 2 — Drive 🔴 → 🟢, 🟡 → 🟢

Per row that is 🔴 or 🟡, decide where the better-fitting skeleton
should live:

- **Per-route**: drop a `loading.tsx` next to the page (`(app)/work/loading.tsx`).
  Use this when the page has a distinctive layout.
- **Per-section group**: drop one in a sub-layout dir (`(app)/gov/loading.tsx`)
  when the whole section shares a layout (e.g. all `/gov/*` pages are
  full-width-table).
- **Composable skeletons**: extract reusable shape skeletons under
  `kit/layout/` (e.g. `TableSkeleton`, `CardGridSkeleton`,
  `ChatComposerSkeleton`) so each route's `loading.tsx` is a one-liner.

### Priority

Per derek: **top priority is node-template + operator routes** —
those are the user-facing flagship surfaces. Poly + resy can follow
once the pattern + composable skeletons are validated.

### Out of scope

- Animation polish (cross-fade between skeleton and content) — defer
  until accurate shapes are in place.
- Mobile-specific skeleton overrides — single skeleton per route is
  fine v0; revisit if mobile diverges materially.
- Per-empty-state distinction (skeleton-vs-empty-table) — separate
  task; this one is purely about the loading state.

## Todos

### Phase 1 — Build the matrix

- [ ] node-template: walk every route, score current skeleton.
- [ ] operator: walk every route, score current skeleton.
- [ ] poly: walk every route, score current skeleton.
- [ ] resy: walk every route, score current skeleton.
- [ ] Commit the four matrices into this work item.

### Phase 2 — Implementation (per node, top-priority first)

- [ ] node-template: extract reusable shape skeletons; replace
      🔴/🟡 routes with accurate per-route or per-section
      `loading.tsx`.
- [ ] operator: same.
- [ ] poly: same (deferred until pattern proves out on first two).
- [ ] resy: same.

## Validation

```
exercise:
  Per node, per fixed route:
    1. Open https://candidate-a-<node>.cogni-dao.net/<route> with
       DevTools throttled to Slow 4G.
    2. Sign in if needed.
    3. Click another nav link, then click back to <route>.
    4. Observe: does the skeleton's macro shape (column count,
       table-vs-card, sidebar-vs-form) match the rendered content?
    5. Re-score: previous verdict → new verdict. MUST be 🟢 for any
       route we touched in Phase 2.

observability:
  Same client-only limitation as task.0403/0404. Felt latency +
  visual shape match are the only signals. task.0406 (PostHog data-
  agent access) will close this gap retroactively.
```

## Closes / Relates

- Blocked-by: task.0404 (must have boundaries in place before
  refining their accuracy).
- Implements spike.0401 Phase 2c (skeleton-fidelity refinement).
- Related: task.0406 (PostHog data-agent access for retroactive
  perf observability).

## PR / Links

- PR(s): TBD (likely one per node, per single-node-scope rule)
