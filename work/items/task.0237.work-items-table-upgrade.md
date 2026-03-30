---
id: task.0237
type: task
title: "Work items table — TanStack Table migration + detail panel"
status: needs_design
priority: 2
rank: 1
estimate: 3
summary: "Replace hand-rolled work items table with @tanstack/react-table for sorting, column resizing, row selection, keyboard navigation. Add slide-out detail panel on row click."
outcome: "Work items table supports column sorting, keyboard navigation (j/k/enter), row selection, and click-to-open detail panel showing full item metadata, linked PRs, and spec refs."
spec_refs:
assignees: []
credit:
project: proj.premium-frontend-ux
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [ui, work-items]
external_refs:
---

# Work Items Table Upgrade

## Requirements

1. Migrate `work/view.tsx` from hand-rolled `<Table>` to `@tanstack/react-table`
2. Column sorting (click header to sort)
3. Keyboard navigation: j/k to move, enter to open, / to focus search
4. Row click opens a slide-out detail panel (Sheet component from shadcn/ui)
5. Detail panel shows: full metadata, linked PRs, spec refs, summary, outcome
6. Grouped-by-project view (collapsible project sections) — optional stretch goal

## Allowed Changes

- `apps/web/src/app/(app)/work/view.tsx` — rewrite table with TanStack Table
- `apps/web/src/app/(app)/work/WorkItemDetail.tsx` — new detail panel component
- `package.json` — add `@tanstack/react-table` dependency

## Plan

- [ ] Install `@tanstack/react-table`
- [ ] Define column definitions matching current table columns
- [ ] Wire sorting, filtering, and keyboard navigation
- [ ] Create detail panel (Sheet/Drawer)
- [ ] Preserve URL-driven filter state

## Validation

```bash
pnpm check:fast
```
