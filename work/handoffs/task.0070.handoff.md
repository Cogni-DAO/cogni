---
id: task.0070.handoff
type: handoff
work_item_id: task.0070
status: active
created: 2026-02-16
updated: 2026-02-17
branch: feat/bar-charts
last_commit: b63bd2f5
---

# Handoff: Activity Bar Charts + Per-Model/Agent Breakdown

## Context

- **Goal**: Replace wavy line charts with stacked bar charts on `/activity` and `/gov`, matching OpenRouter's dashboard style
- **Extends task.0070**: The governance dashboard was built on `feat/gov-dashboard` (merged as #430). This branch (`feat/bar-charts`) adds the chart redesign on top of staging
- **Scope**: Both `/activity` (user's own usage) and `/gov` (system tenant usage) get identical chart upgrades
- **Key feature**: Toggle between "By Model" and "By Agent" to see per-model or per-graphId usage breakdown in stacked bars
- **Data already existed**: `llm_charge_details` table has `model` and `graphId` columns — the facade just needed to group by them

## Current State

- ✅ `ActivityChart` component: `AreaChart` → `BarChart` with stacked bars, dynamic series from config keys
- ✅ Contract: `ActivityGroupBySchema` (`"model" | "graphId"`) input, `groupedSeries` optional output
- ✅ Facade: `buildGroupedSeries()` groups receipts by dimension, ranks by spend, caps at top 5 + "Others", zero-fills
- ✅ API routes: both `/api/v1/activity` and `/api/v1/governance/activity` accept `?groupBy=model|graphId`
- ✅ Client fetchers: `fetchActivity()` and `fetchGovernanceActivity()` forward `groupBy`
- ✅ Views: `ToggleGroup` control ("By Model" / "By Agent") on both pages, React Query key includes `groupBy`
- ✅ Utility: `activity-chart-utils.ts` — pure transforms from `groupedSeries` to recharts flat data + `ChartConfig`
- ✅ Types pass (`tsc --noEmit`), lint passes (biome), doc headers updated
- ❌ No tests written for `buildGroupedSeries` or `buildGroupedChartData`
- ❌ No manual validation (requires `pnpm dev:stack`)
- ❌ No PR created yet

## Decisions Made

- Stacked bar chart (not grouped bar) — matches OpenRouter's visual style, shows relative contribution
- Top 5 groups + "Others" bucket — prevents legend/color explosion with many models
- Groups ranked by total spend descending — most expensive model is always at bottom of stack
- `groupBy` is optional — omitting it returns the existing aggregate `chartSeries` (backwards compatible)
- `groupedSeries` uses numeric `spend` (not decimal string) — simpler for chart rendering, aggregate `chartSeries` keeps decimal strings for precision
- Toggle defaults to `"model"` (most useful breakdown for cost tracking)
- `activity-chart-utils.ts` sanitizes group names for CSS variable keys via `toDataKey()`

## Next Actions

- [ ] Manual validation: `pnpm dev:stack` → navigate to `/activity` and `/gov` → verify bar charts render
- [ ] Verify the toggle switches between model and agent breakdown correctly
- [ ] Add unit tests for `buildGroupedSeries` (facade) and `buildGroupedChartData` (utils)
- [ ] Run `/review-implementation` for code review
- [ ] Create PR via `/pull-request` targeting `staging`

## Risks / Gotchas

- The facade caps receipts at 1000 (existing limitation) — heavy users may see truncated breakdown
- `ToggleGroup` from shadcn fires `onValueChange("")` when deselecting — the handler maps empty string to `undefined` to fall back to aggregate mode
- Group colors are hardcoded in `GROUP_COLORS` array (6 colors) — if `MAX_GROUPS` changes, palette needs extending
- `toDataKey()` replaces non-alphanumeric chars with `_` — two models differing only in special chars could collide (unlikely in practice)

## Pointers

| File / Resource                                           | Why it matters                                       |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `src/components/kit/data-display/ActivityChart.tsx`       | Bar chart component (was AreaChart)                  |
| `src/components/kit/data-display/activity-chart-utils.ts` | Pure transforms: groupedSeries → recharts data       |
| `src/contracts/ai.activity.v1.contract.ts`                | `ActivityGroupBySchema` + `groupedSeries` schema     |
| `src/app/_facades/ai/activity.server.ts`                  | `buildGroupedSeries()` — grouping + ranking + Others |
| `src/app/(app)/activity/view.tsx`                         | Activity page with ToggleGroup                       |
| `src/app/(app)/gov/view.tsx`                              | Governance page with ToggleGroup                     |
| `src/app/api/v1/activity/route.ts`                        | Parses `groupBy` query param                         |
| `src/app/api/v1/governance/activity/route.ts`             | Parses `groupBy` query param (system tenant scope)   |
| Commit `d2fe9200`                                         | AreaChart → BarChart conversion                      |
| Commit `1c7c2dec`                                         | Contract + facade + utils for groupBy                |
| Commit `6bab5d27`                                         | UI wiring (routes, fetchers, views)                  |
