---
id: task.0070.handoff
type: handoff
work_item_id: task.0070
status: complete
created: 2026-02-16
updated: 2026-02-16
branch: feat/gov-dashboard
last_commit: dfe98b57
---

# Handoff: DAO Governance Status Dashboard

## Context

- **Goal**: User-facing transparency page showing system tenant governance health
- **NOT** an ops monitoring tool — this is public DAO visibility, not incident prevention
- **Displays**: Credit balance, next governance run time, recent 10 runs
- **Architecture decision**: Proper hexagonal with GovernanceStatusPort (design review completed)

## Current State

**All Checkpoints Completed** (commits c22ee70c → dfe98b57):

- ✅ **Checkpoint 1** (c22ee70c): Port & Contract Layer
- ✅ **Checkpoint 2** (efbad073): Drizzle adapter implementation
- ✅ **Checkpoint 3** (2339c97b): Feature service
- ✅ **Checkpoint 4** (73e4c80c): Container wiring
- ✅ **Checkpoint 5** (57794681): API route
- ✅ **Checkpoint 6** (2adea212): UI components (page, view, hook)
- ✅ **Final** (dfe98b57): Unit tests (5/5 passing)

## Decisions Made

**Architecture** (from design review):

- Port-based design: Route → Feature Service → Ports (AccountService + GovernanceStatusPort) → Adapters
- Port created even for single caller (hexagonal compliance, not "YAGNI")
- Link: [governance-status-api.md spec](../../docs/spec/governance-status-api.md)

**Data Flow**:

- Reuse `AccountService.getBalance()` for system balance
- New `GovernanceStatusPort` with two methods: `getScheduleStatus()`, `getRecentRuns()`
- Adapter queries: `schedules` table (next run), `ai_threads` table (recent runs)

**UI Pattern**:

- 30s polling interval (not aggressive for infrequent governance runs)
- React Query hook pattern (like `/credits` page)
- Server component + client view split

## Manual Validation (Next Steps)

- [ ] Start dev server: `pnpm dev:stack`
- [ ] Navigate to `/governance` in browser
- [ ] Verify credit balance displays
- [ ] Verify next run time displays (or "No runs scheduled")
- [ ] Verify recent runs list shows governance threads
- [ ] Wait 30s, verify page auto-refreshes

## Pre-PR Cleanup

- [ ] **IMPORTANT**: `docs/spec/streaming-status.md` was accidentally included in this branch (commit fa13657b) but is unrelated to governance status. Another developer has made modifications to it. Before creating the PR, this file needs to be cherry-picked to a separate branch or removed from the PR scope.

## Risks / Gotchas

**BigInt Serialization**:

- `AccountService.getBalance()` returns `bigint`
- Must call `.toString()` before JSON serialization
- Contract enforces `systemCredits: z.string()`

**System Tenant Constants**:

- Import from `@/shared/constants/system-tenant`
- Use `COGNI_SYSTEM_PRINCIPAL_USER_ID` for queries
- Use `COGNI_SYSTEM_BILLING_ACCOUNT_ID` for balance

**RLS Compatibility**:

- Queries use `owner_user_id` filter even though route has elevated privileges
- Compatible with future RLS policies on `ai_threads` and `schedules`

**Adapter Queries**:

- `schedules`: filter by `owner_user_id + enabled + nextRunAt IS NOT NULL`, order by `nextRunAt ASC`, limit 1
- `ai_threads`: filter by `owner_user_id + deleted_at IS NULL`, order by `updatedAt DESC`, limit 10

**Metadata Parsing**:

- `ai_threads.metadata` is JSONB with optional `title` field
- Cast as `{ title?: string }` when accessing

## Pointers

| File / Resource                                                       | Why it matters                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------- |
| [task.0070](../items/task.0070.governance-credit-health-dashboard.md) | Full task with plan, code samples, validation steps        |
| [governance-status-api.md](../../docs/spec/governance-status-api.md)  | Spec with architecture diagram, invariants, port interface |
| `src/ports/governance-status.port.ts`                                 | Port interface (completed)                                 |
| `src/contracts/governance.status.v1.contract.ts`                      | API contract (completed)                                   |
| `src/shared/constants/system-tenant.ts`                               | System tenant constants                                    |
| `src/ports/accounts.port.ts`                                          | AccountService port (reused for balance)                   |
| `packages/db-schema/src/ai-threads.ts`                                | ai_threads schema (query for recent runs)                  |
| `packages/db-schema/src/scheduling.ts`                                | schedules schema (query for next run)                      |
| `src/app/(app)/credits/CreditsPage.client.tsx`                        | Pattern: React Query polling, balance display              |
| `src/adapters/server/accounts/drizzle.adapter.ts`                     | Pattern: Drizzle adapter implementation                    |
| Commit c22ee70c                                                       | Checkpoint 1: Port and contract layer                      |
