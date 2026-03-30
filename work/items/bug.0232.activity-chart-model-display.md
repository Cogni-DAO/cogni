---
id: bug.0232
type: bug
title: Activity charts show raw model IDs and "unknown" instead of human-friendly names
status: needs_triage
priority: 1
rank: 99
estimate: 2
summary: Activity chart model labels use raw LiteLLM model IDs (e.g. "claude-sonnet-4-20250514") instead of display names, Codex/OpenAI usage shows as "unknown", and the legend layout breaks with many models.
outcome: Charts show human-readable model names, Codex usage is attributed to the correct model, and the legend scales gracefully.
spec_refs:
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [dashboard, activity, ux]
external_refs:
---

# Activity charts show raw model IDs, "unknown", and broken legend

## Requirements

### Bug 1: Raw model IDs instead of human-friendly names

**Observed:** The "By Model" activity charts display raw LiteLLM model identifiers like `claude-sonnet-4-20250514`, `deepseek-r1:14b`, `kimi-k2.5` instead of human-readable display names.

**Expected:** Charts should show display names from the model catalog (e.g. "Claude Sonnet 4", "DeepSeek R1 14B").

**Root cause:** `buildGroupedSeries()` in `apps/web/src/app/_facades/ai/activity.server.ts:127-130` uses the raw `detail.model` value directly as the group key. The model catalog at `apps/web/src/shared/ai/model-catalog.server.ts:128` already maps `display_name` to `name` -- but the activity facade never consults it.

**Reproduction:**

1. Navigate to Dashboard
2. Toggle "By Model" in the Activity section
3. Observe raw model IDs in chart legends and tooltips

### Bug 2: Codex OpenAI subscription usage appears as "unknown"

**Observed:** Usage from the Codex OpenAI subscription shows model name "unknown" in all three activity charts.

**Expected:** The actual model name (e.g. "GPT-4o mini") should be displayed.

**Root cause:** The billing pipeline defaults to `"unknown"` when `fact.model` is undefined at `apps/web/src/features/ai/services/billing.ts:110`. The usage fact from Codex calls is not populating the model field. This propagates through `llm_charge_details.model` into the activity facade which also defaults to `"unknown"` at `activity.server.ts:129`.

**Reproduction:**

1. Make an LLM call via a Codex/OpenAI subscription connection
2. View Dashboard activity charts "By Model"
3. Observe "unknown" as a model group

### Bug 3: Legend layout breaks with many models (pre-existing)

**Observed:** The chart legend renders as a single horizontal flex row (`flex items-center justify-center gap-4`) with no wrapping. As models accumulate, labels overflow, overlap, and become unreadable.

**Expected:** Legend should remain readable regardless of model count -- wrapping to multiple lines, truncating long names with tooltips, or collapsing into a scrollable list.

**Root cause:** `ChartLegendContent` in `apps/web/src/components/vendor/shadcn/chart.tsx:286` uses fixed `gap-4` horizontal flex with no `flex-wrap`, no `max-width`, and no text truncation. Labels at `activity-chart-utils.ts:61` are passed through verbatim.

**Reproduction:**

1. Have 5+ distinct models with usage in the selected time range
2. View any activity chart in "By Model" mode
3. Observe overlapping/truncated legend items

## Allowed Changes

- `apps/web/src/app/_facades/ai/activity.server.ts` -- look up display names from model catalog
- `apps/web/src/features/ai/services/billing.ts` -- ensure model field is populated for all provider types
- `apps/web/src/components/vendor/shadcn/chart.tsx` -- improve legend layout (flex-wrap, truncation)
- `apps/web/src/components/kit/data-display/activity-chart-utils.ts` -- apply display name mapping
- Usage fact emission for Codex/OpenAI provider -- ensure model name is captured

## Plan

- [ ] Add model display name lookup in `buildGroupedSeries()` using the model catalog
- [ ] Trace Codex/OpenAI usage fact emission and ensure `fact.model` is populated
- [ ] Update `ChartLegendContent` to use `flex-wrap` and truncate long labels
- [ ] Add unit test for model name normalization in activity data transform

## Validation

**Command:**

```bash
pnpm check:fast
```

**Expected:** All tests pass. Activity charts display human-readable model names, no "unknown" entries for Codex usage, legend wraps gracefully.

## Review Checklist

- [ ] **Work Item:** `bug.0232` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
