---
id: task.0212
type: task
title: "ScheduledSweepWorkflow + RoleSpec + domain activities"
status: needs_implement
priority: 0
rank: 2
estimate: 3
summary: "RoleSpec type + 2 constants. ScheduledSweepWorkflow with claim/release, real GraphRunWorkflowInput, domain activities shared by integration. Wires CEO + Git Reviewer on Temporal schedules."
outcome: "ScheduledSweepWorkflow runs on Temporal, leases work items via claim(), delegates to GraphRunWorkflow, processes outcome, always releases. Two roles operational on cron schedules."
spec_refs:
  - agent-roles
  - temporal-patterns
assignees:
  - derekg1729
project: proj.agent-workforce
branch:
pr:
reviewer:
revision: 1
blocked_by: task.0211
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [agents, temporal, workforce]
---

# ScheduledSweepWorkflow + RoleSpec + Domain Activities

## Design

### Outcome

One reusable `ScheduledSweepWorkflow` for all queue-sweeping agents. RoleSpec binds capabilities to operational config. Domain activities shared by integration (work items, Discord), not per-agent.

### Approach

**Solution**: `ScheduledSweepWorkflow` (~40 lines) following PrReviewWorkflow's proven pattern. `RoleSpec` type + 2 constants. Activities organized by domain.

**Reuses**: `GraphRunWorkflow` via `executeChild`, `WorkItemCommandPort.claim()`/`release()`, PrReviewWorkflow pattern.

**Rejected**:

- "One generic workflow for ALL shapes" — webhook and sweep have different triggers/lifecycles
- "Per-agent workflow" — CEO/PM/Analyst all sweep queues, same shape
- "Read-then-act without lease" — race condition with concurrent schedules

### Invariants

- [ ] CLAIM_NOT_READ: claimNextItemActivity uses WorkItemCommandPort.claim()
- [ ] ALWAYS_RELEASE: releaseItemActivity in finally block
- [ ] REAL_GRAPHRUNINPUT: matches pr-review.workflow.ts shape
- [ ] ACTIVITIES_BY_DOMAIN: work item activities shared, not per-role
- [ ] CONTEXT_STAYS_LEAN: Temporal stores activity inputs in history

### Files

- Create: `packages/temporal-workflows/src/domain/role-spec.ts` — type + 2 constants
- Create: `packages/temporal-workflows/src/workflows/scheduled-sweep.workflow.ts`
- Create: `packages/temporal-workflows/src/activities/claim-next-item.ts`
- Create: `packages/temporal-workflows/src/activities/build-sweep-context.ts`
- Create: `packages/temporal-workflows/src/activities/process-sweep-outcome.ts`
- Create: `packages/temporal-workflows/src/activities/release-item.ts`
- Modify: `services/scheduler-worker/` — register workflow + activities
- Modify: `.cogni/repo-spec.yaml` — add schedules
- Test: workflow unit test with mocked activities

## Validation

- [ ] claimNextItemActivity calls WorkItemCommandPort.claim()
- [ ] releaseItemActivity runs even when graph execution fails (finally block)
- [ ] GraphRunWorkflow receives valid GraphRunWorkflowInput
- [ ] ScheduledSweepWorkflow returns no_op when queue empty
- [ ] Two schedules fire: HEARTBEAT (ceo-operator), PR_LIFECYCLE (git-reviewer)
- [ ] `pnpm check:fast` passes
