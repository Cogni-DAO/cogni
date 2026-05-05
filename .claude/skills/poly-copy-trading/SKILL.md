---
name: poly-copy-trading
description: "Cogni poly copy-trade mirror pipeline specialist. Load when working on the mirror loop itself — `mirror-coordinator`, `wallet-watch`, `poly_copy_trade_{targets,config,fills,decisions}` tables, poll cadence, v0 live-money caps, RLS on copy-trade tables, shared poller refactor (task.0332), status-sync / sync-truth cache (task.0328), v1 hardening bucket (task.0323), or Phase 4 streaming prep (task.0322). Also triggers for: 'mirror this wallet', 'why didn't the mirror fire', 'flip copy_trade_config', 'tracked wallet add', 'mirror skip reason=already_placed noise', 'fills ledger status drift', 'cap exceeded daily', 'WebSocket streaming poly', 'target ranker'. For provisioning trading wallets / CLOB creds / CTF approvals see `poly-auth-wallets`; for CLOB order semantics / Data-API / wallet screening see `poly-market-data`."
---

# Poly Copy-Trading Pipeline

You are the expert for the mirror loop — everything that turns "target wallet traded" into "our wallet placed a mirror order." Trading-wallet provisioning, signing, and CLOB semantics live in sibling skills.

## Architecture in one pass

```
wallet-watch source                   (WS wake-up + Data-API drain, or legacy source in old branches)
    │
    ▼
features/wallet-watch                 (normalize → Fill; no decisions, no writes)
    │
    ▼
mirror-pipeline.ts::runMirrorTick     (dedup, target policy, position context)
    │
    ▼ INSERT_BEFORE_PLACE              (correctness gate — at-most-once)
poly_copy_trade_fills row lands       (status=pending, client_order_id set)
    │
    ▼
PolyTradeExecutor.placeIntent         (authorizeIntent → CLOB adapter)
    │
    ▼
ledger updated + decision row written (placed | skipped | error)
```

**Invariant order matters.** Flipping INSERT and PLACE means a successful CLOB submit whose ledger row never committed → next poll double-mirrors. Never reorder.

Durable flowchart: [Poly Order And Position Lifecycle § Mirror Decision To Limit Order](../../../docs/spec/poly-order-position-lifecycle.md#0-mirror-decision-to-limit-order).

## Key code landmarks

- `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts` — `runMirrorTick` glue
- `nodes/poly/app/src/features/copy-trade/plan-mirror.ts` — pure mirror decision policy
- `nodes/poly/app/src/features/wallet-watch/` — wallet observation source, no decisions
- `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts` — poll shim + target-config hydration
- `nodes/poly/app/src/features/copy-trade/target-source.ts` — `dbTargetSource` + `envTargetSource`; target policy fields
- `nodes/poly/packages/db-schema/src/copy-trade.ts` — schema for `poly_copy_trade_*` tables
- `nodes/poly/app/src/features/trading/order-ledger.ts` — ledger writes + sync-truth reads

## Tables (RLS-scoped, per-tenant)

| Table                       | Purpose                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `poly_copy_trade_targets`   | Per-tenant tracked target wallets plus target policy fields. RLS via `created_by_user_id`. |
| `poly_copy_trade_fills`     | The ledger. Row per decision. `idempotency_key = keccak256(target_id + ':' + fill_id)`.    |
| `poly_copy_trade_decisions` | Append-only audit log of every `decide()` outcome. Never updated or deleted.               |

`dbTargetSource.listForActor(actorId)` — RLS-clamped via `appDb`, used by per-user routes.
`dbTargetSource.listAllActive()` — under `serviceDb`, the **ONE sanctioned BYPASSRLS read** across tenants. Only called by the mirror-poll enumerator in `container.ts`. If you find a second caller, that is a bug.

## Runtime config — candidate-a

**Enable switch:** there is no per-tenant kill-switch table. An active target row plus active wallet connection plus active grant is the opt-in gate. Remove or disable the target row to stop mirroring that wallet.

**Poll cadence:** 30s. Warmup backlog: 60s. Hardcoded in `copy-trade-mirror.job.ts`. Bounds our latency floor at ~30-60s (task.0322 P4 swaps to CLOB WebSocket).

**Target policy:** `poly_copy_trade_targets` carries `mirror_filter_percentile` and `mirror_max_usdc_per_trade`. The enumerator threads these through `buildMirrorTargetConfig` into `MirrorTargetConfig.sizing`.

**Grant caps:** `poly_wallet_grants` carries `per_order_usdc_cap`, `daily_usdc_cap`, and `hourly_fills_cap`. These are enforced by `authorizeIntent`, downstream of `planMirrorFromFill`.

**Tracked wallets** — add via dashboard `+` or `POST /api/v1/poly/copy-trade/targets`; remove via `−` or `DELETE /api/v1/poly/copy-trade/targets/[id]`. Never seed wallets via env vars (the Phase-A `envTargetSource` exists for local-dev only).

## Observability — mirror signals

| Signal                                                             | Where   | Good state                                                              |
| ------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------- |
| `poly.mirror.poll.singleton_claim`                                 | Loki    | Fires exactly once per pod start                                        |
| `poly.wallet_watch.fetch`                                          | Loki    | `raw=N, fills=N, phase=ok` when a drain runs                            |
| `poly.wallet_watch.ws.wakeup_total`                                | Metrics | Increments when watched assets trade                                    |
| `poly.mirror.decision outcome=placed`                              | Loki    | Emitted when mirror fires                                               |
| `poly.mirror.decision outcome=skipped reason=already_placed`       | Loki    | Dedup. Noisy — reducing noise is in task.0323 §1.                       |
| `poly.mirror.decision outcome=skipped reason=position_cap_reached` | Loki    | Hitting target-policy cap. Expected under load; investigate if spiking. |
| `poly.mirror.poll.tick_error`                                      | Loki    | **ZERO**. Any hit = bug.                                                |
| `poly_copy_trade_fills`                                            | poly DB | Row per mirror decision                                                 |

**Status-sync gotcha (task.0323 §2 / task.0328):** `poly_copy_trade_fills.status=open` is written at INSERT time and **never re-read from CLOB**. Actual CLOB state may be filled, canceled, or partial. Don't trust the ledger's `status` column alone — cross-check Data-API `/positions?user=<addr>` or the `synced_at` staleness window exposed via `/api/v1/poly/sync-health`.

**MCP-down fallback:** `scripts/loki-query.sh '{env="candidate-a",service="app",pod=~"poly-node-app-.*"} | json | event=~"poly.mirror.*"' 30` — see top-level `poly-dev-manager` skill for details.

## Idempotency + fill_id — frozen

- `fill_id = data-api:<tx>:<asset>:<side>:<ts>` — assembled in `polymarket-source.ts`. **Shape is frozen.** Phase 4 adds `clob-ws:<…>` as a sibling scheme; never mix schemes within one fill.
- `idempotency_key = keccak256(target_id + ':' + fill_id)` — written to ledger and submitted as `client_order_id` to CLOB. Invariant: two poll ticks seeing the same on-chain fill produce the same key → CLOB dedups → at-most-once.
- The `target_id` in the key is the **UUIDv5 derived from `target_wallet`**, not the DB row PK (UUIDv4). This was the source of revision-1 bug #2 on task.0318 Phase A — HTTP routes had a drift between `target_id` (UUIDv5 for ledger correlation) and `params.id` (UUIDv4 DB row PK for DELETE). Same term, different space.

## v1 + Phase 4 roadmap pointers

- [task.0323 v1 hardening](../../../work/items/task.0323.poly-copy-trade-v1-hardening.md) — cursor persistence, CTF SELL (wallet-owned, overlaps with `poly-auth-wallets`), status-sync, metrics, alerting. `In Review` at time of writing.
- [task.0328 sync-truth cache](../../../work/items/task.0328.poly-sync-truth-ledger-cache.md) — DB-as-CLOB-cache with `synced_at` + `/sync-health`. **Done.**
- [task.0332 shared poller](../../../work/items/task.0332.poly-mirror-shared-poller.md) — replace per-wallet `setInterval` with one poll loop + `TargetSubscriptionRouter`. Blocks Phase 3 multi-tenant scale. `Needs Design`.
- [task.0322 Phase 4](../../../work/items/task.0322.poly-copy-trade-phase4-design-prep.md) — CLOB WebSocket dual-path ingestion + hot signer + target ranker + counterfactual PnL. `Needs Design`.

## Active bugs that affect this pipeline

- [bug.0335](../../../work/items/bug.0335.poly-clob-buy-empty-reject-candidate-a.md) — shared operator BUY empty reject on candidate-a. Every autonomous mirror attempt rejected with empty CLOB response. Likely operator-wallet balance / allowance / keys — not a code bug in this pipeline. Ground-truth in `poly-auth-wallets`. Until resolved, candidate-a mirror attempts always fail at the CLOB submit step.
- [bug.0329](../../../work/items/bug.0329.poly-sell-neg-risk-empty-reject.md) — SELL on neg_risk market empty reject. Any position opened on neg_risk becomes roach-motel until resolution. Blocks close-position. Root cause: missing CTF approval (see `poly-auth-wallets`).

## Anti-patterns specific to the mirror

- **"I placed a trade from my own per-tenant wallet and the mirror should see it."** No — the mirror watches the TARGET wallet, not your trading wallet. Placing from yourself validates CLOB + signing, not the mirror.
- **Adding a second `BYPASSRLS` read** somewhere other than the `container.ts` enumerator. Cross-tenant reads are a cross-tenant isolation hole; the enumerator is the audited seam.
- **Generalizing `scripts/experiments/place-polymarket-order.ts`** (scope-narrow $1 post-only dress-rehearsal) instead of using `privy-polymarket-order.ts`. The dress-rehearsal has deliberate guardrails.
- **Smuggling P4 scope** (WebSocket, ranking, streaming) into v0 or v1. Keep the fill_id shape + idempotency formula fixed.
- **Silencing `outcome=skipped reason=already_placed`** at the coordinator layer. It's noise at the Loki level but correctness-preserving at the code level. Fix per task.0323 §1 (batch / sample), not by removing the skip branch.
- **Changing v0 caps via `kubectl set env`.** Argo reverts on next sync. Caps are in code. task.0347 is the work item to lift them to tenant-config.

## Enforcement rules

- `INSERT_BEFORE_PLACE` is the correctness gate — never reorder.
- `fill_id` and idempotency formulas are frozen.
- Per-tenant RLS on `poly_copy_trade_*` tables must stay intact. Any new table joins through `billing_accounts.owner_user_id` EXISTS-pattern (same shape as `llm_charge_details`), not direct `created_by_user_id` coupling.
- Caps are defense-in-depth. Even when task.0347 lifts them to per-tenant config, the code must enforce whichever is smaller: configured cap or hardcoded safety cap.
