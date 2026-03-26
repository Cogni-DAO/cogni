---
id: task.0209
type: task
title: "Multi-provider LLM rearchitecture — ModelCatalogPort + ModelRef"
status: needs_implement
priority: 1
rank: 5
estimate: 3
summary: "Replace split model/provider authority with unified ModelCatalogPort, typed ModelRef on GraphRunRequest, one credit check path, provider-aware usage metrics. Delete all CHATGPT_MODEL_IDS hacks."
outcome: "Adding a new LLM provider requires one adapter + one catalog entry. Zero changes to graph execution, billing, or UI code. No hardcoded model arrays anywhere."
spec_refs: [multi-provider-llm]
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: feat/byo-ai-per-tenant
pr:
reviewer:
created: 2026-03-26
updated: 2026-03-26
labels: [ai, byo-ai, architecture, refactor]
external_refs: []
revision: 0
blocked_by: []
deploy_verified: false
---

## Design

### Outcome

One authority per decision. `ModelCatalogPort` owns "what's selectable." `ModelRef` carries provider + model + connection as one typed value. Credit check reads `isFree` from catalog. Usage metrics reflect actual provider. No hardcoded model arrays in UI or server.

### Approach

**Solution**: Introduce `ModelRef` type, `ModelCatalogPort` port, and `AggregatingModelCatalog` adapter. Propagate `ModelRef` through the full pipeline replacing `model: string` + `modelConnectionId?: string`. Delete all `CHATGPT_MODEL_IDS` hacks.

**Spec**: [multi-provider-llm](../../docs/spec/multi-provider-llm.md)

**Reuses**:

- Existing `ConnectionBrokerPort` for credential resolution
- Existing `LlmService` adapters (LiteLlmAdapter, CodexLlmAdapter)
- Existing `/api/v1/ai/models` route (modify, not replace)
- Existing `PreflightCreditCheckDecorator` (simplify, not replace)

### Invariants

- [ ] ONE_CATALOG_AUTHORITY: `ModelCatalogPort` is the ONLY source for selectable models (spec: multi-provider-llm)
- [ ] TYPED_MODEL_SELECTION: `ModelRef` replaces bare `model: string` on `GraphRunRequest` (spec: multi-provider-llm)
- [ ] PROVIDER_ON_REQUEST: Factory resolves `LlmService` from `modelRef.provider` — no override pattern (spec: multi-provider-llm)
- [ ] ONE_CREDIT_PATH: Credit check in decorator only, reads catalog `isFree` — no inline checks in routes (spec: multi-provider-llm)
- [ ] PROVIDER_AWARE_USAGE: `UsageFact.source` reflects actual provider (spec: multi-provider-llm)
- [ ] CATALOG_OWNS_FREE: No `CHATGPT_MODEL_IDS` sets anywhere (spec: multi-provider-llm)

### Files

#### New

- Create: `apps/web/src/ports/model-catalog.port.ts` — `ModelCatalogPort`, `ModelOption`, `ModelRef`
- Create: `apps/web/src/adapters/server/ai/model-catalog/aggregating.adapter.ts` — combines LiteLLM + ChatGPT catalogs
- Create: `apps/web/src/adapters/server/ai/model-catalog/litellm.adapter.ts` — fetches from LiteLLM `/model/info`
- Create: `apps/web/src/adapters/server/ai/model-catalog/chatgpt.adapter.ts` — returns ChatGPT models when connection exists

#### Modify — core types

- Modify: `packages/graph-execution-core/src/graph-executor.port.ts` — `modelRef: ModelRef` replaces `model` + `modelConnectionId`
- Modify: `packages/ai-core/src/billing/source-system.ts` — add `"codex" | "ollama"` to `SourceSystem`
- Modify: `apps/web/src/contracts/ai.models.v1.contract.ts` — `ModelOption` with `ref: ModelRef`
- Modify: `apps/web/src/contracts/ai.chat.v1.contract.ts` — `modelRef` replaces `model` + `modelConnectionId`

#### Modify — execution pipeline

- Modify: `apps/web/src/bootstrap/graph-executor.factory.ts` — resolve `LlmService` from `modelRef.provider`, delete override pattern
- Modify: `apps/web/src/adapters/server/ai/execution-scope.ts` — `llmService: LlmService` (configured, not override)
- Modify: `apps/web/src/adapters/server/ai/inproc-completion-unit.adapter.ts` — read configured `LlmService` from scope
- Modify: `apps/web/src/adapters/server/ai/preflight-credit-check.decorator.ts` — check `modelRef.provider !== "platform"`

#### Modify — routes

- Modify: `apps/web/src/app/api/v1/ai/models/route.ts` — call `ModelCatalogPort` instead of LiteLLM directly
- Modify: `apps/web/src/app/api/v1/ai/chat/route.ts` — validate `modelRef` via catalog, remove `isModelAllowed` hack
- Modify: `apps/web/src/app/api/v1/schedules/route.ts` — remove inline credit check, use catalog `isFree`
- Modify: `apps/web/src/app/_facades/ai/completion.server.ts` — pass `modelRef` to Temporal
- Modify: `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts` — extract `modelRef` from input

#### Modify — UI

- Modify: `apps/web/src/features/ai/components/ModelPicker.tsx` — render from API only, delete `CHATGPT_MODELS` const
- Modify: `apps/web/src/features/ai/components/ChatComposerExtras.tsx` — selection value is `ModelRef`
- Modify: `apps/web/src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx` — send `modelRef` in request body

#### Delete

- Delete: `CHATGPT_MODELS` const from `ModelPicker.tsx`
- Delete: `CHATGPT_MODEL_IDS` set from `model-catalog.server.ts` (3 occurrences)
- Delete: `isModelFreeFromCache` ChatGPT hack from `model-catalog.server.ts`

#### Tests

- Test: `tests/unit/ports/model-catalog.test.ts` — aggregating catalog combines providers correctly
- Test: `tests/unit/adapters/preflight-credit-check.test.ts` — platform checks credits, non-platform skips

## Validation

- [ ] `/api/v1/ai/models` returns unified list including ChatGPT models when connected
- [ ] ModelPicker renders from API response only — no hardcoded arrays
- [ ] Chat with ChatGPT model: no credit check, no model validation hack
- [ ] Chat with OpenRouter model: credit check fires, model validated against LiteLLM
- [ ] Schedule with ChatGPT model: no inline credit check, schedule creates
- [ ] Schedule with OpenRouter paid model + no credits: rejected at creation
- [ ] `UsageFact.source` is `"codex"` for ChatGPT runs, `"litellm"` for platform runs
- [ ] `pnpm check` passes
- [ ] No `CHATGPT_MODEL_IDS` or `CHATGPT_MODELS` anywhere in codebase

## PR / Links

- PR: https://github.com/Cogni-DAO/node-template/pull/612
- Handoff: [handoff](../handoffs/task.0209.handoff.md)
