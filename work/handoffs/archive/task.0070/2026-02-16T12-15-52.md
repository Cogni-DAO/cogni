---
id: task.0070.handoff
type: handoff
work_item_id: task.0070
status: pending
created: 2026-02-16
updated: 2026-02-16
branch: ""
last_commit: ""
---

# Handoff: Governance Status Dashboard (User-Facing)

## Context

- **Goal**: User-facing DAO transparency page showing system tenant governance health
- **NOT** an ops monitoring tool — this is public visibility, not incident prevention
- **Shows**: Credit balance, next governance run time, recent 10 runs
- **Estimate**: 1 hour (purely additive, simple composition of existing infrastructure)
- **Key Decision**: Composition-over-ports for MVP — reuse `AccountService`, direct DB queries acceptable for single caller

## Current State

**Not Started** — design complete, ready to implement.

- ✅ Spec written: `docs/spec/governance-status-api.md`
- ✅ Task designed: `work/items/task.0070.governance-credit-health-dashboard.md`
- ❌ No code written yet
- ❌ No branch created
- ❌ No tests written

## Decisions Made

**Architectural Pattern**: [Composition Over Ports (governance-status-api.md)](../../docs/spec/governance-status-api.md#design)

- Reuse `AccountService` for balance queries (already account-agnostic)
- Direct Drizzle queries for `ai_threads` and `schedules` tables (single caller = acceptable)
- Extract to `GovernanceStatusPort` ONLY when second caller (MCP tool, CLI, worker) needs it

**Data Sources**:

- System credits: `AccountService.getBalance(COGNI_SYSTEM_BILLING_ACCOUNT_ID)` → string (BigInt serialized)
- Next run: `schedules` table query → `WHERE owner_user_id = SYSTEM_PRINCIPAL AND enabled = true ORDER BY next_run_at LIMIT 1`
- Recent runs: `ai_threads` table query → `WHERE owner_user_id = SYSTEM_PRINCIPAL AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 10`

**Why No Port Extraction?**:

Per [architecture.md](../../docs/spec/architecture.md) and [governance-status-api.md](../../docs/spec/governance-status-api.md):

- Single caller (one route) = direct queries acceptable
- Simple filtering (owner_user_id = constant)
- Read-only operations
- Clear migration path documented in spec when second caller appears

## Next Actions

- [ ] Create `src/contracts/governance.status.v1.contract.ts` — Zod contract (see task Plan section 1)
- [ ] Create `src/app/api/v1/governance/status/route.ts` — API route (see task Plan section 2)
- [ ] Create `src/app/(app)/governance/page.tsx` — Server component with auth check (see task Plan section 3)
- [ ] Create `src/app/(app)/governance/view.tsx` — Client component with React Query polling (see task Plan section 3)
- [ ] Create `src/features/governance/hooks/useGovernanceStatus.ts` — React Query hook with 30s polling (see task Plan section 4)
- [ ] Manual validation: Navigate to `/governance`, verify data displays (see task Validation section)
- [ ] Run `pnpm check` — type check + lint
- [ ] Create PR with `/pull-request` skill

## Risks / Gotchas

**BigInt Serialization**:

- `balance` from `AccountService.getBalance()` returns `bigint`
- Must call `.toString()` before JSON serialization or `JSON.stringify()` will throw
- Contract expects `systemCredits: z.string()` — this enforces the conversion

**RLS Compatibility**:

- `ai_threads` table has RLS policy: `owner_user_id = current_setting('app.current_user_id')`
- API route queries with `eq(aiThreads.ownerUserId, COGNI_SYSTEM_PRINCIPAL_USER_ID)` — compatible with RLS filter
- Route has elevated privileges but queries still filter by owner (good practice)

**System Tenant Constants**:

- Import from `@/shared/constants/system-tenant` (not hardcoded strings)
- `COGNI_SYSTEM_PRINCIPAL_USER_ID` for user queries
- `COGNI_SYSTEM_BILLING_ACCOUNT_ID` for balance queries

**Polling Interval**:

- Task uses 30s (`refetchInterval: 30000`) — not aggressive for governance data
- Research doc suggested 10s, but task simplified to 30s as governance runs are infrequent (15-60 min)

**When to Extract Port**:

- DO NOT prematurely extract `GovernanceStatusPort` "just in case"
- Extract ONLY when second caller needs it (MCP tool, CLI, worker, etc.)
- Migration path documented in spec at governance-status-api.md#future-extensions

## Pointers

| File / Resource                                    | Why it matters                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `work/items/task.0070...md`                        | Full task with plan, code samples, validation steps                        |
| `docs/spec/governance-status-api.md`               | Spec defining API contract, invariants, composition-over-ports decision    |
| `packages/db-schema/src/ai-threads.ts`             | Schema for recent runs — has ownerUserId, stateKey, metadata, updatedAt    |
| `packages/db-schema/src/scheduling.ts`             | Schema for schedules table — has nextRunAt, enabled, ownerUserId           |
| `src/ports/accounts.port.ts`                       | AccountService.getBalance() — already works for any billing account        |
| `src/shared/constants/system-tenant.ts`            | System tenant constants (COGNI_SYSTEM_PRINCIPAL_USER_ID, etc.)             |
| `src/app/(app)/activity/page.tsx`                  | Existing pattern for server component with auth check                      |
| `src/app/(app)/credits/view.tsx`                   | Existing pattern for React Query polling (credits balance)                 |
| `docs/research/governance-visibility-dashboard.md` | Research doc explaining why polling > SSE/WebSocket for this use case      |
| `work/items/story.0063...md`                       | Parent story (larger scope with heartbeats, EDOs, etc.) — this task is MVP |
