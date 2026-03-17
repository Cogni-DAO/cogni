---
id: task.0178
type: task
title: "Delete old scheduled run path + observability + documentation finish"
status: needs_triage
priority: 1
rank: 5
estimate: 3
summary: Delete GovernanceScheduledRunWorkflow (replaced by GraphRunWorkflow in task.0176); delete old dual-path code; add observability instrumentation; update documentation
outcome: Zero old execution paths remain; all runs go through GraphRunWorkflow; observability traces unified runs; docs reflect as-built state
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0177
created: 2026-03-13
updated: 2026-03-13
labels:
  - ai-graphs
  - scheduler
---

# Delete Old Scheduled Run Path + Observability + Documentation

## Context

Zero users — no migration needed. `GraphRunWorkflow` replaces `GovernanceScheduledRunWorkflow` (done in task.0176). This task deletes the old path, adds observability, and updates docs.

## Requirements

- Delete `GovernanceScheduledRunWorkflow` and any dual-path code
- Delete old internal API execution path (`POST /api/internal/graphs/{graphId}/runs` inline execution)
- Observability: Temporal workflow spans, Redis stream publish/subscribe spans, run lifecycle metrics
- Spec docs (`unified-graph-launch.md`, `graph-execution.md`) updated to reflect as-built state
- AGENTS.md files updated if surface area changed

## Allowed Changes

- `services/scheduler-worker/src/workflows/` — delete `GovernanceScheduledRunWorkflow`
- `apps/web/src/app/api/internal/` — delete or simplify old internal execution route
- `apps/web/src/` — observability instrumentation (spans, metrics)
- `docs/spec/` — update specs to as-built
- `**/AGENTS.md` — update if public surface changed
- Tests

## Plan

- [ ] **Checkpoint 1: Delete old paths**
  - Delete `GovernanceScheduledRunWorkflow` (replaced by `GraphRunWorkflow`)
  - Delete or simplify old internal graph execution route
  - Remove any dual-path code or feature flags
  - Validation: `pnpm check` passes, stack tests pass

- [ ] **Checkpoint 2: Observability + docs**
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
