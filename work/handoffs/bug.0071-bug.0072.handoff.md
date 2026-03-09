---
id: bug.0071-bug.0072
type: handoff
work_item_id: bug.0071
status: active
created: 2026-02-16
updated: 2026-02-16
branch: feat/v0-work-items
last_commit: 81c12c80
---

# Handoff: bug.0071 + bug.0072 — Governance schedule sync fix & error visibility

## Context

- All 4 production governance runs fail with `400: "model field is required"` every 15 minutes
- Root cause: `syncGovernanceSchedules` only sets `model` at create time; existing Temporal schedules were never updated (conflict → skip path)
- The deployment-health skill reports "0 errors" during 100% failure — it only queries `ai_llm_errors_total`, not HTTP errors or log errors
- Two bugs filed: bug.0071 (sync fix) and bug.0072 (observability blind spot)
- Both fixes belong in the same PR on `feat/v0-work-items`, as independent commits

## Current State

- **bug.0071 — DONE (uncommitted):** Port, adapter, sync service, and unit tests all updated. 11/11 tests pass. `tsc --noEmit` clean.
  - `ScheduleControlPort` now has `updateSchedule()` + widened `ScheduleDescription` (cron/timezone/input)
  - Temporal adapter implements `updateSchedule()` via `handle.update()` and extracts config from `describeSchedule()`
  - Sync logic: on conflict → describe → compare with `isDeepStrictEqual` → update if changed, skip if identical
  - Model changed from `gpt-4o-mini` → `deepseek-v3.2`
- **bug.0072 — PARTIALLY DONE (uncommitted):**
  - `queries.sh` updated: added `cmd_http_errors()`, `cmd_log_errors()`, `loki_query()` helper, wired into `cmd_all`
  - `SKILL.md` updated: new commands documented, output example updated, interpretation guidance added
  - `.claude/commands/deployment-health.md` updated: HTTP error + log error sections added with PromQL/LogQL guidance
  - **NOT YET DONE:** No update to `.claude/commands/deployment-health.md` output format example section

## Decisions Made

- Use `isDeepStrictEqual` (not `JSON.stringify`) for input comparison — avoids key-ordering false positives
- Reuse `CreateScheduleParams` for `updateSchedule()` signature — same fields, no new type needed
- `GOVERNANCE_MODEL` extracted to module constant for single-source-of-truth
- `cmd_errors` kept as legacy alias → `cmd_llm_errors` for backward compat
- Status label values are `"2xx"/"4xx"/"5xx"` strings (from `statusBucket()` in metrics.ts)

## Next Actions

- [ ] Update `.claude/commands/deployment-health.md` output format example to match SKILL.md
- [ ] Stage and commit bug.0071 changes (port, adapter, sync, job, tests)
- [ ] Stage and commit bug.0072 changes (queries.sh, SKILL.md, deployment-health.md)
- [ ] Run `pnpm check` for full lint/type validation
- [ ] Update bug.0071 and bug.0072 status to `In Progress` with branch set
- [ ] Create PR via `/pull-request`

## Risks / Gotchas

- The `describeSchedule()` input extraction casts `action.args[0]` — if Temporal SDK changes the action shape, this will silently return `null` (safe but no drift detection)
- The Loki `level >= 40` filter in `cmd_log_errors` is a numeric comparison on JSON field — verify Loki parses pino's numeric levels correctly in prod
- `queries.sh` uses `PROM_UID="grafanacloud-prom"` and `LOKI_UID="grafanacloud-logs"` — these are stable UIDs but verify they match your Grafana instance
- The `gpt-4o-mini` → `deepseek-v3.2` model change is a behavior change bundled with a bugfix — reviewer should note this

## Pointers

| File / Resource                                                           | Why it matters                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/scheduler-core/src/ports/schedule-control.port.ts`              | Port: `updateSchedule` + widened `ScheduleDescription`                           |
| `src/adapters/server/temporal/schedule-control.adapter.ts`                | Temporal adapter: `updateSchedule()` + config extraction in `describeSchedule()` |
| `packages/scheduler-core/src/services/syncGovernanceSchedules.ts`         | Sync logic: drift detection, model constant                                      |
| `src/bootstrap/jobs/syncGovernanceSchedules.job.ts`                       | Job wiring: added `updated` to summary                                           |
| `tests/unit/features/governance/services/syncGovernanceSchedules.spec.ts` | 11 unit tests covering all sync paths                                            |
| `.openclaw/skills/deployment-health/queries.sh`                           | New `cmd_http_errors` + `cmd_log_errors` commands                                |
| `.openclaw/skills/deployment-health/SKILL.md`                             | Skill docs for governance agents                                                 |
| `.claude/commands/deployment-health.md`                                   | Claude Code command (human-facing)                                               |
| `work/items/bug.0071.governance-schedule-sync-skips-config-updates.md`    | Work item                                                                        |
| `work/items/bug.0072.error-metrics-blind-spot.md`                         | Work item                                                                        |
