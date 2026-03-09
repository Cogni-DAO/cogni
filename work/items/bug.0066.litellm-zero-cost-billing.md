---
id: bug.0066
type: bug
title: LiteLLM reports $0 cost for gpt-4o-mini — billing creates 0-credit receipts for paid models
status: cancelled
priority: 1
estimate: 3
summary: Production logs show gpt-4o-mini calls with providerCostUsd=0 despite OpenRouter pricing at $0.15/$0.60 per 1M tokens. Billing system creates charge receipts with 0 credits.
outcome: Understand why LiteLLM reports $0 for paid models and either fix upstream or add workaround
spec_refs: []
assignees: []
credit:
project:
branch:
pr:
reviewer:
created: 2026-02-15
updated: 2026-02-15
labels: [billing, litellm, openrouter]
external_refs:
  - https://openrouter.ai/openai/gpt-4o-mini
revision: 0
blocked_by:
deploy_verified: false
rank: 2
---

# LiteLLM reports $0 cost for gpt-4o-mini — billing creates 0-credit receipts

## Requirements

### Observed

Production logs (2026-02-15) show LLM calls completing with `providerCostUsd: 0` for models that ARE paid on OpenRouter:

```json
{
  "event": "ai.llm_call",
  "model": "gpt-4o-mini",
  "tokensUsed": 403,
  "providerCostUsd": 0, // ← WRONG
  "billingAccountId": "aa68521d-e694-488e-8903-061d88b8408b"
}
```

Cascade:

1. `providerCostUsd: 0` (number, not undefined)
2. `billing.ts:102` type check passes: `if (typeof costUsd !== "number")`
3. `llmPricingPolicy.calculateDefaultLlmCharge(0)` returns `chargedCredits: 0`
4. Charge receipt written with 0 credits
5. **User sees no charge for conversation**

**Affected models** (from logs):

- `gpt-4o-mini` (OpenRouter: $0.15 input, $0.60 output per 1M tokens)
- `nemotron-nano-30b` (also $0 in logs)

**Working correctly:**

- `gemini-2.5-flash` shows actual cost: `providerCostUsd: 0.0001479`

**Code pointers:**

- `src/features/ai/services/billing.ts:100-122` - cost handling logic
- `src/adapters/server/ai/inproc-completion-unit.adapter.ts` - emits usage events with providerCostUsd from LiteLLM
- Billing event: `{event: "ai.billing.commit_complete", chargedCredits: "0", sourceSystem: "litellm"}`

### Expected

**Either:**

A) **LiteLLM correctly reports cost** from OpenRouter response headers
B) **We detect free-tier usage** and mark specific calls as free (not all gpt-4o-mini calls)
C) **We configure free models explicitly** in LiteLLM config and billing skips them

**Currently broken:**

- Billing system can't distinguish "legitimately free" from "missing cost data"
- $0 from LiteLLM could mean: free tier credits, free model, OR missing cost data

### Reproduction

1. Start dev stack with OpenRouter-backed LiteLLM
2. Make completion call with `gpt-4o-mini` model
3. Check Grafana logs for `event="ai.llm_call"`
4. **Observe**: `providerCostUsd: 0`
5. Check `/activity` page
6. **Observe**: No charge receipt (or $0 receipt)

**Production evidence:**

```bash
# Query Loki for zero-cost paid model calls
{app="cogni-template", env="production"} | json
  | event="ai.llm_call"
  | model="gpt-4o-mini"
  | providerCostUsd="0"
```

### Impact

- **Users**: No charge receipts for conversations (can't track usage)
- **Billing**: Revenue loss if free tier exhausted but still reporting $0
- **Metrics**: Can't distinguish free usage from missing cost data
- **Trust**: Inconsistent billing undermines user confidence

## Allowed Changes

- `src/features/ai/services/billing.ts` - cost validation logic
- `platform/infra/services/runtime/configs/litellm.config.yaml` - free model config
- LiteLLM proxy logs investigation (not code change)
- `src/features/ai/services/llmPricingPolicy.ts` - free model handling

## Plan

### Investigation Phase

- [ ] Check LiteLLM callback logs for OpenRouter response headers (search for `x-openrouter-cost` or similar)
- [ ] Verify OpenRouter account credit balance (free tier usage?)
- [ ] Test same model via OpenRouter API directly (bypass LiteLLM)
- [ ] Check if LiteLLM has upstream issue for OpenRouter $0 costs

### Fix Options

**Option A: Mark known free models in config**

- Add `free_models` list to LiteLLM config
- Billing skips free models (no receipt written)
- Document which models are intentionally free

**Option B: Defer when cost=0 from paid providers**

- If `providerCostUsd === 0` AND provider is OpenRouter AND model is known-paid
- Log warning + defer billing (don't write $0 receipt)
- Wait for callback or manual reconciliation

**Option C: Use fallback pricing**

- If cost=0, calculate from tokens \* known rate
- Requires maintaining model pricing table
- Risk: stale pricing data

## Validation

**After investigation:**

```bash
# Confirm root cause identified
grep -r "x-openrouter" platform/infra/services/runtime/configs/
```

**After fix:**

```bash
# Run billing E2E test
pnpm test tests/stack/ai/billing-e2e.stack.test.ts

# Check prod logs show correct costs
# (manual Grafana query)
```

**Expected:** gpt-4o-mini calls show `providerCostUsd > 0` OR are explicitly marked as free models with no receipt.

## Review Checklist

- [ ] **Work Item:** `bug.0066` linked in PR body
- [ ] **Spec:** N/A (billing fix)
- [ ] **Tests:** Billing E2E test updated to cover free vs paid models
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Production logs: 2026-02-15 14:00-14:07 UTC
- OpenRouter pricing: https://openrouter.ai/openai/gpt-4o-mini
- Related: task.0062 (LiteLLM model update workflow with billing validation)

## Attribution

- Reported: derekg1729
- Investigation: Claude Code agent
