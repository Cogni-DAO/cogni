---
id: proj.byo-ai
type: project
primary_charter:
title: "BYO-AI: Bring Your Own AI Subscription"
state: Active
priority: 1
estimate: 8
summary: "Enable users to connect their own AI provider subscriptions (starting with OpenAI Codex/ChatGPT) for $0 marginal cost graph execution, using Codex-native transport — not a generic OpenAI-compatible shim."
outcome: "Users authenticate with their ChatGPT subscription via OAuth, select Codex graphs in the chat UI, and execute graph runs powered by their own subscription. Platform credits not consumed for BYO-AI runs."
assignees: [derekg1729]
created: 2026-03-22
updated: 2026-03-23
labels: [ai, oauth, byo-ai, cost-control, codex]
---

# BYO-AI: Bring Your Own AI Subscription

## Goal

Let users bring their own AI provider subscriptions to power graph execution. Starting with OpenAI Codex (ChatGPT Plus/Pro), users connect their account via OAuth and run graphs at $0 marginal cost using their subscription quota.

## Architecture

Codex is a **separate graph executor**, not a model swap behind LiteLLM. The `CodexGraphProvider` implements `GraphExecutorPort` and uses the `@openai/codex-sdk` to call the Codex-native transport (WebSocket + Responses API to ChatGPT backend). This matches OpenAI's SDK design: "building Codex into your own internal tools and workflows."

```
codex: namespace → CodexGraphProvider → @openai/codex-sdk → codex CLI → ChatGPT backend
```

## Roadmap

### Crawl (v0) — Local Dev Experiment (DONE)

- [x] OAuth login script (`pnpm codex:login`) — PKCE flow via `@mariozechner/pi-ai`
- [x] `CodexGraphProvider` implementing `GraphExecutorPort`
- [x] Codex graphs in UI picker (`codex:poet`, `codex:spark`)
- [x] Credit check bypass for `codex:` namespace
- [x] Full unified graph executor path (Temporal, Redis, Langfuse, thread persistence)
- Auth: file-backed `~/.codex/auth.json`, single trusted runner

### Walk (v1) — Per-Tenant BYO-AI

- [ ] OAuth flow in web UI: "Connect your ChatGPT account" in settings
- [ ] `provider_credentials` DB table with encrypted token storage
- [ ] Codex app-server sidecar with `chatgptAuthTokens` for host-managed multi-user auth
- [ ] Per-tenant auth resolution in `CodexGraphProvider`
- [ ] Token refresh via `account/chatgptAuthTokens/refresh` JSON-RPC
- [ ] Usage tracking per-tenant (Codex usage API)

### Run (v2) — Multi-Provider BYO

- [ ] Anthropic, Google provider support
- [ ] Provider-agnostic credential management
- [ ] Spend limits and usage dashboards
- [ ] Organization-level key sharing

## Constraints

- v0 is single trusted runner only — no multi-tenant auth on file-backed credentials
- Codex subscription tokens cannot call api.openai.com (missing model.request scope)
- ChatGPT backend requires Codex-native transport (WebSocket + Responses API)

## Dependencies

- @openai/codex-sdk (TypeScript SDK)
- @openai/codex (CLI binary)
- @mariozechner/pi-ai (OAuth login flow)
- Codex app-server (v1, for chatgptAuthTokens multi-user auth)

## As-Built Specs

- docs/research/openai-oauth-byo-ai.md

## Design Notes

- The Codex SDK wraps `codex exec` as a subprocess, communicating via JSONL over stdio
- Platform-specific Rust binaries (optional deps) may not install under pnpm; the JS CLI fallback works identically via `codexPathOverride`

## Key Decisions

- **Codex is a graph executor, not a model provider** — no LiteLLM, no ChatOpenAI shim
- **v0 uses file-backed auth** — single trusted runner pattern, explicitly not multi-tenant
- **v1 uses Codex app-server `chatgptAuthTokens`** — host supplies per-user tokens, not temp auth.json files
- **Credit check skipped for `codex:` graphs** — billing is handled by OpenAI, not our ledger
