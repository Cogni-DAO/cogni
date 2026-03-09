---
id: task.0039
type: task
title: "Billing reconciler — LiteLLM spend/logs polling in scheduler worker"
status: needs_design
priority: 2
estimate: 2
summary: "Periodic reconciliation loop in scheduler-worker. Queries LiteLLM /spend/logs API as universal reference set, LEFT JOINs against charge_receipts by litellm_call_id, replays missing entries through ingest path. No new DB tables."
outcome: "Missing callback receipts are auto-detected and self-healed within minutes. Structured alerts on persistent gaps. No silent revenue leakage. Zero schema changes."
spec_refs: [billing-ingest-spec]
assignees: []
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
created: 2026-02-12
updated: 2026-02-13
labels: [billing, reconciliation, scheduler, p2]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 9
---

# task.0039 — Billing reconciler via LiteLLM spend/logs polling

## Context

task.0029 replaces synchronous receipt barriers with callback-driven billing via LiteLLM webhook. The safety net: **what happens when a callback never arrives?**

Design review (2026-02-13) evaluated all existing DB tables as reconciliation candidates. Finding: **no existing table tracks "all LLM calls that happened" across all executor types** (InProc, sandbox, gateway, LangGraph). `ai_invocation_summaries` only covers InProc. `schedule_runs` only covers Temporal-scheduled runs. `ai_threads` is conversation-scoped, not execution-scoped.

**Decision: use LiteLLM's `/spend/logs` API as the universal reference set.** LiteLLM records every LLM call regardless of executor type. The reconciler queries this API, LEFT JOINs against `charge_receipts` by `litellm_call_id`, and replays missing entries through the same `commitUsageFact()` path. Zero new DB tables.

Related:

- task.0029 — callback-driven billing (the ingest side)
- bug.0037 — gateway proxy zero-cost streaming (the motivating bug)
- `docs/spec/external-executor-billing.md` — reconciliation via `/spend/logs` (converges with this design)

## Design

### Placement

Module in the existing `services/scheduler-worker/` process. **No new container. No new DB tables. No Temporal workflow.**

### Trigger

`setInterval` in `main.ts` alongside the Temporal worker. Every 5 minutes (configurable). Not a Temporal cron — simple interval avoids workflow plumbing for a straightforward poller.

### Leader Election

DB advisory lock (`pg_try_advisory_lock`) or rely on existing scheduler-worker singleton semantics. Only one instance runs the reconciler at a time.

### Algorithm (per tick)

```
1. FETCH: GET /spend/logs from LiteLLM API
   - Trailing window: now-30m to now-5m (grace period avoids in-flight callbacks)
   - Scoped by start_date / end_date params

2. EXTRACT: Collect litellm_call_id from each spend log entry

3. QUERY: SELECT source_reference FROM charge_receipts
   WHERE source_system = 'litellm'
   AND litellm_call_id = ANY($call_ids)

4. DIFF: missing_call_ids = spend_log_ids - receipt_ids

5. REPLAY: For each missing call_id:
   - Extract billing fields from spend log entry (response_cost, end_user,
     model, tokens, metadata.spend_logs_metadata)
   - Call commitUsageFact() with same idempotency key as callback path
   - source_reference includes litellm_call_id → safe replay (UNIQUE constraint)

6. ALERT: If missing_count > threshold after N consecutive cycles, emit
   structured log + increment Prometheus counter
```

### Idempotency

Reconciler replays use `source_system='litellm'` and `source_reference` containing `litellm_call_id` — identical to the callback ingest path. `UNIQUE(source_system, source_reference)` makes replays no-ops. Safe to run concurrently with callback writes.

### Backpressure

LiteLLM `/spend/logs` returns paginated results. Process one page per tick (batch_size). Ordered by start_time ASC (oldest first). No unbounded scans.

### Defaults

| Parameter             | Default | Notes                                          |
| --------------------- | ------- | ---------------------------------------------- |
| `interval_ms`         | 300000  | 5 minutes                                      |
| `window_start_offset` | 30      | Minutes before now (trailing window start)     |
| `window_end_offset`   | 5       | Minutes before now (grace period for inflight) |
| `batch_size`          | 100     | Max spend_log entries per tick                 |
| `alert_threshold`     | 10      | Missing count before alert escalation          |

## Ultra-Lean Constraints

- No new container
- **No new DB tables or schema changes** — uses LiteLLM API as reference set, `charge_receipts` as billed set
- No new hex port — keep as a module in scheduler worker
- No synchronous "receipt barrier" in any execution path
- No Temporal workflow for reconciliation (simple `setInterval`)

## Requirements

- Reconciler runs in `services/scheduler-worker/` process
- Uses LiteLLM `/spend/logs` API (via `LITELLM_BASE_URL` + `LITELLM_MASTER_KEY`)
- Uses the worker's existing DB connection for `charge_receipts` queries
- Replays missing receipts through `commitUsageFact()` (same path as ingest endpoint)
- Structured log on each reconciliation cycle (Pino JSON → Loki): entries_checked, missing_count, replayed_count
- Prometheus counter metrics: `billing_reconciler_missing_total`, `billing_reconciler_replayed_total`
- Config via env vars: `RECONCILER_INTERVAL_MS`, `RECONCILER_WINDOW_START_MINUTES`, `RECONCILER_WINDOW_END_MINUTES`, `RECONCILER_BATCH_SIZE`
- Graceful shutdown: interval cleared in the existing `shutdown()` handler

## Allowed Changes

- `services/scheduler-worker/src/main.ts` — start reconciler alongside Temporal worker
- `services/scheduler-worker/src/reconciler/` — new module directory
- `services/scheduler-worker/src/reconciler/billing-reconciler.ts` — tick logic
- `services/scheduler-worker/src/reconciler/litellm-spend-logs.ts` — LiteLLM API client (fetch /spend/logs)
- `services/scheduler-worker/src/config.ts` — add reconciler env vars + `LITELLM_BASE_URL`
- `platform/infra/services/runtime/docker-compose*.yml` — add env vars to scheduler-worker service
- `docs/spec/billing-ingest.md` — add reconciliation section

## Plan

- [ ] **1. LiteLLM spend/logs client** — HTTP client for `GET /spend/logs?start_date=...&end_date=...`. Uses `LITELLM_BASE_URL` + `LITELLM_MASTER_KEY`. Returns parsed entries with `litellm_call_id`, `response_cost`, `end_user`, `model`, token counts, `metadata`.
- [ ] **2. Reconciler module** — `billing-reconciler.ts`: fetch window → bulk query `charge_receipts` by call_id → diff → replay missing via `commitUsageFact()`.
- [ ] **3. Wire into main** — Start `setInterval` in `main.ts` (with `pg_try_advisory_lock` guard), clear on shutdown.
- [ ] **4. Observability** — Structured log per cycle + Prometheus counters.
- [ ] **5. Config** — Env vars with defaults, validated in `config.ts`.

## Acceptance Criteria

- Reconciler runs in scheduler-worker process (verified by structured log on startup)
- LLM calls present in LiteLLM spend_logs but missing from charge_receipts are detected and replayed
- Replayed receipts are idempotent (re-running reconciler produces no duplicates)
- No user-facing latency impact (fully async, never in request path)
- Graceful shutdown stops the interval before process exit
- Structured alert log when missing_count exceeds threshold

## Validation

**Command:**

```bash
pnpm --filter @cogni/scheduler-worker test
```

**Expected:** Unit test for reconciler tick logic (mock LiteLLM API response + mock DB, assert: missing entries detected, replay called, idempotent on re-run).

## Review Checklist

- [ ] **Work Item:** `task.0039` linked in PR body
- [ ] **Spec:** `billing-ingest.md` reconciliation section updated with LiteLLM API approach
- [ ] **Tests:** Unit test for tick logic (mock LiteLLM API + mock DB): missing detected, replay called, idempotent on re-run
- [ ] **No new DB tables or migrations**
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Depends on: task.0029 (callback-driven billing — provides the ingest side + `commitUsageFact()` pathway)
- Related: bug.0037 (gateway zero-cost streaming — motivating bug)
- Converges with: `docs/spec/external-executor-billing.md` (reconciliation via `/spend/logs`)
- Spec: docs/spec/billing-ingest.md
- Design review: 2026-02-13 — evaluated all existing DB tables, none cover all executor types. LiteLLM API chosen as universal reference set.

## Attribution

-
