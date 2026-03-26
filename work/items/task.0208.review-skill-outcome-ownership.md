---
id: task.0208
type: task
title: "RoleHeartbeatWorkflow — reusable Temporal workflow for all roles"
status: needs_design
priority: 0
rank: 2
estimate: 3
summary: "Create RoleHeartbeatWorkflow (Temporal) that picks a work item from a filtered queue, builds context messages, delegates to GraphRunWorkflow, and processes the outcome. One workflow for all roles."
outcome: "RoleHeartbeatWorkflow runs on Temporal schedule, picks items via WorkItemQueryPort, delegates graph execution to existing GraphRunWorkflow, and updates work item status + posts to Discord. HEARTBEAT schedule wired to use this workflow instead of OpenClaw."
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
blocked_by: task.0207
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [agents, temporal, workforce]
---

# RoleHeartbeatWorkflow — Reusable Temporal Workflow for All Roles

## Context

`PrReviewWorkflow` proves the pattern: gather context → run graph → act on result. A role heartbeat is the same shape: filter queue → pick item → build context → run graph → update item. One reusable workflow handles all roles.

## Design

### Outcome

A single `RoleHeartbeatWorkflow` that any role schedule can invoke. It uses existing `GraphRunWorkflow` via `executeChild` for all graph execution (billing, observability, error handling already wired).

### Approach

**Solution**: One Temporal workflow (~30 lines) + 3 activities: `pickNextItemActivity`, `buildRoleContextActivity`, `processOutcomeActivity`. Delegates graph execution to existing `GraphRunWorkflow`.

**Reuses**: `GraphRunWorkflow` (existing), `WorkItemQueryPort` (existing), `PrReviewWorkflow` pattern (proven).

**Rejected**:

- "Per-role workflow" — duplication. All roles follow pick→context→graph→outcome.
- "mc-controller.ts as CLI" — wrong runtime. Temporal provides durability, retry, observability.
- "OpenClaw as agent runtime" — no structured output, no billing integration, fragile shell invocation.

### Invariants

- [ ] ONE_WORKFLOW_ALL_ROLES: RoleHeartbeatWorkflow is parameterized by roleId/graphId/queueFilter
- [ ] REUSE_GRAPH_RUN_WORKFLOW: delegates to GraphRunWorkflow via executeChild (spec: agent-roles)
- [ ] TEMPORAL_DETERMINISM: no I/O in workflow code, all I/O in activities (spec: temporal-patterns)
- [ ] ACTIVITY_IDEMPOTENCY: activities are idempotent with workflowId-based keys (spec: temporal-patterns)
- [ ] WORKFLOW_ID_STABILITY: workflowId = `role:${roleId}:${itemId}` (spec: temporal-patterns)

### Files

- Create: `packages/temporal-workflows/src/workflows/role-heartbeat.workflow.ts` — workflow + types
- Create: `packages/temporal-workflows/src/activities/pick-next-item.ts` — WorkItemQueryPort activity
- Create: `packages/temporal-workflows/src/activities/build-role-context.ts` — format item as messages
- Create: `packages/temporal-workflows/src/activities/process-outcome.ts` — update item + Discord
- Modify: `.cogni/repo-spec.yaml` — add PR_LIFECYCLE schedule, add roleId to HEARTBEAT
- Modify: `services/scheduler-worker/` — register new workflow + activities
- Test: `packages/temporal-workflows/tests/role-heartbeat.test.ts` — workflow unit test

## Validation

- [ ] RoleHeartbeatWorkflow picks correct item for given queueFilter
- [ ] RoleHeartbeatWorkflow returns `{ outcome: "no_op" }` when queue is empty
- [ ] RoleHeartbeatWorkflow delegates to GraphRunWorkflow via executeChild
- [ ] processOutcomeActivity updates work item status on success
- [ ] HEARTBEAT schedule fires RoleHeartbeatWorkflow with roleId=ceo-operator
- [ ] PR_LIFECYCLE schedule fires RoleHeartbeatWorkflow with roleId=git-reviewer
- [ ] `pnpm check:fast` passes
