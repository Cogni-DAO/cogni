---
id: multi-provider-llm
type: spec
title: Multi-Provider LLM Execution
status: draft
spec_state: draft
trust: draft
summary: Unified model selection, provider routing, billing, and observability across all LLM backends — platform (LiteLLM), ChatGPT subscription (Codex), user-hosted OSS (Ollama).
read_when: Adding an LLM provider, changing model selection, modifying credit checks, or touching usage metrics.
implements: proj.byo-ai
owner: derekg1729
created: 2026-03-26
verified: null
tags:
  - ai
  - byo-ai
  - architecture
---

# Multi-Provider LLM Execution

> One authority per decision: what models exist, which backend runs them, whether credits are needed, and how usage is tracked.

### Key References

|             |                                                   |                              |
| ----------- | ------------------------------------------------- | ---------------------------- |
| **Project** | [proj.byo-ai](../../work/projects/proj.byo-ai.md) | Roadmap and planning         |
| **Spec**    | [tenant-connections](./tenant-connections.md)     | Encrypted credential storage |
| **Spec**    | [graph-execution](./graph-execution.md)           | Graph execution pipeline     |

## Design

```
                              ┌─────────────────────┐
                              │  /api/v1/ai/models   │
                              │   ModelCatalogPort    │
                              └──────┬──────────────┘
                                     │ returns ModelOption[]
                                     ▼
┌──────────────┐    ModelRef    ┌─────────────────────┐    GraphRunRequest    ┌──────────────────┐
│   UI Layer   │ ──────────►   │   Chat / Schedule    │ ──────────────────►  │  Graph Executor   │
│  ModelPicker │               │      Routes          │                      │  Factory          │
└──────────────┘               └─────────────────────┘                      └────────┬─────────┘
                                                                                     │
                                                                      resolves LlmService
                                                                      from ModelRef.provider
                                                                                     │
                                                           ┌─────────────────────────┼────────────────────────┐
                                                           │                         │                        │
                                                           ▼                         ▼                        ▼
                                                   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
                                                   │ LiteLlmAdapter│         │CodexLlmAdapter│         │OllamaAdapter │
                                                   │  (platform)   │         │  (ChatGPT)    │         │ (user-hosted)│
                                                   └──────────────┘         └──────────────┘         └──────────────┘
                                                          │                         │                        │
                                                          ▼                         ▼                        ▼
                                                     LiteLLM proxy           codex exec subprocess    HTTP POST /v1/...
                                                     → OpenRouter            → ChatGPT backend        → user's Ollama
```

## Goal

Define the contracts for model selection, provider routing, credit checks, and usage tracking such that adding a new LLM provider requires:

1. One new `LlmService` adapter
2. One new entry in `ModelCatalogPort`
3. Zero changes to graph execution, billing, or UI code

## Non-Goals

- External agent runtimes (Codex containers, OpenClaw sandbox) — those are `GraphExecutorPort` providers, not `LlmService` adapters
- Tool credential management — covered by [tenant-connections spec](./tenant-connections.md)
- OAuth flow details — provider-specific, lives in route implementations
- LlmService port evolution to ModelRuntimePort — future concern when semantics diverge

## Invariants

| Rule                    | Constraint                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ONE_CATALOG_AUTHORITY   | `ModelCatalogPort` is the ONLY source of truth for "what models can this user select." No hardcoded model arrays in UI or server validation.                                     |
| TYPED_MODEL_SELECTION   | Model selection is a `ModelRef` (provider + modelId + connectionId), not a bare string. Invalid combinations are impossible at the type level.                                   |
| PROVIDER_ON_REQUEST     | `GraphRunRequest` carries `modelRef: ModelRef`. The factory resolves the correct `LlmService` adapter from `modelRef.provider`. No "override" pattern.                           |
| ONE_CREDIT_PATH         | Credit check happens in ONE place: `PreflightCreditCheckDecorator`. It reads `isFree` from the model catalog. No inline credit checks in routes.                                 |
| PROVIDER_AWARE_USAGE    | `UsageFact.source` reflects the actual provider (`"litellm"                                                                                                                      | "codex" | "ollama"`). `usageUnitId` is provider-specific (litellmCallId for LiteLLM, runId for others). Missing usageUnitId is only a billing violation for providers that have one. |
| CATALOG_OWNS_FREE       | Whether a model costs platform credits is determined by the catalog (`ModelOption.isFree`), not by checking model IDs against hardcoded sets.                                    |
| ADAPTER_IMPLEMENTS_PORT | Every LLM provider has exactly one `LlmService` adapter. The adapter owns provider-specific auth, transport, and response mapping. No provider logic leaks into graph execution. |
| BROKER_RESOLVES_CREDS   | Non-platform providers resolve credentials via `ConnectionBrokerPort`. The adapter receives pre-resolved credentials — never reads from disk, DB, or env directly.               |

### Types

#### ModelRef — typed model selection

```ts
/**
 * Typed reference to a specific model on a specific provider.
 * Replaces `model: string` + `modelConnectionId?: string`.
 */
interface ModelRef {
  /** Which LLM backend handles this model */
  readonly provider: "platform" | "chatgpt" | "ollama";
  /** Model identifier (provider-specific, e.g. "gpt-5.4-mini", "llama3:8b") */
  readonly modelId: string;
  /** Connection ID for non-platform providers (resolves to credentials via broker) */
  readonly connectionId?: string;
}
```

#### ModelOption — catalog entry

```ts
/**
 * A selectable model returned by the catalog.
 * The UI renders these directly — no client-side model arrays.
 */
interface ModelOption {
  /** Typed reference — carried through to GraphRunRequest */
  readonly ref: ModelRef;
  /** Display name (e.g. "GPT-5.4 Mini", "Llama 3 8B") */
  readonly label: string;
  /** Short description */
  readonly description?: string;
  /** Whether this model costs platform credits */
  readonly isFree: boolean;
  /** Provider display name for UI grouping */
  readonly providerLabel: string;
  /** Provider key for icon rendering */
  readonly providerKey: string;
}
```

#### ModelCatalogPort

```ts
/**
 * Unified model catalog aggregating all connected LLM backends.
 * The ONLY authority for "what models can this user select."
 */
interface ModelCatalogPort {
  /** List all models available to this user across all backends */
  listModels(params: { userId: string; billingAccountId: string }): Promise<{
    models: ModelOption[];
    defaultRef: ModelRef | null;
  }>;
}
```

Adapters:

- `LiteLlmModelCatalogAdapter` — fetches from LiteLLM `/model/info`, marks `isFree` from metadata
- `ChatGptModelCatalogAdapter` — returns hardcoded Codex model list when user has active `openai-chatgpt` connection, all marked `isFree: true`
- `OllamaModelCatalogAdapter` — fetches from user's Ollama `/api/tags` endpoint, all marked `isFree: true`
- `AggregatingModelCatalog` — combines all adapters, returns unified list

#### GraphRunRequest change

```ts
interface GraphRunRequest {
  readonly runId: string;
  readonly graphId: GraphId;
  readonly messages: Message[];
  readonly modelRef: ModelRef;        // replaces `model: string`
  // readonly model: string;          // REMOVED
  // readonly modelConnectionId?: string;  // REMOVED (absorbed into ModelRef)
  readonly stateKey?: string;
  readonly toolIds?: readonly string[];
  readonly responseFormat?: { ... };
  readonly toolConnectionIds?: readonly string[];
}
```

#### UsageFact change

```ts
const SOURCE_SYSTEMS = ["litellm", "codex", "ollama"] as const;
type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

interface UsageFact {
  readonly runId: string;
  readonly attempt: number;
  readonly source: SourceSystem;
  readonly executorType: ExecutorType;
  readonly graphId: GraphId;
  /** Provider-specific billing key. Required for platform (litellm). Optional for BYO. */
  readonly usageUnitId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
  readonly usageRaw?: Record<string, unknown>;
}
```

### LlmService adapter resolution

```ts
/**
 * Resolve the correct LlmService adapter for a model reference.
 * Called by the graph executor factory at run start.
 */
async function resolveLlmService(
  ref: ModelRef,
  container: Container,
  broker: ConnectionBrokerPort
): Promise<LlmService> {
  switch (ref.provider) {
    case "platform":
      return container.llmService; // LiteLlmAdapter singleton
    case "chatgpt": {
      const conn = await broker.resolve(
        ref.connectionId!,
        billing.billingAccountId
      );
      return new CodexLlmAdapter(conn);
    }
    case "ollama": {
      const conn = await broker.resolve(
        ref.connectionId!,
        billing.billingAccountId
      );
      return new OllamaLlmAdapter(conn);
    }
  }
}
```

### Credit check — unified path

The `PreflightCreditCheckDecorator` reads `modelRef` from the request:

```ts
runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
  const result = this.inner.runGraph(req, ctx);

  // Non-platform providers have $0 platform cost — skip
  if (req.modelRef.provider !== "platform") {
    return result;
  }

  // Platform: check credits
  const checkPromise = this.checkFn(this.billingAccountId, req.modelRef.modelId, req.messages);
  return {
    stream: this.wrapWithPreflight(result.stream, checkPromise),
    final: checkPromise.then(() => result.final),
  };
}
```

No inline credit checks in schedule routes. The schedule creation route validates that the `modelRef` is valid via the catalog — the catalog knows `isFree`. If `isFree`, no credit gate. If paid, check balance. Same logic, one place.

### Usage reporting — provider-aware

The `InProcCompletionUnitAdapter` emits `usage_report` based on what the adapter returns:

```ts
if (result.ok) {
  const fact: UsageFact = {
    runId, attempt, graphId,
    source: result.resolvedProvider === "openai-chatgpt" ? "codex"
          : result.resolvedProvider === "ollama" ? "ollama"
          : "litellm",
    executorType: "inproc",
    ...(result.usageUnitId ? { usageUnitId: result.usageUnitId } : {}),
    ...(result.usage ? { inputTokens: result.usage.promptTokens, outputTokens: result.usage.completionTokens } : {}),
    ...(result.model ? { model: result.model } : {}),
    ...(result.providerCostUsd !== undefined ? { costUsd: result.providerCostUsd } : {}),
  };
  yield { type: "usage_report", fact };
}
```

No conditional throw for missing `usageUnitId`. Platform runs that are missing it get a warning log. BYO runs legitimately don't have one.

### File Pointers

| File                                                                  | Purpose                               |
| --------------------------------------------------------------------- | ------------------------------------- |
| `packages/graph-execution-core/src/graph-executor.port.ts`            | `GraphRunRequest` with `modelRef`     |
| `apps/web/src/ports/llm.port.ts`                                      | `LlmService` interface                |
| `apps/web/src/ports/model-catalog.port.ts`                            | `ModelCatalogPort` (new)              |
| `apps/web/src/ports/connection-broker.port.ts`                        | `ConnectionBrokerPort`                |
| `packages/ai-core/src/billing/source-system.ts`                       | `SourceSystem` enum                   |
| `packages/ai-core/src/usage/usage.ts`                                 | `UsageFact` type                      |
| `apps/web/src/bootstrap/graph-executor.factory.ts`                    | `resolveLlmService` + decorator stack |
| `apps/web/src/adapters/server/ai/preflight-credit-check.decorator.ts` | Unified credit check                  |
| `apps/web/src/shared/ai/model-catalog.server.ts`                      | `AggregatingModelCatalog` adapter     |
| `apps/web/src/contracts/ai.models.v1.contract.ts`                     | `/api/v1/ai/models` contract          |

## Open Questions

- [ ] Should `ModelRef.provider` be a fixed union or an open string? Fixed union is safer but requires code changes per provider. Open string is extensible but loses type safety.
- [ ] Should the `OllamaLlmAdapter` use the OpenAI-compatible endpoint (`/v1/chat/completions`) or Ollama's native API (`/api/chat`)? The former is simpler; the latter supports Ollama-specific features.
- [ ] How should the catalog handle disconnected providers? If a user's Ollama server is offline, should its models still appear (grayed out) or be hidden?
- [ ] Should `UsageFact` track BYO runs at all? They have $0 platform cost, but token counts are useful for observability. If tracked, what's the billing key (`usageUnitId`)?

## Related

- [proj.byo-ai](../../work/projects/proj.byo-ai.md) — project roadmap
- [tenant-connections](./tenant-connections.md) — encrypted credential storage
- [graph-execution](./graph-execution.md) — graph execution pipeline
- [architecture](./architecture.md) — system architecture
