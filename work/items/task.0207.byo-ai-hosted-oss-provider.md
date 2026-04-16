---
id: task.0207
type: task
title: "Run: BYO-AI hosted OSS provider — user connects their OpenAI-compatible endpoint"
status: needs_merge
priority: 3
rank: 30
estimate: 3
summary: "Users connect any OpenAI-compatible LLM endpoint (Ollama, vLLM, llama.cpp, LM Studio) as a BYO-AI provider. One new LlmService adapter, one new ModelProviderPort, zero changes to graph execution or billing."
outcome: "A user with Ollama behind Cloudflare Tunnel can paste their endpoint URL + optional API key on the profile page, select any Cogni graph, and run AI using their own models at $0 platform cost."
spec_refs: [multi-provider-llm]
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: feat/byo-ai-openai-compatible
pr: https://github.com/Cogni-DAO/node-template/pull/645
reviewer:
created: 2026-03-26
updated: 2026-03-27
labels: [ai, byo-ai, oss, self-hosted]
external_refs: []
revision: 0
blocked_by: []
deploy_verified: false
---

## Design

### Outcome

Users connect any OpenAI-compatible LLM endpoint (Ollama, vLLM, llama.cpp, LM Studio) and run Cogni graphs on their own compute at $0 platform cost.

### Research: OSS Landscape

**No turnkey "BYO endpoint connector" exists.** Every platform builds this as custom integration. The pieces exist:

| Layer                             | OSS solution                                                         | Status                    |
| --------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| User-side: expose local server    | Cloudflare Tunnel (free, Ollama-recommended), Tailscale, frp         | User handles this         |
| User-side: OpenAI-compatible API  | Ollama, vLLM, llama.cpp, LM Studio all expose `/v1/chat/completions` | De facto standard         |
| Platform-side: credential storage | `tenant-connections` table with AEAD encryption                      | Already built             |
| Platform-side: provider routing   | `ModelProviderPort` + `ModelProviderResolverPort`                    | Already built (task.0209) |
| Platform-side: model discovery    | Ollama `/api/tags`, vLLM `/v1/models`                                | Need to implement         |

**Wire protocol**: `/v1/chat/completions` is the universal standard. Every local LLM server supports it. The adapter should target this, not Ollama-specific `/api/chat`.

**Security**: Ollama has zero built-in auth. Users are expected to put it behind TLS (Cloudflare Tunnel, reverse proxy) and optionally set an API key (vLLM supports `VLLM_API_KEY`, others use reverse proxy auth). The platform sends `Authorization: Bearer <key>` if the user provides a key.

### Approach

**Solution**: One new `OpenAiCompatibleLlmAdapter implements LlmService` that does `POST /v1/chat/completions` to the user's registered endpoint. One new `OpenAiCompatibleModelProvider implements ModelProviderPort` that discovers models via `GET /v1/models` from the user's endpoint. Connection model: `{ baseUrl, apiKey? }` stored in `connections` table via `ConnectionBrokerPort`.

**Reuses**:

- `ModelProviderPort` contract (task.0209) — register provider, zero execution/billing changes
- `ConnectionBrokerPort` — encrypted credential storage and tenant-scoped resolution
- `LiteLlmAdapter` — same HTTP + SSE parsing pattern, reuse `eventsource-parser`
- `connections` table + profile page connection UI — already built for ChatGPT OAuth
- OpenAI SDK or raw fetch — `/v1/chat/completions` is a trivial HTTP POST

**Rejected**:

- ~~LiteLLM dynamic model registration (`/model/new` API)~~ — operator-managed gateway, not user-self-service. Adds complexity (per-user LiteLLM models) without benefit.
- ~~Ollama-specific `/api/chat` format~~ — locks out vLLM, llama.cpp, LM Studio. The `/v1/chat/completions` standard works everywhere.
- ~~Custom tunnel/proxy component~~ — user handles their own network exposure (Cloudflare Tunnel, Tailscale, etc.). Platform is a plain HTTP client.
- ~~Provider-specific adapters (OllamaAdapter, VllmAdapter)~~ — unnecessary. All expose the same OpenAI-compatible API. One adapter handles all.

### Connection Model

The connection form on profile page collects:

- `endpoint_url`: `https://my-ollama.example.com/v1` (required)
- `api_key`: optional Bearer token

Stored in `connections` table as:

- `provider: "openai-compatible"`
- `credentialType: "api_endpoint"`
- Encrypted credential blob: `{ base_url: "...", api_key: "..." }`

On connect: probe `GET /v1/models` to verify reachability + discover available models.

### Model Discovery

Unlike ChatGPT (hardcoded model list), user-hosted endpoints have dynamic models. The provider calls `GET /v1/models` on the user's endpoint during `listModels()`:

```
GET https://user-endpoint/v1/models
→ { data: [{ id: "llama3:8b", ... }, { id: "mistral:7b", ... }] }
```

This is the OpenAI `/v1/models` standard. Ollama, vLLM, and llama.cpp all support it. Cache with short TTL (30s) since user may load/unload models.

### Security

- **SSRF protection**: In production, validate `endpoint_url` against deny-list (no `localhost`, `127.0.0.1`, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`, link-local). In dev, allow all.
- **Response validation**: Validate response shape (OpenAI format). Don't trust arbitrary JSON from user endpoints.
- **Timeout**: 30s connect, 120s read (user models may be slow on CPU).
- **No secret logging**: Never log API keys or endpoint URLs in user-visible contexts.

### Invariants

- [ ] ONE_ADAPTER_ALL_SERVERS: Single `OpenAiCompatibleLlmAdapter` handles Ollama, vLLM, llama.cpp, LM Studio, and any OpenAI-compatible server (spec: multi-provider-llm / ADAPTER_IMPLEMENTS_PORT)
- [ ] OPENAI_WIRE_PROTOCOL: Uses `/v1/chat/completions` and `/v1/models` — the de facto standard (not Ollama-specific `/api/chat`)
- [ ] BROKER_RESOLVES_CREDS: Adapter receives pre-resolved `{ baseUrl, apiKey }` from ConnectionBrokerPort — never reads env/DB directly (spec: multi-provider-llm / BROKER_RESOLVES_CREDS)
- [ ] SSRF_PROTECTED: Endpoint URL validated against private IP ranges in production (spec: architecture)
- [ ] DYNAMIC_MODEL_DISCOVERY: `listModels()` calls user endpoint `/v1/models`, not hardcoded (unlike CodexModelProvider)
- [ ] PROVIDER_KEY_OPAQUE: `providerKey: "openai-compatible"` — no central type edits needed (spec: multi-provider-llm / PROVIDER_KEY_IS_REGISTRY)
- [ ] SIMPLE_SOLUTION: Reuses existing ModelProviderPort, ConnectionBrokerPort, eventsource-parser, connections table
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal layering — port interface, adapter implementation, container wiring

### Files

- Create: `apps/operator/src/adapters/server/ai/openai-compatible/openai-compatible-llm.adapter.ts` — LlmService impl: HTTP POST to user's `/v1/chat/completions` with SSE streaming
- Create: `apps/operator/src/adapters/server/ai/providers/openai-compatible.provider.ts` — ModelProviderPort impl: dynamic model discovery via `/v1/models`, creates adapter from resolved connection
- Create: `apps/operator/src/adapters/server/ai/openai-compatible/ssrf-guard.ts` — URL validation against private IP ranges
- Modify: `apps/operator/src/adapters/server/ai/providers/index.ts` — export new provider
- Modify: `apps/operator/src/bootstrap/container.ts` — register `OpenAiCompatibleModelProvider` in providers array
- Modify: `apps/operator/src/app/(app)/profile/view.tsx` — add "Connect OpenAI-Compatible Endpoint" section (URL + API key form)
- Test: `apps/operator/tests/unit/adapters/server/ai/openai-compatible/openai-compatible-llm.adapter.spec.ts` — completion, streaming, error handling, timeout
- Test: `apps/operator/tests/unit/adapters/server/ai/openai-compatible/ssrf-guard.spec.ts` — private IP rejection
- Test: `apps/operator/tests/unit/adapters/server/ai/providers/openai-compatible.provider.spec.ts` — model discovery, provider contract

### User Documentation

Tell users: "Expose your Ollama/vLLM/llama.cpp server with Cloudflare Tunnel (free), then paste the URL on your profile page." Link to Ollama's own Cloudflare Tunnel docs.

## Validation

- [ ] User connects Ollama endpoint on profile page
- [ ] `GET /v1/models` probe succeeds on connect
- [ ] Any graph executes using user's hosted model
- [ ] Streaming works through user's endpoint
- [ ] Graceful error when endpoint is unreachable
- [ ] SSRF protection prevents internal IP targeting in production
