---
id: task.0237
type: task
title: "Work items table — ReUI data-grid + detail panel + visual identity"
status: done
priority: 1
rank: 1
estimate: 3
summary: "Replace hand-rolled work items table with ReUI's data-grid (TanStack Table + shadcn) for sorting, faceted filters, column visibility, keyboard nav, and row-expand detail. Add type/status visual icons optimized for human recall."
outcome: "Work items table is premium: sortable columns, faceted status/type/project filters, keyboard navigation, row-click detail panel with full metadata, and visual type icons that make items instantly recognizable at a glance."
spec_refs:
assignees: []
credit:
project: proj.premium-frontend-ux
branch: feat/premium-frontend-ux
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-31
labels: [ui, work-items]
external_refs:
  - https://reui.io/docs/data-grid
  - https://data-table.openstatus.dev/
---

# Work Items Table — ReUI Data-Grid + Detail Panel

## Design

### Outcome

Work items table goes from "admin spreadsheet" to "top 0.1% CMS" — sortable, filterable, keyboard-navigable, with visual icons that make every item type and status instantly recognizable at a glance. Designed to evolve toward AI-generated visual aids.

### Approach

**Solution**: Use [ReUI data-grid](https://reui.io/docs/data-grid) patterns — already in our shadcn registry (`@reui`). ReUI wraps `@tanstack/react-table` v8 + our existing shadcn/ui primitives into production-ready data-grid components with 29 pre-built patterns (sorting, faceted filters, column visibility, row selection, virtualization). Install via `npx shadcn@latest add @reui/data-grid`.

**Why ReUI over raw TanStack Table**: ReUI is already a registered registry in our `components.json`. It provides pre-built, styled data-grid components (headers, filters, pagination, column toggles) composed from shadcn primitives we already use. Writing these from scratch would be ~500 LOC of boilerplate that ReUI gives us for free.

**Why ReUI over OpenStatus data-table-filters**: OpenStatus is excellent but uses `nuqs` for URL state. We already have URL-driven state via `useSearchParams` + `useRouter`. ReUI is more composable and doesn't prescribe state management.

**Reuses**:

- `@reui/data-grid` registry (already configured in `components.json`)
- `@tanstack/react-table` v8 (installed as ReUI dependency)
- Existing `Sheet` component (shadcn/ui, already installed) for detail panel
- Existing `WorkItemDtoSchema` contract — no API changes needed
- Existing `fetchWorkItems` + React Query hook — no backend changes
- Existing `ExpandableTableRow` pattern (reference for expand UX)
- `cmdk` (already installed, unused) — activate for command palette search

**Rejected**:

- **AG Grid** — heavy (200KB+), enterprise features we don't need, different styling paradigm from our shadcn design system
- **Material React Table** — Material Design conflicts with our Tailwind/shadcn aesthetic
- **Handsontable** — spreadsheet-oriented, wrong UX metaphor for work items
- **Raw TanStack Table** — too much boilerplate to reach premium feel; ReUI solves this
- **Payload CMS** — full CMS is overkill; we just need a great table component, not a content management system

### Visual Identity System (P1 evolution path)

Each work item type and status gets a distinct visual icon optimized for human recall:

**Type icons** (lucide-react, already installed):

- `task` → CheckSquare (concrete, actionable)
- `bug` → Bug (universal recognition)
- `story` → BookOpen (narrative, scope)
- `spike` → FlaskConical (research, experiment)
- `subtask` → CornerDownRight (child relationship)

**Status icons** (color + icon pairing for dual-channel encoding):

- `needs_triage` → CircleDashed (gray) — unprocessed
- `needs_research` → Search (amber) — investigating
- `needs_design` → Pencil (amber) — designing
- `needs_implement` → Code (blue) — building
- `needs_closeout` → ClipboardCheck (blue) — verifying
- `needs_merge` → GitMerge (green) — review
- `done` → CheckCircle (green) — complete
- `blocked` → Ban (red) — stuck
- `cancelled` → XCircle (gray) — dropped

**Future evolution**: These icons become slots for AI-generated images or Rive animations per task.0238. The component accepts `icon?: ReactNode` override so generated visuals drop in without refactoring.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CONTRACTS_ARE_TRUTH: No new API types — table columns derive from `WorkItemDto` via `z.infer` (spec: architecture)
- [ ] SIMPLE_SOLUTION: ReUI data-grid from existing registry, not custom table implementation
- [ ] URL_DRIVEN_STATE: Filter/sort state preserved in URL params (existing pattern in `view.tsx`)
- [ ] ARCHITECTURE_ALIGNMENT: Component in `app/(app)/work/`, kit components in `components/kit/` (spec: architecture)
- [ ] PROGRESSIVE_ENHANCEMENT: Detail panel is additive — table works without it
- [ ] MOBILE_FIRST: Table scrolls horizontally on mobile, detail panel uses Drawer (not Sheet) below md breakpoint

### Files

**Install (one-time)**:

- `npx shadcn@latest add @reui/data-grid` — pulls TanStack Table + ReUI grid components into `components/vendor/`

**Create**:

- `apps/operator/src/app/(app)/work/_components/columns.tsx` — column definitions with type/status icon renderers
- `apps/operator/src/app/(app)/work/_components/WorkItemDetail.tsx` — Sheet/Drawer detail panel
- `apps/operator/src/app/(app)/work/_components/type-icons.tsx` — type/status icon maps (lucide-react)
- `apps/operator/src/app/(app)/work/_components/faceted-filter.tsx` — faceted filter for status/type/project (if not in ReUI)

**Modify**:

- `apps/operator/src/app/(app)/work/view.tsx` — rewrite with ReUI data-grid, wire column defs + detail panel
- `apps/operator/src/app/(app)/work/_api/fetchWorkItems.ts` — add `fetchWorkItem(id)` for detail panel

**Test**:

- Manual: sort by each column, filter by type/status/project, keyboard j/k/enter, row click → detail
- `pnpm check:fast` — typecheck + lint + unit tests

### Implementation Sequence

1. **Install ReUI data-grid** — `npx shadcn@latest add @reui/data-grid`, verify components land in vendor/
2. **Column definitions** — map WorkItemDto fields to TanStack column defs with icon renderers
3. **Replace table** — swap hand-rolled table in `view.tsx` with ReUI DataGrid, preserve URL-driven filters
4. **Faceted filters** — type, status, and project facets (replace current Select dropdowns)
5. **Detail panel** — Sheet on desktop, Drawer on mobile. Fetch full item via GET `/api/v1/work/items/[id]`
6. **Keyboard navigation** — j/k row movement, enter to open detail, / to focus search, esc to close detail
7. **Polish** — loading skeletons, empty states, mobile horizontal scroll

## Validation

```bash
pnpm check:fast
```
