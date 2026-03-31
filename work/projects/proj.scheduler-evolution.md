---
id: proj.scheduler-evolution
type: project
primary_charter:
title: Scheduler Evolution — Temporal Migration & Beyond
state: Active
priority: 1
estimate: 4
summary: Migrate scheduled graph execution from Graphile Worker to Temporal, add HITL integration, admin tooling
outcome: Durable, observable scheduling with incident-gated HITL and drift repair
assignees: derekg1729
created: 2026-02-07
updated: 2026-02-07
labels: [scheduler, temporal]
---

# Scheduler Evolution — Temporal Migration & Beyond

> Source: docs/SCHEDULER_SPEC.md (roadmap content extracted during docs migration)

## Goal

Evolve the scheduled graph execution system from Graphile Worker to Temporal Schedules, then add HITL integration and admin drift-repair tooling.

## Roadmap

### Crawl (P0) — Foundation + Internal API

**Goal:** Run-centric billing + ExecutionGrant + internal execution API.

| Deliverable                                                                       | Status | Est | Work Item |
| --------------------------------------------------------------------------------- | ------ | --- | --------- |
| Types: `ExecutionGrant`, `ScheduleSpec`, `ScheduleRun` in `@cogni/scheduler-core` | Done   | 1   | —         |
| Schema: `execution_grants`, `schedules`, `schedule_runs` tables                   | Done   | 1   | —         |
| Ports: `ExecutionGrantPort`, `ScheduleManagerPort`, `ScheduleRunRepository`       | Done   | 1   | —         |
| Adapters: All Drizzle adapters                                                    | Done   | 1   | —         |
| Routes: `/api/v1/schedules` CRUD endpoints                                        | Done   | 1   | —         |
| Package extraction complete                                                       | Done   | 1   | —         |
| `POST /api/internal/graphs/{graphId}/runs` — service-auth endpoint                | Done   | 2   | —         |
| Auth: Bearer `SCHEDULER_API_TOKEN`, constant-time compare                         | Done   | 1   | —         |
| Re-validate grant (validity + scope) — defense-in-depth                           | Done   | 1   | —         |
| Create `execution_requests` table with `request_hash`                             | Done   | 1   | —         |
| Stack tests for auth, idempotency, and grant validation                           | Done   | 1   | —         |

### Walk (P1) — Temporal Migration

**Goal:** Replace Graphile Worker with Temporal Schedules. Vendor-agnostic port + adapter pattern.

| Deliverable                                                        | Status      | Est | Work Item |
| ------------------------------------------------------------------ | ----------- | --- | --------- |
| `ScheduleControlPort` interface (vendor-agnostic)                  | Done        | 2   | —         |
| `TemporalScheduleControlAdapter`                                   | Done        | 2   | —         |
| Docker Infrastructure (temporal + temporal-ui + temporal-postgres) | Done        | 2   | —         |
| CRUD Integration with Temporal (failure semantics, rollback)       | Done        | 3   | —         |
| Worker Service (`services/scheduler-worker/`)                      | Done        | 3   | —         |
| Graphile Cleanup (delete `JobQueuePort`, `DrizzleJobQueueAdapter`) | Done        | 1   | —         |
| Stack test: create → describe → pause → resume → delete            | Not Started | 2   | —         |

**ScheduleControlPort Idempotency & Error Semantics:**

| Method             | Idempotent? | On Not Found                         | On Already Exists                    |
| ------------------ | ----------- | ------------------------------------ | ------------------------------------ |
| `createSchedule`   | No          | N/A                                  | Throw `ScheduleControlConflictError` |
| `pauseSchedule`    | Yes         | Throw `ScheduleControlNotFoundError` | No-op if already paused              |
| `resumeSchedule`   | Yes         | Throw `ScheduleControlNotFoundError` | No-op if already running             |
| `deleteSchedule`   | Yes         | No-op (success)                      | N/A                                  |
| `describeSchedule` | Yes         | Return `null`                        | N/A                                  |

**Temporal Error Mapping:**

| Temporal Error                   | Port Error                        |
| -------------------------------- | --------------------------------- |
| `ScheduleAlreadyRunning`         | `ScheduleControlConflictError`    |
| `ScheduleNotFoundError`          | `ScheduleControlNotFoundError`    |
| Connection/timeout errors        | `ScheduleControlUnavailableError` |
| Schedule already paused (no-op)  | Success (idempotent)              |
| Schedule already deleted (no-op) | Success (idempotent)              |

**Deleted (Graphile Cleanup):**

| File                                                           | Reason                               |
| -------------------------------------------------------------- | ------------------------------------ |
| `packages/scheduler-core/src/ports/job-queue.port.ts`          | Graphile-specific, replaced          |
| `packages/db-client/src/adapters/drizzle-job-queue.adapter.ts` | Graphile-specific, replaced          |
| `services/scheduler-worker/src/tasks/reconcile.ts`             | Temporal handles scheduling natively |

### Walk+ (P1.5) — Day Planner & AI Self-Scheduling

**Goal:** 24-hour day planner view layer over existing schedules. AI tools for self-scheduling. Human/AI co-editing with lock modes.

| Deliverable                                                 | Status    | Est | Work Item |
| ----------------------------------------------------------- | --------- | --- | --------- |
| Schedule AI tools + capability wiring (planner UI deferred) | In Review | 3   | task.0241 |

### Run (P2+)

**Goal:** HITL integration + admin drift repair.

| Deliverable                                                      | Status      | Est | Work Item            |
| ---------------------------------------------------------------- | ----------- | --- | -------------------- |
| Add Signal handler for `plane_review_decision` in workflow       | Not Started | 2   | (create at P2 start) |
| Implement Plane webhook endpoint to signal workflows             | Not Started | 2   | (create at P2 start) |
| Workflow waits for signal, then resumes execution                | Not Started | 2   | (create at P2 start) |
| `pnpm scheduler:reconcile` — one-shot drift repair command       | Not Started | 3   | (create at P2 start) |
| Compare DB schedules vs Temporal schedules                       | Not Started | 2   | (create at P2 start) |
| Report: missing, orphaned, state mismatch                        | Not Started | 1   | (create at P2 start) |
| Optional `--fix` flag with audit logging                         | Not Started | 1   | (create at P2 start) |
| Add `ok` and `error_code` columns to `execution_requests` schema | Not Started | 1   | (create at P2 start) |

## Constraints

- CRUD endpoints are the single authority for Temporal schedule lifecycle
- Worker NEVER imports graph execution code
- All execution via internal HTTP API with shared-secret auth
- `execution_requests` table is the correctness layer for slot deduplication

## Dependencies

- [x] GraphExecutorPort (GRAPH_EXECUTION.md)
- [x] Billing accounts (ACCOUNTS_DESIGN.md)
- [x] Temporal OSS deployment

## As-Built Specs

- [Scheduler Spec](../../docs/spec/scheduler.md) — Core invariants, schema, architecture

## Design Notes

**Phase Progression:**

| Phase           | Worker Entry                            | Scheduler          | Status  |
| --------------- | --------------------------------------- | ------------------ | ------- |
| **1 (Legacy)**  | `src/scripts/run-scheduler-worker.ts`   | Graphile Worker    | Deleted |
| **2 (Current)** | `services/scheduler-worker/src/main.ts` | Graphile Worker    | Merged  |
| **3 (Next)**    | `services/scheduler-temporal-worker/`   | Temporal Schedules | Planned |

**Status (2026-01-22):** P1 complete; scheduler runs in dev with stack test passing. Missing deployment infra (CI/CD, production compose).
