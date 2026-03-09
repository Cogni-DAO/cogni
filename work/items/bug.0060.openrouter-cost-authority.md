---
id: bug.0060
type: bug
title: "Cost authority bug: OpenRouter billed cost not flowing through LiteLLM callback (response_cost=0)"
status: needs_design
priority: 1
estimate: 2
summary: "LiteLLM generic_api callback is the billing cost oracle (response_cost). For new OpenRouter models missing from LiteLLM’s internal pricing table (e.g. claude-opus-4.6), LiteLLM computes response_cost=0 silently even though OpenRouter billed non-zero. This causes $0 charge receipts and underbilling."
outcome: "For paid OpenRouter models, callback payload response_cost (and cost_breakdown.total_cost) reflects OpenRouter provider-reported billed cost (e.g. usage.cost). No paid model can produce a persisted $0 receipt with non-zero tokens."
spec_refs: [billing-ingest-spec, billing-evolution-spec]
assignees: [derekg1729]
credit:
project: proj.reliability
branch:
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [billing, litellm, openrouter, p1]
external_refs:
  - docs/postmortems/pm.billing-observability-gaps.2026-02-14.md
revision: 0
blocked_by:
deploy_verified: false
rank: 1
---

# bug.0060 — Cost authority: OpenRouter → LiteLLM → callback `response_cost`

## Observed

- LiteLLM `generic_api` callback sends `StandardLoggingPayload[]` with `response_cost: 0` for `openrouter/anthropic/claude-opus-4-6`.
- Billing ingest (`POST /api/internal/billing/ingest`) treats `response_cost` as authoritative cost and writes `charge_receipts` with $0 cost → `charged_credits = 0`.

## Expected

- For paid OpenRouter models: callback payload `response_cost > 0` and receipts record non-zero cost / credits.
- New models must not require manual updates to an internal LiteLLM pricing table to produce accurate cost.

## Root cause

- **LiteLLM is recomputing `response_cost` from its internal cost map** instead of passing through OpenRouter’s provider-reported billed cost.
- When the model is missing from LiteLLM’s table, LiteLLM silently falls back to `response_cost = 0` (no error/warn), even though OpenRouter billed correctly.

## Current code path (Cogni)

- Callback payload contract: `src/contracts/billing-ingest.internal.v1.contract.ts`
- Ingest handler maps cost directly from callback:
  - `src/app/api/internal/billing/ingest/route.ts` → `fact.costUsd = entry.response_cost`
  - `src/features/ai/services/billing.ts` (`commitUsageFact`) computes charge from `fact.costUsd` and writes receipt

## Design / path forward (super scoped)

### 1) Pipe OpenRouter usage cost through LiteLLM (the actual fix)

**Goal:** Ensure LiteLLM’s callback payload cost fields represent **OpenRouter’s billed cost**, not LiteLLM’s internal recomputation.

**Required LiteLLM behavior (OpenRouter provider):**

- If OpenRouter response provides a numeric provider cost (commonly `usage.cost` in OpenAI-compatible responses / final stream usage chunk):
  - Set `StandardLoggingPayload.response_cost = usage.cost`
  - Set `StandardLoggingPayload.cost_breakdown.total_cost = usage.cost` (and split input/output if available)
  - Preserve raw provider usage in `metadata.usage_object` for audit/debug
- Only fall back to LiteLLM internal pricing-table computation if provider cost is absent.
- If cost is missing or falls back to 0 for a paid model, populate `response_cost_failure_debug_info` and emit a warning (no silent 0).

**Docs reference (LiteLLM):**

- StandardLoggingPayload spec (response_cost, cost_breakdown, usage_object): `https://docs.litellm.ai/docs/proxy/logging_spec`
- generic_api callback payload format: `https://docs.litellm.ai/docs/observability/generic_api`

### 2) Stack tests using LiteLLM-only mocks (replace finicky `mock-llm`)

**Decision:** Replace the current finicky upstream `mock-llm` container usage for most stack tests with LiteLLM proxy “mock_response” models.

**Rationale:** Deterministic, no upstream network, reduces flaky SSE behavior. Validates our streaming plumbing without involving provider emulators.

**Plan:**

- Add a test-only model alias (e.g. `mock-stream`) in `platform/infra/services/runtime/configs/litellm.test.config.yaml` using `litellm_params.mock_response`.
- Use `stream=true` in test requests to validate:
  - SSE chunk parsing
  - `[DONE]` handling
  - tool-call delta accumulation (if needed)

### 3) Add stack tests for OpenRouter usage costs (deterministic + manual)

#### A) Deterministic regression (always runs)

**Test:** `POST /api/internal/billing/ingest` with a handwritten/captured `StandardLoggingPayload[]` entry:

- `status: "success"`
- `custom_llm_provider: "openrouter"`
- `model_group`: paid model alias (e.g. `"claude-opus-4.6"`)
- `prompt_tokens > 0`, `completion_tokens > 0`
- `response_cost > 0`

**Assert:** A `charge_receipts` row is written with:

- `response_cost_usd > 0` (after markup policy)
- `charged_credits > 0`

This is the core regression guard for bug.0060: **given non-zero callback cost, we persist a non-zero receipt**.

#### B) Manual OpenRouter passthrough validation (env-gated)

**Test (manual):** Call LiteLLM proxy with a real OpenRouter paid model (e.g. `claude-opus-4.6`) and assert the callback-driven receipt is non-zero.

- Gate behind env vars:
  - `RUN_OPENROUTER_BILLING_TESTS=1`
  - `OPENROUTER_API_KEY` present
- Flow:
  1. Make a real proxy call via LiteLLM `/v1/chat/completions` (stream or non-stream)
  2. Wait/poll for callback ingest to write receipt
  3. Assert `response_cost_usd > 0`

This validates the real end-to-end: **OpenRouter usage cost → LiteLLM callback `response_cost` → charge receipt**.

## Invariants to assert (P1 guardrail)

- **No paid-model final receipt at $0**: if `tokens > 0` and model is known-paid but callback `response_cost == 0`, emit a targeted CRITICAL metric/log (and optionally treat as “missing cost” to defer receipt).
- **Cost authority remains callback**: app never recomputes provider cost from tokens; it only consumes callback payload cost (`response_cost` / cost_breakdown).

## Validation

- **Deterministic:** run stack test that posts `StandardLoggingPayload[]` to ingest and asserts non-zero receipt.
- **Manual (required for release):** enable env-gated OpenRouter test and confirm `claude-opus-4.6` produces non-zero callback cost + receipt.
