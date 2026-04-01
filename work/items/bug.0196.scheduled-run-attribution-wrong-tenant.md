---
id: bug.0196
type: bug
title: "Scheduled runs attributed to system tenant instead of schedule owner"
status: needs_merge
priority: 1
rank: 3
estimate: 3
summary: User-created scheduled runs are written with requestedBy=COGNI_SYSTEM_PRINCIPAL_USER_ID, making them invisible in "My Runs" and incorrectly visible under system scope. The adapter hardcodes the system tenant as the requester for ALL schedules, including user-owned ones.
outcome: User-created scheduled runs appear in the schedule owner's "My Runs" dashboard, not in system scope. System tenant is only the requester for governance-owned schedules.
spec_refs:
  - spec.identity-model
  - spec.database-rls
  - spec.system-tenant
  - spec.scheduler
assignees: []
credit:
project:
branch: task-0189-dashboard-p1-bridge
pr: https://github.com/Cogni-DAO/node-template/pull/626
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-25
updated: 2026-03-25
labels:
  - identity
  - scheduler
  - rls
  - dashboard
external_refs:
---

# Scheduled runs attributed to system tenant instead of schedule owner

## Observed

When a user creates a schedule via `/schedules`, runs produced by that schedule are attributed to the system tenant (`00000000-0000-4000-a000-000000000001`) instead of the user who created the schedule.

**Evidence from dev DB** (734 total runs, 5 schedules — 3 user-owned, 2 system-owned):

| `requested_by`                              | count | `run_kind`                        | actual owner             |
| ------------------------------------------- | ----- | --------------------------------- | ------------------------ |
| `cogni_system` (stale string)               | 700   | system_scheduled                  | pre-UUID-migration data  |
| `00000000-...-0001` (system principal UUID) | 28    | system_scheduled + system_webhook | mix of user + governance |
| `e55dc7c1-...` (actual user)                | 6     | user_immediate                    | user's chat runs only    |

The 3 user-owned schedules (poet, brain, ponderer) produce runs with `requestedBy = COGNI_SYSTEM_PRINCIPAL_USER_ID`, which means:

- **"My Runs" tab** → `listRunsByUser(userId=user)` → WHERE `requested_by = user` → **0 scheduled runs visible**
- **"System Runs" tab** → `listRunsByUser(userId=system)` → WHERE `requested_by = system` → **user's scheduled runs mixed with governance runs**

RLS is actually smarter — it allows the user to see runs from schedules they own (via `schedule_id IN (SELECT id FROM schedules WHERE owner_user_id = ?)`) — but the app-level WHERE clause in `listRunsByUser` defeats the RLS schedule-ownership clause by adding `eq(graphRuns.requestedBy, userId)`.

## Root Cause (3 bugs, 1 root)

### Bug A: `requestedBy` hardcoded to system tenant for ALL schedules

**File**: `apps/operator/src/adapters/server/temporal/schedule-control.adapter.ts:144`

```typescript
requestedBy: COGNI_SYSTEM_PRINCIPAL_USER_ID,  // hardcoded for ALL schedules
```

The Temporal schedule action args bake `requestedBy` at schedule-creation time. `CreateScheduleParams` has no field for the schedule owner, so the adapter defaults to the system principal. This is correct for governance schedules but wrong for user-created schedules.

### Bug B: `listRunsByUser` double-filters against RLS

**File**: `packages/db-client/src/adapters/drizzle-run.adapter.ts:223`

```typescript
const conditions = [eq(graphRuns.requestedBy, userId)];
```

RLS policy (migration 0024) grants visibility via two paths:

1. `requested_by = current_user_id` — runs you requested
2. `schedule_id IN (schedules WHERE owner_user_id = current_user_id)` — runs from your schedules

The app-level WHERE clause only uses path 1, ignoring path 2 entirely. Even if Bug A is fixed, this WHERE clause would need to match.

### Bug C: `runKind` enum conflates trigger mechanism with tenant identity

**File**: `packages/db-schema/src/scheduling.ts:58-62`

```typescript
export const GRAPH_RUN_KINDS = [
  "user_immediate", // user chatted
  "system_scheduled", // ANY schedule (user or governance)
  "system_webhook", // webhook (PR review)
] as const;
```

The `system_` prefix implies these belong to the system tenant. But user-created schedules also produce `system_scheduled` runs. The enum conflates "how it was triggered" (scheduled, immediate, webhook) with "who owns it" (system vs user). These are orthogonal concerns.

## Expected

1. **`requestedBy` = schedule owner**: User-created schedules produce runs with `requestedBy = schedule.ownerUserId`. Governance schedules produce runs with `requestedBy = COGNI_SYSTEM_PRINCIPAL_USER_ID`.
2. **"My Runs" shows user's scheduled runs**: The user who created a schedule sees its runs in their dashboard.
3. **"System Runs" shows only system-tenant runs**: Only governance-owned schedules appear under system scope.
4. **`runKind` describes mechanism, not tenant**: The enum should be `immediate`, `scheduled`, `webhook` — no `system_` prefix. Ownership is determined by `requestedBy`, not `runKind`.

## Impact

- **All users with schedules**: Scheduled runs are invisible in "My Runs". Users cannot see what their schedules are doing.
- **System scope pollution**: User-created scheduled runs appear under "System Runs", mixing personal and governance activity.
- **Identity model violation**: Per `spec.system-tenant`, the system tenant is "the first-class tenant for governance AI loops" — not a catch-all for anything a scheduler touches.

## Design: Proposed Fix

### 1. Add `ownerUserId` to `CreateScheduleParams`

**File**: `packages/scheduler-core/src/ports/schedule-control.port.ts`

```typescript
export interface CreateScheduleParams {
  // ... existing fields ...
  /** User ID of the schedule owner — used as requestedBy on produced runs */
  readonly ownerUserId: string;
}
```

### 2. Adapter uses `ownerUserId` as `requestedBy`

**File**: `apps/operator/src/adapters/server/temporal/schedule-control.adapter.ts:144`

```typescript
// Before:
requestedBy: COGNI_SYSTEM_PRINCIPAL_USER_ID,
// After:
requestedBy: params.ownerUserId,
```

### 3. Callers pass the owner

- **`DrizzleScheduleUserAdapter.createSchedule`** (`packages/db-client/src/adapters/drizzle-schedule.adapter.ts:153`): Pass `callerUserId` as `ownerUserId`
- **`syncGovernanceSchedules`** (`packages/scheduler-core/src/services/syncGovernanceSchedules.ts`): Pass `COGNI_SYSTEM_PRINCIPAL_USER_ID` as `ownerUserId`

### 4. Rename `runKind` values (migration)

```typescript
export const GRAPH_RUN_KINDS = [
  "immediate", // was "user_immediate"
  "scheduled", // was "system_scheduled"
  "webhook", // was "system_webhook"
] as const;
```

Migration: `UPDATE graph_runs SET run_kind = replace(run_kind, 'user_', '') WHERE run_kind LIKE 'user_%'; UPDATE graph_runs SET run_kind = replace(run_kind, 'system_', '') WHERE run_kind LIKE 'system_%';`

### 5. Fix `listRunsByUser` — drop redundant `requestedBy` filter

**File**: `packages/db-client/src/adapters/drizzle-run.adapter.ts:223`

The `requestedBy` WHERE clause is redundant with RLS. RLS already enforces: "you see runs you requested OR runs from your schedules." The app-level filter should not re-implement access control.

**Option A (minimal)**: Remove the `requestedBy = userId` condition entirely. Let RLS handle visibility.

**Option B (explicit)**: Match the RLS logic in the query:

```sql
WHERE (requested_by = ? OR schedule_id IN (SELECT id FROM schedules WHERE owner_user_id = ?))
```

Option A is preferred — RLS is the single source of truth for row visibility.

### 6. Fix stale `cogni_system` string data

Migration: `UPDATE graph_runs SET requested_by = '00000000-0000-4000-a000-000000000001' WHERE requested_by = 'cogni_system';`

### 7. Fix `requestedBy` column comment

**File**: `packages/db-schema/src/scheduling.ts:177`

```typescript
// Before:
/** User ID or 'cogni_system' who requested the run */
// After:
/** User ID (UUID) of the principal who requested/owns this run */
```

## Allowed Changes

- `packages/scheduler-core/src/ports/schedule-control.port.ts` — add `ownerUserId` to `CreateScheduleParams`
- `apps/operator/src/adapters/server/temporal/schedule-control.adapter.ts` — use `ownerUserId` instead of hardcoded system principal
- `packages/db-client/src/adapters/drizzle-schedule.adapter.ts` — pass `callerUserId` as `ownerUserId`
- `packages/scheduler-core/src/services/syncGovernanceSchedules.ts` — pass system principal as `ownerUserId`
- `packages/db-client/src/adapters/drizzle-run.adapter.ts` — remove redundant `requestedBy` filter in `listRunsByUser`
- `packages/db-schema/src/scheduling.ts` — rename `GRAPH_RUN_KINDS` values, fix column comment
- `apps/operator/src/adapters/server/db/migrations/` — new migration for runKind rename + stale data fix
- Tests touching the above files

## Plan

- [ ] Add `ownerUserId: string` to `CreateScheduleParams` port interface
- [ ] Update `TemporalScheduleControlAdapter.createSchedule` to use `params.ownerUserId` as `requestedBy`
- [ ] Update `DrizzleScheduleUserAdapter.createSchedule` to pass `callerUserId` as `ownerUserId`
- [ ] Update `syncGovernanceSchedules` to pass `systemUserId` as `ownerUserId`
- [ ] Remove `eq(graphRuns.requestedBy, userId)` from `listRunsByUser` — let RLS handle visibility
- [ ] New migration: rename `runKind` values (`user_immediate` → `immediate`, `system_scheduled` → `scheduled`, `system_webhook` → `webhook`)
- [ ] New migration: fix stale `cogni_system` string → UUID
- [ ] Fix column comment in `scheduling.ts`
- [ ] Update existing tests for new `ownerUserId` param and `runKind` values
- [ ] Add test: user-created schedule produces runs visible in user's `listRunsByUser`

## Validation

**Command:**

```bash
pnpm check
```

**Expected:** All checks pass.

**Manual verification:**

```sql
-- After fix: user's scheduled runs have requestedBy = user's UUID
SELECT requested_by, run_kind, graph_id FROM graph_runs
WHERE schedule_id IN (SELECT id FROM schedules WHERE owner_user_id = '<user-uuid>')
ORDER BY started_at DESC LIMIT 5;
-- Expected: requested_by = '<user-uuid>', run_kind = 'scheduled'
```

## Review Checklist

- [ ] **Work Item:** bug.0196 linked in PR body
- [ ] **Spec:** identity-model, database-rls, system-tenant invariants upheld
- [ ] **Tests:** schedule run attribution test, listRunsByUser visibility test
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
