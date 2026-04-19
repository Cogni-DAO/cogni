---
id: task.0328
type: task
title: "Poly sync-truth — DB as CLOB cache (first slice: typed not_found, grace window, synced_at, sync-health)"
status: done
revision: 2
priority: 1
rank: 50
estimate: 1
branch: feat/poly-sync-truth
pr: "930"
created: 2026-04-19
updated: 2026-04-19
summary: "PR #918 shipped the copy-trade dashboard + reconciler, but validation revealed split-brain: CLOB says an order was canceled, dashboard DB still shows `open` because (a) reconciler skips when CLOB returns null, (b) nothing exposes sync staleness to the UI or ops. This task lands the first slice of the sync-truth architecture — DB rows are a cache of CLOB state, with observable staleness and no silent skips."
outcome: "After this slice merges: (1) reconciler never silently skips — CLOB 404 is a typed `not_found` response, (2) rows stuck `open` older than a configurable grace window (default 15m) are promoted to `canceled` with a distinct reason + alertable counter, (3) every `poly_copy_trade_fills` row has a `synced_at` the dashboard can surface as a staleness badge, (4) ops has a `/api/v1/poly/internal/sync-health` endpoint returning oldest-unsynced-row age + reconciler last-tick time."
spec_refs:
  - architecture
assignees: []
project: proj.poly-prediction-bot
labels: [poly, polymarket, copy-trading, sync, observability]
---

# task.0328 — Poly sync-truth ledger cache (first slice)

> Follow-up to [task.0323](./task.0323.poly-copy-trade-v1-hardening.md). Sibling of [task.0322](./task.0322.poly-copy-trade-phase4-design-prep.md) (P4 WS cutover — not in scope here).

## Context

PR #918 validation on 2026-04-19 exposed split-brain: agent ran `core__poly_cancel_order` + `core__poly_list_orders`, CLOB confirmed no open orders. Dashboard still showed `status: open` because `poly_copy_trade_fills.status` is written once at placement time and never re-read. The reconciler shipped in PR #918 polls `getOrder(order_id)` but silently skips when CLOB returns null — which happens exactly for the canceled orders we most need to sync. The result: rows can get permanently stuck `open`, dashboard lies, UI/agent split-brain.

The correct mental model (per the sync-truth design review): the DB is a **cache** of CLOB state, not a parallel ledger. Every row has a freshness timestamp, `null` is never a valid adapter response, and staleness is observable to the dashboard + ops.

This task is the **first slice** of that architecture. Follow-ups (event log, PnL, WS push) are deliberately NOT in scope.

## Design

### Invariants

- `GETORDER_NEVER_NULL` — `PolyTradeBundle.getOrder` and `PolymarketClobAdapter.getOrder` return a discriminated union `{found: OrderReceipt} | {status: "not_found"}`. `null` is not a valid return. Callers MUST branch on the discriminant.
- `GRACE_WINDOW_IS_CONFIG` — the "promote `not_found` to `canceled`" grace period is read from `POLY_CLOB_NOT_FOUND_GRACE_MS` via server-env, default 900_000 (15 min). No magic numbers in the reconciler body.
- `UPGRADE_IS_METERED` — every not_found-to-canceled promotion increments `poly_reconciler_not_found_upgrades_total{}`. A sudden rate change signals CLOB pruning-window drift (alertable in Grafana).
- `SYNCED_AT_WRITTEN_ON_EVERY_SYNC` — any reconciler tick that successfully reads from CLOB for a row (regardless of whether the status changed) sets `poly_copy_trade_fills.synced_at = now()`. Rows never re-checked show `synced_at IS NULL` and the dashboard renders a distinct "never synced" indicator.
- `SYNC_HEALTH_IS_PUBLIC` — `GET /api/v1/poly/internal/sync-health` returns `{oldest_unsynced_row_age_ms, rows_stale_over_60s, rows_never_synced, reconciler_last_tick_at}` with a stable Zod contract. No auth (the endpoint reads aggregate state only, no PII).
- `STALENESS_VISIBLE_IN_UI` — dashboard's Active Orders card renders a badge/tooltip when `synced_at` is `NULL` or older than `STALENESS_WARN_MS` (60s). No silent lies.

### Scope (first slice — this task)

1. **Typed `not_found`** — replace nullable `getOrder` result with a discriminated union. Update: adapter signature, `PolyTradeBundle.getOrder`, fake adapter, reconciler call sites, all tests.
2. **Grace window + metric** — new env `POLY_CLOB_NOT_FOUND_GRACE_MS` (default 15m). Reconciler promotion path: `not_found && row.age > grace → updateStatus("canceled", reason: "clob_not_found")` + increment new counter `poly_reconciler_not_found_upgrades_total`.
3. **`synced_at` column** — Drizzle migration adding `synced_at timestamptz NULL` to `poly_copy_trade_fills`. Reconciler writes it on every successful CLOB read. Dashboard order-list API surfaces it + a `staleness_ms` derived field. UI renders a badge.
4. **Sync-health endpoint** — new route `/api/v1/poly/internal/sync-health` with Zod contract in `packages/node-contracts/`.

### Out of scope (follow-up slice, NOT this task)

- `poly_copy_trade_status_events` append-only audit log + dedup key
- Realized PnL materialization on status transition
- `poly_market_prices` cache + mark-price poller
- `/api/v1/poly/pnl` endpoint + `core__poly_get_pnl` agent tool
- CLOB WS user-channel subscription (task.0322 territory)
- SSE push to dashboard (task.0322 territory)

### Allowed changes

- `packages/market-provider/src/adapters/polymarket/polymarket-clob.adapter.ts` — `getOrder` return type
- `nodes/poly/app/src/adapters/test/poly-trade/fake-polymarket-clob.adapter.ts` — fake match
- `nodes/poly/app/src/bootstrap/capabilities/poly-trade.ts` — bundle `getOrder` signature, lazy wrapper
- `nodes/poly/app/src/bootstrap/jobs/order-reconciler.job.ts` — typed branching + grace window + metric
- `nodes/poly/app/src/features/trading/order-ledger.ts` + `.types.ts` — `synced_at` read/write; new `listStaleRows` or extend `listOpenOrPending`
- `nodes/poly/packages/db-schema/src/copy-trade.ts` — `syncedAt` column
- Drizzle migration directory — new SQL migration
- `nodes/poly/app/src/app/api/v1/poly/internal/sync-health/route.ts` — NEW endpoint
- `nodes/poly/app/src/app/api/v1/poly/copy-trade/orders/route.ts` — include `synced_at` + `staleness_ms`
- `packages/node-contracts/src/poly.copy-trade.orders.v1.contract.ts` — extend row shape
- `packages/node-contracts/src/poly.sync-health.v1.contract.ts` — NEW contract
- `nodes/poly/app/src/components/copy-trade/active-orders-card.tsx` (or wherever orders render) — staleness badge
- `packages/node-shared/src/observability/events/index.ts` — new event names if needed
- Test files for all of the above
- `nodes/poly/app/src/config/server-env.ts` — new env var
- `docs/guides/polymarket-account-setup.md` — doc the new env var
- This work item + `_index.md`

## Plan

- [x] **Checkpoint 1: typed not_found** — `206ae65f4`
  - Milestone: adapter + bundle + reconciler + tests compile with new discriminated union; reconciler behavior unchanged semantically (null-skip becomes "not_found no-op" pending CP2)
  - Invariants: `GETORDER_NEVER_NULL` ✅
  - Todos: all complete. 26 poly unit tests + 87 market-provider tests green.

- [x] **Checkpoint 2: grace window + metric** — `9f438db30` (9 tests green)
  - Milestone: `not_found` + row older than grace window promotes to `canceled` with reason, metric increments. Telemetry-first rollout.
  - Invariants: `GRACE_WINDOW_IS_CONFIG`, `UPGRADE_IS_METERED`
  - Todos:
    - [ ] Add `POLY_CLOB_NOT_FOUND_GRACE_MS` to `server-env.ts` (default 900_000, parse as int)
    - [ ] Thread through `startOrderReconciler` deps → `runReconcileOnce`
    - [ ] Add metric name `poly_reconciler_not_found_upgrades_total` (no labels — single counter)
    - [ ] Promotion logic: `if not_found && (now - row.created_at) > grace → ledger.updateStatus({client_order_id, status:"canceled", reason:"clob_not_found"})` + `metrics.incr(upgrades_total)`
    - [ ] Extend `updateStatus` to accept `reason?: string` stored in `attributes.reason`
    - [ ] Event name for the log: `poly.reconciler.not_found_upgrade`
    - [ ] Doc env var in `docs/guides/polymarket-account-setup.md` (or a reconciler section)
  - Validation:
    - [ ] unit: reconciler test — `not_found` + stale row → status flips to `canceled`, counter++
    - [ ] unit: reconciler test — `not_found` + fresh row → no-op (grace not yet elapsed)

- [x] **Checkpoint 3: synced_at column + wiring** — `2e96a4909` (14 tests green)
  - Milestone: every reconciler read stamps `synced_at`, surfaced on orders API, visible in UI as staleness badge
  - Invariants: `SYNCED_AT_WRITTEN_ON_EVERY_SYNC`, `STALENESS_VISIBLE_IN_UI`
  - Todos:
    - [ ] Drizzle migration: `ALTER TABLE poly_copy_trade_fills ADD COLUMN synced_at timestamptz` (nullable)
    - [ ] Update `copy-trade.ts` Drizzle schema: `syncedAt: timestamp('synced_at', { withTimezone: true })`
    - [ ] New method `ledger.markSynced({client_order_ids: string[]})` — bulk `UPDATE ... SET synced_at = now() WHERE client_order_id IN (...)`. Bulk because a reconciler tick touches up to 200 rows.
    - [ ] Reconciler: call `markSynced` for every row for which `getOrder` returned a typed answer (found OR not_found — both count as "we heard from CLOB")
    - [ ] `LedgerRow.synced_at: Date | null` + `listRecent` returns it
    - [ ] Orders API contract adds `synced_at: string | null` + `staleness_ms: number | null` (derived server-side)
    - [ ] Active-orders-card renders a subtle grey dot or "stale" tooltip when `staleness_ms > 60_000` OR `synced_at === null`
  - Validation:
    - [ ] unit: ledger test — `markSynced` updates rows
    - [ ] unit: reconciler test — `markSynced` called with all processed client_order_ids
    - [ ] contract: orders contract parses the new fields
    - [ ] component (if feasible): renders badge when stale

- [x] **Checkpoint 4: sync-health endpoint** — `c1a3699bc` (+14 tests)
  - Milestone: `GET /api/v1/poly/internal/sync-health` returns aggregate freshness. Dashboard gains a banner (optional in this slice — endpoint alone is enough).
  - Invariants: `SYNC_HEALTH_IS_PUBLIC`
  - Todos:
    - [ ] New contract `poly.sync-health.v1.contract.ts` — Zod response shape `{oldest_unsynced_row_age_ms: number | null, rows_stale_over_60s: number, rows_never_synced: number, reconciler_last_tick_at: string | null}`
    - [ ] Reconciler: on every successful tick, persist `last_tick_at` (in-memory singleton is fine for v0 — cross-process sync is P2)
    - [ ] New method `ledger.syncHealthSummary()` — one aggregate SELECT
    - [ ] New route `app/api/v1/poly/internal/sync-health/route.ts` — reads ledger + reconciler snapshot; returns Zod-validated response
    - [ ] (Stretch — deferable) dashboard banner component; not a blocker
  - Validation:
    - [ ] contract: `sync-health.v1.contract.ts` parses expected shape
    - [ ] unit: ledger test — `syncHealthSummary` returns correct counts on a fixture
    - [ ] stack or component (pick one): route returns 200 + valid body

## Review Feedback (revision 2 — 2026-04-19) — APPROVED

Verified all 11 rev1 fixes landed correctly. Three non-blocking UI a11y/opacity nits filed as follow-ups; not blocking merge:

- `focus-visible:outline-none` on clickable row removes focus indicator without a visible substitute — add `focus-visible:ring-2 focus-visible:ring-ring`.
- `role="link"` on `<tr>` with multiple cells produces incoherent screen-reader narration — either drop the role or wrap the market-title cell in a real `<a>`.
- `bg-[hsl(var(--chart-1))]/70` — Tailwind arbitrary-value syntax for opacity likely doesn't apply; positions segment probably renders at 100%. Fix: `bg-[hsl(var(--chart-1)/0.7)]`.

Minor perf nit (not worth blocking): the grace-window `not_found → canceled` path does two UPDATEs per row (status + markSynced). Fold into one inline stamp on a follow-up.

## Review Feedback (revision 1 — 2026-04-19)

**Blocking issues** from /review-implementation:

### 1. Migration 0028 not registered with drizzle-kit (CRITICAL)

`nodes/poly/app/src/adapters/server/db/migrations/0028_synced_at_column.sql` exists but:

- Not listed in `meta/_journal.json` (journal ends at idx 27)
- No corresponding `meta/0028_snapshot.json`

Drizzle-orm's migrator reads `_journal.json` to decide which migrations to apply. The orphaned SQL file will be silently skipped at deploy. Production DB will not get the `synced_at` column, so every `listRecent` / `listOpenOrPending` / `markSynced` / `syncHealthSummary` call will throw at runtime. `pnpm check` doesn't catch it because unit tests use the fake ledger; stack tests in CI would.

**Fix**: regenerate the migration via drizzle-kit. Either:

- `cd` to repo root and run `DATABASE_URL=<local> pnpm --filter ./nodes/poly/app exec drizzle-kit generate` (preferred — regenerates journal + snapshot automatically), OR
- Delete the hand-authored `0028_synced_at_column.sql`, add the `syncedAt` column to the Drizzle schema only, then run drizzle-kit generate.

### 2. `sql.raw(String(olderThanMs))` in `listOpenOrPending`

`order-ledger.ts:279` — raw interpolation of a numeric into SQL. Not a user-input-injection exploit but fragile and bypasses parameter binding. A future caller passing a float produces invalid SQL silently.

**Fix**: `sql\`now() - make_interval(secs => ${olderThanMs} / 1000.0)\``or`sql\`now() - ${olderThanMs} \* interval '1 millisecond'\``.

### 3. `/sync-health` leaks `err.message`

`nodes/poly/app/src/app/api/v1/poly/internal/sync-health/route.ts:45-48` — `err.message` is returned directly in the 500-response body. Potential information disclosure (SQL errors, stack messages, connection strings).

**Fix**: log the error via `ctx.log`; return only `{ error: "sync_health_error" }`.

### 4. Contract field `oldest_unsynced_row_age_ms` is misnamed

`packages/node-contracts/src/poly.sync-health.v1.contract.ts:20` — the field represents the age of the least-recently-**synced** row. A truly unsynced row has no age (counted in `rows_never_synced`). The contract's own docstring L10–11 admits the contradiction. Consumers will misread it.

**Fix**: rename to `oldest_synced_row_age_ms` (or `oldest_sync_age_ms`). Zero-cost now; expensive after downstream consumers subscribe.

### Non-blocking suggestions

- **Outdated invariant**: `OrderActivityCard.tsx:11` still claims `LEDGER_STATUS_MAY_BE_STALE: status is set at placement time and is not reconciled with the CLOB.` That's exactly what this PR fixes. Replace with an accurate `LEDGER_STATUS_IS_RECONCILED` invariant noting the `synced_at` freshness signal.
- **Outdated agent hint** `OrderActivityCard.tsx:67` — the agent payload hint still references task.0323 §2 and tells the agent to cross-check against Data-API. Update to reflect the new truth: staleness is self-declared via `staleness_ms`.
- **Dead metric alias**: `order-reconciler.job.ts:52-74` — drop `RECONCILER_METRICS` and keep only `ORDER_RECONCILER_METRICS`. The "back-compat" comment is wrong; this PR is the first consumer.
- **Unused dep**: `getOperatorPositions` on reconciler deps is accepted but never called. Either use it (redemption-sync) or remove it; required-but-unused wastes test scaffolding.
- **Discriminant style**: `order-reconciler.job.ts:187` uses `!("found" in result)` — prefer `if (result.status === "not_found")` to match the contract's discriminator.
- **Per-request ledger instantiation**: both routes (`orders/route.ts:112`, `sync-health/route.ts:28`) build a fresh `createOrderLedger` per request. Container should expose a singleton.
- **No wrapRouteHandlerWithLogging on /sync-health**: loses correlation ids that every other route has.
- **Redundant SQL FILTER**: `order-ledger.ts:348-361` applies `FILTER (WHERE synced_at IS NOT NULL)` to `MIN(synced_at)` — MIN already ignores NULLs.

## Validation

This task is done when:

- All 4 checkpoints land with green tests
- `pnpm check` passes
- Deployed to canary, the stuck `0xb79e…` row (or any like it) transitions to `canceled` within one grace window
- Dashboard shows a staleness indicator for rows older than 60s
- `/api/v1/poly/internal/sync-health` returns accurate aggregates

## Revision 1 — what changed (2026-04-19)

All 11 items from the /review-implementation blocking + non-blocking feedback addressed in
commit `8cb598690`.

**Blocking fixes:**

- Migration 0028 regenerated via drizzle-kit; manually constructed missing `0027_snapshot.json`
  so drizzle-kit diffs correctly (produces ALTER TABLE, not CREATE TABLE). Old hand-authored
  `0028_synced_at_column.sql` deleted. New file: `0028_small_doomsday.sql`.
- `sql.raw(String(olderThanMs))` → `sql\`now() - make_interval(secs => ${olderThanMs} / 1000.0)\``
- `/sync-health` now uses `wrapRouteHandlerWithLogging`; error logs via `ctx.log.error` and
  returns only `{ error: "sync_health_error" }` — no `err.message` leak.
- `oldest_unsynced_row_age_ms` → `oldest_synced_row_age_ms` in contract, types, impl, fake, tests.

**Non-blocking fixes:**

- `LEDGER_STATUS_MAY_BE_STALE` → `LEDGER_STATUS_IS_RECONCILED` in OrderActivityCard.tsx.
- Dropped `RECONCILER_METRICS` alias; single canonical `ORDER_RECONCILER_METRICS` export.
- Removed `getOperatorPositions` from `OrderReconcilerDeps` (never called); added
  `TODO(task.0329)` at file top.
- `!("found" in result)` kept — `result.status === "not_found"` does not type-check because
  `{ found: OrderReceipt }` has no `status` property.
- `orderLedger` singleton exposed on `Container`; both `/sync-health` and `/orders` routes
  use `getContainer().orderLedger`.
- Removed redundant `FILTER (WHERE synced_at IS NOT NULL)` from `MIN(synced_at)` aggregate.
- `/sync-health` covered by `wrapRouteHandlerWithLogging` (fix 3 + 11 combined).
