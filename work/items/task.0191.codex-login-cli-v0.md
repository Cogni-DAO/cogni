---
id: task.0191
type: task
title: "v0: Codex-native graph executor with ChatGPT subscription auth"
status: done
priority: 1
rank: 10
estimate: 3
summary: "CodexGraphProvider implementing GraphExecutorPort via @openai/codex-sdk. OAuth login script, Codex graphs in UI, credit check bypass for subscription-backed runs. Full unified graph executor path (Temporal, Redis, Langfuse)."
outcome: "Developer selects Codex Poet/Spark graph in chat UI, authenticates via pnpm codex:login, and executes graph runs powered by ChatGPT subscription at $0 marginal cost through the unified graph execution pipeline."
spec_refs: []
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: spike/openai-oauth-byo-ai
pr:
reviewer:
created: 2026-03-22
updated: 2026-03-22
labels: [ai, oauth, byo-ai, cost-control, dev-tooling]
external_refs:
  - docs/research/openai-oauth-byo-ai.md
revision: 0
blocked_by: [spike.0190]
deploy_verified: false
---

## Acceptance Criteria

1. `pnpm codex:login` runs PKCE OAuth flow, opens browser, stores tokens to `.env.local`
2. LiteLLM config includes Codex model entries that use the stored token
3. Token refresh runs automatically if expired when dev server starts
4. `.env.local` entries: `CODEX_ACCESS_TOKEN`, `CODEX_REFRESH_TOKEN`, `CODEX_EXPIRES_AT`, `CODEX_ACCOUNT_ID`
5. Works on macOS (primary dev platform)

## Validation

- [x] `pnpm codex:login` completes OAuth flow
- [x] CodexGraphProvider executes graph via Codex SDK
- [x] Chat UI renders Codex response (codex:poet)
- [x] Thread persisted, Langfuse trace created
- [ ] Automated tests

## PR / Links

- PR: https://github.com/Cogni-DAO/node-template/pull/612
- Handoff: [handoff](../handoffs/task.0191.handoff.md)
