---
id: task.0211
type: task
title: "BYO-AI ChatGPT — auth manager + Codex CLI in Docker image"
status: needs_design
priority: 2
rank: 20
estimate: 3
summary: "Add Codex CLI to production Docker image and build per-connection auth serialization. ChatGPT subscription tokens require the Codex CLI (not raw API calls) — separate billing platform. Concurrent graph runs per connection need serialized auth access or a centralized auth manager."
outcome: "ChatGPT-backed graph runs work in Docker deployments. Multiple users can run concurrently. Single-user concurrent runs are serialized per connectionId to prevent auth state corruption."
spec_refs: [spec.tenant-connections, multi-provider-llm]
assignees: []
credit:
project: proj.byo-ai
branch:
pr:
reviewer:
created: 2026-03-27
updated: 2026-03-27
labels: [ai, oauth, byo-ai, infrastructure]
external_refs:
  - work/items/task.0192.byo-ai-per-tenant-codex.md
  - work/items/task.0210.byo-ai-chatgpt-v0-hardening.md
revision: 1
blocked_by: []
deploy_verified: false
---

## Context

The `CodexLlmAdapter` spawns the `codex` CLI binary per LLM call. This works locally (devDependency) but fails in Docker (`ENOENT`). A naive HTTP adapter swap (`OpenAiCompatibleLlmAdapter` → `api.openai.com`) may not work because **ChatGPT subscriptions and API billing are separate platforms** — the OAuth access token from the device code flow may not be accepted by `/v1/chat/completions`.

Additionally, the Codex CLI manages auth state (token refresh, session persistence) that raw API calls don't handle. OpenAI's Codex auth docs are explicit: only one serialized job stream should use a given auth.json copy at a time.

With Temporal workers executing graph runs, concurrent runs for the same connection would race on auth state mutation.

## Requirements

### P0 — Codex CLI in Docker (unblock preview/prod)

- Add `@openai/codex` to production dependencies (or a separate execution image)
- Ensure the `codex` binary is available in the app container's PATH
- Verify the adapter's temp-dir auth isolation pattern works in the container

### P1 — Per-connection serialization

- Serialize all Codex-backed graph runs per `connectionId`
- Different users/connections run in parallel; same connection runs sequentially
- Implementation options:
  - Temporal: use a per-connection workflow ID with max-concurrent-1
  - In-process: semaphore map keyed by connectionId (only works single-instance)

### P2 — Auth manager (future)

Split auth ownership from execution:

1. **Auth manager** per connection owns the canonical auth blob, handles refresh
2. **Workers** get a read-only token snapshot for execution
3. On 401, workers request refresh from auth manager, then retry
4. This enables true concurrency: N workers share one connection safely

This matches OpenAI's "externally managed token mode" where the host owns auth lifecycle.

## Key Constraints

- **CHATGPT_NOT_API**: ChatGPT subscription tokens go through Codex transport, not standard OpenAI API. Don't assume `/v1/chat/completions` works with OAuth tokens.
- **SERIALIZE_PER_CONNECTION**: One connection = one serialized job stream for auth safety
- **TEMP_AUTH_CLEANUP**: Each run's temp auth dir must be cleaned up (already implemented)
- **TOKENS_NEVER_LOGGED**: Auth blobs must not appear in logs or error messages

## Open Questions

- Does the ChatGPT OAuth access token actually work with `/v1/chat/completions`? If yes, the HTTP adapter is simpler and avoids the CLI dependency entirely. Needs empirical testing.
- Should the Codex CLI live in the app container or a separate execution sidecar?
- For Temporal: per-connection workflow ID vs. activity-level mutex?

## Validation

- [ ] `codex` binary available in Docker container PATH
- [ ] ChatGPT chat works in preview deployment (connect → select model → send message → get response)
- [ ] Two concurrent graph runs for different connections execute in parallel
- [ ] Two concurrent graph runs for same connection serialize (no auth corruption)
- [ ] `pnpm check` passes

## Files

- Modify: `apps/operator/Dockerfile` — add `@openai/codex` to production dependencies or install separately
- Modify: `apps/operator/src/adapters/server/ai/codex/codex-llm.adapter.ts` — fix binary path resolution for Docker
- Create: per-connection serialization mechanism (location TBD based on approach)
- Modify: `apps/operator/src/bootstrap/graph-executor.factory.ts` — integrate serialization
