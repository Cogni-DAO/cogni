---
id: gov-epoch-ui-handoff
type: handoff
work_item_id: gov-epoch-ui
status: active
created: 2026-02-21
updated: 2026-02-21
branch: feat/gov-epoch-ui
last_commit: 78fcd87c
---

# Handoff: Governance Epoch UI Pages

## Context

- The `/gov` route previously only showed system AI activity (credit balance, usage charts, recent runs)
- We need 3 new pages for the epoch ledger: **Current Epoch**, **Epoch History**, and **Holdings & Ownership**
- Mockups were provided (dark theme, purple accents, contributor cards with emoji avatars, countdown timers, progress bars)
- No backend API routes exist for the ledger yet — pages use mock data shaped to match the `activity_events` model from the [epoch-ledger spec](../../docs/spec/attribution-ledger.md)
- Branch `feat/gov-epoch-ui` was cut from `feat/activity-ledger-v0`

## Current State

- **DONE**: All 3 pages implemented with mock data, tab navigation, and all feature components
- **DONE**: `pnpm check` passes clean (typecheck, lint, format, docs, arch)
- **DONE**: 4 incremental commits on `feat/gov-epoch-ui`
- **NOT DONE**: No tests written yet (unit tests for components/hooks)
- **NOT DONE**: Not pushed to remote
- **NOT DONE**: No PR created
- **NOT DONE**: Pages not wired to real API routes (mock data only, hooks have `USE_MOCK` flag)
- The 2 unstaged files (`docs/spec/decentralized-identity.md`, `work/items/task.0089...`) are from the parent branch, not this work

## Decisions Made

- Routes: `/gov` (existing system page), `/gov/epoch`, `/gov/history`, `/gov/holdings`
- Layout owns the container padding — `gov/view.tsx` had its outer container div removed
- Data model uses `activity_events` shape from spec (source + event_type), not `work_receipts`
- Contract types: `src/contracts/governance.epoch.v1.contract.ts` and `governance.holdings.v1.contract.ts`
- All credit values are BigInt-as-string per `ALL_MATH_BIGINT` invariant; display uses `Number()` conversion
- Contributor colors are 7 deterministic HSL strings applied via inline `style` (runtime values)
- See [approved plan](../../.claude/plans/wise-marinating-steele.md) for full design rationale

## Next Actions

- [ ] Push branch to remote and create PR against `feat/activity-ledger-v0` (or `staging`)
- [ ] Add unit tests for hooks (mock returns correct shapes)
- [ ] Add component render tests for key components (ContributorCard, EpochCard, HoldingCard)
- [ ] Visual QA in browser: `pnpm dev` → navigate `/gov`, `/gov/epoch`, `/gov/history`, `/gov/holdings`
- [ ] When ledger API routes ship (task.0094–0096), flip `USE_MOCK` flags in hooks to `false`
- [ ] Consider adding mobile nav entries for the new sub-pages

## Risks / Gotchas

- The `gov/layout.tsx` is a client component (uses `NavigationLink` which needs `usePathname`); this means the existing `gov/view.tsx` error/loading states no longer have their own container — they rely on the layout's container
- Mock data uses `new Date(2026, 1, ...)` which means the countdown timer will show negative/zero time after Feb 23 2026; update mock dates or connect to real data before then
- The `Badge` component's `intent="outline"` is used with custom className color overrides for SourceBadge — if Badge's API changes, these will need updating

## Pointers

| File / Resource                                    | Why it matters                                          |
| -------------------------------------------------- | ------------------------------------------------------- |
| `src/app/(app)/gov/layout.tsx`                     | Tab navigation layout wrapping all /gov/\* routes       |
| `src/contracts/governance.epoch.v1.contract.ts`    | Zod schemas for epoch + activity data                   |
| `src/contracts/governance.holdings.v1.contract.ts` | Zod schemas for holdings data                           |
| `src/features/governance/mock/epoch-mock-data.ts`  | All mock data; shaped to match contracts                |
| `src/features/governance/hooks/use*.ts`            | Three React Query hooks with USE_MOCK flags             |
| `src/features/governance/components/`              | 6 feature components (ContributorCard, EpochCard, etc.) |
| `docs/spec/attribution-ledger.md`                  | Authoritative spec for data model and invariants        |
| `.claude/plans/wise-marinating-steele.md`          | Approved implementation plan                            |
