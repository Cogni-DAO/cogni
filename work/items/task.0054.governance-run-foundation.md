---
id: task.0054
type: task
title: "Governance run foundation — declarative schedule sync"
status: done
priority: 0
estimate: 2
summary: Declarative governance schedules in repo-spec.yaml synced to Temporal at deploy time. Config layer + sync function + internal ops route + deploy wiring.
outcome: "POST /api/internal/ops/governance/schedules/sync creates Temporal schedules for each charter in repo-spec; pnpm governance:schedules:sync triggers that route."
spec_refs:
  - governance-scheduling-spec
  - scheduler-spec
assignees: cogni-dev
credit:
project: proj.system-tenant-governance
branch: feat/task.0054-governance-run-foundation
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-15
labels: [governance, system-tenant, scheduling]
external_refs:
  - docs/research/system-tenant-seeding-heartbeat-funding.md
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Governance Run Foundation — Declarative Schedule Sync

## Context

task.0046 seeded `cogni_system` billing account + revenue share. This task enables governance **runs** via declarative repo-spec schedules synced to Temporal at deploy time.

## Requirements

- `.cogni/repo-spec.yaml` has `governance.schedules` array with charter-scoped entries (COMMUNITY, ENGINEERING, SUSTAINABILITY, GOVERN)
- `repoSpecSchema` (Zod) validates governance section with `governanceScheduleSchema` (optional, defaults to empty)
- `repoSpec.server.ts` exposes `getGovernanceConfig()` accessor (lazy-cached)
- `syncGovernanceSchedules()` creates/resumes Temporal schedules, pauses removed ones
- Internal ops endpoint `POST /api/internal/ops/governance/schedules/sync` runs at deploy time (after migrations)
- `pnpm governance:schedules:sync` acts as a local helper that calls the internal ops endpoint
- Unit tests for config schema + accessor + sync function

## Allowed Changes

- `.cogni/repo-spec.yaml` — add `governance.schedules` section
- `src/shared/config/repoSpec.schema.ts` — governance schedule Zod schemas
- `src/shared/config/repoSpec.server.ts` — `getGovernanceConfig()`
- `src/shared/config/index.ts` — barrel exports
- `src/features/governance/services/syncGovernanceSchedules.ts` — sync function (new)
- `src/features/governance/AGENTS.md` — new feature AGENTS.md
- `src/app/api/internal/ops/governance/schedules/sync/route.ts` — internal deploy trigger route
- `platform/ci/scripts/deploy.sh` — add sync step
- `package.json` — governance:schedules:sync helper script (calls internal route)
- `tests/unit/shared/config/` — governance config tests
- `tests/unit/features/governance/` — sync function tests
- `docs/spec/governance-scheduling.md` — as-built spec (new)
- Doc headers on touched files

## Plan

- [x] Add `governance.schedules` to `.cogni/repo-spec.yaml` (4 charters)
- [x] Extend `repoSpecSchema` with `governanceScheduleSchema` + `governanceSpecSchema`
- [x] Add `getGovernanceConfig()` to `repoSpec.server.ts`
- [x] Export from `src/shared/config/index.ts`
- [x] Write unit tests for governance config (5 tests, all passing)
- [x] Implement `syncGovernanceSchedules()` with `GovernanceScheduleSyncDeps` interface
- [x] Write unit tests for sync function (8 tests)
- [x] Create internal ops route (`src/app/api/internal/ops/governance/schedules/sync/route.ts`)
- [x] Add `governance:schedules:sync` helper script in `package.json` (calls internal route)
- [x] Wire into `platform/ci/scripts/deploy.sh` (Step 10.1, after stack-up)
- [x] Create `src/features/governance/AGENTS.md`
- [x] Update doc headers on touched files
- [x] Final `pnpm check:docs`

## Validation

```bash
pnpm check
```

**Expected:** All checks pass.

## Review Checklist

- [ ] **Work Item:** `task.0054` linked in PR body
- [ ] **Spec:** `governance-scheduling-spec` invariants upheld
- [ ] **Tests:** config schema + accessor + sync function tests pass
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [2026-02-15 - Tests Passing](../handoffs/task.0054.handoff.md)
- Handoff (archived): [2026-02-15T07-29-43](../handoffs/archive/task.0054/2026-02-15T07-29-43.md)
- Spec: [governance-scheduling](../../docs/spec/governance-scheduling.md)

## Attribution

-
