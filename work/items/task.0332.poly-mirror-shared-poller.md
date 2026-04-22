---
id: task.0332
type: task
title: "Poly mirror — shared batched poller (N wallets, 1 loop) replacing per-wallet setInterval"
status: needs_design
priority: 1
rank: 10
estimate: 3
summary: "v0 and PR #932 spin one `setInterval` per tracked target wallet. That scales linearly with users × wallets-per-user and will DDoS Polymarket Data-API (and us) the moment Phase 3 lands. Replace with a single shared poller that batch-fetches activity for all active targets on one tick, then fans out per-fill events to the correct tenant's mirror-coordinator."
outcome: "One `setInterval` per pod regardless of target count. Data-API request volume scales sub-linearly in target count (batch endpoint where available; concurrency-bounded fan-out where not). A tenant-scoped event router dispatches each observed fill to the correct `mirror-coordinator.runOnce(targetId, fill)` without leaking cross-tenant state. 1000 tracked wallets = 1 loop, not 1000 loops."
spec_refs:
  - poly-copy-trade-phase1
  - poly-multi-tenant-auth
assignees: []
project: proj.poly-copy-trading
pr:
created: 2026-04-19
updated: 2026-04-19
labels: [poly, polymarket, mirror, scaling, architecture]
external_refs:
  - nodes/poly/app/src/bootstrap/container.ts
  - nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts
  - nodes/poly/app/src/features/wallet-watch/polymarket-source.ts
  - nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts
  - work/items/task.0318.poly-wallet-multi-tenant-auth.md
---

# task.0332 — Poly mirror: shared batched poller

> Surfaced during PR #932 review on 2026-04-19. Multi-wallet fan-out works correctly but uses 1 `setInterval` per wallet — the wrong shape for anything past single-digit targets.

## Context

`createContainer()` (post-PR-#932) loops over `CopyTradeTargetSource.listTargets()` and calls `startMirrorPoll({ target, source, ledger, …, placeIntent, … })` **once per wallet**. Each `startMirrorPoll` creates its own `setInterval(pollCadenceMs)`, its own `createPolymarketActivitySource` instance, its own cursor, and its own in-memory state. One operator-wide `startOrderReconciler` sits outside that loop.

```
// today
for (const targetWallet of wallets) {
  const source = createPolymarketActivitySource({ client, wallet: targetWallet, ... });
  startMirrorPoll({ target, source, ledger: orderLedger, placeIntent, ... });  // <-- own setInterval
}
```

This shape is fine for v0 (1 target) and bearable for multi-target under one tenant. **It is not fine for Phase 3** (per-user multi-tenant, task.0318 Phase B), where the target set is the union of every user's tracked wallets.

## Problem

### Scaling math

| Scenario                                              |     Loops | Data-API requests/minute |
| ----------------------------------------------------- | --------: | -----------------------: |
| v0 (1 target)                                         |         1 |                        2 |
| PR #932 (2 targets, 1 operator)                       |         2 |                        4 |
| 10 users × 3 targets each                             |        30 |                       60 |
| 1000 users × 1 target each                            |      1000 |                     2000 |
| 1000 users × 5 targets each (popular wallets dedup'd) | 1000–5000 |               2000–10000 |

Data-API is an unauthenticated public endpoint. Hammering it from one pod will trip rate limits, get us IP-banned, or both. We also eat our own CPU on 1000 timers, 1000 Zod parses per tick, 1000 independent backoff states.

### Architectural problems on top of volume

1. **No request dedup**: two users tracking the same popular wallet generate two independent polls for the same address.
2. **No shared backoff**: if Data-API goes into 429, each loop independently retries — making the problem worse.
3. **No tenant-scoped event routing**: the current shape hard-wires `target → operator` at registration time. Phase 3 needs one fill on target wallet `X` to fan out to every user who subscribed to `X`, each with their own `WalletGrant` + `operatorWallet`.
4. **Cursor is per-loop state**: if a pod restarts, every cursor resets independently (task.0323 §1 already calls this out for the v0 single-wallet case; N wallets makes it N× worse).
5. **No priority / fairness**: a wallet trading 300 times/hr gets the same poll budget as a wallet trading twice a day.

## Design target

**One poll loop per pod. One event router. N coordinators.**

```
┌──────────────────────────────────────────────────────────────────────┐
│  SharedWalletWatchPoller    (one setInterval, pod-wide)             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  tick():                                                     │   │
│  │    wallets = activeTargets.list()    // dedup'd set of addrs │   │
│  │    fills   = batchFetch(wallets)     // minimal request      │   │
│  │    for fill in fills:                                        │   │
│  │      for subscription in router.subscribers(fill.wallet):    │   │
│  │        await coordinator.runOnce(subscription, fill)         │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  TargetSubscriptionRouter   (in-memory projection of DB state)      │
│    wallet → [ (tenant_id, target_id, operator_binding), … ]         │
│                                                                      │
│  PollFairnessScheduler      (later; P4-adjacent)                    │
│    hot wallets poll more often, cold wallets less                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Shape of the seam

- **`SharedWalletWatchPoller`** — the one-setInterval runtime. Reads from `TargetRegistry.listActiveWallets()` on every tick. Batches the request where Polymarket exposes a batch endpoint (Data-API `/trades` supports `user` as a single wallet today; check `gamma-api` + websocket for multi-wallet). Where no batch exists, concurrency-bound Promise.all with a shared rate-limiter.

- **`TargetSubscriptionRouter`** — maps `wallet_address → Subscription[]`, where each `Subscription` carries `(tenant_id, target_id, operator_binding_id)`. In Phase 2 (this PR's state) there's exactly one subscription per wallet (the system tenant). In Phase 3 there are N. The router is an in-memory projection of `poly_copy_trade_targets` refreshed on a DB notify (or short TTL).

- **Coordinator fan-out** — `for subscription in router.subscribers(wallet)` then `mirror-coordinator.runOnce({ subscription, fill })`. Idempotency stays `keccak256(target_id + ':' + fill_id)` → client_order_id — target_id already tenant-scoped in Phase 3, so two users on the same wallet get two independent client_order_ids.

- **Cursor** — **per-wallet, not per-subscription.** We only need to not re-fetch the same trades; who mirrors them is a downstream concern. Persist cursor in `poly_copy_trade_wallet_cursors(wallet_address PK, last_ts, updated_at)` — survives pod restart (addresses task.0323 §1 across all wallets simultaneously).

### What this does NOT solve (deliberately)

- **Phase 4 WebSocket ingestion** (task.0322) is orthogonal. The shared poller and the WS ingestor both push into the same router — two sources, one fan-out.
- **Per-tenant signing** (task.0318 Phase B). That's about the `operatorWallet` dimension. The router knows `subscription.operator_binding_id`; the coordinator resolves to the right `LocalAccount` via `operatorWallet.resolvePolymarketAccount(bindingId)`. This task just cleans the polling side.
- **Cross-pod coordination**. Still single-writer per pod. If we ever run >1 poly-node-app replica we need a distributed lease on each wallet — out of scope here, filed separately when needed.

## Fix criteria

- [ ] Exactly one `setInterval` in `createContainer()` for mirror polling, regardless of target count.
- [ ] `TargetSubscriptionRouter` port + in-memory impl backed by `CopyTradeTargetSource` (Phase 2) or `poly_copy_trade_targets` (Phase 3).
- [ ] `SharedWalletWatchPoller` owns a single cursor table per wallet (persisted), shared rate-limiter, and shared backoff.
- [ ] Per-wallet poll interval becomes a config knob, not a per-loop constant.
- [ ] Component test: 100 target wallets → 1 Data-API request per tick (or ceil(100/batch_size) if Polymarket exposes batch), 100 coordinator.runOnce calls per observed fill, zero duplicate calls.
- [ ] Preserves all existing invariants: `INSERT_BEFORE_PLACE`, keccak256 idempotency, frozen `data-api:<tx>:<asset>:<side>:<ts>` fill_id, rate-cap enforcement, kill-switch honoring.
- [ ] Migration plan in task body: how do we flip from per-wallet to shared without downtime and without duplicate places in the transition window? (Feature-flag on boot; old loops cleanly handed off.)

## Validation

Fixed when a stack test with N=10 target wallets emitting a scripted fill burst produces:

1. Exactly 1 `setInterval` callback registration (verify via fake `Clock` port)
2. 1 `wallet_watch.fetch` log per tick (not 10)
3. 1 `mirror.decision` row per (subscription, fill) pair
4. All placements share the same operator's rate-cap counter (no escape via separate loops)

Additionally: a short-duration candidate-a soak (≥100 fills aggregate across ≥3 wallets in 10 minutes) shows no rate-limit errors from Data-API and no accumulated timer drift.

## Blast radius if not fixed

- **Phase 3 (task.0318 Phase B) is a non-starter** with the current shape. The moment a second user connects a wallet, we have N loops. The moment N crosses ~50 targets we're at Data-API rate limits. The moment we cross ~500 we're blocked.
- **Telemetry becomes noise**: 1000 `wallet_watch.fetch` events per tick drowns real signal.
- **Operator CPU budget** on small pods (k3s default) is a soft limit we'd hit before the platform does.

## Priority

- **P1, do before Phase 3 ships.** Blocks multi-tenant.
- Could ship earlier: the current shape is fine for single-digit targets under one operator (today's candidate-a). Pick the slot between task.0323 hardening and task.0318 Phase B design.

## Pointers

- `nodes/poly/app/src/bootstrap/container.ts` — where the `for (const targetWallet of wallets)` loop lives (post-PR-#932)
- `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts` — `startMirrorPoll` setInterval shim + hardcoded poll cadence
- `nodes/poly/app/src/features/wallet-watch/polymarket-source.ts` — per-wallet Data-API client instance today
- `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts` — `runOnce` seam the shared poller will call
- `.claude/skills/poly-copy-trading/SKILL.md` — poll cadence + rate-cap + idempotency rules this must preserve
- [task.0318](task.0318.poly-wallet-multi-tenant-auth.md) — the multi-tenant work this unblocks
- [task.0323](task.0323.poly-copy-trade-v1-hardening.md) §1 — cursor persistence gap (this task subsumes the multi-wallet flavor)
- [task.0322](task.0322.poly-copy-trade-phase4-design-prep.md) — Phase 4 WebSocket ingestion that plugs into the same router
