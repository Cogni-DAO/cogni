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

- [ ] OAuth PKCE flow on profile page: "Connect ChatGPT" button (same UX as GitHub/Discord/Google linking)
- [ ] `provider_credentials` DB table with AES-256-GCM encrypted token storage
- [ ] `connectionId` abstraction: graph executor receives opaque ref, never raw tokens
- [ ] `CredentialBrokerPort`: resolves connectionId → decrypted tokens, handles refresh
- [ ] Codex app-server sidecar with `chatgptAuthTokens` auth mode (host-managed tokens, in-memory)
- [ ] Host-managed token refresh: pre-execution expiry check + reactive `chatgptAuthTokens/refresh` on 401
- [ ] Disconnect flow (remove credentials)

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
- Codex app-server (v1, `chatgptAuthTokens` host-managed auth mode)
- Node.js `crypto` (AES-256-GCM for token encryption)

## As-Built Specs

- docs/research/openai-oauth-byo-ai.md

## Design Notes

- The Codex SDK wraps `codex exec` as a subprocess, communicating via JSONL over stdio
- Platform-specific Rust binaries (optional deps) may not install under pnpm; the JS CLI fallback works identically via `codexPathOverride`

## Key Decisions

- **Codex is a graph executor, not a model provider** — no LiteLLM, no ChatOpenAI shim
- **v0 uses file-backed auth** — single trusted runner pattern, explicitly not multi-tenant
- **v1 uses connectionId + credential broker + app-server `chatgptAuthTokens`** — graph executor receives opaque connectionId, broker resolves to tokens, app-server sidecar handles runtime auth (host-managed, in-memory only)
- **Credit check skipped for `codex:` graphs** — billing is handled by OpenAI, not our ledger
