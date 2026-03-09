---
id: task.0029.handoff
type: handoff
work_item_id: task.0029
status: active
created: 2026-02-12
updated: 2026-02-13
branch: ""
last_commit: 9e7d7406
---

# Handoff: Callback-driven billing — P0 MVP (ingest endpoint + LiteLLM config)

## Context

- **bug.0037 (P0):** All gateway streaming LLM calls record $0 cost. Revenue leakage on paid models like `gemini-2.5-flash`.
- **Root cause:** Streaming SSE responses don't include cost in nginx response headers. The proxy-based billing pipeline is architecturally broken for streaming.
- **The fix:** LiteLLM's `generic_api` callback fires AFTER stream completion with full cost data. A new internal ingest endpoint receives the callback and writes charge receipts via existing `commitUsageFact()`.
- **P0 scope is narrow:** Add the ingest endpoint (step 1) + wire the LiteLLM callback (step 2). Old billing path coexists safely — idempotency prevents double-billing. Adapter stripping and old-path deletion are deferred.
- **No code has been written yet.** Branch off `staging` and begin building.

## Current State

- **Spec verified:** `docs/spec/billing-ingest.md` contains verified Zod schema, callback payload shape, end_user routing quirks, and per-executor correlation table — all confirmed via live spike on 2026-02-13.
- **Task scoped:** `work/items/task.0029...md` — P0 plan is 3 steps (endpoint, config, test). Full 6-step cleanup plan documented as deferred.
- **Existing billing still works:** InProc and ephemeral sandbox bill correctly. Gateway records $0 (the bug). Old + new paths will coexist via `UNIQUE(source_system, source_reference)` idempotency.
- **No reconciler needed for P0:** task.0039 (LiteLLM spend/logs polling) is deprioritized. Callback delivery failures on Docker-internal network are near-zero probability. Monitor first, build later.

## Decisions Made

1. **P0 = steps 1-2 only.** Ingest endpoint + LiteLLM config. No adapter changes, no decorator changes, no deletions. Prove the callback path works before removing the old one. See task.0029 → Plan.
2. **Accept `StandardLoggingPayload[]` directly.** Verified Zod schema in spec matches real callback data. See `billing-ingest.md` → "Callback Payload Schema (Verified)".
3. **Callback name is `generic_api`.** URL via `GENERIC_LOGGER_ENDPOINT` env var, auth via `GENERIC_LOGGER_HEADERS`. Not configured in YAML — env vars on the LiteLLM container.
4. **`end_user` routing quirk.** Header-based callers (`x-litellm-end-user-id`) get `end_user: ""` in callback. Fall back to `metadata.requester_custom_headers["x-litellm-end-user-id"]`. See spec → "End User Routing (Verified Quirk)".
5. **Gateway `run_id` gap is deferred.** Gateway calls have `spend_logs_metadata: null`. The `end_user` field is populated (account correlation works). `run_id` fix requires OpenClaw outboundHeaders change — ship later.
6. **No new DB tables.** Design review (2026-02-13) evaluated all existing tables for reconciliation — none cover all executor types. LiteLLM API is the universal reference set if reconciliation is needed later.

## Next Actions

- [ ] **1. Create branch** from `staging` for task.0029
- [ ] **2. Add `BILLING_INGEST_TOKEN`** to `src/shared/env/server.ts` (Zod-validated, min 32 chars)
- [ ] **3. Create Zod contract** at `src/contracts/billing-ingest.contract.ts` — schema from `billing-ingest.md` → "Callback Payload Schema (Verified)"
- [ ] **4. Implement ingest endpoint** at `src/app/api/internal/billing/ingest/route.ts` — bearer auth, Zod validate array, iterate entries, call `commitUsageFact()` per entry, return 200/409
- [ ] **5. Configure LiteLLM** — add `"generic_api"` to `success_callback` in `litellm.config.yaml`, add `GENERIC_LOGGER_ENDPOINT` + `GENERIC_LOGGER_HEADERS` env vars to litellm service in docker-compose files
- [ ] **6. Add `.env.local.example` entries** for `BILLING_INGEST_TOKEN`
- [ ] **7. Stack test** — streaming chat on paid model → verify `charge_receipts.response_cost_usd > 0`
- [ ] **8. Run `pnpm check`** — ensure no lint/type/format regressions

## Risks / Gotchas

- **Batched payloads:** LiteLLM sends `List[StandardLoggingPayload]` — sometimes 2+ entries per POST. Endpoint must iterate the array, not assume single entry.
- **Cutover idempotency:** Both old and new paths may write the same receipt. `UNIQUE(source_system, source_reference)` makes the duplicate a no-op. Catch the constraint violation and return 409, don't throw.
- **Internal endpoint auth:** `POST /api/internal/billing/ingest` bypasses the standard `/api/v1/` proxy auth. Use `Authorization: Bearer BILLING_INGEST_TOKEN` — validate in route handler, not in `proxy.ts`.
- **Token field names:** Payload uses `prompt_tokens` / `completion_tokens` / `total_tokens` (NOT `input_tokens` / `output_tokens`). The Zod schema in the spec is correct.
- **`model_group` vs `model`:** Use `model_group` for the alias users see (e.g., `gemini-2.5-flash`). `model` is the full provider path (e.g., `google/gemini-2.5-flash`).

## Pointers

| File / Resource                                                     | Why it matters                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `docs/spec/billing-ingest.md`                                       | Authoritative spec — verified Zod schema, architecture, invariants                  |
| `work/items/task.0029.callback-driven-billing-kill-log-scraping.md` | Work item — scoped plan, allowed changes, acceptance criteria                       |
| `work/projects/proj.unified-graph-launch.md`                        | Project roadmap — P0/P0.5/P1 phasing                                                |
| `src/features/ai/services/billing.ts`                               | `commitUsageFact()` — the receipt writer, reuse from ingest endpoint                |
| `src/shared/env/server.ts`                                          | Add `BILLING_INGEST_TOKEN` here                                                     |
| `platform/infra/services/runtime/configs/litellm.config.yaml`       | Add `generic_api` to `success_callback`                                             |
| `platform/infra/services/runtime/docker-compose.dev.yml`            | Add `GENERIC_LOGGER_ENDPOINT` + `GENERIC_LOGGER_HEADERS` to litellm                 |
| `src/adapters/server/accounts/drizzle.adapter.ts`                   | `recordChargeReceipt()` — atomic receipt + ledger debit (called by commitUsageFact) |
| `packages/db-schema/src/billing.ts`                                 | `charge_receipts` schema — `UNIQUE(source_system, source_reference)`                |
