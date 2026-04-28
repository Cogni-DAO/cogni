---
id: task.0405
type: task
title: "Per-node skeleton-accuracy matrix — make each `loading.tsx` actually match its page"
status: needs_implement
priority: 1
rank: 1
estimate: 3
branch: feat/task-0405-poly-skeleton-accuracy
summary: "After task.0403 + task.0408 land, every route renders a *generic* `PageSkeleton` (one heading bar + a few rows). For routes whose actual content is a sidebar table, a chat composer, a data grid, or a wallet widget, that generic skeleton is visibly wrong — flashes one shape, then snaps to a different shape on RSC arrival. Lay out a per-node × per-route matrix of (page, what its skeleton shows now, what it should show, accuracy verdict), then drive each high-traffic route to a layout-accurate skeleton."
outcome: "A scorecard, then code: for each high-traffic route per node, the `loading.tsx` skeleton matches the rendered page's macro layout (column count, table-vs-card, sidebar-vs-form) closely enough that there is no perceptible 'shape pop' between skeleton and content. Top priority: node-template + operator routes (per derek). Skeleton accuracy is graded by a 4-state scorecard (🟢 accurate · 🟡 close · 🔴 wrong shape · ⚪ generic). Net change is a tree of per-route or per-section `loading.tsx` files overriding the route-group default where needed."
spec_refs:
assignees: derekg1729
credit:
project:
pr:
reviewer:
revision: 0
blocked_by: [task.0408]
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [frontend, perf, ux, nextjs, ssr, app-router]
external_refs:
  - work/items/task.0403.operator-loading-error-boundaries.md
  - work/items/task.0408.port-loading-error-boundaries-other-nodes.md
  - work/items/spike.0401.nextjs-frontend-perf.md
---

## Problem

Task.0403 + task.0408 deliver "instant skeleton on click" — but it's
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

Capture as a markdown matrix in this work item, with a **HUMAN APPROVED**
column so each row only counts once derek (or another reviewer) has
confirmed visually on candidate-a-<node>:

```
| ROUTE         | PAGE TYPE           | CURRENT SKEL  | VERDICT | PROPOSED SKEL              | HUMAN APPROVED  |
| ------------- | ------------------- | ------------- | ------- | -------------------------- | --------------- |
| /dashboard    | cards + 2-col grid  | generic 4-row | 🔴      | CardGridSkeleton + table   | ⬜              |
| /work         | full-width table    | generic 4-row | 🔴      | TableSkeleton(rows=8)      | ⬜              |
...
```

The HUMAN APPROVED column ticks ⬜ → ✅ only after the implementer has
flighted the bespoke skeleton to candidate-a-<node>, pinged derek with
a desktop + mobile screenshot or a "click here" message, and derek has
visually confirmed it matches. **No row is "done" without a ✅.**

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
- Per-empty-state distinction (skeleton-vs-empty-table) — separate
  task; this one is purely about the loading state.

### In scope, explicitly

- **Mobile and desktop both.** Per derek: skeletons must match each page
  on **desktop AND mobile**. Each row's PROPOSED SKEL column captures
  the responsive behavior (e.g. "2-col grid on md+, stacked on sm").
  HUMAN APPROVED only ticks ✅ after both viewports are visually OK.

## Reusable primitives

Three composable skeletons added under
`nodes/<node>/app/src/components/kit/layout/` (per node — UI governance
forbids cross-node imports). Each is a thin wrapper over the existing
shadcn `Skeleton` primitive — no new design tokens, no animations
beyond the inherited `animate-pulse`:

| Primitive            | Use                                    | Roughly                                                           |
| -------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `PageHeaderSkeleton` | every page top                         | `<Skeleton h-8 w-44>` + optional subtitle line                    |
| `TableSkeleton`      | /work, /research, /gov/\*, /schedules  | toolbar row + N body rows × cell rectangles + pagination footer   |
| `CardGridSkeleton`   | /dashboard, /credits, /activity charts | responsive grid of `<Skeleton>` cards (cols, count, height props) |

Each per-route `loading.tsx` becomes a one-liner that composes 1-3
of these. No bespoke per-route skeleton implementations except `/chat`,
which is genuinely unique (full-viewport flex shell, not PageContainer).

## Per-node matrices

### Poly

Walked 2026-04-27 from `nodes/poly/app/src/app/`. Page macro shapes
read from view files. Mobile behavior inferred from existing tailwind
classes + the in-page `animate-pulse` patterns several views already
use as their own data-load skeletons.

#### `(app)` group — protected, signed-in

| ROUTE              | DESKTOP MACRO LAYOUT                                                                                                                                   | MOBILE                                      | CURRENT SKEL  | VERDICT | PROPOSED SKEL                                                                                                                                                            | HUMAN APPROVED |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| /dashboard         | Header + 4 stacked full-width cards (TradingWallet · OperatorWalletCharts · ExecutionActivity · WalletQuickJump) + 2-col grid (Runs · Work) + 3 charts | Cards stack 1-col, charts stack 1-col       | generic 4-row | 🔴      | `PageHeaderSkeleton` + 4× `CardGridSkeleton(cols=1,h=128)` + `CardGridSkeleton(cols={lg:2,base:1},count=2,h=192)` + `CardGridSkeleton(cols={md:3,base:1},count=3,h=192)` | ✅ poly        |
| /research          | Title + subtitle + WalletQuickJump + (search input + period toggle) + WalletsTable (full-width data grid ~10 rows) + no-fly footer (md:grid-cols-2)    | Same; table scrolls horizontally            | generic 4-row | 🔴      | `PageHeaderSkeleton` + quick-jump bar (h-10 × max-w-md) + toolbar row (input + toggle, h-9) + `TableSkeleton(rows=8)` + footer aside h-24                                | ✅ poly        |
| /research/w/[addr] | Wallet detail page — large drawer-style content (stat cards + tabs + content panel)                                                                    | Same, narrower                              | generic 4-row | 🟡      | `PageHeaderSkeleton` + `CardGridSkeleton(cols={lg:4,base:2},count=4,h=96)` + tabs bar (h-10) + content panel (h-96)                                                      | ⬜             |
| /work              | Title + Input filter + DataGrid (toolbar + ~12 rows + pagination)                                                                                      | Table scrolls horizontally                  | generic 4-row | 🔴      | `PageHeaderSkeleton` + faceted-filter bar (h-9 × ~280w) + `TableSkeleton(rows=10)`                                                                                       | ✅ poly        |
| /chat              | Custom layout (`chat-viewport flex overflow-hidden`) — full-viewport thread + composer pinned to bottom                                                | Single-col, narrower; no rail               | generic 4-row | 🔴      | **Per-route override** at `(app)/chat/loading.tsx`: thread-list rail (h-full × 280w, hidden on sm) + 4× message bubble rows (h-16) + composer bar (h-14, pinned bottom)  | ✅ poly        |
| /credits           | 2-col grid (AiCreditsPanel · TradingWalletPanel) on md+                                                                                                | Pill toggle (Credits/Wallet) → single panel | generic 4-row | 🟡      | `PageHeaderSkeleton` + `CardGridSkeleton(cols={md:2,base:1},count=2,h=288)` (sm shows pill-stub above)                                                                   | ✅ poly        |
| /profile           | Form with multiple connection cards (OAuth providers, codex, openai-compatible)                                                                        | Stacked cards                               | generic 4-row | 🟡      | `PageHeaderSkeleton` + `CardGridSkeleton(cols=1,count=4,h=160)`                                                                                                          | ⬜             |
| /activity          | Time-range selector + activity charts + table                                                                                                          | Charts stack                                | generic 4-row | 🔴      | `PageHeaderSkeleton` + range-selector (h-10 × 200w) + `CardGridSkeleton(cols={md:3,base:1},count=3,h=192)` + `TableSkeleton(rows=8)`                                     | ✅ poly        |
| /schedules         | List of scheduled jobs + create-form                                                                                                                   | Stacked                                     | generic 4-row | 🟡      | `PageHeaderSkeleton` + `TableSkeleton(rows=4)`                                                                                                                           | ⬜             |
| /gov               | Governance landing                                                                                                                                     | Same                                        | generic 4-row | ⚪      | leave generic                                                                                                                                                            | ✅ poly        |
| /gov/epoch         | Epoch list/table                                                                                                                                       | Table scrolls                               | generic 4-row | 🟡      | section-level `(app)/gov/loading.tsx`: `PageHeaderSkeleton` + `TableSkeleton(rows=8)` (covers epoch/holdings/review collectively)                                        | ✅ poly        |
| /gov/holdings      | Holdings table                                                                                                                                         | Table scrolls                               | generic 4-row | 🟡      | (covered by `(app)/gov/loading.tsx`)                                                                                                                                     | ✅ poly        |
| /gov/review        | Review queue                                                                                                                                           | Table scrolls                               | generic 4-row | 🟡      | (covered by `(app)/gov/loading.tsx`)                                                                                                                                     | ✅ poly        |
| /gov/system        | System dashboard                                                                                                                                       | Same                                        | generic 4-row | ⚪      | (covered by `(app)/gov/loading.tsx` — generic shape acceptable)                                                                                                          | ✅ poly        |

#### `(public)` group — anonymous

| ROUTE          | MACRO LAYOUT                                          | CURRENT SKEL     | VERDICT | PROPOSED SKEL                                                                                                                                                 | HUMAN APPROVED |
| -------------- | ----------------------------------------------------- | ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| /              | Hero + MarketCards + BrainFeed (full-bleed marketing) | generic centered | 🔴      | Per-route `(public)/loading.tsx` override: Hero skel (h-64 × max-w-4xl centered) + `CardGridSkeleton(cols={md:3,base:1},count=3,h=128)` + 3× list rows (h-14) | ✅ poly        |
| /propose/merge | Merge proposal form                                   | generic          | 🟡      | Per-route override: `PageHeaderSkeleton` + 4× labeled input rows (h-16) + button row (h-10 × 200w right-aligned)                                              | ✅ poly        |
| /dummy         | test page                                             | generic          | ⚪      | leave generic                                                                                                                                                 | ✅ poly        |

#### Poly status notes (2026-04-27)

- **Implementation merged**: PR #1095 (squashed) — supersedes #1089's
  generic boundary port. All bespoke skeletons + 3 reusable primitives
  (`PageHeaderSkeleton`, `TableSkeleton`, `CardGridSkeleton`) on main.
- **`/chat` history**: first attempt added a phantom thread-list rail
  inside the chat viewport. Real `/chat` has no rail — the thread list
  lives in the global `AppSidebar` via `ChatThreadsSidebarGroup`. Fixed
  in second flight (`024032bb`) — single-column messages + composer.
- **`/dashboard` accepted with caveat**: user judged 🟡 ("yellow/red,
  but still good enough, and not worth fixing rn, since we expect
  churn"). Defer further accuracy work until dashboard layout
  stabilizes.
- **`/research/w/[addr]`, `/profile`, `/schedules`**: not bespoke'd,
  not explicitly walked. Default `(app)/loading.tsx` (`PageSkeleton`)
  serves them. Re-score if any feels wrong.
- **All-nodes carry-over**: per user — "all nodes share the same
  threads page layout. once we get poly right, this should be spread
  to node template" (and operator + resy). The
  `(app)/chat/loading.tsx` shape is the canonical port template.

### Operator

⬜ TODO — same exercise after poly's primitives are validated. Top
priority per derek (alongside node-template).

### Node-template

⬜ TODO — same exercise. Top priority per derek (this is the template
that downstream forks inherit; getting it right propagates).

### Resy

⬜ TODO — defer until pattern proves out on the first two.

## Todos

### Phase 1 — Build the matrix

- [x] poly: walk every route, score current skeleton, propose accurate
      shape per route. Filed in §"Per-node matrices · Poly" above.
- [ ] node-template: same exercise.
- [ ] operator: same exercise.
- [ ] resy: same exercise.

### Phase 2 — Implementation, per node

Drives every 🔴/🟡 row in each node's matrix to ✅ in the HUMAN
APPROVED column. Pattern (in priority order):

#### Poly (in flight on `feat/task-0405-poly-skeleton-accuracy`)

- [ ] Build reusable primitives in `nodes/poly/app/src/components/kit/layout/`:
      `PageHeaderSkeleton.tsx`, `TableSkeleton.tsx`, `CardGridSkeleton.tsx`.
- [ ] /chat — per-route `(app)/chat/loading.tsx` (chat-viewport shell)
- [ ] /dashboard — per-route loading.tsx (CardGridSkeleton stack +
      2-col grid + 3-col charts)
- [ ] /research — per-route loading.tsx (TableSkeleton + footer aside)
- [ ] /work — per-route loading.tsx (TableSkeleton)
- [ ] (app)/gov/loading.tsx — section-level (TableSkeleton, covers
      epoch/holdings/review/system)
- [ ] /credits — per-route loading.tsx (CardGridSkeleton 2-col + mobile pill)
- [ ] /activity — per-route loading.tsx (range selector + 3 charts + table)
- [ ] /profile, /schedules, /research/w/[addr] — assess after the
      above land; may stay ⚪ generic if visually OK
- [ ] (public)/page — per-route loading.tsx (Hero + MarketCards + BrainFeed)
- [ ] (public)/propose/merge — per-route loading.tsx (form skel)
- [ ] Hand-validate each on `candidate-a-poly.cogni-dao.net`,
      desktop **and** mobile viewport. Tick HUMAN APPROVED ⬜→✅
      per row only after derek confirms.

#### node-template

- [ ] Walk routes, fill the matrix above.
- [ ] Implement per same pattern as poly.

#### operator

- [ ] Walk routes, fill the matrix above.
- [ ] Implement per same pattern as poly.

#### resy

- [ ] Walk routes, fill the matrix above.
- [ ] Implement per same pattern as poly.

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

- Blocked-by: task.0408 (must have boundaries in place before
  refining their accuracy).
- Implements spike.0401 Phase 2c (skeleton-fidelity refinement).
- Related: task.0406 (PostHog data-agent access for retroactive
  perf observability).

## PR / Links

- PR(s): TBD (likely one per node, per single-node-scope rule)
