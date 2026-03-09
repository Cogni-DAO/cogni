---
id: billing-ingest-spec
type: spec
title: "Billing Ingest: Callback-Driven, Port-Level Billing"
status: active
spec_state: active
trust: reviewed
summary: "Canonicalize billing at GraphExecutorPort: LiteLLM generic_api callback writes receipts, adapters only emit usage_unit_created{call_id}, decorator logs for observability. Async reconciliation catches missing callbacks."
read_when: Working on billing pipeline, LiteLLM integration, sandbox billing, or charge receipt reconciliation.
implements: proj.unified-graph-launch
owner: derekg1729
created: 2026-02-11
verified: 2026-02-14
tags: [billing, litellm, sandbox]
---

# Billing Ingest: Callback-Driven, Port-Level Billing

> Billing is canonicalized at GraphExecutorPort. Adapters never implement billing — they only emit `usage_unit_created{call_id}`. Cost data comes from a single source (LiteLLM `generic_api` callback). The decorator logs call_ids for observability; a periodic reconciliation job catches missing receipts. **No synchronous receipt barrier blocks the user response.**

### Key References

|             |                                                                                      |                                                     |
| ----------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| **Project** | [proj.unified-graph-launch](../../work/projects/proj.unified-graph-launch.md)        | Unified execution roadmap                           |
| **Spec**    | [billing-evolution](./billing-evolution.md)                                          | Charge receipt schema, credit unit                  |
| **Spec**    | [billing-sandbox](./billing-sandbox.md)                                              | Current proxy audit log pipeline (to be superseded) |
| **Spec**    | [external-executor-billing](./external-executor-billing.md)                          | Reconciliation design                               |
| **Task**    | [task.0029](../../work/items/task.0029.callback-driven-billing-kill-log-scraping.md) | Implementation work item                            |
| **Task**    | [task.0039](../../work/items/task.0039.billing-reconciler-worker.md)                 | Reconciliation worker (companion)                   |

## Core Primitive

**`litellm_call_id`** is the universal billing tracking key. In the callback payload this is the `id` field (same value as the `x-litellm-call-id` response header). LiteLLM assigns it per-call, includes it in response headers _and_ callback payloads. Every component — adapter, ingest endpoint, reconciliation — keys off this single ID.

## Invariants

| Rule                                  | Constraint                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ONE_BILLING_PATH                      | All billing confirmation is receipt-existence by `litellm_call_id`. No adapter-specific billing logic, no log parsing, no cost extraction in adapters.                                  |
| ADAPTERS_NEVER_BILL                   | Adapters only emit `usage_unit_created{call_id, runId, billingAccountId, model?}`. They never parse cost data, read logs, or write receipts.                                            |
| COST_ORACLE_IS_LITELLM                | Cost comes from LiteLLM callback payload (`response_cost`), not from nginx logs, response headers, or adapter-side computation.                                                         |
| NO_PLACEHOLDER_RECEIPTS               | Never write $0/empty receipts as placeholders. If cost is unknown, defer until authoritative cost arrives via callback (COST_ORACLE_IS_LITELLM) or reconciler (task.0039).              |
| CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID | `UNIQUE(source_system, source_reference)` where `source_reference` includes `litellm_call_id`. Duplicate callbacks are no-ops (swallowed by commitUsageFact, HTTP 200).                 |
| NO_SYNCHRONOUS_RECEIPT_BARRIER        | The user response is NEVER blocked waiting for callback receipt arrival. Reconciliation is async (task.0039).                                                                           |
| CALLBACK_AUTHENTICATED                | Ingest endpoint requires `Authorization: Bearer BILLING_INGEST_TOKEN`.                                                                                                                  |
| INGEST_ENDPOINT_IS_INTERNAL           | `/api/internal/billing/ingest` — internal Docker network only, not exposed through Caddy.                                                                                               |
| NO_DOCKER_SOCK_IN_APP                 | App container never mounts docker.sock or uses dockerode for billing. (Preserved from bug.0027 bridge fix.)                                                                             |
| BILLING_CORRELATION_BY_RUN_ID         | Gateway mode correlates billing by `metadata.spend_logs_metadata.run_id` from the callback, not by per-call barrier. Requires `x-litellm-spend-logs-metadata` header set with `run_id`. |

## Design

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ ADAPTER (any executor type)                                         │
│                                                                     │
│  1. Makes LLM call through LiteLLM proxy                           │
│  2. Reads x-litellm-call-id from response header (if available)    │
│  3. Emits: usage_unit_created { call_id, runId, billingAccountId }  │
│  4. Adapter is DONE with billing. No cost parsing. No log reads.   │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ (stream event)
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ BillingGraphExecutorDecorator (at GraphExecutorPort level)           │
│                                                                     │
│  1. Collects call_ids from usage_unit_created events                │
│  2. Consumes these events (not yielded downstream)                  │
│  3. Logs collected call_ids at end-of-run for observability         │
│  4. Does NOT block on receipt existence (async reconciliation)      │
└─────────────────────────────────────────────────────────────────────┘

                    ┌── callback fires async ──┐
                    ▼                           │
┌─────────────────────────────────────────────────────────────────────┐
│ LiteLLM Proxy (cost oracle)                                         │
│                                                                     │
│  On every successful LLM call:                                      │
│  1. Computes response_cost                                          │
│  2. Fires generic_api callback →                                    │
│     POST /api/internal/billing/ingest                               │
│     List[StandardLoggingPayload] (batched)                          │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ POST /api/internal/billing/ingest                                   │
│                                                                     │
│  1. Validate payload array (Zod)                                    │
│  2. For each entry: commitUsageFact() → recordChargeReceipt()       │
│  3. UPSERT by (source_system, source_reference=call_id)             │
│  4. Return 200 OK (duplicates are no-ops internally)                │
└─────────────────────────────────────────────────────────────────────┘

                       ┌── periodic (task.0039) ──┐
                       ▼                           │
┌─────────────────────────────────────────────────────────────────────┐
│ Reconciliation Worker (in scheduler-worker, setInterval)            │
│                                                                     │
│  1. GET /spend/logs from LiteLLM API (trailing window)              │
│  2. Bulk query charge_receipts by litellm_call_id                   │
│  3. DIFF: spend_log_ids minus receipt_ids = missing                 │
│  4. REPLAY: commitUsageFact() per missing entry (idempotent)        │
│  5. ALERT: structured log + metric if missing persists              │
│  6. Never blocks user response — purely async                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Ingest Endpoint

A standard Next.js internal API route. Not a hex port — just delivery-layer wiring that calls `commitUsageFact()`.

- Path: `POST /api/internal/billing/ingest`
- Auth: `Authorization: Bearer BILLING_INGEST_TOKEN`
- Body: `List[StandardLoggingPayload]` (LiteLLM sends batched arrays)
- Response: `200 OK` (receipts written; duplicates are no-ops internally)

### Adapter Contract

Adapters emit a single event type for billing:

```typescript
// What adapters emit — nothing else billing-related
yield {
  type: "usage_unit_created",
  callId: litellmCallId,      // x-litellm-call-id from response header
  runId,
  billingAccountId,
  model,                       // optional — for observability, not billing
};
```

Adapters do NOT:

- Parse `response_cost` or `providerCostUsd`
- Read nginx audit logs or billing files
- Construct `UsageFact` with cost fields
- Call `commitUsageFact()` or `recordChargeReceipt()`

### Decorator Change

The existing `BillingGraphExecutorDecorator` currently intercepts `usage_report` events and writes receipts inline during stream consumption. After this change:

1. Intercepts `usage_unit_created` events (replaces `usage_report`)
2. Collects call_ids into a set for observability logging
3. Consumes events (not yielded downstream)
4. At end-of-stream: logs collected call_ids (count, run_id) — **no blocking poll**
5. Receipt writing happens async via the LiteLLM callback, not the decorator

The decorator's role shrinks from "billing writer" to "billing event consumer + observability logger". The callback is the sole receipt writer.

### How Executors Get call_id

| Executor                 | call_id source                                                    |
| ------------------------ | ----------------------------------------------------------------- |
| **InProc**               | `x-litellm-call-id` response header (already extracted)           |
| **Sandbox (ephemeral)**  | `x-litellm-call-id` response header via proxy (already forwarded) |
| **Gateway (OpenClaw)**   | Correlated by `run_id` in callback metadata (not per-call)        |
| **External (LangGraph)** | `spend_logs.request_id` or callback metadata                      |

### Callback Payload Schema (Verified)

Verified against LiteLLM `generic_api` callback on 2026-02-13. The callback sends `List[StandardLoggingPayload]` — a JSON array, sometimes batched (2+ entries per POST).

**LiteLLM Configuration:**

```yaml
# litellm.config.yaml
litellm_settings:
  success_callback: ["langfuse", "generic_api"]
# Environment variable (on LiteLLM container):
# GENERIC_LOGGER_ENDPOINT=http://app:3000/api/internal/billing/ingest
# GENERIC_LOGGER_HEADERS=Authorization=Bearer ${BILLING_INGEST_TOKEN}
```

**Actual payload shape** (relevant fields for billing — full payload has ~40 fields):

```typescript
// Zod schema for ingest endpoint — matches LiteLLM StandardLoggingPayload
const StandardLoggingPayloadBilling = z.object({
  id: z.string().min(1), // litellm_call_id (same as x-litellm-call-id header)
  call_type: z.string(), // "acompletion"
  stream: z.boolean(),
  status: z.string(), // "success"
  response_cost: z.number(), // USD cost (0 for free models, >0 for paid)
  model: z.string(), // Full provider model: "google/gemini-2.5-flash"
  model_group: z.string(), // LiteLLM alias: "gemini-2.5-flash"
  custom_llm_provider: z.string(), // "openrouter"
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  total_tokens: z.number().int(),
  end_user: z.string(), // billingAccountId (see End User Routing below)
  metadata: z
    .object({
      spend_logs_metadata: z
        .object({
          // From x-litellm-spend-logs-metadata header
          run_id: z.string(),
          graph_id: z.string().optional(),
          attempt: z.number().int().optional(),
        })
        .nullable(),
      user_api_key_end_user_id: z.string().nullable().optional(),
      requester_custom_headers: z.record(z.string()).optional(),
    })
    .passthrough(), // Allow extra LiteLLM internal fields
});

// The POST body is always an array
const BillingIngestBody = z.array(StandardLoggingPayloadBilling);
```

### End User Routing (Verified Quirk)

The `end_user` field in the callback depends on HOW the caller sets identity:

| Method                             | `end_user` in callback | `metadata.spend_logs_metadata`    |
| ---------------------------------- | ---------------------- | --------------------------------- |
| Request body `user` field          | Populated              | Not set (unless header also sent) |
| `x-litellm-end-user-id` header     | **Empty string**       | Not set                           |
| Both body `user` + metadata header | Populated              | Populated                         |

**Current state by executor:**

| Executor                | Sets `user` body field?              | Sets metadata header?      | `end_user` in callback | `run_id` in callback |
| ----------------------- | ------------------------------------ | -------------------------- | ---------------------- | -------------------- |
| **InProc**              | Yes (`billingAccountId`)             | Yes (via request metadata) | Populated              | Populated            |
| **Gateway (OpenClaw)**  | Yes (via OpenClaw `outboundHeaders`) | **No**                     | Populated              | **MISSING**          |
| **Sandbox (ephemeral)** | No (proxy sets headers)              | Yes (proxy header)         | Empty                  | Populated            |

**Implication:** Gateway mode has `end_user` (for account correlation) but NO `run_id` (for per-run correlation). Fix: add `x-litellm-spend-logs-metadata` to OpenClaw's `outboundHeaders` per session (done in `SandboxGraphProvider.runGateway()`).

## Goal

Canonicalize billing at GraphExecutorPort so adapters never implement billing. Single stable path: LiteLLM callback writes receipts asynchronously. Async reconciliation catches missing callbacks. This eliminates all log-scraping billing paths and makes billing work identically across all executor types and deployment topologies.

## Non-Goals

- Redesigning the charge_receipts schema (reuse existing table and idempotency)
- Changing the credit unit standard or markup policy
- Building a standalone billing microservice (internal API route)
- Real-time billing UI updates
- Synchronous receipt barriers that block user response
- Modifying the unified graph launch workflow architecture

## Migration Path

Callback and log-scraping paths coexisted briefly during cutover:

1. **Add ingest endpoint** — ~~Done (task.0029).~~ `POST /api/internal/billing/ingest` accepting `List[StandardLoggingPayload]`, Zod validation, `commitUsageFact()`, shared-secret auth.
2. **Configure LiteLLM `generic_api` callback** — ~~Done (task.0029).~~ `success_callback: ["langfuse", "generic_api"]` with `GENERIC_LOGGER_ENDPOINT` + `GENERIC_LOGGER_HEADERS` env vars.
3. **Fix gateway `run_id` gap** — Not started. Add `x-litellm-spend-logs-metadata` to OpenClaw `outboundHeaders` per session.
4. **Strip billing from adapters** — ~~Done (task.0029).~~ `ProxyBillingReader` deleted, gateway billing removed from `SandboxGraphProvider`, `OPENCLAW_BILLING_DIR` removed. Gateway nginx audit log removed.
5. **Delete old paths** — ~~Done (task.0029).~~ `ProxyBillingReader`, billing volumes, `OPENCLAW_BILLING_DIR`, gateway audit log all removed. `commitUsageFact()` refactored to strict cost-known/unknown branching (COST_AUTHORITY_IS_LITELLM).

## Verified Findings (Spike 2026-02-13)

Tested against running dev:stack with LiteLLM `generic_api` callback pointed at a capture server.

| Question                                                   | Answer                                                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Does `metadata.spend_logs_metadata` survive into callback? | **Yes** — `run_id`, `graph_id`, `attempt` all present when set via `x-litellm-spend-logs-metadata` header                           |
| What is the callback name?                                 | `generic_api` (not `generic` or `webhook`). URL via `GENERIC_LOGGER_ENDPOINT` env var, headers via `GENERIC_LOGGER_HEADERS` env var |
| Is the payload batched?                                    | **Yes** — always `List[StandardLoggingPayload]`, sometimes 2+ entries per POST                                                      |
| Is `id` the same as `x-litellm-call-id`?                   | **Yes** — `id` field = litellm_call_id                                                                                              |
| Is `response_cost` present for streaming?                  | **Yes** — accurate costs for paid models (e.g., gemini-2.5-flash: $0.0005-0.003 per call)                                           |
| Does `end_user` populate from header?                      | **No** — `x-litellm-end-user-id` header → `end_user: ""`. Must use request body `user` field to populate `end_user`                 |
| Token fields?                                              | `prompt_tokens`, `completion_tokens`, `total_tokens` (not `input_tokens`/`output_tokens`)                                           |
| `model` vs `model_group`?                                  | `model` = full provider path (`google/gemini-2.5-flash`), `model_group` = LiteLLM alias (`gemini-2.5-flash`)                        |
| Does gateway set `run_id` in metadata?                     | **No** — live gateway calls have `spend_logs_metadata: null`. Must add `x-litellm-spend-logs-metadata` to OpenClaw outboundHeaders  |

## Related

- [billing-evolution](./billing-evolution.md) — Charge receipt schema, credit unit standard
- [billing-sandbox](./billing-sandbox.md) — Current proxy audit log pipeline (to be superseded)
- [external-executor-billing](./external-executor-billing.md) — Reconciliation design (converges with this spec)
- [openclaw-sandbox-spec](./openclaw-sandbox-spec.md) — Gateway billing architecture
- [proj.unified-graph-launch](../../work/projects/proj.unified-graph-launch.md) — Unified execution roadmap
