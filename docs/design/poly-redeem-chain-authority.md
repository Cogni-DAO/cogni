---
id: design.poly-redeem-chain-authority
type: design
status: needs_implement
created: 2026-05-04
updated: 2026-05-04
tags: [poly, redeem, dashboard, lifecycle, read-model, observability]
implements: bug.5008
---

# Poly Redeem — Chain Authority Alignment

## Outcome

Success is when **every "Redeem" button shown on the poly dashboard succeeds when clicked, every losing/unresolved row is classified into the right dashboard bucket without a Polymarket Data-API call per dashboard request, and every 409 from the manual-redeem route emits a structured Loki log with `condition_id` + `reason`.**

## Problem (observed 2026-05-04 in production)

Production user clicks `Redeem` on rows the dashboard labels `redeemable`; manual-redeem route returns `409 not_redeemable / no_redeemable_position` or `losing_outcome` on rows with positive PnL. UI also renders `Redeem` for rows whose `lifecycleState` disqualifies them, and the 409 path logs nothing useful (no `condition_id`, no `reason`). Confirmed in Loki: 5 distinct user clicks at 22:26–22:32 UTC, each `status=409, durationMs<400ms`, no observability beyond `request received` / `request complete`.

## Root cause: split-brain on "redeemable"

Two independent authorities decide whether a position is redeemable, and they disagree.

| Path                  | File                                                                                        | Source of truth                                                                             | Drives                                            |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Read-model (display)  | `nodes/poly/app/src/features/wallet-analysis/server/current-position-read-model.ts:238-257` | DB-cached Polymarket Data-API `raw.redeemable` flag **OR** ledger `lifecycleState="winner"` | Dashboard `status="redeemable"` and Action button |
| Redeem route (action) | `nodes/poly/app/src/features/redeem/resolve-redeem-decision.ts`                             | Live Data-API `/positions` + on-chain CTF `payoutNumerator/Denominator/balanceOf`           | What actually executes                            |

`raw.redeemable=true` from Polymarket Data API means **"market resolved AND you held shares at snapshot time"** — _not_ "you have a winner." Loser shares are technically `redeemable` for $0 in CTF terms (`payoutNumerator=0`). Polymarket's UI shows a "Redeem" button on losing positions too; we mistook that signal for actionability. This violates `docs/spec/poly-order-position-lifecycle.md` § Required Matrix, which makes `lifecycle="winner"` the only redeemable signal.

## Approach: `poly_market_outcomes` becomes the single chain-resolution authority

The `poly_market_outcomes` table already exists in `nodes/poly/packages/db-schema/src/trader-activity.ts:304` with the right shape: PK `(condition_id, token_id)`, `outcome IN ('winner','loser','unknown')`, `payout`, `resolved_at`, `raw`, `updated_at`. It is currently unpopulated. PR #1235's follow-ups #1 + #2 already plan to populate it and read-join it. **This PR fulfills both.**

The `redeem-subscriber` already receives every Polygon `ConditionResolution` chain event with `conditionId, outcomeSlotCount, payoutNumerators[]`. The catchup replays the same events from a cursor. Both paths already invoke `resolveRedeemCandidatesForCondition()` per funder; we simply add **one DB UPSERT per chain event** (not per funder) into `poly_market_outcomes`. Then the read-model JOINs on `(condition_id, token_id)` and derives `winner | loser` purely from DB.

**Net effect**: zero Data-API calls and zero RPC calls on the dashboard read path. Read-model lifecycle is computed from `poly_market_outcomes.outcome` directly. `raw.redeemable` is no longer consulted anywhere.

**Reuses**:

- `poly_market_outcomes` table (existing, unpopulated — `db-schema/src/trader-activity.ts:304`)
- `RedeemSubscriber.handleConditionResolution` (existing handler — adds one UPSERT, no new method)
- `redeem-catchup.ts` event replay (existing — same UPSERT runs during replay → backfills past resolutions automatically)
- `decideRedeem` policy (unchanged — still authoritative for the manual-redeem write path; the dashboard read path no longer needs it)
- Homepage `Connect` button styling (find via grep, reuse for accent color — no new design tokens)

**Rejected alternatives**:

- **Observation-driven trigger** — calling `decideRedeem` from `trader-observation-service` whenever Data-API `raw.redeemable` flips `false→true`. Re-introduces per-tick Data-API + RPC traffic. Wrong direction relative to PR #1235. Rejected.
- **Live multicall on every dashboard read** — correct but slow (~2-3s P95) and chatty against public Polygon RPC. Rejected.
- **New `chain_redeem_*` columns on `poly_trader_current_positions`** — would be a third authority parallel to `poly_market_outcomes`. Rejected; we have the right table already.
- **Lower `redeem-catchup.ts:initialFromBlock` only** — fixes backfill but does nothing if the read-model still trusts `raw.redeemable`. Necessary but insufficient. Folded into the design.

## Files

### 1. Persist resolution into `poly_market_outcomes` (subscriber + catchup)

- **Modify** `nodes/poly/app/src/features/redeem/redeem-subscriber.ts`
  - In `handleConditionResolution(logs)`, after decoding each log, derive `outcomeSlotCount = payoutNumerators.length` and for each `outcomeIndex` compute `tokenId = positionId(conditionId, indexSet)` matching CTF math (already used elsewhere — find existing helper or use viem `keccak256` per Polymarket docs).
  - UPSERT into `poly_market_outcomes` one row per `(condition_id, token_id)`: `outcome = payoutNumerators[i] > 0 ? 'winner' : 'loser'`, `payout = payoutNumerators[i] / payoutDenominator`, `resolved_at = now()`, `raw = log payload`, `updated_at = now()`. `ON CONFLICT (condition_id, token_id) DO UPDATE SET outcome=EXCLUDED.outcome, payout=EXCLUDED.payout, resolved_at=EXCLUDED.resolved_at, raw=EXCLUDED.raw, updated_at=now()`.
  - Add new `MarketOutcomesPort` interface (constructor-injected) — keeps subscriber pure of DB access. Adapter lives in `nodes/poly/app/src/adapters/server/db/`.
  - Idempotent: re-receiving the same chain log produces the same UPSERT result.

- **Modify** `nodes/poly/app/src/features/redeem/redeem-catchup.ts`
  - The catchup decodes the same `ConditionResolution` events during replay and currently calls `subscriber.handleConditionResolution()`. The new UPSERT therefore runs automatically during catchup → past resolutions back-fill on next pod boot / daily cron. Lower `initialFromBlock` in bootstrap to a generous historical floor (e.g. `BLOCK_AT_2025_06_01` — pre-launch of the poly node) so first-deploy scan covers all funder-relevant resolutions.

- **Modify** `nodes/poly/app/src/bootstrap/redeem-pipeline.ts`
  - Wire `MarketOutcomesPort` into the subscriber + catchup.

### 2. Read-model JOIN + drop `raw.redeemable` backdoor

- **Modify** `nodes/poly/app/src/features/wallet-analysis/server/current-position-read-model.ts`
  - Add `LEFT JOIN poly_market_outcomes pmo ON pmo.condition_id = p.condition_id AND pmo.token_id = p.token_id` to the existing query (line ~84).
  - Add `pmo.outcome AS market_outcome` and `pmo.resolved_at AS market_resolved_at` to the SELECT.
  - Update `deriveCurrentPositionStatus` signature: replace the `redeemable: boolean` parameter with `marketOutcome: 'winner'|'loser'|'unknown'|null`.
  - New status logic (precedence):
    1. `marketOutcome === 'loser'` → `closed` (currentValue forced to 0 in returned position).
    2. `marketOutcome === 'winner'` → `redeemable`.
    3. terminal lifecycle (`redeemed/loser/dust/abandoned/closed`) → `closed`.
    4. lifecycle `winner` → `redeemable` (kept as fallback for the rare race where `poly_redeem_jobs` was written before `poly_market_outcomes`).
    5. `currentValue <= 0` → `closed`.
    6. else → `open`.
  - **`raw.redeemable` is dead in this codebase.** `readBoolean(raw, "redeemable")` and the parameter pass-through are removed.

### 3. UI: action label + accent color

- **Modify** `nodes/poly/app/src/app/(app)/_components/positions-table/columns.tsx`
  - In `PositionActionButton`, when `!isRedeemable && !isCloseable`: set label to `"Settled"` (matches `actionLabel("closed")`). Never fall through to `"Redeem"` for a disabled button.
  - When `isRedeemable && actionable && !busy`: swap to the homepage Connect button styling. **First** grep for the homepage Connect button to find the exact classes; reuse without creating new tokens. If the homepage uses `<Button variant="default">`, use the same here.

### 4. Manual-redeem route: 409 / 503 observability

- **Modify** `nodes/poly/app/src/app/api/v1/poly/wallet/positions/redeem/route.ts`
  - Before each error response (`pipeline_unavailable`, `wallet_adapter_unconfigured`, `not_redeemable`, `redeem_failed`, `invalid_condition_id`), call `ctx.log.info({ event: "poly.wallet.positions.redeem.<reason>", condition_id, reason, candidates: candidates?.map(c => ({ outcomeIndex: c.outcomeIndex, kind: c.decision.kind, ...(c.decision.kind!=="redeem" ? {reason: c.decision.reason}: {}) })), funder_address, billing_account_id, status_code }, "manual redeem rejected")`. The 409 path is the most important — it must log all candidate decisions so future drift is debuggable in Loki without database access.

### 5. `first_observed_at` column + Held column fix

- **Create** `nodes/poly/app/src/adapters/server/db/migrations/0041_poly_trader_current_positions_first_observed_at.sql`
  - `ALTER TABLE poly_trader_current_positions ADD COLUMN first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now();`
  - `UPDATE poly_trader_current_positions SET first_observed_at = COALESCE(last_observed_at, now()) WHERE first_observed_at = (SELECT MIN(first_observed_at) FROM poly_trader_current_positions);` — backfill existing rows from `last_observed_at`.
- **Modify** `nodes/poly/packages/db-schema/src/trader-activity.ts`
  - Add `firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull().defaultNow()` to `polyTraderCurrentPositions`.
- **Modify** `nodes/poly/app/src/features/wallet-analysis/server/trader-observation-service.ts:persistObservedCurrentPositions()`
  - On `INSERT ... ON CONFLICT ... DO UPDATE`: explicitly **exclude** `first_observed_at` from the SET clause so it stays at its insert-time value.
- **Modify** `nodes/poly/app/src/features/wallet-analysis/server/current-position-read-model.ts`
  - SELECT `p.first_observed_at`. In `rowToExecutionPosition`: `openedAt = first_observed_at ?? last_observed_at` (fallback for pre-migration rows). `heldMinutes = capturedAt - openedAt`.

### 6. Migration journal

- **Update** `nodes/poly/app/src/adapters/server/db/migrations/meta/_journal.json` — add 0041 entry per existing convention.

### 7. Spec update

- **Modify** `docs/spec/poly-order-position-lifecycle.md`
  - § Dashboard Classification: replace ledger-only flowchart with the new model — `poly_trader_current_positions` is current inventory, `poly_market_outcomes` is chain-resolution authority for `winner | loser`, `poly_copy_trade_fills` is closed history.
  - § Redeem State Machine: document `poly_market_outcomes` UPSERT as a fourth event in the redeem mirror table, sourced from `ConditionResolution`.

### 8. Tests (targeted; CI runs full)

- **Create** `nodes/poly/app/tests/component/features/redeem/condition-resolution-outcomes-upsert.test.ts`
  - Drive `RedeemSubscriber.handleConditionResolution` with a synthetic 2-outcome `ConditionResolution` log (`payoutNumerators=[1,0], payoutDenominator=1`); assert `poly_market_outcomes` has rows for both `(condition_id, token_id)` pairs with `outcome='winner'` for index 0, `outcome='loser'` for index 1.
  - Re-drive with the same log; assert one row per `(condition_id, token_id)` (UPSERT idempotent).
- **Create** `nodes/poly/app/tests/unit/features/wallet-analysis/derive-current-position-status.test.ts` (or add to existing)
  - Cases: `marketOutcome='loser'` + `currentValue=10` → `status="closed"`. `marketOutcome='winner'` → `status="redeemable"`. `marketOutcome=null` + `lifecycleState='winner'` → `status="redeemable"`. `marketOutcome=null` + lifecycle=null + `currentValue>0` → `status="open"`. **Ensure no test passes when only `raw.redeemable=true` is given** — the param is gone.
- **Modify** `nodes/poly/app/tests/contract/app/poly.wallet.positions.redeem.routes.test.ts` (or wherever the route is contract-tested)
  - Assert log line shape for `not_redeemable` 409 path: `event="poly.wallet.positions.redeem.not_redeemable"`, `condition_id`, `reason`, `candidates[]`.

## Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **REDEEMABLE_AUTHORITY_IS_DB**: Read-model derives `redeemable` from `poly_market_outcomes.outcome` and `poly_redeem_jobs.lifecycle_state` only. `raw.redeemable` is not read by any dashboard code path. (spec: poly-order-position-lifecycle § Required Matrix; PR #1235 direction)
- [ ] **MARKET_OUTCOMES_IS_CHAIN_AUTHORITY**: `poly_market_outcomes` is written **only** from chain `ConditionResolution` events (subscriber live + catchup replay). No Data-API path writes to it.
- [ ] **DECIDE_REDEEM_IS_AUTHORITY**: For the manual-redeem **write** path, `@cogni/poly-market-provider/policy:decideRedeem` remains the only function deciding whether a redeem job enqueues. Unchanged. (spec: existing in `resolve-redeem-decision.ts`)
- [ ] **REDEEM_409_IS_DEBUGGABLE**: Every error response from `/api/v1/poly/wallet/positions/redeem` emits a structured Loki line with `condition_id`, `reason`, and (when applicable) all candidate decisions. No silent 4xx/5xx.
- [ ] **FIRST_OBSERVED_IS_IMMUTABLE**: `poly_trader_current_positions.first_observed_at` set once on insert; subsequent upserts must not touch it. Reviewer must read the upsert SQL.
- [ ] **SWEEP_IS_NOT_AN_ARCHITECTURE**: No new Data-API `enumerate-and-fire` path. Resolution discovery is chain-event-driven (subscriber + catchup). Unchanged. (spec: existing in `redeem-subscriber.ts`)
- [ ] **SIMPLE_SOLUTION**: Reuses existing `poly_market_outcomes` table, existing `handleConditionResolution` path, existing catchup replay, existing `Connect` button styling. New surface area: 1 port interface, 1 adapter, 1 migration.
- [ ] **ARCHITECTURE_ALIGNMENT**: DB-as-truth aligned with PR #1235; brings read-model into compliance with `poly-order-position-lifecycle` spec; updates the spec where task.5007 left it stale.

## Validation

- **exercise**: On candidate-a after merge + flight, render the dashboard for the multi-tenant test wallet that has ≥1 row showing `Redeem` today. Confirm:
  1. Rows previously showing `Redeem` on positive-PnL `losing_outcome` now show `Settled` with `currentValue=0`.
  2. Rows truly redeemable (winner side, balance > 0) show the accent-color `Redeem` button; clicking it succeeds end-to-end (`tx_submitted` → `confirmed`).
  3. `Held` column shows true entry-time durations, not zeros, after a fresh sync.
- **observability**: Loki queries must show:
  1. `event="poly.ctf.subscriber.condition_resolution"` lines with new `outcomes_persisted=N` field.
  2. `event="poly.wallet.positions.redeem.not_redeemable"` lines for any rejected click — the field must include `condition_id`, `reason`, `candidates[]`.
  3. `feature.poly_wallet_execution.complete` shows `live_positions` drops to true-actionable rows; `closed_positions` absorbs the previously-misclassified loser rows.
  4. No new Data-API HTTP traffic on the dashboard read path (compare 24h request counts to the `polymarket-data-api` adapter pre/post deploy).

## Out of scope

- Replacing Polymarket Data API as the _position-inventory_ source (`poly_trader_current_positions` reconciler still pulls `/positions`; that's task.0426).
- Changing the redeem worker / reaper flow.
- Migrating `lifecycle_state` storage off `poly_copy_trade_fills`.
- Funder-vs-wallet identity reconciliation (Safe-proxy mismatch). The 409 observability added here will surface this if it's still happening post-fix; follow-up bug at that point.

## Estimated PR size

~8 files modified, 1 migration, 1 new port + adapter, 2 new test files. ~350 LOC delta. Single PR.
