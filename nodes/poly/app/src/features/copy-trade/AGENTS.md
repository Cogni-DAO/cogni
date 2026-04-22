# copy-trade · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Thin copy-trade slice — the pure `planMirrorFromFill()` policy that, given a normalized Polymarket `Fill`, a per-target `TargetConfig`, and a `RuntimeState` snapshot, returns either `{action: "place", intent}` or `{action: "skip", reason}`; plus the `mirror-pipeline` that glues `features/wallet-watch/` → `planMirrorFromFill` → `features/trading/`. **This is the only slice with copy-trade-specific vocabulary** — placement primitives + order ledger live in `features/trading/`, Polymarket wallet observation lives in `features/wallet-watch/`. Cap + scope enforcement lives downstream inside `PolyTraderWalletPort.authorizeIntent` — the planner stays pure.

## Pointers

- [task.0315 — Phase 1 plan](../../../../../../work/items/task.0315.poly-copy-trade-prototype.md)
- [task.0318 — Multi-tenant auth + per-tenant execution](../../../../../../work/items/task.0318.poly-wallet-multi-tenant-auth.md)
- [Phase 1 spec](../../../../../../docs/spec/poly-copy-trade-phase1.md)
- [Multi-tenant auth spec](../../../../../../docs/spec/poly-multi-tenant-auth.md)
- [Poly trader wallet port](../../../../../../docs/spec/poly-trader-wallet-port.md) — where caps + scope are enforced
- [Root poly node AGENTS.md](../AGENTS.md)
- Sibling layers: [../trading/AGENTS.md](../trading/AGENTS.md), [../wallet-watch/AGENTS.md](../wallet-watch/AGENTS.md)

## Boundaries

```json
{
  "layer": "features",
  "may_import": ["features", "ports", "core", "shared", "types"],
  "must_not_import": [
    "app",
    "adapters/server",
    "adapters/worker",
    "bootstrap",
    "contracts"
  ]
}
```

`copy-trade/` may import from sibling `features/trading/` and `features/wallet-watch/`. It is the ONLY slice that crosses both.

## Public Surface

- **Exports (pure):** `planMirrorFromFill()` — the stable-boundary planner function (renamed from `decide`). No cap checks; emits a typed `MirrorIntent | null` or a skip reason.
- **Exports (types):** `TargetConfig` (carries `billing_account_id` + `created_by_user_id`), `RuntimeState`, `MirrorDecision`, `MirrorReason`, `PlanMirrorInput`.
- **Exports (pipeline):** `mirror-pipeline.runOnce(deps)` (renamed from `mirror-coordinator`) — orchestrates wallet-watch → `planMirrorFromFill` → `PolyTradeExecutorFactory.getFor(tenant).placeOrder`.
- **Exports (target source):** `CopyTradeTargetSource` port + `EnumeratedTarget` shape, `envTargetSource(wallets)` (local-dev), `dbTargetSource({appDb, serviceDb})` (production). Two methods: `listForActor(actorId)` (RLS-clamped) + `listAllActive()` (the ONE sanctioned BYPASSRLS read; grant-aware join against `poly_wallet_connections` + `poly_wallet_grants`).

## Invariants

- **COPY_TRADE_ONLY_COORDINATES** — files in this slice MAY import `features/trading/` and `features/wallet-watch/`. They MUST NOT import each other's internals except through the public barrel.
- **FAIL_CLOSED** — kill-switch disabled or unreadable → skip. Callers MUST NOT default to `enabled: true` on DB read failure.
- **INTENT_BASED_CAPS** — caps count against intent submissions, not partial fills. **Enforced downstream** inside `PolyTraderWalletPort.authorizeIntent`, not here.
- **IDEMPOTENT_BY_CLIENT_ID** — repeat decisions with the same `(target_id, fill_id)` are silently dropped via `already_placed_ids`.
- **PLANNER_IS_PURE** — `planMirrorFromFill` has no I/O, no env reads, no clock reads, no grant reads. All runtime state handed in explicitly.
- **MIRROR_REASON_BOUNDED** — `MirrorReason` is an enum; used verbatim as a Prom label.
- **TARGET_SOURCE_TENANT_SCOPED** — `listForActor` returns only the actor's own targets under appDb RLS. `listAllActive` is the only cross-tenant path; it runs under serviceDb and returns `(billing_account_id, created_by_user_id, target_wallet)` triples, filtered to tenants with an active `poly_wallet_connections` + at least one active `poly_wallet_grants` row so ungranted tenants never enter the pipeline.
- **TENANT_INHERITED_FROM_TARGET** — every fills/decisions write inherits `(billing_account_id, created_by_user_id)` from `TargetConfig`. The pipeline never reads tenant from anywhere else.

## Responsibilities

- Own the pure `planMirrorFromFill()` function and its input/output types.
- Own the `mirror-pipeline` that wires observation → planner → per-tenant executor dispatch.
- Stay thin — placement mechanics (executor, order-ledger) live in `features/trading/`; observation (Data-API, activity-poll) lives in `features/wallet-watch/`; per-tenant signing + cap enforcement lives in `adapters/server/wallet/` behind `PolyTraderWalletPort`.

## Notes

- **Not in this slice:** CLOB executor (in `features/trading/clob-executor.ts`); order-ledger I/O (in `features/trading/order-ledger.ts`); scheduler tick + bootstrap wiring (in `bootstrap/jobs/copy-trade-mirror.job.ts`); per-tenant executor factory (`bootstrap/capabilities/poly-trade-executor.ts`); Privy signing + `authorizeIntent` (`adapters/server/wallet/privy-poly-trader-wallet.adapter.ts`).
- **Removed (Stage 4, 2026-04-22):** `bootstrap/capabilities/poly-trade.ts` and its `PolyTradeBundle` — the single-operator prototype. `PolyTradeExecutorFactory` is the only placement path.
