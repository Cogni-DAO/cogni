---
id: proj.byo-ai
type: project
primary_charter:
title: "BYO-AI: Bring Your Own LLM Provider"
state: Active
priority: 1
estimate: 8
summary: "Users connect their own LLM backends (ChatGPT subscription, Ollama, future providers) to power any Cogni graph at $0 platform cost. Swap happens at LlmService level — graph logic unchanged."
outcome: "Any Cogni graph runs on any connected LLM backend. Provider selection is a first-class config choice, not an override."
assignees: [derekg1729]
created: 2026-03-22
updated: 2026-03-26
labels: [ai, oauth, byo-ai, cost-control]
---

# BYO-AI: Bring Your Own LLM Provider

## Goal

Users connect their own LLM backends to power Cogni graph execution. The LLM provider is a first-class configuration choice on every graph run — not a hack, not an override. Any graph, any backend, same graph logic.

## Current State (as-built, 2026-03-26)

### What works

- **ChatGPT OAuth** — profile page connect flow (PKCE + paste-back, works local + cloud)
- **CodexLlmAdapter implements LlmService** — swaps LLM backend via `ExecutionScope.llmServiceOverride`
- **UI provider toggle** — OpenRouter / ChatGPT in ModelPicker, with ChatGPT model list
- **Chat + Schedules** — both pass `modelConnectionId` through the full pipeline
- **Credit check skip** — BYO runs bypass preflight credit check via `req.modelConnectionId`
- **Billing skip** — BYO runs skip `usage_report` (no `litellmCallId`, no platform cost)

### What's wrong (technical debt from crawl)

The current architecture has **split authority** — multiple places make the same decision independently:

```
WHERE "is this model valid?" IS DECIDED:
  1. ModelPicker.tsx         — hardcoded CHATGPT_MODELS array
  2. ChatComposerExtras.tsx  — validates against CHATGPT_MODELS + OpenRouter list
  3. model-catalog.server.ts — isModelAllowed() checks CHATGPT_MODEL_IDS set
  4. model-catalog.server.ts — isModelFree() checks CHATGPT_MODEL_IDS set
  5. model-catalog.server.ts — isModelFreeFromCache() checks CHATGPT_MODEL_IDS set

WHERE "should this run pay credits?" IS DECIDED:
  1. schedules/route.ts      — inline isModelFree() check at schedule creation
  2. preflight-credit-check  — req.modelConnectionId check at execution time

WHERE "which LLM backend?" IS DECIDED:
  1. graph-executor.factory   — checks req.modelConnectionId, resolves broker
  2. inproc-completion-unit   — reads scope.llmServiceOverride
  3. The model ID itself      — ChatGPT model IDs only work on Codex transport
```

This means: 3 hardcoded `CHATGPT_MODEL_IDS` sets, 2 credit check paths, and the "override" framing treats BYO as an exception rather than a first-class provider.

## Proper Design (next phase)

### Principle: One authority per decision

| Decision                                  | Authority                                                          | Where                                                               |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| What models can this user select?         | `ModelCatalogPort`                                                 | Server — `/api/v1/ai/models` returns unified list from ALL backends |
| Does this model require platform credits? | `ModelCatalogPort` — `requiresPlatformCredits` field on each model | Same unified list                                                   |
| Which LLM backend handles this model?     | `ModelRef.providerKey` field (registry key)                        | Set at selection time, carried on `GraphRunRequest`                 |
| What credentials does this backend need?  | `ConnectionBrokerPort`                                             | Resolves `connectionId` to provider-specific credentials            |
| What can this model do?                   | `ModelOption.capabilities`                                         | Catalog declares streaming, tools, structuredOutput, vision         |

### ModelRef — typed model selection

Replace `model: string` + `modelConnectionId?: string` with one typed reference:

```ts
// Lives in @cogni/ai-core — shared across packages
type ModelRef = {
  providerKey: string; // registry key, NOT a fixed union
  modelId: string;
  connectionId?: string; // required for non-platform providers
};
```

`GraphRunRequest` carries `modelRef: ModelRef` instead of separate fields. The factory routes to the correct `LlmService` adapter via a **provider registry** keyed by `providerKey`. No "override" — it's the configured provider. `providerKey` is an opaque string — adding a new provider means registering one factory, not editing a central union type.

**MODELREF_FULLY_RESOLVED**: The `ModelRef` on `GraphRunRequest` is the exact selection from the user. No executor may infer, default, or rewrite it. Schedules persist the exact `ModelRef`, not "re-resolve whatever default is current."

### ModelCatalogPort — unified model authority

```ts
interface ModelCatalogPort {
  listModels(params: {
    userId: string;
    billingAccountId: string;
    requiredCapabilities?: Partial<ModelCapabilities>;
  }): Promise<{ models: ModelOption[]; defaultRef: ModelRef | null }>;
}

type ModelOption = {
  ref: ModelRef;
  label: string;
  requiresPlatformCredits: boolean; // NOT "isFree" — BYO models are not free
  providerLabel: string;
  capabilities: ModelCapabilities;
};

type ModelCapabilities = {
  streaming: boolean;
  tools: boolean;
  structuredOutput: boolean;
  vision: boolean;
};
```

The `/api/v1/ai/models` endpoint calls `ModelCatalogPort.listModels()` which aggregates:

- Platform models from LiteLLM `/model/info` — `requiresPlatformCredits: true`
- ChatGPT models (if user has active `openai-chatgpt` connection) — `requiresPlatformCredits: false`
- Ollama models (if user has connected Ollama endpoint — future) — `requiresPlatformCredits: false`

The UI renders what the server returns. **No hardcoded model arrays in React.**

### LlmService adapters — provider registry

```
Provider Registry (Map<string, LlmServiceFactory | LlmService>)
  "platform" → LiteLlmAdapter singleton
  "chatgpt"  → (conn) => new CodexLlmAdapter(conn)
  "ollama"   → (conn) => new OllamaLlmAdapter(conn)    (future)
```

The factory resolves via registry lookup — no switch statement, open for extension:

```ts
async function resolveLlmService(
  ref: ModelRef,
  broker,
  actorId,
  billingAccountId
): Promise<LlmService> {
  const entry = providerRegistry.get(ref.providerKey);
  if (!entry) throw new Error(`Unknown provider: ${ref.providerKey}`);
  if (typeof entry !== "function") return entry; // singleton
  const conn = await broker.resolve(ref.connectionId!, {
    actorId,
    billingAccountId,
  });
  return entry(conn);
}
```

No `ExecutionScope.llmServiceOverride`. No special-case checks. The provider is resolved from the request config.

### Credit check — one path

The `PreflightCreditCheckDecorator` checks `requiresPlatformCredits` from the catalog. If `false`, skip. If `true`, check credits. One check, one authority.

The schedule creation route uses the same `requiresPlatformCredits` from the catalog response — no separate `isModelFree()` function call.

## Roadmap

### Done — Crawl (local dev, working)

- [x] CodexLlmAdapter implements LlmService
- [x] ExecutionScope.llmServiceOverride wiring
- [x] ChatGPT OAuth (PKCE + paste-back, profile page)
- [x] UI provider toggle in ModelPicker
- [x] Credit check skip for BYO runs
- [x] Billing skip (no usage_report for BYO)
- [x] Chat + Schedules pass modelConnectionId
- [x] connections table + AEAD + DrizzleConnectionBrokerAdapter

### Next — Clean up split authority (task.0209)

- [ ] Define `ModelRef` + `ModelCapabilities` in `@cogni/ai-core` (package-level type)
- [ ] Implement `ModelCatalogPort` with capability filtering — server-side unified model list
- [ ] `/api/v1/ai/models` aggregates platform + ChatGPT models (based on user connections)
- [ ] Remove `CHATGPT_MODELS` const from ModelPicker — render from API only
- [ ] Remove `CHATGPT_MODEL_IDS` set from model-catalog.server.ts
- [ ] Replace `model: string` + `modelConnectionId?: string` with `ModelRef` on `GraphRunRequest`
- [ ] Provider registry + `resolveLlmService` from `providerKey` — no override pattern, no switch
- [ ] Rename `isFree` → `requiresPlatformCredits` everywhere
- [ ] One credit check path using catalog `requiresPlatformCredits`
- [ ] Remove schedule route inline credit check — use decorator only
- [ ] Widen `ConnectionBrokerPort.resolve()` scope to `{ actorId, billingAccountId }`
- [ ] MODELREF_FULLY_RESOLVED: schedules persist exact `ModelRef`, no re-resolution

### Future — Ollama / hosted OSS (task.0207)

- [ ] `OllamaLlmAdapter implements LlmService` — HTTP POST to user's endpoint
- [ ] Profile page "Connect Ollama" — user enters endpoint URL
- [ ] `ModelCatalogPort` fetches models from Ollama `/api/tags` endpoint
- [ ] SSRF protection for user-provided URLs

### Future — Multi-provider production

- [ ] Codex app-server with `chatgptAuthTokens` (host-managed, replaces subprocess)
- [ ] Token refresh via broker (pre-execution expiry check)
- [ ] Spend limits and usage dashboards per connection
- [ ] Organization-level connection sharing

## Execution Paths (as-built → target)

```
Chat:      UI → chat/route → facade → Temporal → internal/route → factory → decorator stack → graph → LlmService
Schedule:  UI → schedules/route → Temporal schedule → workflow → internal/route → factory → decorator stack → graph → LlmService

Decorator stack (inside-out):
  BillingEnrichment → BillingValidator → PreflightCreditCheck → Observability

LlmService dispatch (as-built — BEING REPLACED):
  factory checks modelConnectionId → broker.resolve() → CodexLlmAdapter → codex exec
  OR
  factory no modelConnectionId → LiteLlmAdapter → LiteLLM → OpenRouter

LlmService dispatch (target — task.0209):
  factory reads modelRef.providerKey → providerRegistry.get(key)
    → singleton (platform) → LiteLlmAdapter
    → factory fn (chatgpt) → broker.resolve() → CodexLlmAdapter
    → factory fn (ollama)  → broker.resolve() → OllamaLlmAdapter
  No ambient llmServiceOverride. No switch. No inference.
```

## Constraints

- ChatGPT subscription tokens work with Codex Responses API only (not api.openai.com)
- Public OAuth client ID locked to `redirect_uri=http://localhost:1455/auth/callback` — paste-back flow for cloud
- `codex exec` subprocess has ~2s cold start per LLM call
- codex exec does not stream incrementally — text arrives in burst at turn completion

## Dependencies

- @openai/codex-sdk, @openai/codex (SDK + CLI)
- @mariozechner/pi-ai (OAuth login flow for CLI, not used in web flow)
- spec.tenant-connections (connections table, AEAD)

## As-Built Specs

- docs/research/openai-oauth-byo-ai.md
- docs/spec/tenant-connections.md

## Design Notes

- `LlmService` port is a crawl-step seam, not the final abstraction — will evolve as provider semantics diverge
- The "override" pattern (`ExecutionScope.llmServiceOverride`) should be replaced with explicit provider resolution from `ModelRef`
- OpenAI does NOT offer self-service OAuth client registration — the paste-back flow is the documented VPS/remote pattern
