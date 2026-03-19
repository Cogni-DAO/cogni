---
id: task.0183
type: task
title: "Run list API: GET /api/v1/ai/runs — query graph_runs with filtering"
status: done
branch: feat/task.0183-run-list-api
revision: 0
priority: 1
rank: 6
estimate: 2
summary: New API endpoint listing graph runs from the graph_runs table with filtering by user, status, run_kind, and pagination
outcome: GET /api/v1/ai/runs returns paginated list of runs; users see only their own runs; admins can query system runs
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.live-dashboard
blocked_by:
  - task.0176
created: 2026-03-18
updated: 2026-03-20
labels:
  - ai-graphs
  - api
---

# Run List API

## Context

The live dashboard needs a run list endpoint to populate the card grid. `graph_runs` has the data — this task exposes it via a contract-first API.

## Requirements

- `GET /api/v1/ai/runs` — session-authenticated
- Query params:
  - `status` — filter by run status (running, success, error, etc.)
  - `runKind` — filter by run_kind (user_immediate, system_scheduled)
  - `limit` — page size (default 20, max 100)
  - `cursor` — cursor-based pagination (started_at-based)
- Users see only runs where `requested_by = userId`
- Admin role can query all runs (for System tab)
- Response shape: `{ runs: RunCard[], nextCursor?: string }`

## Allowed Changes

- `packages/scheduler-core/src/ports/schedule-run.port.ts` — add `listRunsByUser`
- `packages/db-client/src/adapters/drizzle-run.adapter.ts` — implement `listRunsByUser`
- `packages/db-schema/src/scheduling.ts` — add composite index
- `apps/web/src/contracts/ai.runs.v1.contract.ts` — contract
- `apps/web/src/app/api/v1/ai/runs/route.ts` — GET endpoint
- Drizzle migration
- Tests

## Plan

- [ ] **Checkpoint 1: Port + adapter + index**
  - Milestone: `listRunsByUser` query works with filtering and cursor pagination
  - Todos:
    - [ ] Add `listRunsByUser` to `GraphRunRepository` port (scheduler-core)
    - [ ] Implement in `DrizzleGraphRunAdapter` with cursor-based pagination
    - [ ] Add composite index `(requested_by, started_at DESC)` to db-schema
    - [ ] Generate Drizzle migration
  - Validation:
    - [ ] `pnpm check` passes

- [ ] **Checkpoint 2: Contract + route + tests**
  - Milestone: GET /api/v1/ai/runs returns filtered, paginated runs
  - Todos:
    - [ ] Create `ai.runs.v1.contract.ts` — input (status?, runKind?, limit, cursor?), output (runs[], nextCursor?)
    - [ ] Create `GET /api/v1/ai/runs` route — session auth, parse query params, call port, return contract output
    - [ ] Add `statusLabel: null` and `stateKey` to output shape (dashboard compatibility)
    - [ ] Contract test for auth, filtering, pagination
  - Validation:
    - [ ] `pnpm check` passes

## Validation

```bash
pnpm check
```
