---
id: task.0183
type: task
title: "Run list API: GET /api/v1/ai/runs — query graph_runs with filtering"
status: needs_design
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
updated: 2026-03-18
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

- `apps/operator/src/contracts/ai.runs.v1.contract.ts` — new contract
- `apps/operator/src/app/api/v1/ai/runs/route.ts` — new endpoint
- `apps/operator/src/features/ai/services/` — run list service
- Tests

## Plan

- [ ] **Checkpoint 1: Contract + service**
  - Define Zod contract for list runs (input: filters, output: RunCard array)
  - Feature service querying graph_runs via existing GraphRunRepository port
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 2: Route + tests**
  - GET route with auth + contract validation
  - Unit test: filter logic, auth scoping
  - Stack test: create runs → list → verify filtering
  - Validation: `pnpm check` passes

## Validation

- `pnpm check` passes
- Stack test: create graph_runs records → call GET /api/v1/ai/runs → verify response shape, filtering, auth scoping
