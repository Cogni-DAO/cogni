---
id: task.0070.handoff
type: handoff
work_item_id: task.0070
status: active
created: 2026-02-16
updated: 2026-02-16
branch: feat/gov-dashboard
last_commit: 982e1b2e
---

# Handoff: DAO Governance Status Dashboard

## Context

- **Goal**: User-facing `/governance` page showing system tenant governance health for DAO transparency
- **NOT** an ops monitoring tool — this is public DAO visibility, not incident prevention
- **Displays**: Credit balance (hero number), next governance run time, recent 10 runs (table)
- **Architecture**: Strict hexagonal — Route → Feature Service → Ports (AccountService + GovernanceStatusPort) → Drizzle Adapter
- **Spec**: [governance-status-api.md](../../docs/spec/governance-status-api.md)

## Current State

**All 6 implementation checkpoints complete** (commits c22ee70c → 982e1b2e):

- ✅ Port & Contract (`governance-status.port.ts`, `governance.status.v1.contract.ts`)
- ✅ Drizzle adapter (`drizzle-governance-status.adapter.ts`) — queries `schedules` + `ai_threads`
- ✅ Feature service (`get-governance-status.ts`) — orchestrates AccountService + GovernanceStatusPort
- ✅ Container wiring (`container.ts` → `governanceStatus` property)
- ✅ API route (`GET /api/v1/governance/status` — auth required, contract validated)
- ✅ UI (page + view + React Query hook with 30s polling)
- ✅ Unit tests (5/5 passing)
- ✅ UI refactor: proper skeleton loading, error state, Table components, hero number display

**Not started — requested by owner:**

- ❌ Activity metrics charts (spend/tokens/requests) scoped to the governance agent account
- This requires a new `/api/v1/governance/activity` endpoint reusing the existing `getActivity()` facade from `src/app/_facades/ai/activity.server.ts` but scoped to `COGNI_SYSTEM_PRINCIPAL_USER_ID` instead of the session user
- The `ActivityChart` component from `src/components/kit/data-display/ActivityChart.tsx` would be reused on the governance view
- A `TimeRangeSelector` would be added for chart period control

**Not validated:**

- ❌ Manual validation (requires `pnpm dev:stack` → navigate to `/governance`)

## Decisions Made

- Port-based design even for single caller (hexagonal compliance) — [spec](../../docs/spec/governance-status-api.md)
- `AccountService.getBalance()` returns `number` (not bigint) — contract uses `z.string()` via `.toString()` for future-proofing
- System tenant scoping: all adapter queries filter by `COGNI_SYSTEM_PRINCIPAL_USER_ID` constant
- UI layout: standard dashboard pattern (`max-w-[var(--max-width-container-screen)]`), not `PageContainer`
- 30s React Query polling (governance runs are infrequent)

## Next Actions

- [ ] Add activity charts for governance account (new endpoint + reuse ActivityChart + TimeRangeSelector)
- [ ] Manual validation: `pnpm dev:stack` → `/governance` → verify all sections render
- [ ] Run `/review-implementation` for code review
- [ ] Create PR via `/pull-request`

## Risks / Gotchas

- `docs/spec/streaming-status.md` has unstaged changes on this branch unrelated to governance — exclude from PR scope
- `getActivity()` facade is tightly coupled to `sessionUser` — to reuse for governance charts, pass a synthetic session user with `id = COGNI_SYSTEM_PRINCIPAL_USER_ID` and `walletAddress = ""` (the facade only uses `id` for account lookup)
- `ai_threads.metadata` is JSONB with optional `title` field — cast as `{ title?: string }` when accessing
- Adapter queries are not RLS-scoped (uses `getAppDb()` directly) — works because queries explicitly filter by system tenant user ID

## Pointers

| File / Resource                                                       | Why it matters                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| [task.0070](../items/task.0070.governance-credit-health-dashboard.md) | Work item with full plan and checkpoint progress     |
| [governance-status-api.md](../../docs/spec/governance-status-api.md)  | Spec: architecture diagram, invariants, data sources |
| `src/ports/governance-status.port.ts`                                 | Port interface (getScheduleStatus, getRecentRuns)    |
| `src/contracts/governance.status.v1.contract.ts`                      | Zod contract for status endpoint                     |
| `src/adapters/server/governance/drizzle-governance-status.adapter.ts` | Drizzle queries against schedules + ai_threads       |
| `src/features/governance/services/get-governance-status.ts`           | Feature service orchestrating ports                  |
| `src/bootstrap/container.ts`                                          | DI wiring (governanceStatus property)                |
| `src/app/api/v1/governance/status/route.ts`                           | API route handler                                    |
| `src/app/(app)/governance/view.tsx`                                   | Client view component                                |
| `src/app/_facades/ai/activity.server.ts`                              | Activity facade to reuse for governance charts       |
| `src/components/kit/data-display/ActivityChart.tsx`                   | Chart component to reuse on governance page          |
| `tests/unit/features/governance/get-governance-status.test.ts`        | Unit tests for feature service                       |
