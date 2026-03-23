---
id: task.0192
type: task
title: "v1: Per-tenant BYO-AI with Codex app-server chatgptAuthTokens"
status: needs_design
priority: 2
rank: 15
estimate: 5
summary: "Enable deployed app users to connect their own ChatGPT subscription via OAuth in the web UI. Use Codex app-server sidecar with chatgptAuthTokens for host-managed multi-user auth. Encrypted credential storage in provider_credentials table."
outcome: "Any authenticated user can link their ChatGPT account in settings, select Codex graphs, and run AI at $0 using their own subscription. Host manages token refresh via app-server JSON-RPC."
spec_refs: []
assignees: []
credit:
project: proj.byo-ai
branch:
pr:
reviewer:
created: 2026-03-23
updated: 2026-03-23
labels: [ai, oauth, byo-ai, codex, multi-tenant]
external_refs:
  - docs/research/openai-oauth-byo-ai.md
revision: 0
blocked_by: [task.0191]
deploy_verified: false
---

## Design Requirements

1. **OAuth flow in web UI** — "Connect ChatGPT" button in account settings
2. **Credential storage** — `provider_credentials` table with encrypted access/refresh tokens per billing_account_id
3. **Codex app-server sidecar** — long-running process with `chatgptAuthTokens` auth mode
4. **Host-managed token refresh** — respond to `account/chatgptAuthTokens/refresh` JSON-RPC
5. **CodexGraphProvider v1 backend** — resolves tenant token from DB, supplies to app-server
6. **No file-backed auth** — v0 pattern does not scale; use app-server's in-memory token model

## Validation

- [ ] User connects ChatGPT account via browser OAuth in settings page
- [ ] Tokens encrypted at rest in provider_credentials
- [ ] Codex graphs execute using the user's own subscription
- [ ] Token refresh works transparently when tokens expire
- [ ] Multiple concurrent users with different subscriptions work
