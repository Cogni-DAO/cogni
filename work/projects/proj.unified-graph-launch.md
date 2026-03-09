---
id: proj.unified-graph-launch
type: project
primary_charter:
title: Unified Graph Launch — Temporal Execution Path
state: Active
priority: 1
estimate: 5
summary: Unify all graph execution (API, scheduled, webhook) through GraphRunWorkflow in Temporal
outcome: All graph runs flow through GraphRunWorkflow; no inline execution in HTTP handlers; idempotent run starts
assignees:
  - derekg1729
created: 2026-02-07
updated: 2026-02-14
labels:
  - ai-graphs
  - scheduler
---

# Unified Graph Launch — Temporal Execution Path

> Source: docs/spec/unified-graph-launch.md

## Goal

Unify all graph execution triggers (API immediate, Temporal scheduled, webhook) through a single `GraphRunWorkflow` in Temporal. HTTP handlers become workflow starters, never executors. Idempotent run starts via deterministic workflow IDs.

## Roadmap

### Crawl (P0): Callback Billing + Automated Reconciliation

**Goal:** Fix $0 gateway billing (bug.0037) via callback-driven receipts, with automated safety net.

| Deliverable                                                                         | Status  | Est | Work Item |
| ----------------------------------------------------------------------------------- | ------- | --- | --------- |
| Fix: schedule creation accepts paid models with zero credits — no credit gate       | Backlog | 2   | bug.0025  |
| Fix: scheduled runs write charge_receipts (billing bypass regression)               | Done    | 2   | bug.0005  |
| Billing enforcement decorator at GraphExecutorPort level                            | Done    | 2   | task.0007 |
| **Callback-driven billing — ingest endpoint + LiteLLM generic_api config (P0 MVP)** | Done    | 1   | task.0029 |

**P0 scope:** task.0029 ships (ingest endpoint + callback config). Old billing path coexists safely — idempotency prevents double-billing. Monitor callback delivery via Grafana (spend_logs count vs charge_receipts count). Reconciler (task.0039) deferred to P2 — build only if callback delivery failures observed in production.

#### File Pointers (P0 Scope)

| File                                                          | Change                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/app/api/internal/billing/ingest/route.ts`                | New: callback ingest endpoint                                  |
| `src/contracts/billing-ingest.contract.ts`                    | New: Zod schema for StandardLoggingPayload                     |
| `platform/infra/services/runtime/configs/litellm.config.yaml` | Add: `generic_api` to `success_callback`                       |
| `platform/infra/services/runtime/docker-compose.dev.yml`      | Add: `GENERIC_LOGGER_ENDPOINT` + `GENERIC_LOGGER_HEADERS`      |
| `services/scheduler-worker/src/reconciler/`                   | New: reconciler module (LiteLLM /spend/logs → charge_receipts) |

### Crawl (P0.5): Adapter Cleanup (after callback proven in prod)

**Goal:** Strip old billing paths now that callback is proven. Adapters become billing-free.

| Deliverable                                                                                              | Status      | Est | Work Item |
| -------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Fix gateway `run_id` gap — add `x-litellm-spend-logs-metadata` to OpenClaw outboundHeaders               | Not Started | 1   | —         |
| Add `usage_unit_created` event + decorator change — decorator becomes observability-only                 | Not Started | 1   | —         |
| Strip billing from adapters — remove cost extraction from InProc, remove ProxyBillingReader from Sandbox | Done        | 1   | task.0029 |
| Delete old paths — ProxyBillingReader, billing volumes, OPENCLAW_BILLING_DIR, gateway audit log          | Done        | 1   | task.0029 |
| Collapse GraphProvider into GraphExecutorPort — single execution interface + namespace routing           | Todo        | 3   | task.0006 |

### Walk (P1): Unified Workflow Path + Run Persistence

**Goal:** All graph runs go through `GraphRunWorkflow`. Durable run records with trigger provenance.

| Deliverable                                                                                             | Status      | Est | Work Item |
| ------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Add `graph_runs` table (product/run lifecycle semantics — not a billing bandaid)                        | Not Started | 2   | —         |
| Add trigger provenance fields: `run_kind`, `trigger_source`, `trigger_ref`, `requested_by`              | Not Started | 1   | —         |
| Add `trigger_*` columns to existing `schedule_runs` table                                               | Not Started | 1   | —         |
| Create `GraphRunWorkflow` in `services/scheduler-worker/`                                               | Not Started | 2   | —         |
| Refactor `POST /api/v1/ai/chat` to start `GraphRunWorkflow` instead of inline execution                 | Not Started | 2   | —         |
| Add `Idempotency-Key` header support to chat endpoint                                                   | Not Started | 1   | —         |
| Ensure `executeGraphActivity` reuses existing internal API path (`/api/internal/graphs/{graphId}/runs`) | Not Started | 1   | —         |
| Migrate `schedule_runs` correlation to use `graph_runs.id`                                              | Not Started | 1   | —         |
| Add attempt semantics (unfreeze `attempt` from 0)                                                       | Not Started | 1   | —         |
| Observability instrumentation                                                                           | Not Started | 1   | —         |
| Documentation updates                                                                                   | Not Started | 1   | —         |

**Note:** When `graph_runs` exists, reconciler can optionally switch reference-set from LiteLLM spend/logs to `graph_runs`, but it is not required. The LiteLLM API approach remains valid long-term.

### Run (P2): Webhook Triggers (Conditional)

**Goal:** Webhook-triggered graph runs via same unified path.

| Deliverable                                                                   | Status      | Est | Work Item |
| ----------------------------------------------------------------------------- | ----------- | --- | --------- |
| Evaluate: Is there a high-value webhook trigger (CI failure, deploy failure)? | Not Started | 1   | —         |
| If yes: Implement single webhook handler using same workflow path             | Not Started | 2   | —         |
| Do NOT build generic webhook/event system preemptively                        | Not Started | 0   | —         |

## Constraints

- **ONE_RUN_EXECUTION_PATH**: All graph execution via `GraphRunWorkflow` — no inline execution in HTTP handlers (P1 goal)
- **IDEMPOTENT_RUN_START**: `workflowId = graph-run:{tenantId}:{idempotencyKey}` — duplicate starts are no-ops (P1 goal)
- **LITELLM_IS_REFERENCE_SET**: For billing reconciliation, LiteLLM spend/logs API is the universal reference set across all executor types. No new DB tables required for reconciliation (design review decision 2026-02-13).
- **GRAPH_RUNS_IS_PRODUCT_TABLE**: `graph_runs` table (P1) exists for product/run lifecycle semantics, not as a billing reconciliation dependency.
- P0 accepts polling for results; streaming deferred to P1
- No generic event bus or rule engine — scope is graph execution only

## Dependencies

- [ ] Temporal infrastructure operational (existing)
- [ ] GRAPH_EXECUTION.md P1 run persistence (for P1 of this initiative)
- [ ] task.0029 callback ingest endpoint (prerequisite for task.0039 reconciler)

## As-Built Specs

- [unified-graph-launch.md](../../docs/spec/unified-graph-launch.md) — Core invariants, schema, design decisions
- [billing-ingest.md](../../docs/spec/billing-ingest.md) — Callback-driven billing: adapters emit call_id, LiteLLM callback writes receipts, decorator enforces barrier
- [scheduler.md](../../docs/spec/scheduler.md) — Temporal architecture, internal API
- [temporal-patterns.md](../../docs/spec/temporal-patterns.md) — Workflow determinism, activity idempotency

## Design Notes

**Implementation order** (updated after design review, 2026-02-13):

1. **bug.0005** (Done) — Minimal inline billing drain in internal route handler.
2. **task.0007** (Done) — `BillingGraphExecutorDecorator` at port level.
3. **task.0029** (Next) — Callback ingest endpoint + LiteLLM `generic_api` config. P0 MVP: steps 1-2 only. Old path coexists.
4. **task.0039** (After 0029) — Reconciler in scheduler-worker polling LiteLLM `/spend/logs`. Automated safety net.
5. **P0.5 cleanup** — Strip adapters, delete ProxyBillingReader, fix gateway `run_id` gap. After callback proven.
6. **task.0006** — Collapse GraphProvider into GraphExecutorPort (independent of billing work).

**Key design decision (2026-02-13):** Reconciler uses LiteLLM `/spend/logs` API as universal reference set, NOT a new `graph_runs` table. No existing app-side table covers all executor types (ai_invocation_summaries=InProc only, schedule_runs=Temporal only, ai_threads=conversation-scoped). `graph_runs` deferred to P1 for product/run lifecycle, not billing.

**Branch:** Cut a clean branch from `staging` for implementation.
