---
id: spike.0190
type: spike
title: "Research OpenAI Codex OAuth & BYO-AI integration"
status: done
priority: 1
estimate: 1
summary: "Research OpenClaw's OpenAI Codex OAuth implementation, understand the PKCE flow, credential storage, and token refresh. Determine how to adopt into cogni-template for v0 (dev experiment) and v1 (per-tenant BYO-AI)."
outcome: "Complete mapping of OpenClaw OAuth flow (client ID, endpoints, JWT account extraction, token refresh). Two-phase plan: v0 CLI login script using @mariozechner/pi-ai, v1 server-side OAuth redirect with per-tenant credential storage. Open questions documented around redirect URI restrictions and LiteLLM Codex transport support."
spec_refs: []
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: spike/openai-oauth-byo-ai
pr:
reviewer:
created: 2026-03-22
updated: 2026-03-22
labels: [ai, oauth, byo-ai, cost-control]
external_refs:
  - docs/research/openai-oauth-byo-ai.md
revision: 0
blocked_by: []
deploy_verified: false
rank: 99
---

## Research Question

How does OpenClaw implement OpenAI Codex OAuth, and how can we adopt it into cogni-template?

## Key Findings

See [docs/research/openai-oauth-byo-ai.md](../../docs/research/openai-oauth-byo-ai.md) for full analysis.

### TL;DR

- OpenAI Codex OAuth uses standard PKCE flow with public client ID `app_EMoamEEZ73f0CkXaXp7hrann`
- Auth endpoints: `auth.openai.com/oauth/authorize` and `auth.openai.com/oauth/token`
- Access tokens are JWTs containing `chatgpt_account_id` at claim `https://api.openai.com/auth`
- API base: `https://chatgpt.com/backend-api` (non-standard)
- npm package `@mariozechner/pi-ai` provides ready-to-use `loginOpenAICodex()` function
- v0: CLI login script stores tokens locally for dev use
- v1: Server-side OAuth redirect flow with encrypted per-tenant credential storage

## Validation

- Research document reviewed and complete at docs/research/openai-oauth-byo-ai.md
- Follow-up task.0191 created for v0 implementation
