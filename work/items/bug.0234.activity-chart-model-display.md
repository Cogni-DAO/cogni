---
id: bug.0234
type: bug
title: Activity charts show raw model IDs and "unknown" instead of human-friendly names
status: needs_implement
priority: 1
rank: 99
estimate: 2
summary: Activity chart model labels use raw LiteLLM model IDs (e.g. "claude-sonnet-4-20250514") instead of display names, Codex/OpenAI usage shows as "unknown", and the legend layout breaks with many models.
outcome: Charts show human-readable model names, Codex usage is attributed to the correct model, and the legend scales gracefully.
spec_refs:
assignees: []
credit:
project:
branch: worktree-fix+bug.0234-activity-chart-model-display
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

## Design

### Outcome

Activity charts show human-readable model names (e.g. "Claude Sonnet 4" not "claude-sonnet-4-20250514"), Codex usage is attributed to the actual model instead of "unknown", and legends remain readable at any model count.

### Approach

Three independent fixes, smallest diff possible:

**Fix 1 — Display names in charts (facade-level mapping)**

`buildGroupedSeries()` already has the raw model ID. Add a simple `Map<string, string>` lookup built from the model catalog (`getCachedModels()`) before grouping. The catalog already has `display_name` via `ModelMeta.name`. For models not in catalog (BYO/Codex), apply a lightweight `humanizeModelId()` fallback (title-case, strip date suffixes).

**Reuses:** `getCachedModels()` from `model-catalog.server.ts` (already cached with SWR, no new I/O). The `humanizeModelId()` pattern already exists in `openai-compatible.provider.ts`.

**Fix 2 — Codex "unknown" model**

Root cause: `codex-llm.adapter.ts:249-262` calls `onResult()` with `resolvedProvider: "openai-chatgpt"` but omits `resolvedModel`. Then `completion.ts:376` extracts model from `providerMeta.model` only — Codex doesn't set `providerMeta`. Two one-line fixes:

- Codex adapter: add `resolvedModel: model` to `onResult()` call
- `completion.ts:376`: fall back to `result.resolvedModel` when `providerMeta.model` is missing

**Rejected:** Threading provider info through a new `CompletionFinalResult.provider` field — unnecessary complexity, the model name alone is sufficient for display.

**Fix 3 — Legend overflow (CSS only)**

Add `flex-wrap` and `max-w` + `text-xs` + `truncate` to `ChartLegendContent` in `chart.tsx`. Pure CSS change.

**Rejected:** Custom scrollable legend component — over-engineered for 5-8 model slots.

### Invariants

- [ ] CHARGE_RECEIPTS_IS_LEDGER_TRUTH: display name mapping is presentation-only; raw model ID stays in DB and in `detail.model` (spec: activity.server.ts)
- [ ] SWR_CACHE: model catalog lookup uses existing `getCachedModels()`, no new fetch calls
- [ ] SIMPLE_SOLUTION: three surgical fixes, no new abstractions or types
- [ ] ARCHITECTURE_ALIGNMENT: facade does presentation mapping, adapter fixes data at source (spec: architecture)

### Files

- Modify: `apps/web/src/app/_facades/ai/activity.server.ts` — build model display name map from catalog, apply in `buildGroupedSeries()` and rows
- Modify: `apps/web/src/adapters/server/ai/codex/codex-llm.adapter.ts` — add `resolvedModel: model` to `onResult()` (line 249)
- Modify: `apps/web/src/features/ai/services/completion.ts` — fallback to `result.resolvedModel` when `providerMeta.model` missing (line 376)
- Modify: `apps/web/src/components/vendor/shadcn/chart.tsx` — add `flex-wrap`, truncation to `ChartLegendContent`
- Test: `apps/web/src/app/_facades/ai/activity.server.test.ts` — unit test for display name mapping in `buildGroupedSeries`

## Allowed Changes

- `apps/web/src/app/_facades/ai/activity.server.ts` -- display name lookup from model catalog
- `apps/web/src/adapters/server/ai/codex/codex-llm.adapter.ts` -- add resolvedModel to onResult
- `apps/web/src/features/ai/services/completion.ts` -- resolvedModel fallback
- `apps/web/src/components/vendor/shadcn/chart.tsx` -- legend flex-wrap and truncation
- `apps/web/src/app/_facades/ai/activity.server.test.ts` -- new test file

## Validation

**Command:**

```bash
pnpm check:fast
```

**Expected:** All tests pass. Activity charts display human-readable model names, no "unknown" entries for Codex usage, legend wraps gracefully.

## Review Checklist

- [ ] **Work Item:** `bug.0234` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
