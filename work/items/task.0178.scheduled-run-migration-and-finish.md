---
id: task.0178
type: task
title: "Delete old scheduled run path, prune dead tables, observability + documentation finish"
status: done
priority: 0
rank: 1
estimate: 3
summary: "BLOCKER: GovernanceScheduledRunWorkflow missing from bundle crashes scheduler-worker on every heartbeat. Delete old workflow, prune schedule_runs table, clean internal API, add observability, update docs."
outcome: Zero old execution paths remain; all runs go through GraphRunWorkflow; dead tables pruned; observability traces unified runs; docs reflect as-built state
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0177
created: 2026-03-13
updated: 2026-03-22
labels:
  - ai-graphs
  - scheduler
---

# Delete Old Scheduled Run Path + Observability + Documentation

## Context

**BLOCKER for staging→main release.** Preview scheduler-worker crashes on every heartbeat:

```
TypeError: Failed to initialize workflow of type 'GovernanceScheduledRunWorkflow':
no such function is exported by the workflow bundle
```

Pre-existing Temporal schedules still reference `GovernanceScheduledRunWorkflow` but the worker bundle only exports `GraphRunWorkflow`. No migration needed — zero real users, just delete and recreate schedules.

The old `schedule_runs` table (pre-`graph_runs`) may also still exist and should be pruned.

## Requirements

- Delete `GovernanceScheduledRunWorkflow` and all references
- Delete old internal API execution path (`POST /api/internal/graphs/{graphId}/runs` inline execution) if still present
- Prune `schedule_runs` table if it still exists (replaced by `graph_runs` in task.0176)
- Delete any orphaned Temporal schedules referencing old workflow type (Temporal admin or governance sync)
- Observability: Temporal workflow spans, Redis stream publish/subscribe spans, run lifecycle metrics
- Spec docs (`unified-graph-launch.md`, `graph-execution.md`) updated to reflect as-built state
- AGENTS.md files updated if surface area changed

## Allowed Changes

- `services/scheduler-worker/src/workflows/` — delete `GovernanceScheduledRunWorkflow` and `scheduled-run.workflow.ts`
- `services/scheduler-worker/src/workflows/activity-profiles.ts` — remove old profile if present
- `packages/db-schema/src/scheduling.ts` — prune `schedule_runs` if still present
- `apps/web/src/app/api/internal/` — delete or simplify old internal execution route
- `apps/web/src/` — observability instrumentation (spans, metrics)
- `docs/spec/` — update specs to as-built
- `**/AGENTS.md` — update if public surface changed
- Migration files for table drops
- Tests

## Plan

- [ ] **Checkpoint 1: Delete old workflow + internal route**
  - Delete `GovernanceScheduledRunWorkflow` (`scheduled-run.workflow.ts`)
  - Delete or simplify old internal graph execution route
  - Remove any dual-path code, feature flags, old activity profiles
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 2: Prune dead tables**
  - Check if `schedule_runs` table still exists in schema
  - If so: create migration to drop it (data moved to `graph_runs` in task.0176)
  - Clean up any schema references (`packages/db-schema/src/scheduling.ts`)
  - Validation: `pnpm check` passes, migrations run clean

- [ ] **Checkpoint 3: Observability + docs**
  - Add OpenTelemetry spans to workflow activities and Redis operations
  - Update specs to reflect as-built state
  - Update AGENTS.md files for any changed public surface
  - Validation: `pnpm check` passes, `pnpm check:docs` passes

## Validation

**Command:**

```bash
pnpm check
pnpm check:docs
pnpm test
```

**Expected:** All checks pass. Scheduled runs use unified workflow. Docs reflect reality.

## Review Checklist

- [ ] **Work Item:** task.0178 linked in PR body
- [ ] **Spec:** ONE_RUN_EXECUTION_PATH invariant upheld for scheduled path
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
