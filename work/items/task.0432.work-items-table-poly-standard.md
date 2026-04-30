---
id: task.0432
type: task
title: "Work Items table — port poly's HEADER_OWNS_CONTROLS standard to operator + node-template"
status: needs_implement
priority: 2
rank: 1
estimate: 1
summary: "Operator and node-template work-items tables already use the reui DataGrid kit but render plain string headers and miss column-visibility/loading polish. Port the poly standard (DataGridColumnHeader on every header, loadingMode='skeleton', tableLayout.columnsVisibility) so the work tables match WalletsTable / PositionsTable visually + behaviorally."
outcome: "Visiting /work on the deployed candidate-a operator (and node-template) shows the same column-header dropdown UX as poly: each header has a sort/visibility menu, skeleton rows during load, and column-visibility toggles. Faceted filter toolbar retained — it provides multi-select status/type/project filtering that the column-header pattern doesn't replace."
spec_refs:
assignees: []
credit:
project:
branch: feat/task-0432-work-items-table-poly-standard
pr: 1150
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-30
updated: 2026-04-30
labels: [ui, work-items, dx]
external_refs:
  - https://github.com/Cogni-DAO/node-template/pull/1123
  - https://github.com/Cogni-DAO/node-template/pull/976
---

# Work Items Table — Poly DataGrid Standard Port

## Design

### Outcome

The `/work` dashboard in operator and node-template adopts the poly `HEADER_OWNS_CONTROLS` invariant: every column header renders via `DataGridColumnHeader` (sort + visibility live in the header dropdown), the grid uses `loadingMode="skeleton"` and `tableLayout.columnsVisibility: true`, matching `WalletsTable` and `PositionsTable`.

### Approach

Both apps already vendor an identical `components/reui/data-grid/` kit (10 files, byte-identical). The grid wrapper already uses `DataGrid + DataGridContainer + DataGridTable`. Three surgical edits per app:

1. `_components/columns.tsx` — wrap each `header` in `DataGridColumnHeader column={column} title="..." visibility`.
2. `view.tsx` — add `loadingMode="skeleton"` and `tableLayout.columnsVisibility: true` on the `DataGrid`.
3. Operator and node-template are byte-identical in `_components/`; same patch applies to both.

Faceted filter toolbar (`FacetedFilter.tsx`) is retained: status / type / project multi-select filtering is a real workflow that header-owned column controls don't replace. Out of scope for this PR.

### Invariants

- HEADER_OWNS_CONTROLS — every header wraps `DataGridColumnHeader`; sort + visibility live there.
- CONTRACTS_ARE_TRUTH — no contract changes; columns continue to derive from `WorkItemDto`.
- SIMPLE_SOLUTION — no new components, no kit changes; only column-def + `tableLayout` adjustments.

### Files

**Modify**:

- `nodes/operator/app/src/app/(app)/work/_components/columns.tsx`
- `nodes/operator/app/src/app/(app)/work/view.tsx`
- `nodes/node-template/app/src/app/(app)/work/_components/columns.tsx`
- `nodes/node-template/app/src/app/(app)/work/view.tsx`

## Validation

```
exercise: |
  Open https://test.cognidao.org/work on the candidate-a operator. Click a column
  header (e.g. "Pri") and confirm the dropdown shows Sort asc / Sort desc / Hide
  (poly-equivalent UX). Confirm skeleton rows appear during initial load.

observability: |
  Loki query at deployed buildSha showing the user's GET /api/v1/work/items request
  hit candidate-a (filter on apps/operator + sha label).
```
