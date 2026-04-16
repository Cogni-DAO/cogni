---
id: bug.0234
type: bug
title: Activity charts show raw model IDs and "unknown" instead of human-friendly names
status: done
priority: 1
rank: 99
estimate: 2
summary: Activity chart model labels use raw LiteLLM model IDs instead of display names, Codex/OpenAI usage shows as "unknown", and the legend layout breaks with many models.
outcome: Charts show human-readable model names, Codex usage is attributed to the correct model, and the legend scales gracefully.
spec_refs:
assignees: []
credit:
project:
branch: worktree-fix+bug.0234-activity-chart
pr: https://github.com/Cogni-DAO/node-template/pull/666
reviewer:
revision: 1
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

**Observed:** Activity charts display raw model identifiers (e.g. `claude-sonnet-4-20250514`, `kimi-k2.5`) instead of display names (e.g. "Claude Sonnet 4.5", "Kimi K2.5").

**Root cause:** Legacy billing path stored `providerMeta.model` (the provider-resolved model ID) in `llm_charge_details.model`. The current callback path stores `model_group` (config alias) but never resolves to the catalog display name.

### Bug 2: Codex OpenAI subscription usage appears as "unknown"

**Observed:** Codex usage shows "unknown" in activity charts.

**Root cause:** `codex-llm.adapter.ts` omits `resolvedModel` from `onResult()`. `completion.ts` only reads `providerMeta.model` with no fallback to `resolvedModel`. Codex doesn't set `providerMeta`.

### Bug 3: Legend layout breaks with many models

**Observed:** Chart legend is a single horizontal flex row with no wrapping. Labels overflow and overlap.

## Design

### Approach: Display name in the completion envelope

Each adapter resolves the display name from its own source of truth and sets `resolvedDisplayName` on `LlmCompletionResult`. The name flows through the billing pipeline to `llm_charge_details.model` at write time. No facade-level name resolution needed.

```
Adapter sets resolvedDisplayName → completion.ts threads it →
UsageFact.model carries it → billing writes to DB → facade reads clean
```

**Adapter sources:**

- LiteLLM: async catalog lookup via `getCachedModels()` (SWR-cached)
- Codex: hardcoded `CODEX_MODEL_LABELS` map (exported from provider)
- OpenAI-compatible: `humanizeModelId()` (exported from provider)
- Callback path: sync `getDisplayNameFromCache()` for `model_group`

**Rejected:** Facade-level catalog lookup at read time — wrong layer, adds fragile fallback chains.

### Invariants

- [x] DISPLAY_NAME_AT_SOURCE: Each adapter resolves display name from its own source of truth
- [x] ENVELOPE_CARRIES_NAME: `LlmCompletionResult.resolvedDisplayName` threads through to billing
- [x] NO_FACADE_LOGIC: Activity facade reads `detail.model` as-is, no name mapping

## Allowed Changes

- `apps/operator/src/ports/llm.port.ts` — add `resolvedDisplayName` to `LlmCompletionResult`
- `apps/operator/src/adapters/server/ai/litellm.adapter.ts` — set `resolvedDisplayName` from catalog
- `apps/operator/src/adapters/server/ai/codex/codex-llm.adapter.ts` — set `resolvedModel` + `resolvedDisplayName`
- `apps/operator/src/adapters/server/ai/openai-compatible/openai-compatible-llm.adapter.ts` — set `resolvedDisplayName`
- `apps/operator/src/adapters/server/ai/providers/codex.provider.ts` — export `CODEX_MODEL_LABELS`
- `apps/operator/src/adapters/server/ai/providers/openai-compatible.provider.ts` — export `humanizeModelId`
- `apps/operator/src/features/ai/services/completion.ts` — prefer display name, fallback to `resolvedModel`
- `apps/operator/src/app/api/internal/billing/ingest/route.ts` — resolve display name for callback path
- `apps/operator/src/shared/ai/model-catalog.server.ts` — add sync `getDisplayNameFromCache()`
- `apps/operator/src/components/vendor/shadcn/chart.tsx` — legend flex-wrap + truncation

## Validation

**Command:**

```bash
pnpm check:fast
```

**Expected:** All checks pass.

## Review Checklist

- [x] **Work Item:** `bug.0234` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
