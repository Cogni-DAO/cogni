---
id: task.0029.handoff
type: handoff
work_item_id: task.0029
status: active
created: 2026-02-12
updated: 2026-02-13
branch: feat/billing-callback-fix
last_commit: 2b06ff60
---

# Handoff: Callback-driven billing — LiteLLM generic_api webhook (PR #399)

## Context

- **bug.0037 (P0):** Gateway streaming LLM calls record $0 cost. Streaming SSE responses don't include cost headers — proxy-based billing is architecturally broken for streaming.
- **The fix:** LiteLLM's `generic_api` callback fires POST with `StandardLoggingPayload[]` after stream completion, carrying full cost data. A new internal ingest endpoint receives the callback and writes charge receipts via `commitUsageFact()`.
- **PR #399** is open against `staging` with 11 commits. Core implementation is complete: ingest endpoint, LiteLLM config, contract test, stack test, env propagation, and closeout all done.
- **Follow-up filed:** task.0048 tracks sub-agent billing attribution (per-session headers can't distinguish sub-agent calls within a run).

## Current State

- **Implementation complete.** Ingest endpoint, contract + stack tests, LiteLLM config, docker-compose env vars, CI env propagation — all committed.
- **PR #399 open** — all commits pushed. Branch merged up from `staging` (includes `feat(gov)` #398).
- **OpenClaw skills sync complete** — all 26 `.claude/commands/` skills synced to `.openclaw/skills/` in `e372e775`.
- **Deploy dependency:** `BILLING_INGEST_TOKEN` must be added as a GitHub Actions secret before production deploy. See `scripts/setup/SETUP_DESIGN.md`.

## Decisions Made

1. **BILLING_NEVER_THROWS.** Removed `APP_ENV === "test"` re-throw from `billing.ts`. Billing catches all errors — identical behavior in test and production. See commit `5f9da44d`.
2. **Idempotency via source_reference.** InProc/Sandbox callbacks match old path's `source_reference` (duplicate = no-op). Gateway callbacks use `litellm_call_id` as fallback `runId` → different `source_reference` → coexists with old $0 receipt. See `src/app/api/internal/billing/ingest/route.ts`.
3. **Old billing path coexists.** No adapter changes or deletions in this PR. Callback path proven correct before old path is stripped in a follow-up.
4. **Spec:** `docs/spec/billing-ingest.md` is the authoritative reference for the ingest contract.

## Next Actions

- [ ] **Push to remote** — `git push` to update PR #399
- [ ] **Add BILLING_INGEST_TOKEN to GitHub Secrets** — required before production deploy (human action)
- [ ] **Merge PR #399** when CI passes

## Risks / Gotchas

- **Batched payloads:** LiteLLM sends arrays — sometimes 2+ entries per POST. Endpoint iterates.
- **Gateway `run_id` gap:** Gateway calls have `spend_logs_metadata: null`. Fallback `runId = litellm_call_id` avoids collisions with old path. Fix requires OpenClaw outboundHeaders change.
- **`model_group` vs `model`:** Use `model_group` for user-facing alias. `model` is the provider path.
- **CI env blocks:** `ci.yaml` has 4 separate `env:` blocks — all must include new vars or `serverEnv()` validation fails.

## Pointers

| File / Resource                                               | Why it matters                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `docs/spec/billing-ingest.md`                                 | Authoritative spec — contract, invariants, architecture      |
| `work/items/task.0029.callback-driven-billing-*.md`           | Work item — scope, acceptance criteria, plan                 |
| `src/app/api/internal/billing/ingest/route.ts`                | Ingest endpoint — bearer auth, Zod validate, commitUsageFact |
| `src/contracts/billing-ingest.internal.v1.contract.ts`        | Zod contract for StandardLoggingPayload                      |
| `src/features/ai/services/billing.ts`                         | `commitUsageFact()` + BILLING_NEVER_THROWS                   |
| `platform/infra/services/runtime/configs/litellm.config.yaml` | `generic_api` in `success_callback`                          |
| `work/items/task.0048.subagent-billing-attribution.md`        | Follow-up: sub-agent billing tracking                        |
| PR #399                                                       | `https://github.com/Cogni-DAO/node-template/pull/399`        |
