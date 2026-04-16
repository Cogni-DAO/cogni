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
                                                                      from ModelRef.providerKey
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

| Rule                      | Constraint                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ONE_CATALOG_AUTHORITY     | `ModelCatalogPort` is the ONLY source of truth for "what models can this user select." No hardcoded model arrays in UI or server validation.                                                                                                                                                                                   |
| TYPED_MODEL_SELECTION     | Model selection is a `ModelRef` (providerKey + modelId + connectionId), not a bare string. Invalid combinations are impossible at the type level.                                                                                                                                                                              |
| MODELREF_FULLY_RESOLVED   | `GraphRunRequest` must always carry a fully resolved `ModelRef`. Executors may NOT infer, default, or rewrite provider/model selection. No UI default mutation, no implicit executor fallback, no ambient `llmServiceOverride`. Schedules persist the exact selected `ModelRef`, not "re-resolve whatever default is current." |
| PROVIDER_ON_REQUEST       | `GraphRunRequest` carries `modelRef: ModelRef`. The factory resolves the correct `LlmService` adapter from `modelRef.providerKey` via a provider registry. No "override" pattern.                                                                                                                                              |
| PROVIDER_KEY_IS_REGISTRY  | `ModelRef.providerKey` is an opaque `string`, not a fixed union. New providers are added by registering an adapter in the provider registry — no central type edits required.                                                                                                                                                  |
| ONE_CREDIT_PATH           | Credit check happens in ONE place: `PreflightCreditCheckDecorator`. It reads `requiresPlatformCredits` from the model catalog. No inline credit checks in routes.                                                                                                                                                              |
| PROVIDER_AWARE_USAGE      | `UsageFact.source` reflects the actual provider. `usageUnitId` is provider-specific (litellmCallId for LiteLLM, runId for others). Missing usageUnitId is only a billing violation for providers that have one. BYO runs are tracked for observability (token counts) even though platform cost is $0.                         |
| BILLING_VOCABULARY        | The billing concept is `requiresPlatformCredits: boolean`, NOT `isFree`. Models on BYO providers are not "free" — they cost the user's own subscription. They simply have zero platform credit cost.                                                                                                                           |
| CATALOG_OWNS_BILLING_MODE | Whether a model costs platform credits is determined by the catalog (`ModelOption.requiresPlatformCredits`), not by checking model IDs against hardcoded sets.                                                                                                                                                                 |
| CAPABILITY_AWARE_CATALOG  | `ModelOption` declares provider capabilities (`streaming`, `tools`, `structuredOutput`, `vision`). The catalog can filter by required capabilities for a graph or step.                                                                                                                                                        |
| ADAPTER_IMPLEMENTS_PORT   | Every LLM provider has exactly one `LlmService` adapter. The adapter owns provider-specific auth, transport, and response mapping. No provider logic leaks into graph execution.                                                                                                                                               |
| BROKER_RESOLVES_CREDS     | Non-platform providers resolve credentials via `ConnectionBrokerPort`. The adapter receives pre-resolved credentials — never reads from disk, DB, or env directly.                                                                                                                                                             |

### Types

#### ModelRef — typed model selection (lives in `@cogni/ai-core`)

```ts
/**
 * Typed reference to a specific model on a specific provider.
 * Replaces `model: string` + `modelConnectionId?: string`.
 *
 * providerKey is an opaque registry key, NOT a fixed union.
 * New providers register an adapter — no central type edits.
 */
interface ModelRef {
  /** Registry key for the LLM backend (e.g. "platform", "chatgpt", "ollama") */
  readonly providerKey: string;
  /** Model identifier (provider-specific, e.g. "gpt-5.4-mini", "llama3:8b") */
  readonly modelId: string;
  /** Connection ID for non-platform providers (resolves to credentials via broker) */
  readonly connectionId?: string;
}
```

#### ModelCapabilities — what a model/provider can do

```ts
/**
 * Declared capabilities for a model on a specific provider.
 * Used by catalog filtering — graphs can require capabilities
 * (e.g. "needs tools") and the catalog returns only matching models.
 */
interface ModelCapabilities {
  readonly streaming: boolean;
  readonly tools: boolean;
  readonly structuredOutput: boolean;
  readonly vision: boolean;
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
  /** Whether this model costs platform credits. NOT "isFree" — BYO models cost the user's own subscription. */
  readonly requiresPlatformCredits: boolean;
  /** Provider display name for UI grouping */
  readonly providerLabel: string;
  /** Declared capabilities for filtering */
  readonly capabilities: ModelCapabilities;
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
  listModels(params: {
    userId: string;
    billingAccountId: string;
    /** Optional: filter to models that have these capabilities */
    requiredCapabilities?: Partial<ModelCapabilities>;
  }): Promise<{
    models: ModelOption[];
    defaultRef: ModelRef | null;
  }>;
}
```

Adapters:

- `LiteLlmModelCatalogAdapter` — fetches from LiteLLM `/model/info`, `requiresPlatformCredits: true` for all
- `ChatGptModelCatalogAdapter` — returns hardcoded Codex model list when user has active `openai-chatgpt` connection, `requiresPlatformCredits: false`
- `OllamaModelCatalogAdapter` — fetches from user's Ollama `/api/tags` endpoint, `requiresPlatformCredits: false`
- `AggregatingModelCatalog` — combines all adapters, applies capability filter, returns unified list

#### GraphRunRequest change

Per MODELREF_FULLY_RESOLVED: the request carries the exact `ModelRef` selected by the user. No executor may infer, default, or rewrite it.

```ts
interface GraphRunRequest {
  readonly runId: string;
  readonly graphId: GraphId;
  readonly messages: Message[];
  readonly modelRef: ModelRef;        // replaces `model: string` — FULLY RESOLVED, never defaulted at execution time
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

### LlmService adapter resolution — provider registry

```ts
/**
 * Provider registry — maps providerKey to an LlmService factory.
 * Adding a new provider = registering one factory. No switch statements.
 */
type LlmServiceFactory = (conn: ResolvedConnection) => LlmService;

const providerRegistry = new Map<string, LlmServiceFactory | LlmService>();

// Register at boot:
providerRegistry.set("platform", container.llmService); // singleton
providerRegistry.set("chatgpt", (conn) => new CodexLlmAdapter(conn));
providerRegistry.set("ollama", (conn) => new OllamaLlmAdapter(conn));

/**
 * Resolve the correct LlmService adapter for a model reference.
 * Called by the graph executor factory at run start.
 * Uses registry lookup, not a switch statement — open for extension.
 */
async function resolveLlmService(
  ref: ModelRef,
  broker: ConnectionBrokerPort,
  actorId: string,
  billingAccountId: string
): Promise<LlmService> {
  const entry = providerRegistry.get(ref.providerKey);
  if (!entry) throw new Error(`Unknown provider: ${ref.providerKey}`);

  // Singleton adapter (platform) — no credential resolution needed
  if (typeof entry !== "function") return entry;

  // Factory adapter — resolve credentials via broker
  if (!ref.connectionId)
    throw new Error(`${ref.providerKey} requires connectionId`);
  const conn = await broker.resolve(ref.connectionId, {
    actorId,
    billingAccountId,
  });
  return entry(conn);
}
```

### Credit check — unified path

The `PreflightCreditCheckDecorator` reads `modelRef` from the request and checks `requiresPlatformCredits` via the catalog:

```ts
runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
  const result = this.inner.runGraph(req, ctx);

  // Catalog-driven: does this model require platform credits?
  // Uses requiresPlatformCredits, NOT "isFree" — BYO models are not free,
  // they just don't cost platform credits.
  if (!this.requiresPlatformCredits(req.modelRef)) {
    return result;
  }

  // Platform credits required: check balance
  const checkPromise = this.checkFn(this.billingAccountId, req.modelRef.modelId, req.messages);
  return {
    stream: this.wrapWithPreflight(result.stream, checkPromise),
    final: checkPromise.then(() => result.final),
  };
}
```

No inline credit checks in schedule routes. The schedule creation route validates that the `modelRef` is valid via the catalog — the catalog knows `requiresPlatformCredits`. Same logic, one place.

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

| File                                                                       | Purpose                                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/graph-execution-core/src/graph-executor.port.ts`                 | `GraphRunRequest` with `modelRef`                                          |
| `apps/operator/src/ports/llm.port.ts`                                      | `LlmService` interface                                                     |
| `apps/operator/src/ports/model-catalog.port.ts`                            | `ModelCatalogPort` (new)                                                   |
| `apps/operator/src/ports/connection-broker.port.ts`                        | `ConnectionBrokerPort` (scoped by actor+tenant, not billing account alone) |
| `packages/ai-core/src/billing/source-system.ts`                            | `SourceSystem` enum                                                        |
| `packages/ai-core/src/usage/usage.ts`                                      | `UsageFact` type                                                           |
| `apps/operator/src/bootstrap/graph-executor.factory.ts`                    | `resolveLlmService` + decorator stack                                      |
| `apps/operator/src/adapters/server/ai/preflight-credit-check.decorator.ts` | Unified credit check                                                       |
| `apps/operator/src/shared/ai/model-catalog.server.ts`                      | `AggregatingModelCatalog` adapter                                          |
| `apps/operator/src/contracts/ai.models.v1.contract.ts`                     | `/api/v1/ai/models` contract                                               |

## Open Questions

- [x] ~~Should `ModelRef.provider` be a fixed union or an open string?~~ **DECIDED: `providerKey: string` (registry key).** Fixed unions become central-edit tax as providers grow. The provider registry holds typed adapter factories; the string key is just a lookup key. Type safety comes from the registry, not the union.
- [ ] Should the `OllamaLlmAdapter` use the OpenAI-compatible endpoint (`/v1/chat/completions`) or Ollama's native API (`/api/chat`)? The former is simpler; the latter supports Ollama-specific features.
- [ ] How should the catalog handle disconnected providers? If a user's Ollama server is offline, should its models still appear (grayed out) or be hidden?
- [x] ~~Should `UsageFact` track BYO runs at all?~~ **DECIDED: Yes.** Track for observability (token counts, latency). Platform cost is $0 but the data is valuable. BYO `usageUnitId` = deterministic `${runId}/${attempt}/byo` for idempotency. **Implemented in task.0212.**

## Related

- [proj.byo-ai](../../work/projects/proj.byo-ai.md) — project roadmap
- [tenant-connections](./tenant-connections.md) — encrypted credential storage
- [graph-execution](./graph-execution.md) — graph execution pipeline
- [architecture](./architecture.md) — system architecture
