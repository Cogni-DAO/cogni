---
id: task.0029.handoff
type: handoff
work_item_id: task.0029
status: active
created: 2026-02-12
updated: 2026-02-13
branch: feat/billing-callback-fix
last_commit: 746d3bf9
---

# Handoff: Callback-driven billing — P0 MVP (ingest endpoint + LiteLLM config)

## Context

- **bug.0037 (P0):** All gateway streaming LLM calls record $0 cost. Root cause: streaming SSE responses don't include cost in nginx response headers. The proxy-based billing pipeline is architecturally broken for streaming.
- **The fix:** LiteLLM's `generic_api` callback fires AFTER stream completion with full cost data. A new internal ingest endpoint receives the callback and writes charge receipts via existing `commitUsageFact()`.
- **P0 scope is narrow:** Ingest endpoint (step 1) + LiteLLM callback config (step 2). Old billing path coexists — idempotency prevents double-billing for InProc/Sandbox; Gateway gets new correct receipts alongside old $0 receipts.
- **No adapter changes, no decorator changes, no deletions** in P0. Prove the callback path works before removing the old one.

## Current State

- **Branch `feat/billing-callback-fix`** created from `staging`. One commit (handoff archive).
- **Ingest endpoint implemented** (uncommitted, passing typecheck):
  - `src/shared/env/server.ts` — `BILLING_INGEST_TOKEN` added (Zod, min 32 chars)
  - `src/contracts/billing-ingest.internal.v1.contract.ts` — Zod schema matching verified `StandardLoggingPayload`
  - `src/app/api/internal/billing/ingest/route.ts` — bearer auth, Zod validate array, resolve billing account, `commitUsageFact()` per entry
- **Billing env-branching removed** (uncommitted): deleted `APP_ENV === "test"` re-throw from both `recordBilling()` and `commitUsageFact()` in `billing.ts`. New invariant: **BILLING_NEVER_THROWS** — billing catches all errors and logs, never re-throws, identical behavior in test and production.
- **Not yet done:**
  - `pnpm check` not yet run on uncommitted changes (typecheck passes)
  - LiteLLM config: `generic_api` in `success_callback`
  - Docker-compose env vars: `GENERIC_LOGGER_ENDPOINT`, `GENERIC_LOGGER_HEADERS`, `BILLING_INGEST_TOKEN` on litellm + app services
  - `.env.local.example` entry for `BILLING_INGEST_TOKEN`
  - Contract test for ingest endpoint
  - Stack test (dev:stack:test is running)
  - Work item status update

## Decisions Made

1. **BILLING_NEVER_THROWS.** Removed `APP_ENV === "test"` re-throw from `recordBilling()` and `commitUsageFact()`. Billing domain logic must not fork on environment — stack tests must verify identical behavior to production. See `src/features/ai/services/billing.ts`.
2. **Idempotency via run_id presence/absence.** When `metadata.spend_logs_metadata.run_id` is present (InProc, Sandbox), the callback's `source_reference` matches the old billing path → duplicate is a no-op. When `run_id` is absent (Gateway), `litellm_call_id` is used as fallback `runId`, creating a different `source_reference` → callback receipt coexists with old $0 receipt. See `buildUsageFact()` in the route.
3. **Response shape simplified.** No `duplicates` counter — `commitUsageFact` handles idempotency internally (logs, doesn't throw). Route returns `{ processed, skipped }`.
4. **User-scoped AccountService for RLS.** Ingest endpoint resolves `billingAccountId` → `ServiceAccountService.getBillingAccountById()` → `ownerUserId` → `container.accountsForUser()` for `recordChargeReceipt()`. Same pattern as scheduler endpoint.

## Next Actions

- [ ] **1. Run `pnpm check`** — validate all uncommitted changes pass lint/type/format/tests
- [ ] **2. Commit checkpoint 1** — env var + contract + route + billing.ts BILLING_NEVER_THROWS change
- [ ] **3. Configure LiteLLM** — add `"generic_api"` to `success_callback` in `litellm.config.yaml`
- [ ] **4. Add env vars to docker-compose** — `GENERIC_LOGGER_ENDPOINT`, `GENERIC_LOGGER_HEADERS`, `BILLING_INGEST_TOKEN` on litellm service in both `docker-compose.dev.yml` and `docker-compose.yml`; pass `BILLING_INGEST_TOKEN` to app service
- [ ] **5. Add `.env.local.example` entry** for `BILLING_INGEST_TOKEN`
- [ ] **6. Run `pnpm check`** (checkpoint 2)
- [ ] **7. Write contract test** for ingest endpoint (Zod validation, billing account lookup, commitUsageFact call)
- [ ] **8. Write stack test** — streaming chat on paid model → verify `charge_receipts.response_cost_usd > 0` (dev:stack:test is running)
- [ ] **9. Run `pnpm check`** (checkpoint 3), update work item status

## Risks / Gotchas

- **Batched payloads:** LiteLLM sends `List[StandardLoggingPayload]` — sometimes 2+ entries per POST. Endpoint iterates the array.
- **End-user routing quirk:** Header-based callers (`x-litellm-end-user-id`) get `end_user: ""` in callback. Fallback to `metadata.requester_custom_headers["x-litellm-end-user-id"]`. Implemented in `resolveBillingAccountId()`.
- **Token field names:** Payload uses `prompt_tokens` / `completion_tokens` / `total_tokens` (NOT `input_tokens` / `output_tokens`). Zod schema enforces this.
- **Gateway `run_id` gap (deferred):** Gateway calls have `spend_logs_metadata: null`. The fallback runId = litellm_call_id creates a unique source_reference that doesn't collide with the old path. Fix requires OpenClaw outboundHeaders change.
- **`model_group` vs `model`:** Use `model_group` for the user-facing alias. `model` is the full provider path.

## Pointers

| File / Resource                                                     | Why it matters                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `docs/spec/billing-ingest.md`                                       | Authoritative spec — verified Zod schema, architecture, invariants                  |
| `work/items/task.0029.callback-driven-billing-kill-log-scraping.md` | Work item — scoped plan, allowed changes, acceptance criteria                       |
| `src/app/api/internal/billing/ingest/route.ts`                      | **New** — ingest endpoint (uncommitted)                                             |
| `src/contracts/billing-ingest.internal.v1.contract.ts`              | **New** — Zod contract for callback payload (uncommitted)                           |
| `src/features/ai/services/billing.ts`                               | `commitUsageFact()` + `recordBilling()` — BILLING_NEVER_THROWS change (uncommitted) |
| `src/shared/env/server.ts`                                          | `BILLING_INGEST_TOKEN` added (uncommitted)                                          |
| `src/app/api/internal/graphs/[graphId]/runs/route.ts`               | Pattern reference — existing internal endpoint with bearer auth                     |
| `platform/infra/services/runtime/configs/litellm.config.yaml`       | Add `generic_api` to `success_callback` (not yet done)                              |
| `platform/infra/services/runtime/docker-compose.dev.yml`            | Add env vars to litellm + app services (not yet done)                               |
| `platform/infra/services/runtime/docker-compose.yml`                | Same for prod compose (not yet done)                                                |
