# trading · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Generic Polymarket placement + order-ledger substrate. Every path that places an order on behalf of the operator wallet routes through this layer: the agent-callable `core__poly_place_trade` tool, the autonomous mirror-coordinator, and the future P4 WS ingester. Survives every phase — not scaffolding, not copy-trade-specific.

## Pointers

- [task.0315 — Phase 1 plan](../../../../../../work/items/task.0315.poly-copy-trade-prototype.md)
- [Phase 1 spec](../../../../../../docs/spec/poly-copy-trade-phase1.md)
- [Root poly node AGENTS.md](../AGENTS.md)
- Sibling layers: [../copy-trade/AGENTS.md](../copy-trade/AGENTS.md), [../wallet-watch/AGENTS.md](../wallet-watch/AGENTS.md)

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

`trading/` is intentionally siloed from `copy-trade/` and `wallet-watch/` — it does not know what calls it. The `copy-trade/mirror-coordinator` imports `trading/`, never the reverse. The `features/copy-trade` + `features/wallet-watch` no-import rule is enforced by review + the `TRADING_IS_GENERIC` invariant below; the AGENTS.md validator only models coarse layers.

## Public Surface

- **Exports (executor):** `createClobExecutor(deps) → ClobExecutor`, `ClobExecutorDeps`, `CLOB_EXECUTOR_METRICS`.
- **Exports (order ledger):** `createOrderLedger(deps) → OrderLedger`, `OrderLedgerDeps`, `snapshotState(target_id, billing_account_id)`, `insertPending` (TenantBinding required; throws `AlreadyRestingError` on partial-unique-index conflict), `markOrderId`, `markError`, `markCanceled` (typed `LedgerCancelReason`), `updateStatus` (accepts optional `reason?`), `recordDecision` (TenantBinding required), `listRecent`, `listOpenOrPending`, `hasOpenForMarket`, `findOpenForMarket`, `findStaleOpen`, `markSynced`, `markPositionLifecycleByConditionId`, `syncHealthSummary`.
- **Exports (types):** `LedgerRow` (includes `synced_at` + `position_lifecycle`), `LedgerStatus`, `LedgerPositionLifecycle`, `StateSnapshot` (now carries `position_aggregates: PositionIntentAggregate[]`), `PositionIntentAggregate` (generic per-(market_id, token_id) intent aggregate — vocabulary stays inside trading, mirror semantics overlay lives in `@/features/copy-trade`), `TenantBinding` (`{billing_account_id, created_by_user_id}`), `UpdateStatusInput`, `ListOpenOrPendingOptions`, `SyncHealthSummary`, `OpenOrderRow`, `LedgerCancelReason`, `AlreadyRestingError`.

## Invariants

- **TRADING_IS_GENERIC** — files in this slice MUST NOT import `features/copy-trade/` or `features/wallet-watch/`. Vocabulary is "order," "intent," "receipt," "ledger." Never "target," "mirror," "fill-observation."
- **EXECUTOR_SEAM_IS_PLACE_ORDER_FN** — the executor takes a `placeOrder(intent) => receipt` function, not an adapter instance. Mock seam for tests + future WS consumer.
- **NO_STATIC_CLOB_IMPORT** — no static import of `@polymarket/clob-client` or `@privy-io/node`. Only `bootstrap/capabilities/poly-trade.ts::buildRealAdapterMethods` dynamically imports those.
- **INSERT_BEFORE_PLACE** _(order-ledger consumers)_ — callers that use the ledger with the mirror-coordinator MUST call `insertPending` before `placeIntent` and `markOrderId` after. The ledger itself is ordering-agnostic; the invariant is the coordinator's responsibility.
- **BOUNDED_METRIC_RESULT** — the executor's `result` label is one of `{ok, rejected, error}`.

## Responsibilities

- Own the Polymarket CLOB executor (structured logs + metrics wrapper around an injected `placeOrder`).
- Own the order-ledger read/write surface over `poly_copy_trade_fills` + `poly_copy_trade_decisions` (table rename deferred to P2).
- Expose `snapshotState(target_id, billing_account_id)` returning `RuntimeState`-shaped data so the coordinator doesn't SELECT directly. (bug.0438 dropped the kill-switch read; only cap counters + dedup keys remain.)

## Notes

- **DB client:** uses `getServiceDb()` from `@/adapters/server/db/drizzle.service-client` (BYPASSRLS; system-owned tables per migration 0027).
- **Single-tenant boundary:** the executor doesn't know about wallets or tenants — the `placeOrder` seam is passed in by `bootstrap/capabilities/poly-trade.ts` which holds the `HARDCODED_WALLET_SECRETS_OK` isolation.
- **Extension points:** adding SELL support, adding a paper adapter route, or adding a cancel-order executor all live here. Adding multi-tenant wallet-keyed placement is a `bootstrap/` concern, not a trading-layer concern.
