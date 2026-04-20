---
id: bug.0338
type: bug
title: Phase A targets never copy-trade — POST doesn't upsert kill-switch config, enumerator is boot-time only
status: needs_triage
priority: 1
rank: 20
estimate: 2
summary: PR #944 lands per-user tracked-wallet CRUD + RLS, and the routes work (POST/GET/DELETE round-trip validated on candidate-a at `be051abcc5`, 2026-04-20). But a user's POSTed wallet does not actually get copy-traded by the mirror pod. Two composing gaps. (1) POST route inserts into `poly_copy_trade_targets` but does NOT upsert a `poly_copy_trade_config` row for the calling tenant — so `dbTargetSource.listAllActive()` inner-joins the new target against zero config rows and drops it; POST response correctly shows `enabled: false`. (2) Container wires the mirror poll by calling `listAllActive()` **once at boot** in `container.ts:720`; mid-flight POSTs are invisible until pod restart. Proven live: two wallets POSTed at 09:29:50, zero `poly.mirror.poll.singleton_claim` events fired after, pod still on its 09:12:23 empty enumeration.
outcome: A user POSTs a wallet via the dashboard + button → within one poll tick (≤30s) `poly.mirror.poll.singleton_claim` fires for that target_wallet under the user's tenant → `poly.mirror.decision` events fire on real fills. No pod restart required.
spec_refs:
  - poly-multi-tenant-auth
assignees: derekg1729
credit:
project: proj.poly-copy-trading
branch:
pr:
reviewer:
revision: 0
blocked_by:
created: 2026-04-20
updated: 2026-04-20
labels: [poly, polymarket, copy-trading, migration, candidate-a, phase-a-gap]
external_refs:
  - work/items/task.0318.poly-wallet-multi-tenant-auth.md
  - work/items/task.0332.poly-mirror-shared-poller.md
---

# Phase A targets never copy-trade — two composing gaps

> Not a regression — env-driven polls were intentionally dropped. Two Phase-A completeness gaps prevent a freshly-POSTed tracked wallet from being mirrored. Surfaced immediately post-flight of PR #944 on candidate-a, SHA `be051abcc5`, 2026-04-20 ~09:30 UTC.

## Observation — live on candidate-a

Agent registered against `https://poly-test.cognidao.org` (user `2ef06b2d…`, billing `98c9fe83…`):

```
POST /api/v1/poly/copy-trade/targets {"target_wallet":"0x204f72…"} → 201
POST /api/v1/poly/copy-trade/targets {"target_wallet":"0x50f4748f…"} → 201
GET  /api/v1/poly/copy-trade/targets                                 → 2 rows, source:"db", enabled:false
```

Loki `{pod=~"poly-node-app-647bc98466.*"} |~ "singleton_claim|poll.skipped|create_success"` for the 20 minutes after:

- `09:12:23` — pod boot, `poly.mirror.poll.skipped {has_bundle:true, target_count:0}`
- `09:24:42` — POST + DELETE round-trip (validation) — no `singleton_claim` after
- `09:29:50` — POST both wallets succeeds (`create_success` events) — no `singleton_claim` after
- (rolling) — zero `poly.mirror.poll.*` events from the mirror job

The pod knows about the targets (POST wrote them). The mirror poll doesn't know anything changed.

## Gap 1 — POST doesn't create the tenant's kill-switch config row

`nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/route.ts:172-189` writes to `poly_copy_trade_targets` only. No matching upsert into `poly_copy_trade_config`. When the enumerator runs:

```sql
-- dbTargetSource.listAllActive (target-source.ts:140-170)
SELECT ...
FROM poly_copy_trade_targets
INNER JOIN poly_copy_trade_config
  ON config.billing_account_id = targets.billing_account_id
WHERE targets.disabled_at IS NULL AND config.enabled = true
```

A fresh tenant has NO row in `poly_copy_trade_config` → inner-join drops all their targets → `listAllActive()` returns []. The POST response surfaces this correctly: `enabled: false` (from `snapshotState`'s fail-closed default when the config row is missing).

**Fix:** POST route upserts `poly_copy_trade_config` for the tenant at creation time. Default behavior TBD:

- **(a)** `enabled = false` — user must explicitly enable (new endpoint `PATCH /api/v1/poly/copy-trade/config {enabled:true}`). Safer but requires more UI.
- **(b)** `enabled = true` — opt-out model; mirror starts as soon as any target is added. Matches the pre-flight env-driven behavior for the system tenant. Simpler demo path.

Preferred: **(a)**, with the dashboard adding a toggle next to the pooled-execution disclaimer. But **(b)** for system-tenant config (migration 0030) so candidate-a demo works without UI.

## Gap 2 — Enumerator runs once at container boot

`nodes/poly/app/src/bootstrap/container.ts:720-773`:

```ts
const enumerated = await copyTradeTargetSource.listAllActive();  // once
if (enumerated.length === 0) return;
for (const enumeratedTarget of enumerated) {
  startMirrorPoll({ target, source, ledger, ... });  // one setInterval per target
}
```

Adding a target mid-flight does not produce a new `setInterval`. The only way a new target starts polling is a pod restart — which re-runs this code and re-enumerates.

**Fix:** either (i) re-run `listAllActive()` every poll tick and diff against the current set of running polls, adding/removing `setInterval` handles, or (ii) the proper fix per [task.0332](./task.0332.poly-mirror-shared-poller.md) — one batched poller with a `TargetSubscriptionRouter` that subscribes/unsubscribes on add/remove.

Gap 2 is partially covered by task.0332 already. This bug tightens the scope: task.0332 is "batched poller" (scale); gap 2 specifically is "any reload, ever" (correctness).

## Fix plan (minimum to land BeefSlayer copy-trading)

Two migrations + one route change. Can ship independently:

| #     | Change                                                                                                                                                                                                                                                                                                          | Restores                                                                |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **1** | `0030_seed_system_tenant_bootstrap_targets.sql` — insert `poly_copy_trade_targets` rows for `0x204f72…` + `0x50f4748f…` under the system tenant (billing `00000000-0000-4000-b000-000000000000`, user `00000000-0000-4000-a000-000000000001`). System-tenant config already `enabled=true` from migration 0029. | BeefSlayer + test-wallet demo mirror on candidate-a, after pod restart. |
| **2** | POST route upserts `poly_copy_trade_config { enabled:true }` for the tenant on first target POST (adopt option (b)).                                                                                                                                                                                            | New users' targets start copy-trading on next pod restart.              |
| **3** | Container enumerator re-runs per tick (5-minute workaround) OR task.0332 shared poller (real fix).                                                                                                                                                                                                              | New users' targets start copy-trading without pod restart.              |

Smallest candidate-a fix: #1 only, with a pod restart. That restores the pre-flight demo. #2 + #3 unblock actual end-user use.

## Validation

- exercise: after #1 applies → restart the poly pod → `poly.mirror.poll.singleton_claim` fires for both `0x204f72…` and `0x50f4748f…` under the system tenant. After #2+#3 → a user POSTs a new wallet → within 30-60s `singleton_claim` fires for that wallet under their tenant, no pod restart.
- observability: `{namespace="cogni-candidate-a"} |~ "poly.mirror.poll.singleton_claim"` returns ≥2 rows at the post-#1 SHA; after #2+#3, adds +1 row per user-POST without a pod-boot signal in between.

## Not in scope

- Per-user wallet custody / signing backends (Phase B).
- Per-user caps (inherits operator-wide scaffolding for Phase A).
- Removing the system-tenant bootstrap — it's the intended fallback until per-user signing wallets ship.
