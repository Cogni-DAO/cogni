---
id: task.0054.handoff
type: handoff
work_item_id: task.0054
status: active
created: 2026-02-14
updated: 2026-02-15
branch: feat/task.0054-governance-run-foundation
last_commit: ff2fee5f
---

# Handoff: Governance Run Foundation — Code Review Fixes Applied

## Context

- task.0046 seeded `cogni_system` billing account. This task adds declarative governance runs — repo-spec schedules synced to Temporal at deploy time.
- Checkpoints 1-2 (config + sync function) were committed. Checkpoint 3 (job, CLI, deploy, port extensions) was in working tree.
- A code review against 10 invariants (INV-GOV-001..010) found 5 blockers. All 5 blocker fixes have been applied but are **uncommitted**.
- Contract tests moved to `tests/component/` and `tests/stack/` by the other dev. Stack tests still failing (see Next Actions).

## Current State

- **DONE (committed):** Config layer, sync function, unit tests (8 passing).
- **DONE (uncommitted, review fixes applied):**
  - B1: `container.ts` imports `serverEnv` from `@/shared/env/server-env` (avoids `server-only` crash in CLI)
  - B2: Advisory lock changed to `pg_try_advisory_lock` (non-blocking) in job module
  - B3: Duplicate charter validation added to `governanceSpecSchema` via `.refine()`
  - B4: `ensureGrant` now checks scope superset before returning existing grant
  - B5: `CreateScheduleParams` extended with `overlapPolicy` + `catchupWindowMs`; governance passes `"skip"` / `0`; adapter defaults to `"buffer_one"` / `60_000`
  - Contract test mocks updated for new `server-env` import path
  - Test fixture `getTestTemporalConfig()` added to `tests/_fixtures/temporal/client.ts`
- **FAILING (stack tests, 6 failures):**
  - `governance-sync-job.stack.test.ts` (2 failures): `pg_try_advisory_lock` result parsed as bare array but drizzle `execute()` returns `{ rows: [...] }`. Fix applied (`.rows` accessor) but **not yet validated** — may have further issues.
  - `schedule-control.stack.test.ts` (4 failures): Was passing `Client` to adapter constructor instead of config. Fix applied (uses `getTestTemporalConfig()`) but **not yet validated**.
- **NOT YET RUN:** `pnpm check` (full suite). `packages:build` and `typecheck` pass. `test:contract` passes (19/19).

## Decisions Made

- `catchupWindowMs` is `number` (milliseconds) in the port — avoids coupling to Temporal's `ms` StringValue type or adding `@temporalio/common` as a dep.
- `ScheduleOverlapPolicyHint` is a string union (`"skip" | "buffer_one" | "allow_all"`) in the port — adapter maps to Temporal enum.
- Governance contract/integration tests moved from `tests/contract/governance/` to `tests/component/` and `tests/stack/` (they need DB/Temporal infra).

## Next Actions

- [ ] Validate `pg_try_advisory_lock` fix: run `pnpm test:stack` — confirm `lockResult.rows[0]?.acquired` works with drizzle's `execute()` return shape
- [ ] Validate schedule-control stack test fix: confirm `getTestTemporalConfig()` resolves namespace correctly
- [ ] Run `pnpm check` end-to-end — fix any remaining lint/format/docs issues
- [ ] Commit in atomic chunks: (1) port extensions + adapter, (2) job + CLI + deploy, (3) review fixes, (4) test fixes
- [ ] Update work item status

## Risks / Gotchas

- **Drizzle `execute()` return shape:** The `{ rows: [...] }` fix for advisory lock is untested. If drizzle wraps differently (e.g., `QueryResultRow[]` vs `{ rows: QueryResultRow[] }`), the lock will silently no-op. Add a diagnostic log of the raw result if it fails again.
- **Package rebuild required:** Port changes in `scheduler-core` and `db-client` require `pnpm packages:build` before typecheck.
- **`catchupWindow` assertion in stack test:** Was `"0s"`, changed to `0` (number). Temporal SDK may serialize differently in `describe()` — verify the actual shape returned.
- **dep-cruiser exemptions:** `syncGovernanceSchedules.job.ts` is exempted from `no-internal-adapter-imports` and `no-service-db-adapter-import` rules.

## Pointers

| File / Resource                                                   | Why it matters                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/scheduler-core/src/services/syncGovernanceSchedules.ts` | Canonical sync function (pure orchestration)                |
| `packages/scheduler-core/src/ports/schedule-control.port.ts`      | `listScheduleIds`, `overlapPolicy`, `catchupWindowMs` added |
| `packages/db-client/src/adapters/drizzle-grant.adapter.ts`        | `ensureGrant` with scope-subset check                       |
| `src/bootstrap/jobs/syncGovernanceSchedules.job.ts`               | Job module — advisory lock + container wiring               |
| `src/scripts/governance-schedules-sync.ts`                        | CLI entry point (zero logic)                                |
| `src/adapters/server/temporal/schedule-control.adapter.ts`        | `listScheduleIds` impl, configurable overlap/catchup        |
| `src/shared/config/repoSpec.schema.ts`                            | Duplicate charter `.refine()` validation                    |
| `tests/_fixtures/temporal/client.ts`                              | `getTestTemporalConfig()` fixture                           |
| `tests/stack/governance/governance-sync-job.stack.test.ts`        | Stack test — advisory lock + end-to-end                     |
| `tests/stack/governance/schedule-control.stack.test.ts`           | Stack test — `listScheduleIds` prefix filtering             |
| `work/items/task.0054.governance-run-foundation.md`               | Work item with requirements                                 |
| `docs/spec/governance-scheduling.md`                              | As-built spec                                               |
