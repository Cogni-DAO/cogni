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
updated: 2026-03-18
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
| Collapse GraphProvider into GraphExecutorPort — single execution interface + namespace routing           | In Review   | 3   | task.0006 |

### Walk (P1): Unified Workflow Path + Run Persistence + Redis Streaming

**Goal:** All graph runs go through `GraphRunWorkflow`. Durable run records with trigger provenance. Real-time SSE streaming via Redis Streams.

**Three-plane architecture:** Temporal (control) + Redis Streams (stream) + PostgreSQL (durable). See [unified-graph-launch.md §4](../../docs/spec/unified-graph-launch.md) for full design.

| Deliverable                                                                                          | Status         | Est | Work Item |
| ---------------------------------------------------------------------------------------------------- | -------------- | --- | --------- |
| **Infrastructure: Redis 7** — docker-compose, `ioredis` dep, env config                              | Done           | 1   | task.0174 |
| **RunStreamPort + RedisRunStreamAdapter** — hexagonal port/adapter for Redis Streams                 | Done           | 2   | task.0175 |
| **Extract `graph-execution-core` package** — decouple execution ports from Next.js                   | Done (PR #574) | 3   | task.0179 |
| **GraphRunWorkflow + promote `schedule_runs` → `graph_runs`** — single run ledger, Temporal workflow | Done           | 5   | task.0176 |
| **Neutral usage facts** — split wrapper composition and remove billing identity from usage facts     | Done           | 2   | task.0180 |
| **Unified streaming API** — chat endpoint → Temporal + Redis + idempotency                           | In Review      | 5   | task.0177 |
| **Run stream reconnection** — GET /api/v1/ai/runs/{runId}/stream with Last-Event-ID replay           | In Review      | 2   | task.0182 |
| **Delete old workflow + prune aliases + LangGraph/Temporal boundary doc**                            | In Review      | 3   | task.0178 |

**Note:** When `graph_runs` exists, reconciler can optionally switch reference-set from LiteLLM spend/logs to `graph_runs`, but it is not required. The LiteLLM API approach remains valid long-term.

### Run (P2): Webhook Alignment + Execution Host Evolution

**Goal:** Webhook-triggered graph runs via Temporal parent workflow pattern. Evaluate worker-local execution.

| Deliverable                                                                 | Status       | Est | Work Item |
| --------------------------------------------------------------------------- | ------------ | --- | --------- |
| **PR review webhook → Temporal parent workflow** with durable GitHub writes | In Review    | 5   | task.0191 |
| **Spike: Worker-local execution** — evaluate eliminating internal API hop   | Not Started  | 2   | task.0181 |
| **Extract graph-execution-host package** — prereq for worker-local exec     | Done         | 3   | task.0250 |
| **Node-aware execution routing** — nodeId in workflow + per-node dispatch   | Needs Design | 2   | task.0279 |
| **Per-node worker DB isolation** — evaluate grant/run persistence approach  | Needs Design | 2   | task.0280 |

## Constraints

- **ONE_RUN_EXECUTION_PATH**: All graph execution via `GraphRunWorkflow` — no inline execution in HTTP handlers (P1 goal)
- **IDEMPOTENT_RUN_START**: `workflowId = graph-run:{tenantId}:{idempotencyKey}` — duplicate starts are no-ops (P1 goal)
- **LITELLM_IS_REFERENCE_SET**: For billing reconciliation, LiteLLM spend/logs API is the universal reference set across all executor types. No new DB tables required for reconciliation (design review decision 2026-02-13).
- **SINGLE_RUN_LEDGER**: `graph_runs` is promoted from `schedule_runs` (rename + extend). One table for all run types. No second run table. Idempotency stays in `execution_requests`.
- **REDIS_IS_STREAM_PLANE**: Redis holds only ephemeral stream data. PostgreSQL is durable truth. Redis loss = stream interruption, not data loss.
- **SSE_FROM_REDIS_NOT_MEMORY**: SSE endpoints read from Redis Streams, not in-process memory. Enables cross-process streaming and reconnection.
- No generic event bus or rule engine — scope is graph execution only

## Dependencies

- [x] Temporal infrastructure operational (existing)
- [ ] GRAPH_EXECUTION.md P1 run persistence (for P1 of this initiative)
- [x] task.0029 callback ingest endpoint (prerequisite for task.0039 reconciler)

## As-Built Specs

- [graph-execution.md](../../docs/spec/graph-execution.md) — GraphExecutorPort, NamespaceGraphRouter, billing, streaming
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

**Branch:** Cut a clean branch from `main` for implementation.
