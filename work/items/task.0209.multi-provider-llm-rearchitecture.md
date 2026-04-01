---
id: task.0209
type: task
title: "Multi-provider LLM rearchitecture — ModelCatalogPort + ModelRef"
status: needs_merge
priority: 1
rank: 5
estimate: 3
summary: "Replace split model/provider authority with unified ModelCatalogPort, typed ModelRef on GraphRunRequest, one credit check path, provider-aware usage metrics. Delete all CHATGPT_MODEL_IDS hacks."
outcome: "Adding a new LLM provider requires one adapter + one catalog entry. Zero changes to graph execution, billing, or UI code. No hardcoded model arrays anywhere."
spec_refs: [multi-provider-llm]
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: feat/byo-ai-mobile-polish
pr: https://github.com/Cogni-DAO/node-template/pull/641
reviewer:
created: 2026-03-26
updated: 2026-03-27
labels: [ai, byo-ai, architecture, refactor]
external_refs: []
revision: 0
blocked_by: []
deploy_verified: false
---

## Design

### Outcome

One authority per decision. `ModelCatalogPort` owns "what's selectable." `ModelRef` carries providerKey + modelId + connectionId as one typed value. Credit check reads `requiresPlatformCredits` from catalog. Usage metrics reflect actual provider. No hardcoded model arrays in UI or server. Provider is a registry key, not a union — adding a provider never requires central type edits.

### Approach

**Solution**: Introduce `ModelRef` type (in `@cogni/ai-core`), `ModelCatalogPort` port, `ModelCapabilities` type, and `AggregatingModelCatalog` adapter with provider registry. Propagate `ModelRef` through the full pipeline replacing `model: string` + `modelConnectionId?: string`. Delete all `CHATGPT_MODEL_IDS` hacks. Rename `isFree` → `requiresPlatformCredits`.

**Spec**: [multi-provider-llm](../../docs/spec/multi-provider-llm.md)

**Reuses**:

- Existing `ConnectionBrokerPort` for credential resolution (widen scope to actor+tenant)
- Existing `LlmService` adapters (LiteLlmAdapter, CodexLlmAdapter)
- Existing `/api/v1/ai/models` route (modify, not replace)
- Existing `PreflightCreditCheckDecorator` (simplify, not replace)

### Invariants

- [ ] ONE_CATALOG_AUTHORITY: `ModelCatalogPort` is the ONLY source for selectable models (spec: multi-provider-llm)
- [ ] TYPED_MODEL_SELECTION: `ModelRef` replaces bare `model: string` on `GraphRunRequest` (spec: multi-provider-llm)
- [ ] MODELREF_FULLY_RESOLVED: `GraphRunRequest` carries exact `ModelRef` — no defaulting, inference, or rewriting at execution time. Schedules persist exact `ModelRef`. (spec: multi-provider-llm)
- [ ] PROVIDER_KEY_IS_REGISTRY: `providerKey` is an opaque `string`, not a fixed union. Provider registry maps key → adapter factory. (spec: multi-provider-llm)
- [ ] PROVIDER_ON_REQUEST: Factory resolves `LlmService` from `modelRef.providerKey` via provider registry — no override pattern (spec: multi-provider-llm)
- [ ] ONE_CREDIT_PATH: Credit check in decorator only, reads catalog `requiresPlatformCredits` — no inline checks in routes (spec: multi-provider-llm)
- [ ] BILLING_VOCABULARY: Use `requiresPlatformCredits`, never `isFree`. BYO models are not free — they have zero platform cost. (spec: multi-provider-llm)
- [ ] CAPABILITY_AWARE_CATALOG: `ModelOption` declares capabilities (streaming, tools, structuredOutput, vision). Catalog can filter by required capabilities. (spec: multi-provider-llm)
- [ ] PROVIDER_AWARE_USAGE: `UsageFact.source` reflects actual provider. BYO runs tracked for observability. (spec: multi-provider-llm)
- [ ] CATALOG_OWNS_BILLING_MODE: No `CHATGPT_MODEL_IDS` sets anywhere (spec: multi-provider-llm)

### Files

#### New

- Create: `packages/ai-core/src/model/model-ref.ts` — `ModelRef` type, `ModelCapabilities` type (shared across packages)
- Create: `apps/operator/src/ports/model-catalog.port.ts` — `ModelCatalogPort`, `ModelOption` (imports `ModelRef` from `@cogni/ai-core`)
- Create: `apps/operator/src/adapters/server/ai/model-catalog/aggregating.adapter.ts` — combines providers, applies capability filter
- Create: `apps/operator/src/adapters/server/ai/model-catalog/litellm.adapter.ts` — fetches from LiteLLM `/model/info`
- Create: `apps/operator/src/adapters/server/ai/model-catalog/chatgpt.adapter.ts` — returns ChatGPT models when connection exists

#### Modify — core types (packages)

- Modify: `packages/ai-core/src/index.ts` — export `ModelRef`, `ModelCapabilities`
- Modify: `packages/graph-execution-core/src/graph-executor.port.ts` — `modelRef: ModelRef` replaces `model` + `modelConnectionId`
- Modify: `packages/ai-core/src/billing/source-system.ts` — add `"codex" | "ollama"` to `SourceSystem`

#### Modify — core types (app)

- Modify: `apps/operator/src/contracts/ai.models.v1.contract.ts` — `ModelOption` with `ref: ModelRef`, `requiresPlatformCredits`, `capabilities`
- Modify: `apps/operator/src/contracts/ai.chat.v1.contract.ts` — `modelRef` replaces `model` + `modelConnectionId`

#### Modify — execution pipeline

- Modify: `apps/operator/src/bootstrap/graph-executor.factory.ts` — provider registry + `resolveLlmService` from `modelRef.providerKey`, delete override pattern
- Modify: `apps/operator/src/adapters/server/ai/execution-scope.ts` — `llmService: LlmService` (resolved, not override)
- Modify: `apps/operator/src/adapters/server/ai/inproc-completion-unit.adapter.ts` — receive resolved `LlmService` as param to `executeCompletionUnit()`
- Modify: `apps/operator/src/adapters/server/ai/preflight-credit-check.decorator.ts` — check `requiresPlatformCredits` from catalog, not provider key comparison
- Modify: `apps/operator/src/ports/connection-broker.port.ts` — widen `resolve()` scope to `{ actorId, billingAccountId }` instead of bare `billingAccountId`

#### Modify — routes

- Modify: `apps/operator/src/app/api/v1/ai/models/route.ts` — call `ModelCatalogPort` instead of LiteLLM directly
- Modify: `apps/operator/src/app/api/v1/ai/chat/route.ts` — validate `modelRef` via catalog, remove `isModelAllowed` hack
- Modify: `apps/operator/src/app/api/v1/schedules/route.ts` — remove inline credit check, use catalog `requiresPlatformCredits`
- Modify: `apps/operator/src/app/_facades/ai/completion.server.ts` — pass `modelRef` to Temporal
- Modify: `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts` — extract `modelRef` from input

#### Modify — UI

- Modify: `apps/operator/src/features/ai/components/ModelPicker.tsx` — render from API only, delete `CHATGPT_MODELS` const
- Modify: `apps/operator/src/features/ai/components/ChatComposerExtras.tsx` — selection value is `ModelRef`
- Modify: `apps/operator/src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx` — send `modelRef` in request body

#### Delete

- Delete: `CHATGPT_MODELS` const from `ModelPicker.tsx`
- Delete: `CHATGPT_MODEL_IDS` set from `model-catalog.server.ts` (3 occurrences)
- Delete: `isModelFreeFromCache` ChatGPT hack from `model-catalog.server.ts`

#### Tests

- Test: `tests/unit/ports/model-catalog.test.ts` — aggregating catalog combines providers, capability filtering works
- Test: `tests/unit/adapters/preflight-credit-check.test.ts` — `requiresPlatformCredits: true` checks credits, `false` skips

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
