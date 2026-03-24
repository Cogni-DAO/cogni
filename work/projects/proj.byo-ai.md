---
id: proj.byo-ai
type: project
primary_charter:
title: "BYO-AI: Bring Your Own AI Subscription"
state: Active
priority: 1
estimate: 8
summary: "Users connect their own LLM subscriptions (starting with ChatGPT) to power any Cogni graph at $0 platform cost. LLM provider auth — not external agent runtime."
outcome: "Users link ChatGPT on profile. Any Cogni graph runs on their subscription. ConnectionBrokerPort provides unified credential resolution for BYO provider auth and future tool auth."
assignees: [derekg1729]
created: 2026-03-22
updated: 2026-03-24
labels: [ai, oauth, byo-ai, cost-control, codex]
---

# BYO-AI: Bring Your Own AI Subscription

## Goal

Let users bring their own LLM subscriptions to power Cogni graph execution. Starting with ChatGPT Plus/Pro, users connect via OAuth and run any Cogni graph at $0 marginal cost using their own subscription.

## Important Distinction

| Concept                  | Description                                                                  | This project?            |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------ |
| **BYO LLM provider**     | ChatGPT subscription tokens powering LLM completions for Cogni graphs        | Yes                      |
| **External Codex agent** | Spawning Codex agent containers as an external runtime (sandbox, CLI, files) | No — separate capability |

BYO-AI is about **LLM provider auth**: the user's ChatGPT subscription becomes an alternative completion backend for Cogni's own LangGraph-based graphs. The graph logic runs in our runtime; only the LLM calls route differently.

## Core Principles

1. **Graph identity orthogonal to LLM backend.** No "codex graphs." Any Cogni graph runs on any backend. `modelConnectionId` determines the backend, not the graph name.

2. **Typed connection references.** `modelConnectionId` (which LLM backend) is separate from `toolConnectionIds` (which tool credentials). Different resolution semantics, no ambiguity.

3. **No credit bypass — stack ordering.** BYOExecutorDecorator sits inside the credit check in the decorator stack. If BYO handles the run, the inner platform executor never fires. No bypass flag needed.

4. **Isolated app-server state.** Do not assume one shared app-server can multiplex users. Isolate per tenant until proven otherwise.

## Architecture

```
Any Cogni graph + modelConnectionId    -> BYOExecutorDecorator -> broker -> ChatGPT (user)
Any Cogni graph + no modelConnectionId -> Standard executor    -> LiteLLM/OpenRouter (platform)
```

`ConnectionBrokerPort` resolves credentials for both BYO provider auth (this project) and tool auth (tenant-connections project). One port, typed returns, provider-specific refresh logic.

## Roadmap

### Crawl (v0) — Local Dev Experiment (DONE)

- [x] OAuth login script (`pnpm codex:login`) — PKCE flow
- [x] `CodexGraphProvider` implementing `GraphExecutorPort` (v0 proof-of-concept)
- [x] Full unified execution path (Temporal, Redis, Langfuse, thread persistence)
- Auth: file-backed `~/.codex/auth.json`, single trusted runner
- `codex:` namespace was a v0 hack — removed in v1

### Walk (v1) — Per-Tenant BYO-AI

- [ ] `connections` table (spec.tenant-connections schema, AEAD blob, AAD binding)
- [ ] `ConnectionBrokerPort` — unified credential resolution with typed returns
- [ ] `BYOExecutorDecorator` — intercepts on `modelConnectionId`, routes to ChatGPT completion backend
- [ ] Remove `codex:` namespace — no codex-specific graphs
- [ ] Typed refs: `modelConnectionId` + `toolConnectionIds` on `GraphRunRequest`
- [ ] OAuth PKCE flow on profile page: "Connect ChatGPT"
- [ ] ChatGPT completion backend via `codex exec` subprocess (proven in v0, naturally isolated)
- [ ] Token refresh via broker (pre-execution expiry check)
- [ ] Stack ordering eliminates credit bypass logic

### Run (v2) — Multi-Provider BYO

- [ ] Anthropic, Google provider support (same broker, new refresh adapters)
- [ ] Spend limits and usage dashboards per connection
- [ ] Organization-level connection sharing

## Constraints

- ChatGPT subscription tokens work with Codex Responses API only (not api.openai.com)
- v1 uses `codex exec` subprocess (~2s cold start per execution). App-server is a v2 performance optimization.
- Public OAuth client ID may not accept non-localhost redirect URIs (spike needed)

## Dependencies

- @openai/codex-sdk, @openai/codex (SDK + CLI for ChatGPT Responses API)
- @mariozechner/pi-ai (OAuth login flow)
- spec.tenant-connections (connections table schema, AEAD invariants)

## As-Built Specs

- docs/research/openai-oauth-byo-ai.md
- docs/spec/tenant-connections.md

## Design Notes

- The Codex SDK wraps `codex exec` as a subprocess (JSONL over stdio)
- Platform-specific Rust binaries may not install under pnpm; JS CLI fallback works via `codexPathOverride`
- ChatGPT Responses API uses WebSocket transport — not standard OpenAI chat completions

## Key Decisions

- **LLM provider, not agent runtime** — BYO-AI = ChatGPT subscription for completions, not spawning Codex containers
- **Graph identity orthogonal to backend** — no `codex:` namespace
- **Typed connection refs** — `modelConnectionId` (LLM) + `toolConnectionIds` (tools), not untyped array
- **No credit bypass** — stack ordering handles billing naturally
- **ConnectionBrokerPort built now** — serves BYO and future tool auth
- **`codex exec` subprocess for v1** — proven, isolated per-request. App-server is a v2 optimization.
- **`connections` table from spec.tenant-connections** — one table, AEAD encryption, AAD binding
