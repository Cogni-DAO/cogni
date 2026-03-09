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

# Handoff: Callback-driven billing via LiteLLM generic_api webhook

## Context

- **All sandbox:openclaw LLM calls bill $0** (bug.0037, P0). Root cause: nginx proxy can't capture cost from streaming SSE response headers.
- task.0029 replaces log-scraping with LiteLLM `generic_api` webhook callback.
- **Spec updated** (`billing-ingest.md`) with all verified findings from spike.
- **Webhook spike completed** (2026-02-13) — all open questions resolved with real data.

## Current State

- **Spec:** `billing-ingest.md` — updated with verified payload schema, end_user routing quirks, gateway run_id gap
- **Task:** `task.0029` — status: Todo, plan has 6 steps (each shippable independently)
- **No code written yet** — design is verified and ready to implement

## Decisions Made (Design Review + Spike)

1. **No ReceiptBarrierPort** — no synchronous receipt barrier. User response never blocked. Async reconciliation (task.0039) catches missing callbacks.
2. **Accept LiteLLM's native `StandardLoggingPayload[]`** — verified payload shape via spike. Zod schema in spec matches actual data.
3. **Gateway `run_id` correlation** — use `metadata.spend_logs_metadata.run_id` from callback. BUT: spike revealed gateway calls currently have `spend_logs_metadata: null`. Must add `x-litellm-spend-logs-metadata` to OpenClaw `outboundHeaders` (step 3 in plan).
4. **Callback name is `generic_api`** (not `generic` or `webhook`). URL via `GENERIC_LOGGER_ENDPOINT` env var, headers via `GENERIC_LOGGER_HEADERS` env var.
5. **`end_user` routing quirk** — `x-litellm-end-user-id` header → `end_user: ""` in callback. Must use request body `user` field. Gateway already does this (OpenClaw sets `user` in outboundHeaders). Ephemeral sandbox uses headers only — will need body `user` field added.
6. **Payloads are batched** — `List[StandardLoggingPayload]`, sometimes 2+ entries per POST. Ingest endpoint must iterate array.

## Next Actions

Ordered by dependency (each step shippable independently):

1. **Add ingest endpoint** — `POST /api/internal/billing/ingest`, Zod-validated `List[StandardLoggingPayload]`, shared-secret auth, calls `commitUsageFact()` per entry. Idempotent by call_id.
2. **Configure LiteLLM callback** — add `generic_api` to `success_callback`, set `GENERIC_LOGGER_ENDPOINT` + `GENERIC_LOGGER_HEADERS` on litellm container in docker-compose.
3. **Fix gateway `run_id` gap** — add `x-litellm-spend-logs-metadata` header to OpenClaw `outboundHeaders` when Cogni app creates gateway session.
4. **Add `usage_unit_created` event + decorator change** — decorator becomes observability-only logger (no receipt writing).
5. **Strip billing from adapters** — remove cost extraction, ProxyBillingReader, billing volumes.
6. **Delete old paths** — final cleanup.

## Risks / Gotchas

- **Batched payloads**: Generic logger sends `List[StandardLoggingPayload]` (1+ items per POST). Endpoint must handle arrays.
- **`end_user` empty for header-based identity**: Ephemeral sandbox sets identity via `x-litellm-end-user-id` header → `end_user: ""` in callback. The callback still has the header value in `metadata.requester_custom_headers["x-litellm-end-user-id"]`. Ingest endpoint must fall back to that field.
- **Gateway `run_id` missing today**: Live gateway calls have `spend_logs_metadata: null`. Step 3 fixes this. Until then, gateway calls can only correlate by `end_user` (billingAccountId) + time window.
- **Cutover safety**: Steps 1-2 run alongside existing billing. Idempotency by call_id prevents double-charging. Both paths can write the same receipt — second write is a no-op.
- **`model_group` vs `model`**: Use `model_group` for the LiteLLM alias (what we display). `model` is the full provider path (e.g., `google/gemini-2.5-flash`).
- **Token field names**: `prompt_tokens` / `completion_tokens` (not `input_tokens` / `output_tokens`).

## Pointers

| File / Resource                                                     | Why it matters                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `docs/spec/billing-ingest.md`                                       | Design spec — updated with verified findings                               |
| `work/items/task.0029.callback-driven-billing-kill-log-scraping.md` | Work item with plan and allowed changes                                    |
| `work/items/bug.0037.gateway-proxy-zero-cost-streaming.md`          | Motivating bug — $0 cost for all gateway calls                             |
| `/tmp/litellm-webhook-capture.jsonl`                                | Raw spike data (9 captured callbacks, inspect with `python3 -m json.tool`) |
| `src/adapters/server/sandbox/proxy-billing-reader.ts`               | To be deleted                                                              |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts:529-567`     | Gateway billing emission (to be simplified)                                |
| `src/adapters/server/ai/billing-executor.decorator.ts`              | Decorator (to become observability-only)                                   |
| `src/features/ai/services/billing.ts`                               | `commitUsageFact()` — the receipt writer (reused by ingest)                |
| `platform/infra/services/runtime/configs/litellm.config.yaml`       | LiteLLM config — add `generic_api` to success_callback                     |
