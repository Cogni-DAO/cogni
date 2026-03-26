---
id: task.0207
type: task
title: "Generalize mc-controller for multi-role dispatch"
status: needs_design
priority: 0
rank: 1
estimate: 3
summary: "Extract Role types (RoleDefinition, WorkQueueFilter, PlaybookMap, RolePolicy) as Zod schemas. Refactor mc-controller.ts to accept --role <id>. Define CEO_ROLE (rename existing) and GIT_REVIEWER_ROLE (new, scoped to needs_merge). Add roles field to repo-spec schedules."
outcome: "mc-controller.ts --role ceo produces identical output to current hardcoded version. mc-controller.ts --role git-reviewer filters to needs_merge items only. Both produce independent AgentSnapshot files. repo-spec.yaml has schedule entries per role."
spec_refs:
  - agent-roles
  - development-lifecycle
assignees:
  - derekg1729
project: proj.agent-workforce
branch: feat/mission-control-clean
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [agents, governance, mission-control, workforce]
---

# Generalize mc-controller for Multi-Role Dispatch

## Context

task.0162 built a deterministic controller (`mc-controller.ts`) that runs observe→gate→pick→snapshot→output for a single hardcoded CEO agent. This task generalizes it to accept any `RoleDefinition` via `--role <id>`, enabling multiple agents to run the same controller with different queue filters and policies.

## Design

### Outcome

mc-controller.ts accepts `--role <id>` and loads the matching Role constant. Two roles defined: CEO (existing logic renamed) and Git Reviewer (new, `needs_merge`-only queue). Each produces independent AgentSnapshot files.

### Approach

**Solution**: Extract four typed pieces into `roles.ts`, parameterize mc-controller.ts with `--role`.

**Reuses**: Existing mc-controller.ts loop logic unchanged. Existing `WorkQuery` for queue filtering. Existing `MissionPolicy` fields reorganized into `RolePolicy`.

**Rejected**:

- "Role as a port/adapter" — premature. Roles are config, not stored entities. No CRUD needed.
- "Separate controller per role" — duplication. One controller, parameterized.
- "YAML role definitions" — premature config. Code-first until 3+ roles prove the shape.

### Invariants

- [ ] CONTROLLER_PARAMETERIZED: `--role <id>` loads matching Role constant (agent-roles spec)
- [ ] BACKWARD_COMPAT: `--role ceo` produces identical output to current hardcoded controller
- [ ] QUEUE_FILTER_IS_WORKQUERY: WorkQueueFilter maps to WorkQuery fields (agent-roles spec)
- [ ] SNAPSHOT_PER_ROLE: AgentSnapshot.roleId distinguishes snapshots (agent-roles spec)
- [ ] CODE_FIRST_NO_YAML: Role constants in TypeScript, Zod-validated (agent-roles spec)

### Files

- Create: `.openclaw/skills/mission-control/roles.ts` — Role types (Zod schemas) + CEO_ROLE + GIT_REVIEWER_ROLE constants
- Modify: `.openclaw/skills/mission-control/mc-controller.ts` — accept `--role`, load Role, use queueFilter + playbookMap
- Modify: `.openclaw/skills/mission-control/types.ts` — add RoleDefinition, WorkQueueFilter, PlaybookMap, RolePolicy schemas
- Modify: `.cogni/repo-spec.yaml` — add `roles` field to schedule entries, add PR_LIFECYCLE schedule
- Test: manual validation in gateway container (same as task.0162)

## Validation

- [ ] `mc-controller.ts --role ceo` produces identical output to current hardcoded controller
- [ ] `mc-controller.ts --role git-reviewer` only picks `needs_merge` items
- [ ] AgentSnapshot files include `roleId` field
- [ ] Unknown `--role` value exits with clear error message
- [ ] repo-spec.yaml schedules include `roles` field
