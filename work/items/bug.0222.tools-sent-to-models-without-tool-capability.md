---
id: bug.0222
type: bug
title: "Graph execution sends tools to models that declare capabilities.tools: false"
status: needs_triage
priority: 2
rank: 99
estimate: 2
summary: "InProcCompletionUnitAdapter passes tools to LlmService.completionStream() regardless of model capabilities. Models that don't support function calling (e.g. tinyllama via Ollama) receive tools and return 400. The OpenAI-compatible adapter works around this with a retry hack."
outcome: "Tools are only sent to models that declare capabilities.tools: true. Models without tool support run graphs without tools — graceful degradation, not error."
spec_refs: [multi-provider-llm]
assignees: []
credit:
project: proj.byo-ai
branch:
pr:
reviewer:
created: 2026-03-27
updated: 2026-03-27
labels: [ai, byo-ai, bug, capabilities]
external_refs: []
revision: 0
blocked_by: []
deploy_verified: false
---

## Requirements

### Observed

`InProcCompletionUnitAdapter.executeCompletionUnit()` at `apps/operator/src/adapters/server/ai/inproc-completion-unit.adapter.ts:203-204` unconditionally forwards tools to the `LlmService`:

```ts
...(tools && { tools }),
...(toolChoice && { toolChoice }),
```

The LangGraph runner at `apps/operator/src/adapters/server/ai/langgraph/inproc.provider.ts:147-148` resolves tools from the catalog based on `toolIds`, then passes them to `executeCompletionUnit()` — also without checking capabilities.

When the resolved `LlmService` is `OpenAiCompatibleLlmAdapter` targeting a model without function calling support (e.g. `tinyllama:latest` on Ollama), the endpoint returns HTTP 400:

```
{"error":{"message":"registry.ollama.ai/library/tinyllama:latest does not support tools","type":"invalid_request_error"}}
```

Current workaround: `openai-compatible-llm.adapter.ts` retries without tools on 400 if the error message contains "does not support tools". This is fragile — error message format is provider-specific and untested for vLLM/llama.cpp.

### Expected

The execution pipeline checks `ModelCapabilities.tools` before attaching tools to the LLM call. If `capabilities.tools === false`, tools and tool_choice are stripped from the `completionStream()` params. The graph still runs — it just can't invoke tools on that turn.

The capability information is available: `ModelProviderPort.listModels()` returns `ModelOption.capabilities` for each model. The `ModelRef` on `GraphRunRequest` identifies the model. The gap: the `InProcCompletionUnitAdapter` and the LangGraph runner don't have access to capabilities at call time.

### Reproduction

1. Connect Ollama with tinyllama via profile page
2. Select tinyllama in model picker
3. Send a chat message using any graph with tools (e.g. `ponderer` has `core__get_current_time`, `core__metrics_query`)
4. Observe 400 error from Ollama, then retry without tools

### Impact

- User-facing: chat fails on first attempt, retry hack masks the error but tools silently disappear
- Architectural: capability declarations (`ModelOption.capabilities`) are decorative — not enforced at execution time
- Affects all BYO providers with models that lack function calling support

## Allowed Changes

- `apps/operator/src/adapters/server/ai/inproc-completion-unit.adapter.ts` — gate tools on capability
- `apps/operator/src/adapters/server/ai/langgraph/inproc.provider.ts` — pass capability flag or strip tools before `executeCompletionUnit()`
- `apps/operator/src/adapters/server/ai/execution-scope.ts` — optionally carry capabilities on scope
- Remove retry hack from `openai-compatible-llm.adapter.ts` once proper gating is in place

## Validation

- `pnpm check` passes
- Chat with tinyllama on Ollama succeeds without the retry hack
- Chat with a platform model (gpt-4o-mini) still receives tools
- Unit test: `InProcCompletionUnitAdapter` strips tools when capabilities.tools is false
