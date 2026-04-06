---
id: task.0209.handoff
type: handoff
work_item_id: task.0209
status: active
created: 2026-03-26
updated: 2026-03-26
branch: feat/byo-ai-per-tenant
last_commit: b423a97d
---

# Handoff: Multi-Provider LLM Rearchitecture

## Context

- Cogni graphs can run on multiple LLM backends: platform (LiteLLM/OpenRouter), ChatGPT subscription (Codex exec), and future user-hosted models (Ollama)
- The crawl implementation works but has split authority — model validation, credit checks, and provider routing are decided in 5+ separate places with hardcoded `CHATGPT_MODEL_IDS` sets
- This task replaces the hacks with a clean architecture: `ModelCatalogPort` (one model authority), `ModelRef` (typed provider+model+connection), and one credit check path
- The spec defines 8 invariants. The task lists every file to create, modify, and delete
- PR #612 on `feat/byo-ai-per-tenant` has the working crawl implementation. This task cleans it up

## Current State

- **Working**: ChatGPT OAuth (profile page), CodexLlmAdapter, UI toggle, chat + scheduled runs, credit skip for BYO
- **Not started**: ModelCatalogPort, ModelRef type, unified `/api/v1/ai/models` endpoint, deletion of hardcoded arrays
- **Spec written**: `docs/spec/multi-provider-llm.md` — has 4 open questions that need answers before implementation
- **CI**: static check passes as of `b423a97d`

## Decisions Made

- LLM backend swap happens at `LlmService` level, not `GraphExecutorPort` — preserves graph logic ([commit 9c45ec46](https://github.com/Cogni-DAO/node-template/pull/612))
- `ExecutionScope.llmServiceOverride` is the current mechanism — spec says replace with explicit `resolveLlmService(modelRef)` factory dispatch
- Credit check skips for non-platform providers via `req.modelConnectionId` check in `PreflightCreditCheckDecorator` — spec says use `modelRef.provider !== "platform"` instead
- `UsageFact.source` is currently always `"litellm"` — spec adds `"codex" | "ollama"` to `SourceSystem`
- OpenAI OAuth uses paste-back flow (public client ID locked to localhost:1455) — this is permanent, not a hack

## Next Actions

- [ ] Answer 4 open questions in `docs/spec/multi-provider-llm.md`
- [ ] Create `ModelRef` type in `packages/graph-execution-core`
- [ ] Create `ModelCatalogPort` + `AggregatingModelCatalog` adapter
- [ ] Update `/api/v1/ai/models` to call catalog (aggregate LiteLLM + ChatGPT models)
- [ ] Replace `model: string` + `modelConnectionId?: string` with `modelRef: ModelRef` on `GraphRunRequest`
- [ ] Update factory to resolve `LlmService` from `modelRef.provider` — delete override pattern
- [ ] Update `PreflightCreditCheckDecorator` to check `modelRef.provider` not `modelConnectionId`
- [ ] Remove schedule route inline credit check — use decorator only
- [ ] Delete `CHATGPT_MODELS` from ModelPicker, `CHATGPT_MODEL_IDS` from model-catalog.server.ts
- [ ] Add `"codex" | "ollama"` to `SourceSystem` enum

## Risks / Gotchas

- `GraphRunRequest.model` is used by ~15 files across the pipeline — the `modelRef` rename touches chat route, facade, Temporal workflow input, internal route, factory, decorator, and UI. Type-check will catch all of them but it's a wide change
- The schedule creation route (`/api/v1/schedules`) has its own inline credit check separate from the decorator — must be removed, not just modified
- `codex exec` does not stream incrementally — text arrives in a burst at turn completion. This is a Codex SDK limitation, not a bug
- `codex exec` subprocess has ~2s cold start per LLM call — acceptable for now, app-server is a future optimization
- The `@openai/codex` and `@openai/codex-sdk` dependencies remain (used by `CodexLlmAdapter`)

## Pointers

| File / Resource                                                              | Why it matters                                            |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- | --------- |
| `docs/spec/multi-provider-llm.md`                                            | The spec — 8 invariants, type definitions, open questions |
| `work/items/task.0209.multi-provider-llm-rearchitecture.md`                  | Task with file-by-file plan                               |
| `work/projects/proj.byo-ai.md`                                               | Project with "what's wrong" analysis and design           |
| `apps/operator/src/ports/llm.port.ts`                                        | `LlmService` interface — the port all adapters implement  |
| `apps/operator/src/adapters/server/ai/codex/codex-llm.adapter.ts`            | ChatGPT adapter — spawns codex exec, maps events          |
| `apps/operator/src/bootstrap/graph-executor.factory.ts:145-220`              | BYO path — async credential resolution + scope override   |
| `apps/operator/src/adapters/server/ai/inproc-completion-unit.adapter.ts:192` | Where `llmServiceOverride` is read — the swap point       |
| `apps/operator/src/shared/ai/model-catalog.server.ts:300-360`                | The `CHATGPT_MODEL_IDS` hacks to delete                   |
| `apps/operator/src/features/ai/components/ModelPicker.tsx:41-82`             | The `CHATGPT_MODELS` hardcoded array to delete            |
| `packages/ai-core/src/billing/source-system.ts`                              | `SourceSystem` enum — needs `"codex"                      | "ollama"` |
| https://github.com/Cogni-DAO/node-template/pull/612                          | PR with all crawl + walk implementation                   |
