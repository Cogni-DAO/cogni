---
id: task.0178
type: task
title: "Delete old scheduled run path, prune dead tables, observability + documentation finish"
status: done
priority: 0
rank: 1
estimate: 3
summary: "Fix scheduler-worker crash — delete GovernanceScheduledRunWorkflow, remove 6 deprecated schedule_runs aliases, add LangGraph vs Temporal boundary guide to spec. Webhook alignment deferred to separate task."
outcome: Scheduler-worker stops crashing; deprecated aliases removed; LangGraph/Temporal boundary documented; webhook alignment scoped as follow-up
spec_refs:
  - spec.unified-graph-launch
assignees: []
branch: task-0178-delete-old-workflow
pr: https://github.com/Cogni-DAO/node-template/pull/616
project: proj.unified-graph-launch
blocked_by:
  - task.0177
created: 2026-03-13
updated: 2026-03-24
labels:
  - ai-graphs
  - scheduler
---

# Unified Graph Execution: Delete Old Paths + Align Webhooks

## Context

**BLOCKER for staging→main release.** Two problems:

1. **Scheduler crash**: Preview scheduler-worker crashes on every heartbeat — `GovernanceScheduledRunWorkflow` missing from bundle.
2. **Webhook inline execution**: PR review webhook (`dispatchPrReview`) calls `createGraphExecutor` → `executeStream` → inline LLM execution in Next.js process. No Temporal, no `graph_runs` record, no Redis streaming. Invisible to dashboard. Violates `ONE_RUN_EXECUTION_PATH`.

No existing schedules or data matter — zero real users.

## Design

### Outcome

All graph execution — chat, scheduled, webhook — goes through `GraphRunWorkflow` via Temporal. Dashboard shows all run types. Dead code removed.

### Approach

**Solution**: Three changes:

1. **Delete `GovernanceScheduledRunWorkflow`** — dead file, worker doesn't bundle it
2. **Refactor `dispatchPrReview`** to start `GraphRunWorkflow` via Temporal (same pattern as `completion.server.ts`). This makes webhook-triggered PR reviews appear in `graph_runs` as `system_webhook` runs, visible on dashboard.
3. **Remove deprecated aliases** — 6 re-exports of old `schedule_runs` naming

**Reuses**:

- `GraphRunWorkflow` already handles `system_scheduled` runKind — add `system_webhook` support (trivial: it's already in the runKind enum)
- `completion.server.ts` pattern: `workflowClient.start("GraphRunWorkflow", ...)` — same pattern for webhook dispatch
- Internal route (`POST /api/internal/graphs/{graphId}/runs`) already handles all execution — webhook runs flow through it like everything else

**Rejected**:

- _Keep webhook inline, track separately_ — violates the whole point of this project
- _Re-export old workflow as alias_ — dead code. Delete.
- _Migrate Temporal schedules_ — no users, nothing to migrate

### Key findings

1. **Worker bundle**: `workflowsPath` points only to `graph-run.workflow.js`. Old workflow never re-bundled.
2. **Schedule control adapter**: Already creates schedules with `workflowType: "GraphRunWorkflow"`.
3. **Internal route**: `POST /api/internal/graphs/{graphId}/runs` is actively used by `GraphRunWorkflow`. Keep.
4. **`schedule_runs` table**: Already renamed to `graph_runs` via migration 0021. Only deprecated aliases remain.
5. **PR review webhook path**: `webhooks/[source]/route.ts:126` → `dispatchPrReview` → `createGraphExecutor` → `executeStream` → inline. Bypasses Temporal, Redis, graph_runs.
6. **Deprecated aliases** (6 total): `ScheduleRunRepository`, `DrizzleScheduleRunAdapter`, `SCHEDULE_RUN_STATUSES`, `ScheduleRun`, `ScheduleRunStatus`, `scheduleRuns`.

### Webhook refactor detail

Current path:

```
webhook route → dispatchPrReview → createGraphExecutor → executeStream → inline LLM
```

New path:

```
webhook route → dispatchPrReview → workflowClient.start("GraphRunWorkflow") → Temporal → internal route → graph execution + Redis stream + graph_runs record
```

`dispatchPrReview` becomes a thin wrapper that:

1. Resolves system tenant billing account (already does this)
2. Starts `GraphRunWorkflow` via Temporal with `runKind: "system_webhook"` (new)
3. Does NOT wait for result (fire-and-forget, same as today)

The review handler (`handlePrReview`) moves into the graph execution path — the `pr-review` graph already exists in the catalog. The structured output, GitHub API calls, and comment posting happen inside the graph's tool calls or post-execution hook.

### Invariants

- [ ] ONE_RUN_EXECUTION_PATH: All graph execution via GraphRunWorkflow — no inline execution in HTTP handlers (spec: unified-graph-launch)
- [ ] SINGLE_RUN_LEDGER: Only `graph_runs` table referenced in non-migration code (spec: unified-graph-launch)
- [ ] INTERNAL_ROUTE_PRESERVED: `POST /api/internal/graphs/{graphId}/runs` remains
- [ ] WEBHOOK_RUNS_VISIBLE: PR review runs appear in graph_runs as system_webhook, visible on dashboard

### Files

**Delete:**

- `services/scheduler-worker/src/workflows/scheduled-run.workflow.ts` — dead workflow

**Modify (webhook alignment):**

- `apps/operator/src/app/_facades/review/dispatch.server.ts` — replace `createGraphExecutor` + inline execution with `workflowClient.start("GraphRunWorkflow")` via Temporal
- `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts` — ensure webhook runs (system_webhook runKind) are handled correctly (may already work)

**Modify (deprecated alias removal):**

- `packages/scheduler-core/src/index.ts` — remove deprecated re-exports
- `packages/scheduler-core/src/ports/schedule-run.port.ts` — remove `ScheduleRunRepository` alias
- `packages/scheduler-core/src/types.ts` — remove `ScheduleRun`, `ScheduleRunStatus`, `SCHEDULE_RUN_STATUSES`
- `packages/db-schema/src/scheduling.ts` — remove `scheduleRuns`, `SCHEDULE_RUN_STATUSES`
- `packages/db-client/src/adapters/drizzle-run.adapter.ts` — remove `DrizzleScheduleRunAdapter`
- `packages/db-client/src/index.ts` — remove `DrizzleScheduleRunAdapter` re-export
- `apps/operator/src/adapters/server/index.ts` — remove `DrizzleScheduleRunAdapter` re-export
- `services/scheduler-worker/src/ports/index.ts` — remove `ScheduleRunRepository` re-export

**Modify (docs):**

- `docs/spec/unified-graph-launch.md` — update to as-built state

**Test:** Existing tests should pass. PR review contract test may need update if execution path changes.

## Plan

- [ ] **Checkpoint 1: Delete old workflow**
  - Delete `scheduled-run.workflow.ts`
  - Validation: `pnpm check` passes, `pnpm test` passes

- [ ] **Checkpoint 2: Remove deprecated aliases**
  - Remove all 6 deprecated aliases across scheduler-core, db-schema, db-client, app adapters
  - Grep for any remaining imports of old names — fix if found
  - Validation: `pnpm check` passes, `pnpm packages:build` passes

- [ ] **Checkpoint 3: Align webhook PR review to Temporal**
  - Refactor `dispatchPrReview` to start `GraphRunWorkflow` with `runKind: "system_webhook"`
  - Verify internal route handles webhook runs correctly
  - Validation: `pnpm check` passes, `pnpm test` passes

- [ ] **Checkpoint 4: Docs**
  - Update `unified-graph-launch.md` spec to reflect as-built state
  - Update AGENTS.md files for any changed public surface
  - Validation: `pnpm check:docs` passes

## Validation

```bash
pnpm check
pnpm check:docs
pnpm test
```

**Expected:** All checks pass. All graph runs (chat, scheduled, webhook) go through GraphRunWorkflow. Dashboard shows all run types.

## Review Checklist

- [ ] **Work Item:** task.0178 linked in PR body
- [ ] **Spec:** ONE_RUN_EXECUTION_PATH upheld for ALL paths (chat, scheduled, webhook)
- [ ] **Tests:** PR review execution path tested
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
