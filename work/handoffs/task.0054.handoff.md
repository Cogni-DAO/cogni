---
id: task.0054.handoff
type: handoff
work_item_id: task.0054
status: complete
created: 2026-02-14
updated: 2026-02-15
branch: feat/task.0054-governance-run-foundation
last_commit: 50d93e6d22b7135ad83df82fd19752d7789f1ff1
---

# Handoff: Governance Run Foundation — Tests Passing

## Context

- Governance schedules sync repo-spec charters to Temporal at deploy time (COMMUNITY, ENGINEERING, SUSTAINABILITY, GOVERN)
- Identity model refactor splits schedule IDs: `temporalScheduleId` (external) + `dbScheduleId` (internal, optional)
- Governance schedules are Temporal-only (`dbScheduleId = null`); user CRUD schedules are DB-backed (`dbScheduleId = UUID`)
- Previous handoff reported stack test failures; root cause was stale Docker packages, not code bugs
- All tests now passing (154 passed, 36 skipped)

## Current State

**✅ COMPLETE:**

- Governance schedule sync function with advisory locking
- Temporal schedule creation with identity split (temporalScheduleId + dbScheduleId)
- Internal ops route `POST /api/internal/ops/governance/schedules/sync`
- CLI helper `pnpm governance:schedules:sync`
- Deploy script integration (`platform/ci/scripts/deploy.sh`)
- Unit tests (8 passing) + stack tests (4 governance tests passing, 1 user schedule test passing)
- Package rebuild workflow documented: `pnpm packages:build` → `pnpm scheduler:docker:build` → `docker restart scheduler-worker`

**Code locations:**

- Identity model: `packages/scheduler-core/src/ports/schedule-control.port.ts` (CreateScheduleParams)
- CRUD adapter: `packages/db-client/src/adapters/drizzle-schedule.adapter.ts:155` (passes `dbScheduleId: row.id`)
- Temporal adapter: `src/adapters/server/temporal/schedule-control.adapter.ts:139` (workflow args include `dbScheduleId`)
- Workflow: `services/scheduler-worker/src/workflows/scheduled-run.workflow.ts:136-141` (conditional `schedule_runs` creation)

## Decisions Made

- **Identity separation:** Governance schedules use Temporal schedule ID as identity; no DB foreign keys (spec: [governance-scheduling](../../docs/spec/governance-scheduling.md))
- **Fail-safe for DB-backed schedules:** Workflow skips `schedule_runs` creation if `dbScheduleId` is falsy (allows Temporal-only schedules)
- **Build dependency chain:** Workspace packages must be rebuilt before Docker image rebuild to include code changes

## Next Actions

- [x] All stack tests passing (validated 2026-02-15)
- [x] Governance e2e test passing: creates schedules, executes runs, creates execution_requests
- [x] User schedule test passing: creates schedule_runs + execution_requests via CRUD API
- [ ] Final `pnpm check:full` before PR (CI parity validation)
- [ ] Commit strategy: Current work is uncommitted; previous handoff suggested atomic chunks
- [ ] PR review against governance-scheduling spec invariants

## Risks / Gotchas

- **Docker cache masking package changes:** If packages are updated but Docker build shows all "CACHED" layers, force rebuild with `--no-cache` or ensure `pnpm packages:build` runs first
- **Package rebuild required:** Changes to `@cogni/scheduler-core` or `@cogni/db-client` require `pnpm packages:build` before `pnpm scheduler:docker:build`
- **Container restart needed:** After Docker image rebuild, `docker restart scheduler-worker` required to load new code
- **Test environment:** Stack tests require `pnpm dev:stack:test` running in separate terminal OR use `pnpm test:stack:docker` with containerized app

## Pointers

| File / Resource                                                       | Why it matters                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `work/items/task.0054.governance-run-foundation.md`                   | Requirements, plan, validation steps                                  |
| `docs/spec/governance-scheduling.md`                                  | As-built spec (identity model, invariants)                            |
| `packages/scheduler-core/src/services/syncGovernanceSchedules.ts`     | Sync function - creates/resumes/pauses Temporal schedules             |
| `packages/db-client/src/adapters/drizzle-schedule.adapter.ts:109-190` | CRUD createSchedule - passes `dbScheduleId: row.id` to Temporal       |
| `src/adapters/server/temporal/schedule-control.adapter.ts:101-164`    | Temporal adapter - includes `dbScheduleId` in workflow args           |
| `services/scheduler-worker/src/workflows/scheduled-run.workflow.ts`   | Workflow - conditional schedule_runs creation based on `dbScheduleId` |
| `services/scheduler-worker/src/activities/index.ts:142-159`           | createScheduleRunActivity - inserts to schedule_runs table            |
| `tests/stack/governance/governance-sync-job.stack.test.ts`            | E2E test - sync, trigger, execution_requests validation               |
| `tests/stack/scheduling/scheduler-worker-execution.stack.test.ts`     | User schedule test - schedule_runs + execution_requests validation    |
| `src/bootstrap/jobs/syncGovernanceSchedules.job.ts`                   | Job module - advisory lock + container wiring                         |
| `.cogni/repo-spec.yaml`                                               | Governance schedules config (4 charters)                              |

## Test Validation

```bash
# Rebuild packages + Docker image + restart
pnpm packages:build
pnpm scheduler:docker:build
docker restart scheduler-worker

# Run governance tests
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/governance/

# Run user schedule test
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/scheduling/scheduler-worker-execution.stack.test.ts

# Full suite (requires dev:stack:test running)
pnpm test:stack:dev
```

**Expected:** All tests pass (154 passed as of 2026-02-15T07:26:58Z)
