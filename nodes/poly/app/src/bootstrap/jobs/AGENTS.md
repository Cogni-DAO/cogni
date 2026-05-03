# bootstrap/jobs · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Job modules that wire business logic to the application container for ops-triggered tasks (CLI and internal routes). Each job acquires an advisory lock, resolves dependencies from the container, and delegates to a service function.

## Pointers

- [Bootstrap AGENTS.md](../AGENTS.md)
- [Governance Scheduling Spec](../../../../../docs/spec/governance-scheduling.md)

## Boundaries

```json
{
  "layer": "bootstrap",
  "may_import": ["bootstrap", "ports", "adapters/server", "shared", "types"],
  "must_not_import": ["app", "features", "core", "contracts"]
}
```

## Public Surface

- **Exports:** `runGovernanceSchedulesSyncJob()`
- **CLI (if any):** `pnpm governance:schedules:sync` (calls internal ops route)
- **Files considered API:** `syncGovernanceSchedules.job.ts`, `order-reconciler.job.ts`, `copy-trade-mirror.job.ts`, `poly-mirror-resting-sweep.job.ts`

**order-reconciler.job.ts** — 60s interval reconciler for `poly_copy_trade_fills`. Resolves typed `GetOrderResult` per row (no null skips); promotes not_found rows older than `notFoundGraceMs` to `canceled`; writes `synced_at` via `markSynced`; stamps `reconcilerLastTickAt` for the sync-health endpoint. Pure `runReconcileOnce` export for unit tests. Scaffolding — deleted in phase 4.

**copy-trade-mirror.job.ts** — 30s mirror poll per `(target, tenant)`. `buildMirrorTargetConfig` defaults `placement: {kind: "mirror_limit"}`. Sizing defaults to `{kind: "min_bet"}` except curated RN1/swisstony targets, which use hardcoded target-position pXX snapshots with `{kind: "target_percentile_scaled"}`. Individual target orders are triggers only. Wires `MirrorPipelineDeps.cancelOrder` from the per-tenant `PolyTradeExecutor`. task.5001, task.5005.

**poly-mirror-resting-sweep.job.ts** — `setInterval` (default 60s) TTL sweeper. Cancels mirror orders with `created_at < now() - MIRROR_RESTING_TTL_MINUTES` (default 20) AND `status IN ('pending','open','partial')`. Single global `findStaleOpen` query; app-side groupBy on `billing_account_id`; per-tenant `executor.cancelOrder` dispatch. Emits `poly_mirror_resting_swept_total{reason}`. task.5001.

## Ports (optional)

- **Uses ports:** `ScheduleControlPort`, `ExecutionGrantUserPort`
- **Implements ports:** none

## Responsibilities

- This directory **does**: Acquire advisory locks, resolve container deps, call service functions
- This directory **does not**: Contain business logic, expose HTTP routes, manage process lifecycle

## Usage

```bash
pnpm governance:schedules:sync  # POST /api/internal/ops/governance/schedules/sync
```

## Standards

- Jobs use `pg_advisory_lock` for single-writer safety
- Jobs import services from `@cogni/scheduler-core`, not from features

## Dependencies

- **Internal:** `@cogni/scheduler-core`, `@/bootstrap/container`, `@/adapters/server`, `@/shared/config`, `@/shared/constants`
- **External:** `drizzle-orm` (sql template tag)

## Change Protocol

- Update this file when adding new job modules
- Bump **Last reviewed** date

## Notes

- Job files are exempted from `no-internal-adapter-imports` and `no-service-db-adapter-import` dep-cruiser rules
