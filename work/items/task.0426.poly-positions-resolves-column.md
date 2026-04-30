---
id: task.0426
type: task
title: "Add Resolves countdown column to poly PositionsTable (v0)"
status: needs_implement
priority: 1
rank: 1
estimate: 2
summary: "PositionsTable today only shows `heldMinutes` (entry → now). The Polymarket Data API already returns `endDate` (market resolve time) on every `/positions` row but it gets dropped at `mapExecutionPositions`. Wire it through and render a 'Resolves' column with a live countdown + lifecycle-aware terminal pills (Resolved · redeeming, Redeemed, Resolved · no payout)."
outcome: "WalletPosition gains `resolvesAt: string | null`. PositionsTable renders a new `resolves` column that shows: relative countdown (`in 3d 4h` / `in 14m`) when future, color-graded (muted >12h, amber 1h–12h, red <1h); and a lifecycle-aware pill when past (Redeemable / Redeemed / no payout / awaiting resolution). Column is sortable + hideable through the existing DataGrid header dropdown. Default-variant visibility ON; history-variant the same. Held column unchanged (augment, not replace)."
spec_refs:
assignees: [derekg1729]
project: proj.premium-frontend-ux
branch: feat/poly-positions-resolves-column
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-29
updated: 2026-04-29
labels: [ui, ux, poly, frontend]
---

# Add Resolves countdown column to poly PositionsTable (v0)

## Problem

Positions table answers "how long have I held this" (Held column) but not "when does it resolve" — the higher-signal question for a copy-trader watching the clock. The data is already on the wire (Data API `/positions` row → `endDate` → `PolymarketUserPosition.endDate`), it just isn't propagated past `mapExecutionPositions`.

## Approach

**Backend wire-up (mechanical):**

1. `packages/market-provider/src/analysis/position-timelines.ts`
   - Add `readonly resolvesAt?: string` to `ExecutionPosition`
   - Inside the loop: read `snapshot?.endDate`, validate non-empty + parseable, set on the mapped position. (Polymarket sometimes returns `""` → null.)
2. `packages/node-contracts/src/poly.wallet.execution.v1.contract.ts`
   - Add `resolvesAt: z.string().nullable()` to `WalletExecutionPositionSchema` after `closedAt`.
3. `nodes/poly/app/src/features/wallet-analysis/types/wallet-analysis.ts`
   - Add `resolvesAt?: string | null` to `WalletPosition` after `closedAt`.
4. `nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts`
   - In `toExecutionContractPosition`, propagate `resolvesAt: position.resolvesAt ?? null`.

**UI: new `resolves` column** in `_components/positions-table/columns.tsx`:

- `col.accessor("resolvesAt", { id: "resolves", … })`
- `sortingFn`: nulls-last datetime
- Cell renders one of:
  - **null** → em-dash (market data missing).
  - **future** → `formatRelativeTime(resolvesAt - now)` ("in 3d 4h", "in 14m"). Color: muted >12h, `text-warning` 1h–12h, `text-destructive` <1h.
  - **past + lifecycleState ∈ {redeem_pending, winner, resolving}** → "Resolving…" pill, amber.
  - **past + lifecycleState === "redeemed"** → "Redeemed" pill, success.
  - **past + lifecycleState ∈ {loser, dust, abandoned}** → "Resolved · no payout" pill, muted.
  - **past + status === "redeemable"** → "Redeem ready" pill, success-emphasized.
  - **past + still open + no terminal lifecycle** → "Awaiting resolution", warning. (Race window; rare.)
- Live ticking: a single `useNowMinute()` hook in `PositionsTable.tsx` re-renders every 60 s so the countdown stays current without re-fetching. Only the cell reads `Date.now()`; passing `now: number` through `meta` would over-engineer.

**Visibility / variants:**

- `default` variant: show `resolves` between `heldMinutes` and `currentValue`.
- `history` variant: show `resolves` between `heldMinutes` and `closedAt` — for closed positions, the cell shows the terminal-state pill so the row tells you _why_ it's closed.

**Skeleton:** `<Skeleton className="ms-auto h-3.5 w-16" />` to match the wallets-table thin model.

## Allowed Changes

- `packages/market-provider/src/analysis/position-timelines.ts`
- `packages/node-contracts/src/poly.wallet.execution.v1.contract.ts`
- `nodes/poly/app/src/features/wallet-analysis/types/wallet-analysis.ts`
- `nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts`
- `nodes/poly/app/src/app/(app)/_components/positions-table/columns.tsx`
- `nodes/poly/app/src/app/(app)/_components/positions-table/PositionsTable.tsx` (add `useNowMinute` + visibility map entry)

Out of scope:

- Replacing or removing `Held` column.
- Per-row dynamic timeline windowing (separate work — Derek's next ask).
- Auto-redeem nudge banners.
- Adding `resolvesAt` enrichment via a second Data API call (not needed; field is already on the position payload).

## Validation

exercise:

- GET `https://poly-test.cognidao.org/dashboard` (signed in) — `ExecutionActivityCard` renders the new `Resolves` column to the right of `Held`. For an open position with a market resolving >12h out, cell shows muted "in Xd Yh"; for one resolving in <12h, amber "in Xh Ym".
- Toggle to History — closed positions show terminal pill matching their `lifecycleState` ("Redeemed", "Resolved · no payout", etc.).
- Wait 60s on the page — countdown updates without a refetch.
- Hide the Resolves column via header dropdown → it disappears; toggle back → it returns.

observability:

- Loki query at deployed SHA: `{app="poly", env="candidate"} |~ "GET /api/v1/poly/wallet/execution"` returns my own positions fetch.
- `poly-test.cognidao.org/version` returns PR head SHA.
- API response sample: `curl -s https://poly-test.cognidao.org/api/v1/poly/wallet/execution` (authed) returns `live_positions[0].resolvesAt` as ISO string (or null).
