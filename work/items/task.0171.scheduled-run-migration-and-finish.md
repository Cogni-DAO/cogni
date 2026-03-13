---
id: task.0171
type: task
title: "Scheduled run migration + observability + documentation finish pass"
status: needs_triage
priority: 1
rank: 5
estimate: 3
summary: Migrate GovernanceScheduledRunWorkflow to use GraphRunWorkflow; update schedule_runs correlation to graph_runs; add observability instrumentation; update documentation
outcome: All execution paths (API + scheduled) use GraphRunWorkflow; schedule_runs references graph_runs; observability traces unified runs; docs reflect as-built state
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0170
created: 2026-03-13
updated: 2026-03-13
labels:
  - ai-graphs
  - scheduler
---

# Scheduled Run Migration + Observability + Documentation

## Requirements

- `GovernanceScheduledRunWorkflow` delegates to `GraphRunWorkflow` instead of calling internal API directly
- `schedule_runs.run_id` correlates to `graph_runs.id` (not a standalone correlation key)
- Observability: Temporal workflow spans, Redis stream publish/subscribe spans, run lifecycle metrics
- Grafana dashboard or panel for run status distribution, latency percentiles, error rates
- Spec docs (`unified-graph-launch.md`, `graph-execution.md`) updated to reflect as-built state
- AGENTS.md files updated if surface area changed

## Allowed Changes

- `services/scheduler-worker/src/workflows/` — modify `GovernanceScheduledRunWorkflow` to delegate
- `packages/db-schema/src/scheduling.ts` — update `schedule_runs` correlation column
- `apps/web/src/` — observability instrumentation (spans, metrics)
- `docs/spec/` — update specs to as-built
- `**/AGENTS.md` — update if public surface changed
- Tests

## Plan

- [ ] **Checkpoint 1: Scheduled run migration**
  - Modify `GovernanceScheduledRunWorkflow` to start `GraphRunWorkflow` instead of calling internal API
  - Idempotency key: `schedule:{scheduleId}:{scheduledFor}`
  - Update `schedule_runs` to reference `graph_runs.id`
  - Validation: `pnpm check` passes, scheduled run tests pass

- [ ] **Checkpoint 2: Observability + docs**
  - Add OpenTelemetry spans to workflow activities and Redis operations
  - Update specs to reflect as-built state (mark draft → implemented sections)
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

- [ ] **Work Item:** task.0171 linked in PR body
- [ ] **Spec:** ONE_RUN_EXECUTION_PATH invariant upheld for scheduled path
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
