---
id: task.0029.handoff
type: handoff
work_item_id: task.0029
status: active
created: 2026-02-12
updated: 2026-02-13
branch: ""
last_commit: ""
---

# Handoff: Callback-driven billing — LiteLLM generic_api webhook replaces log scraping

## Context

- All `sandbox:openclaw` LLM calls record **$0 cost and 0 tokens** (bug.0037, P0). This is active revenue leakage for paid models like `gemini-2.5-flash`.
- Root cause: the current billing pipeline captures cost from nginx response headers (`x-litellm-response-cost`), but **streaming SSE responses don't include that header** — cost isn't known until the stream completes.
- The fix: LiteLLM's `generic_api` callback fires AFTER stream completion with full cost data. A new ingest endpoint receives the callback and writes charge receipts. No log scraping, no shared volumes, no docker exec.
- The design has been verified via a live spike against dev:stack (2026-02-13). All open questions are resolved. The spec (`billing-ingest.md`) contains the verified payload schema, Zod types, and a table of per-executor quirks.
- **No code has been written yet.** This is ready to implement.

## Current State

- **Spec:** `docs/spec/billing-ingest.md` — fully updated with verified findings, Zod schema, end_user routing quirks, gateway `run_id` gap
- **Task:** `work/items/task.0029.callback-driven-billing-kill-log-scraping.md` — 6-step plan, each step independently shippable
- **Bug:** `work/items/bug.0037.gateway-proxy-zero-cost-streaming.md` — the motivating P0, resolved by this task
- **Companion:** `work/items/task.0039.billing-reconciler-worker.md` — async reconciliation worker (build AFTER task.0029)
- **Existing billing paths still operational:** inproc works, ephemeral sandbox works, gateway records $0 (broken)

## Decisions Made

1. **No synchronous receipt barrier** — user response is never blocked waiting for callback. Async reconciliation (task.0039) catches missing callbacks. See spec invariant `NO_SYNCHRONOUS_RECEIPT_BARRIER`.
2. **Accept LiteLLM's native `StandardLoggingPayload[]` directly** — verified Zod schema in spec matches real callback data. See `billing-ingest.md` → "Callback Payload Schema (Verified)".
3. **Callback name is `generic_api`** — configured via `GENERIC_LOGGER_ENDPOINT` env var (not yaml). Headers via `GENERIC_LOGGER_HEADERS`. See spec → "LiteLLM Configuration".
4. **Gateway `run_id` gap must be fixed** — live gateway calls have `spend_logs_metadata: null` in callback. Must add `x-litellm-spend-logs-metadata` to OpenClaw `outboundHeaders` per session (plan step 3).
5. **`end_user` routing quirk** — `x-litellm-end-user-id` header does NOT populate `end_user` in callback (it's empty string). Must use request body `user` field. See spec → "End User Routing (Verified Quirk)".

## Next Actions

- [ ] **1. Add ingest endpoint** — `POST /api/internal/billing/ingest`. Accepts `List[StandardLoggingPayload]` (batched array). Zod validation, `Authorization: Bearer BILLING_INGEST_TOKEN` auth, calls `commitUsageFact()` per entry. Idempotent by `(source_system, source_reference)`. Safe to deploy alongside existing billing.
- [ ] **2. Configure LiteLLM callback** — Add `generic_api` to `success_callback` in `litellm.config.yaml`. Add `GENERIC_LOGGER_ENDPOINT` + `GENERIC_LOGGER_HEADERS` env vars to litellm service in docker-compose.
- [ ] **3. Fix gateway `run_id` gap** — Add `x-litellm-spend-logs-metadata` header (with `run_id`, `graph_id`, `attempt`) to OpenClaw `outboundHeaders` when Cogni app creates the gateway session.
- [ ] **4. Add `usage_unit_created` event + decorator change** — New event in `@cogni/ai-core`. Decorator collects call_ids for observability, stops writing receipts inline.
- [ ] **5. Strip billing from adapters** — Remove cost extraction from InProc, delete `ProxyBillingReader`, remove billing volumes. Adapters emit only `usage_unit_created`.
- [ ] **6. Delete old paths** — `ProxyBillingReader`, billing volumes, `proxyBillingEntries`, `OPENCLAW_BILLING_DIR`, `usage_report` event type.

## Risks / Gotchas

- **Batched payloads**: LiteLLM sends `List[StandardLoggingPayload]` — sometimes 2+ entries per POST. Endpoint must iterate the array.
- **`end_user` empty for header-based callers**: Ephemeral sandbox sets identity via header → callback has `end_user: ""`. Fall back to `metadata.requester_custom_headers["x-litellm-end-user-id"]`.
- **Cutover idempotency**: During transition, both old (inline) and new (callback) paths may write the same receipt. The `UNIQUE(source_system, source_reference)` constraint makes the second write a no-op — this is safe.
- **`model_group` vs `model`**: Use `model_group` for the LiteLLM alias we display (e.g., `gemini-2.5-flash`). `model` is the full provider path (e.g., `google/gemini-2.5-flash`).
- **Token field names in payload**: `prompt_tokens` / `completion_tokens` / `total_tokens` (NOT `input_tokens` / `output_tokens`).

## Pointers

| File / Resource                                                     | Why it matters                                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `docs/spec/billing-ingest.md`                                       | Authoritative spec — verified Zod schema, architecture, invariants, spike findings |
| `work/items/task.0029.callback-driven-billing-kill-log-scraping.md` | Work item — plan, allowed changes, acceptance criteria                             |
| `work/items/bug.0037.gateway-proxy-zero-cost-streaming.md`          | Motivating P0 bug — $0 cost for all gateway streaming calls                        |
| `src/features/ai/services/billing.ts`                               | `commitUsageFact()` — the receipt writer, reused by ingest endpoint                |
| `src/adapters/server/ai/billing-executor.decorator.ts`              | Current decorator — writes receipts inline, must become observability-only         |
| `src/adapters/server/sandbox/proxy-billing-reader.ts`               | To be deleted — current gateway log-scraping reader                                |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts:529-567`     | Gateway billing emission — to be simplified to `usage_unit_created`                |
| `platform/infra/services/runtime/configs/litellm.config.yaml`       | LiteLLM config — add `generic_api` to `success_callback`                           |
| `platform/infra/services/runtime/docker-compose.dev.yml:111-133`    | LiteLLM container — add `GENERIC_LOGGER_ENDPOINT` env var                          |
