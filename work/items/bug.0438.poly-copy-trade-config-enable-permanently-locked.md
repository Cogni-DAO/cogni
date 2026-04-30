---
id: bug.0438
type: bug
title: "Purge poly_copy_trade_config kill-switch table — never had a real use, permanently locked tenants out of copy-trade with no UI path back"
status: needs_review
priority: 1
rank: 9
estimate: 1
created: 2026-04-30
updated: 2026-04-30
branch: fix/poly-copy-trade-config-enable-flow
summary: "Migration 0029 backfills every tenant's `poly_copy_trade_config` with `enabled=false`. The targets POST route upserts `enabled=true` with `onConflictDoNothing()` — meaning the default-false row is never overwritten. There's no UI control to flip the kill-switch and the targets POST silently no-ops on the config side, so every non-system tenant is permanently locked out of copy-trade unless an admin runs an SQL `UPDATE` against the DB. Discovered live on prod 2026-04-30: Derek's bid `207795de-…` had `enabled=false` for 6 days while the UI showed 'copy-trade enabled' (UI's enable-state is wired to target-presence, not the kill-switch — so users get a silent lie). After landing #1149, prod's copy-trade reconciler tick fired every 30s with `active_targets=0` even though Derek had RN1 as a tracked target."
outcome: "Drop the `poly_copy_trade_config` table entirely. Migration 0036 issues `DROP TABLE poly_copy_trade_config CASCADE`. The cross-tenant enumerator's `target × connection × grant` join becomes the sole gate to autonomous mirror placement — no separate kill-switch table, no `enabled` column to flip, no UI control to maintain. Per-tenant USDC caps already live on `poly_wallet_grants` (per_order_usdc_cap, daily_usdc_cap), where they belong. The act of POSTing a target IS the user's opt-in; DELETE on the target row (or revoking the grant/connection) is the only way to stop mirror placements. `kill_switch_off` skip reason removed from the planner; `enabled` field removed from the API contract response, the StateSnapshot type, the TargetConfig type, the FakeOrderLedger fixture, and the tests."
assignees: []
spec_refs:
  - poly-multi-tenant-auth
project: proj.poly-copy-trading
deploy_verified: false
labels: [poly, copy-trade, kill-switch, ui-drift, prod-incident]
external_refs:
  - work/items/task.0429.poly-auto-wrap-usdce-to-pusd.md
  - https://github.com/Cogni-DAO/node-template/pull/1149
---

# bug.0438 — copy-trade kill-switch permanently-locked default-false

## Why this exists (prod incident, 2026-04-30 ~22:30 UTC)

After PR #1149 promoted to prod (sha `5871a7da`), Derek's prod copy-trade did nothing despite an active target row (`RN1 = 0x2005d16a84ceef…`) visible in the dashboard. The reconciler tick fired every 30s reporting `active_targets=0`. Investigation:

- `poly_copy_trade_targets` for bid `207795de-891c-4791-9f8b-aa0f0bcc4911`: 1 active row (`disabled_at IS NULL`)
- `poly_wallet_connections`: not revoked, `trading_approvals_ready_at` set
- `poly_wallet_grants`: not revoked, no expiry, `{poly:trade:buy, poly:trade:sell}` scopes
- **`poly_copy_trade_config.enabled = false`**, `updated_at = 2026-04-24 03:52` — untouched for 6 days

The UI control Derek interacted with ("Copy Trading: Enabled") is wired to `target-list non-empty`, NOT to `poly_copy_trade_config.enabled`. So the indicator and the actual gate disagree. There is no UI affordance to flip the kill-switch.

The targets POST route (line 192 pre-fix):

```ts
.insert(polyCopyTradeConfig)
.values({ billingAccountId, createdByUserId, enabled: true })
.onConflictDoNothing();    // ← if a row already exists with enabled=false, no-op
```

So the spec invariant `CONFIG_ROW_AUTO_ENABLED_ON_FIRST_POST` only fired the first time anyone POSTed a target on a tenant with NO config row. Every other path was a silent no-op. Migration 0029 had backfilled the row at `enabled=false` for every existing tenant, locking them all out.

## Fix

Change the upsert semantics in the targets POST route:

```ts
.onConflictDoUpdate({
  target: polyCopyTradeConfig.billingAccountId,
  set: { enabled: true },
});
```

Adding a target is the user's opt-in act. The kill-switch's purpose is to gate the autonomous mirror loop; an explicit POST on a target is itself the strongest possible signal that the loop should run. Renamed the spec invariant from `CONFIG_ROW_AUTO_ENABLED_ON_FIRST_POST` → `CONFIG_ROW_ENABLED_ON_TARGET_POST` to reflect the broader semantics.

## Out of scope

- A dedicated `/api/v1/poly/copy-trade/config` PATCH route + UI control to explicitly disable copy-trade (preserving the existing-target). v1 scope; users today can only "stop" copy-trade by deleting their last target. Tracked separately if needed.
- Backfilling existing prod / preview / candidate-a `enabled=false` rows. Once this fix lands, the next time a user adds OR re-adds a target it will flip on. Manual ops can run the SQL UPDATE in the meantime (Derek's prod `207795de-…` row was already manually flipped on 2026-04-30 22:39 to unstick him).

## Validation

- **Component test**: `nodes/poly/app/tests/component/copy-trade/targets-route.int.test.ts` line ~217 inverted to assert that POST flips an `enabled=false` row to `enabled=true` (was: asserted preservation).
- **Manual on candidate-a / preview / production**: with a tenant whose config row exists at `enabled=false`, POST a target — verify `poly_copy_trade_config.enabled = true` after the request.
- **Loki signal**: `poly.mirror.targets.reconcile.tick active_targets=N` flips from `0` to `≥1` within one tick (≤30s) of the POST.

## Notes

- Filed during PR #1149's prod-validation cycle. Not blocking for #1149's auto-wrap feature, which works correctly. Filing here because the ux drift was discovered while validating #1149's deploy.
- The companion bug for the UI-state lie (the "Copy Trading: Enabled" indicator reading from target-presence not the actual gate) is separate UI work — fix at the source by binding the indicator to `enabled` from `poly_copy_trade_config`. v1 scope.
