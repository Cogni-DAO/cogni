---
id: poly-copy-trade-phase1-spec
type: spec
title: "Poly Mirror v0 — trading / wallet-watch / copy-trade layers"
status: draft
spec_state: draft
trust: draft
summary: "End-to-end reference for Phase 1 of task.0315. Decomposes placement into three layers: generic `trading/` (executor + order ledger), generic `wallet-watch/` (Polymarket activity polling), and thin `copy-trade/` (policy + coordinator). Covers the agent-tool path (CP4.25, shipped pre-split on the old branch; re-landed on feat/poly-mirror-v0), the autonomous 30s mirror poll (pending), and the read-only dashboard card. Captures layer boundaries, ordering invariants, single-tenant isolation boundary, and the disposable scaffolding marked for deletion in Phase 4."
read_when: Implementing the mirror poll or dashboard card, reviewing the placement code path, adding a second consumer of the trading layer (future WS ingester, PnL tracking, multi-tenant wallet resolution), or auditing the at-most-once placement argument.
implements: task.0315
owner: derekg1729
created: 2026-04-18
tags: [poly, polymarket, copy-trading, prototype, scaffolding]
---

# Poly Mirror v0 — Trading / Wallet-Watch / Copy-Trade Layers

> **Pointers only — no code.** Every block below references a file or invariant; read the referenced file for the body.

## Goal

Phase 1 of task.0315 delivers three layers inside the poly node:

1. **`features/trading/`** — a generic placement-and-ledger substrate: structured-log executor + Postgres-backed order ledger. Every path that places an order on behalf of the operator wallet routes through this layer.
2. **`features/wallet-watch/`** — a generic Polymarket wallet observation primitive: a pure `activity-poll` tick over a `polymarket-source` adapter that produces normalized `Fill[]`. No copy-trade vocabulary.
3. **`features/copy-trade/`** — a thin coordinator: `decide(fill, config, state)` policy + a `mirror-coordinator` that glues `wallet-watch` → `decide` → `trading`. This is the only layer with copy-trade-specific vocabulary.

Two runtime consumers of these layers land in Phase 1:

- **Agent-callable tool** (`core__poly_place_trade` — shipped on main as of PR #900). Consumes `trading/`.
- **Autonomous 30s mirror poll** (`bootstrap/jobs/copy-trade-mirror.job.ts` — pending). Consumes all three layers plus `wallet-watch`.

A read-only dashboard card (`order-activity-card.tsx`) surfaces ledger rows. All scaffolding is labeled `@scaffolding / Deleted-in-phase: 4`.

## Non-Goals

- Multi-target UI / `poly_copy_trade_targets` table (P2).
- Paper-adapter body (P3).
- WS ingester / Temporal workflows / SSE dashboard (P4).
- Multi-tenant wallet resolution — single-operator hardcoded via Privy wallet lookup, isolated to one function in one file.
- SELL orders — requires CTF `setApprovalForAll`; rejected at the capability boundary.
- Retroactive ledger writes from the agent-tool path — tracked as a follow-up, not in scope.
- A `MirrorPolicyPort` interface or `features/ledger/` package — one policy, one ledger consumer shape; premature.
- Grafana dashboard JSON, Loki alert rules, performance tuning of state-reader SELECTs.
- Any change to the `@cogni/ai-tools` contract shape.

## Design

Pointers only. The prose on each bullet is the authoritative source; every file referenced below either exists today or lands on this branch.

## Layer map

```
┌─────────────────────────────────────────────────────────────────────┐
│  features/copy-trade/           (thin — policy + glue)              │
│    decide.ts         ← pure "should we mirror?" policy              │
│    mirror-coordinator.ts ← wires wallet-watch → decide → trading    │
│    types.ts          ← TargetConfig / MirrorDecision / reasons      │
└─────────────────────────────────────────────────────────────────────┘
         │                                                │
         ▼                                                ▼
┌──────────────────────────────┐      ┌──────────────────────────────┐
│  features/wallet-watch/      │      │  features/trading/           │
│    polymarket-source.ts      │      │    clob-executor.ts          │
│     ← Data-API activity+cursor│     │     ← wraps placeOrder fn    │
│    activity-poll.ts          │      │    order-ledger.ts           │
│     ← pure (source, since)   │      │     ← insertPending/mark*    │
│       → Fill[]               │      │    order-ledger.types.ts     │
└──────────────────────────────┘      └──────────────────────────────┘
                                              │
                                              ▼
                                   ┌──────────────────────────────┐
                                   │  bootstrap/capabilities/     │
                                   │    poly-trade.ts             │
                                   │   PolyTradeBundle {          │
                                   │     capability, placeIntent  │
                                   │   }                          │
                                   │   Single-tenant Privy        │
                                   │   resolution lives HERE ONLY │
                                   └──────────────────────────────┘
                                              │
                                              ▼
                                  packages/market-provider/
                                    PolymarketClobAdapter
                                    @polymarket/clob-client
```

The mirror-coordinator is the **only** file that imports from both `wallet-watch` and `trading`. The agent-tool path imports only `trading` (via the capability's `placeIntent`). The P4 WS ingester will replace `wallet-watch` as the coordinator's Fill source without touching `trading` or `decide`.

## Two runtime consumers

```
┌─ agent tool path (shipped pre-split in PR #900) ───────────────────┐
│  poly-brain  →  core__poly_place_trade                              │
│                →  PolyTradeCapability.placeTrade(AgentReq)          │
│                   [cid = clientOrderIdFor("agent", tokenId + Date)] │
│                →  trading.clob-executor                             │
│                →  PolymarketClobAdapter.placeOrder                  │
│  (agent-tool does NOT write the order ledger in v0 — follow-up)     │
└─────────────────────────────────────────────────────────────────────┘

┌─ autonomous mirror poll (this branch) ──────────────────────────────┐
│  30s tick   →  mirror-coordinator.runOnce(deps)                     │
│                →  wallet-watch.activity-poll.nextFills(source, since)│
│                   →  wallet-watch.polymarket-source.listUserActivity │
│                   →  normalize → Fill[]  (empty-tx reject + counter)│
│                →  for each Fill:                                     │
│                   cid = clientOrderIdFor(target_id, fill_id)         │
│                   state = trading.order-ledger.snapshotState(target) │
│                   d = decide({fill, config, state, cid})             │
│                   recordDecision(d)  (always)                        │
│                   if d.action === 'place':                           │
│                     trading.order-ledger.insertPending(...)  ⟵ BEFORE│
│                     placeIntent(d.intent)                            │
│                     trading.order-ledger.markOrderId(...)    ⟵ AFTER │
└─────────────────────────────────────────────────────────────────────┘
```

## Files — by layer

### Shared port + domain (package — stable across all phases)

| File                                                                            | Purpose                                                                            |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/market-provider/src/port/market-provider.port.ts`                     | `placeOrder` / `cancelOrder` / `listOpenOrders` port surface                       |
| `packages/market-provider/src/port/observability.port.ts`                       | `LoggerPort` + `MetricsPort` (caller-supplied sinks)                               |
| `packages/market-provider/src/domain/order.ts`                                  | `OrderIntent` / `OrderReceipt` / `Fill` Zod                                        |
| `packages/market-provider/src/domain/client-order-id.ts`                        | Pinned `clientOrderIdFor(target_id, fill_id)` — every placement path MUST use this |
| `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts`   | Sole importer of `@polymarket/clob-client`                                         |
| `packages/market-provider/src/adapters/polymarket/polymarket.normalize-fill.ts` | Fill-normalization helpers; extended for Data-API `UserActivity` in this branch    |
| `packages/market-provider/src/adapters/polymarket/data-api.ts`                  | `listUserActivity(wallet, since)` — extended if missing                            |

### Agent tool surface (package — stable)

| File                                               | Purpose                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `packages/ai-tools/src/tools/poly-place-trade.ts`  | `core__poly_place_trade` tool definition                                                   |
| `packages/ai-tools/src/tools/poly-list-orders.ts`  | `core__poly_list_orders` tool definition                                                   |
| `packages/ai-tools/src/tools/poly-cancel-order.ts` | `core__poly_cancel_order` tool definition                                                  |
| `packages/ai-tools/src/index.ts`                   | `PolyTradeCapability` interface — agent-request shapes only; does NOT expose `OrderIntent` |

### Poly app — `features/trading/` (generic placement + ledger)

| File                                                        | Purpose                                                                                      | Status                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| `nodes/poly/app/src/features/trading/clob-executor.ts`      | Pure composition: wraps an injected `placeOrder` fn with logs + bounded metrics              | MOVE from `copy-trade/` (pre-split) |
| `nodes/poly/app/src/features/trading/order-ledger.ts`       | `insertPending` / `markOrderId` / `markError` / `snapshotState` over `poly_copy_trade_fills` | NEW                                 |
| `nodes/poly/app/src/features/trading/order-ledger.types.ts` | Ledger row type, status enum, snapshot shape                                                 | NEW                                 |
| `nodes/poly/app/src/features/trading/AGENTS.md`             | Layer boundaries + dep-allowlist                                                             | NEW                                 |

### Poly app — `features/wallet-watch/` (generic Polymarket observation)

| File                                                            | Purpose                                                               | Status |
| --------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| `nodes/poly/app/src/features/wallet-watch/polymarket-source.ts` | Data-API `listUserActivity(wallet, since)` wrapper + cursor mgmt      | NEW    |
| `nodes/poly/app/src/features/wallet-watch/activity-poll.ts`     | Pure `nextFills(source, since) → {fills, newSince}`; no `setInterval` | NEW    |
| `nodes/poly/app/src/features/wallet-watch/AGENTS.md`            | Layer boundaries + dep-allowlist                                      | NEW    |

### Poly app — `features/copy-trade/` (thin coordinator + policy)

| File                                                           | Purpose                                                                           | Status                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `nodes/poly/app/src/features/copy-trade/decide.ts`             | Pure `decide()` — the stable policy boundary                                      | EXISTS (from pre-split; re-landed on this branch) |
| `nodes/poly/app/src/features/copy-trade/types.ts`              | `TargetConfig` / `RuntimeState` / `MirrorDecision` / `MirrorReason`               | EXISTS (from pre-split)                           |
| `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts` | Pure `runOnce(deps)` — glues wallet-watch → decide → trading                      | NEW                                               |
| `nodes/poly/app/src/features/copy-trade/AGENTS.md`             | Layer boundaries: may import `trading/` + `wallet-watch/`; nothing imports _this_ | UPDATE                                            |

### Poly app — bootstrap (runtime wiring)

| File                                                                          | Purpose                                                                                                                                                     | Status |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `nodes/poly/app/src/bootstrap/capabilities/poly-trade.ts`                     | Factory returning `PolyTradeBundle { capability, placeIntent }`. **Single-tenant Privy resolution lives here and nowhere else** (`buildRealAdapterMethods`) | MODIFY |
| `nodes/poly/app/src/bootstrap/container.ts`                                   | Constructs bundle + mirror-coordinator deps; routes agent tools to `capability`, poll to `placeIntent`                                                      | MODIFY |
| `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts`                  | `@scaffolding` / `Deleted-in-phase: 4`. scheduler-core tick → `mirror-coordinator.runOnce()`; singleton claim log                                           | NEW    |
| `nodes/poly/app/src/adapters/test/poly-trade/fake-polymarket-clob.adapter.ts` | Test-mode fake; `APP_ENV=test` routes here                                                                                                                  | EXISTS |

### Poly app — dashboard (disposable)

| File                                                                         | Purpose                                                                                                                                                    | Status |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `nodes/poly/app/src/app/(app)/dashboard/_components/order-activity-card.tsx` | Generic recent-orders card over `order-ledger`. Takes a filter prop (copy-trade-initiated vs all). `@scaffolding` only on the copy-trade-filtered instance | NEW    |

### Env + DB

| File                                                                            | Purpose                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nodes/poly/app/src/shared/env/server-env.ts`                                   | `POLY_PROTO_*` wallet/creds env + `COPY_TRADE_TARGET_WALLET` — the ONE runtime input. All other v0 parameters (mode, mirror size, caps, poll cadence) are hardcoded in the job shim. |
| `packages/db-schema/src/poly-copy-trade.ts`                                     | Drizzle definitions for `poly_copy_trade_{fills,config,decisions}` (table rename deferred to P2)                                                                                     |
| `nodes/operator/app/src/adapters/server/db/migrations/0027_silent_nextwave.sql` | Migration 0027 — fail-closed kill-switch seeded `enabled=false`; no RLS on these tables                                                                                              |

## Invariants

All invariants are enforced either by code (header comments + Biome `noRestrictedImports` + Zod) or by the single-tenant constraint until Phase 2. Every invariant below has a named owner file — regressions fail review at that file.

### Layer boundaries

- **`COPY_TRADE_ONLY_COORDINATES`** _(features/copy-trade/_)\* — files in `copy-trade/` MAY import `features/trading/` and `features/wallet-watch/`, plus pure helpers from `@cogni/market-provider`. They MUST NOT import from `bootstrap/`, from `app/`, or from each other's internals. Enforced by the layer's AGENTS.md `may_import`.
- **`TRADING_IS_GENERIC`** _(features/trading/_)\* — `trading/` MUST NOT import `features/copy-trade/` or `features/wallet-watch/`. Vocabulary in this layer is "order," "intent," "receipt," "ledger" — never "target," "mirror," "fill-observation."
- **`WALLET_WATCH_IS_GENERIC`** _(features/wallet-watch/_)\* — `wallet-watch/` MUST NOT import `features/copy-trade/` or `features/trading/`. Emits `Fill[]` (from `@cogni/market-provider/domain/order`) — no downstream policy concepts.

### Stability + idempotency

- **`DECIDE_IS_PURE`** _(decide.ts)_ — zero I/O; same input → same output. All runtime state is passed in.
- **`IDEMPOTENT_BY_CLIENT_ID`** _(decide.ts + mirror-coordinator.ts + capability)_ — every placement path derives `client_order_id` via the pinned `clientOrderIdFor(...)` helper. Mirror uses `(target_id, fill_id)`; agent tool uses `("agent", tokenId + ":" + Date.now())`. Composite PK on `poly_copy_trade_fills(target_id, fill_id)` + unique index on `order_id` enforce de-duplication at the DB.
- **`FAIL_CLOSED`** _(mirror-coordinator.ts + order-ledger.ts)_ — kill-switch disabled OR DB read error ⇒ coordinator synthesizes `{enabled: false}` and `decide()` returns `skip/kill_switch_off`. Caller MUST NOT default to enabled on read failure. Counter: `poly_mirror_kill_switch_fail_closed_total`.
- **`INTENT_BASED_CAPS`** _(decide.ts)_ — `today_spent_usdc` and `fills_last_hour` count INTENT submissions, not realized fills. Strict `>` comparison.
- **`MIRROR_REASON_BOUNDED`** _(types.ts)_ — reason codes are a closed enum so the `reason` Prometheus label stays bounded-cardinality.

### Execution-primitive floor

- **`FILL_NEVER_BELOW_FLOOR`** _(packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts → `placeOrder`)_ — every matched fill amount must be either `0` or `≥ market_min_order_size`. **Scope (task.5001 amendment):** this invariant now applies only when `intent.attributes.placement === "market_fok"`. The intent-shape preflight (`bug.0342`) is necessary but not sufficient: the GTC limit-order path matches against orderbook depth at the inside ask and settles the matched portion to our wallet with no min-order-size check on the matched amount, producing sub-min positions that are structurally unsellable on CLOB. The invariant is held by the **execution primitive**: for `market_fok`, `placeOrder` uses `createAndPostMarketOrder(OrderType.FOK)` (atomic-or-nothing — exchange enforces "fill the entire intent at the limit price, or fill nothing"). FOK no-match rejections are bucketed under the `fok_no_match` `error_code` and surfaced in mirror-pipeline as a clean skip — next signal from the target re-enters the pipeline. Owner: bug.0405.

  **Deliberately relaxed for `placement === "limit"`** (`mirror_limit` policy, task.5001): `placeOrder` uses `createAndPostOrder(OrderType.GTC, postOnly=false)`, which can match partial depth and produce sub-min positions. Mitigations: (1) `MIRROR_BUY_CANCELED_ON_TARGET_SELL` cancels any open mirror order on `(target, market)` when the target SELLs, bounding holding-when-target-exited to one poll cycle; (2) `TTL_SWEEP_OWNS_STALE_ORDERS` cancels orders older than `MIRROR_RESTING_TTL_MINUTES` (default 20); (3) redeem-at-resolution (task.0387 / task.0388) sweeps any remaining sub-min CTF positions at market expiry. Cancel paths route through `PolyTradeExecutor.cancelOrder` (`CANCEL_GOES_THROUGH_TENANT_EXECUTOR`) and the adapter swallows CLOB 404 (`CANCEL_404_SWALLOWED_IN_ADAPTER`).

- **`PLACEMENT_DISCRIMINATOR_IN_ATTRIBUTES`** _(packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts → `readPolyPlacement`)_ — `intent.attributes.placement ∈ {"limit", "market_fok"}` is the single source of truth for order type. Absent value falls back to `"market_fok"` so non-mirror callers (agent tool) preserve legacy behavior without code changes (`AGENT_TOOL_DEFAULT_PRESERVED`). The shared `OrderIntent` port type does **not** gain a top-level `placement` field — keeps the port clean per the active depoly-ification of `@cogni/poly-market-provider`. Owner: task.5001.

- **`DEDUPE_AT_DB`** _(nodes/poly/packages/db-schema/src/copy-trade.ts → `poly_copy_trade_fills_one_open_per_market`)_ — partial unique index on `(billing_account_id, target_id, market_id) WHERE status IN ('pending','open','partial') AND position_lifecycle IS NULL|unresolved|open|closing AND attributes->>'closed_at' IS NULL` enforces "exactly one active resting mirror order per (tenant, target, market)" at the database. `position_lifecycle` is the typed position-state column; legacy `closed_at` remains a compatibility terminal stamp. Closed/resolved/redeemable rows are history or action state, not active resting orders. The mirror pipeline's `hasOpenForMarket` gate (`ALREADY_RESTING_BEFORE_INSERT`) is fast-path optimization; this index is the correctness backstop. PG 23505 on insert raises a typed `AlreadyRestingError` that the pipeline converts to `skip/already_resting`. Owner: task.5001 / task.5006.

- **`MIRROR_BUY_CANCELED_ON_TARGET_SELL`** _(nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts → `processSellFill` → `cancelOpenMirrorOrdersForMarket`)_ — every SELL fill triggers an unconditional cancel pre-step over `findOpenForMarket(billing_account_id, target_id, market_id)` BEFORE the position-close path. Bounds the window in which we hold a position the target has already exited. Idempotent: rows with `order_id IS NULL` are skipped + counted (`PENDING_CANCEL_RACE_ACCEPTED_V0`); the adapter swallows CLOB 404 so a concurrent cancel from the TTL sweeper is harmless. Owner: task.5001.

- **`TTL_SWEEP_OWNS_STALE_ORDERS`** _(nodes/poly/app/src/bootstrap/jobs/poly-mirror-resting-sweep.job.ts → `startRestingSweep`)_ — per-process `setInterval` (default 60s) cancels mirror orders with `created_at < now() - MIRROR_RESTING_TTL_MINUTES` (default 20) AND `status IN ('pending','open','partial')`. Single global `findStaleOpen` query → app-side groupBy on `billing_account_id` (`SWEEPER_QUERIES_GLOBAL_NOT_PER_TENANT`). Cancel routes through the per-tenant executor + 404-idempotent adapter; ledger marked `canceled` with `attributes.reason = 'ttl_expired'` AFTER the CLOB cancel returns. Owner: task.5001.

### Ordering + at-most-once

- **`INSERT_BEFORE_PLACE`** _(order-ledger.ts + mirror-coordinator.ts)_ — `order-ledger.insertPending(cid, target_id, fill_id, intent)` runs **before** `placeIntent(intent)`. Crash between insert and place leaves a pending row whose `client_order_id` will be in the next tick's `already_placed_ids`, so `decide()` returns `skip/already_placed`. This is the at-most-once argument — do not reorder.
- **`SINGLE_WRITER`** _(copy-trade-mirror.job.ts)_ — exactly one process runs the poll at any time. Enforced by `replicas=1` on the poly deployment. Boot logs `event:poly.mirror.poll.singleton_claim`; counter `poly_mirror_poll_ticks_total` is alertable on rate-from-multiple-pods in Loki.
- **`BUY_ONLY`** _(poly-trade.ts + decide.ts indirectly)_ — prototype rejects SELL at the capability boundary (requires CTF `setApprovalForAll`, out of scope).

### Single-tenant isolation boundary (where Phase 2 multi-tenant slots in)

- **`HARDCODED_WALLET_SECRETS_OK`** _(poly-trade.ts → `buildRealAdapterMethods()`)_ — ONE function in ONE file holds the env → single-operator Privy wallet lookup. Every other branch (`container.ts`, trading, wallet-watch, coordinator, capability shape, tests) is production-generic. Phase 2 multi-tenant replaces this function with a per-tenant Privy wallet resolver keyed by `connection_id`; no other file changes signature.
- **`KEY_NEVER_IN_APP`** _(poly-trade.ts)_ — CLOB L2 creds + Privy signing key stay in env; the adapter holds them in-memory only for the lifetime of the process. No logs, no DB columns, no error messages include secrets.
- **`KEY_IN_TRADER_ROLE_ONLY`** _(container.ts)_ — non-trader replicas MUST NOT construct the real adapter. Asserted by the absence-of-module-load test + the runtime branch that returns `undefined` capability when env is incomplete.

### Dynamic-import boundary

- **`NO_STATIC_CLOB_IMPORT`** _(trading/clob-executor.ts + mirror-coordinator.ts + capability)_ — none of these modules may statically `import` from `@polymarket/clob-client` or `@privy-io/node/viem`. Only `buildRealAdapterMethods()` uses `await import(...)`. Enforced by Biome `noRestrictedImports`.

### Observability contract

- **`BOUNDED_METRIC_RESULT`** _(trading/clob-executor.ts)_ — `result` label is one of `{ok, rejected, error}`. The `PolymarketClobAdapter` `poly_clob_place_*` counters additionally carry an `error_code` sub-label from `POLY_CLOB_ERROR_CODES` (`insufficient_balance`, `insufficient_allowance`, `stale_api_key`, `invalid_signature`, `invalid_price_or_tick`, `below_min_order_size`, `empty_response`, `http_error`, `unknown`) on non-ok results — bounded enum, dashboard-safe, filed under bug.0335 to replace opaque silent-reject telemetry. `below_min_order_size` is the classifier landing for bug.0342's business-logic fix — expect the non-zero counter to go to zero once that PR ships.
- **`DECISIONS_TOTAL_HAS_SOURCE`** _(mirror-coordinator.ts)_ — `poly_mirror_decisions_total{outcome, reason, source="data-api"}` always carries `source` so the P4 divergence dimension lands free. Values are forward-compatible: `source ∈ {data-api, clob-ws}`.
- **`KILL_SWITCH_FAIL_CLOSED_COUNTED`** _(mirror-coordinator.ts + order-ledger.ts)_ — every fail-closed branch increments `poly_mirror_kill_switch_fail_closed_total`. The metric going non-zero is an alertable signal that DB reads are failing silently.

### Scaffolding marker

- **`SCAFFOLDING_LABELED`** _(copy-trade-mirror.job.ts + order-activity-card.tsx when copy-trade-filtered)_ — both files open with a header comment containing `@scaffolding` and `Deleted-in-phase: 4`. P4's cutover PR searches for these markers to find everything to delete. The `trading/` and `wallet-watch/` layers are NOT scaffolding — they survive every phase.

## End-to-end scenarios

### Scenario A — Agent places a trade (shipped pre-split)

1. User asks `poly-brain` to buy a Polymarket outcome.
2. LangGraph calls `core__poly_place_trade` tool.
3. `PolyTradeCapability.placeTrade({conditionId, tokenId, outcome, side:"BUY", size_usdc, limit_price})`.
4. Capability generates `client_order_id = clientOrderIdFor("agent", tokenId + ":" + Date.now())`, builds `OrderIntent`, routes through `trading/clob-executor` → adapter.
5. Receipt returned as `PolyPlaceTradeReceipt` (includes `profile_url` for the operator EOA).

**Not written to `order-ledger` in v0** — agent-initiated placements are out-of-band. Follow-up tracked separately; adding it is a single call-site change in the capability.

### Scenario B — Autonomous mirror poll (this branch)

1. Scheduler fires every 30s on the singleton trader pod.
2. `mirror-coordinator.runOnce(deps)`:
3. `wallet-watch.activity-poll.nextFills(polymarketSource, lastObservedAt)` reads the Data-API `listUserActivity(target_wallet, since)`, normalizes, rejects empty-tx rows (counter: `poly_mirror_data_api_empty_tx_hash_total`), returns `{fills, newSince}`.
4. For each `Fill`: compute `cid`; `trading.order-ledger.snapshotState(target_id)` → `{today_spent_usdc, fills_last_hour, already_placed_ids, config.enabled}`; call `decide()`.
5. `recordDecision(d)` always (audit + metrics).
6. If `d.action === 'place'`: `order-ledger.insertPending` → `placeIntent` → `order-ledger.markOrderId` (or `markError` on throw). Any throw between insert and place leaves the pending row for the next tick to skip on.
7. Kill-switch `enabled=false` ⇒ coordinator exits with `decisions_total{reason:kill_switch_off}` and no DB inserts.

### Scenario C — Dashboard renders recent activity

1. Ops loads `/dashboard`.
2. `order-activity-card.tsx` server component SELECTs latest 50 ledger rows (no RLS per migration 0027) filtered by `target_id IS NOT NULL` (copy-trade instance).
3. Each row renders with `status`, `size_usdc`, `limit_price`, Polymarket profile link for `order_id`.
4. `revalidate: 5` refreshes independently of poll tick.

## Test layout

| Suite          | File                                                         | Covers                                                                                                                                       |
| -------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit (pure)    | `tests/unit/features/copy-trade/decide.test.ts`              | skip branches, caps, idempotency, fail-closed                                                                                                |
| Unit (pure)    | `tests/unit/features/trading/clob-executor.test.ts`          | ok / rejected / error metric + log shapes                                                                                                    |
| Unit (pure)    | `tests/unit/features/trading/order-ledger.test.ts`           | insertPending / markOrderId / markError / snapshotState against a fake DB                                                                    |
| Unit (pure)    | `tests/unit/features/wallet-watch/activity-poll.test.ts`     | cursor advance, empty-result short-circuit                                                                                                   |
| Unit (pure)    | `tests/unit/features/wallet-watch/polymarket-source.test.ts` | Data-API → `Fill[]` golden + empty-tx rejection                                                                                              |
| Unit (pure)    | `tests/unit/features/copy-trade/mirror-coordinator.test.ts`  | (a) idempotent re-run ⇒ zero re-placements (b) insert-then-crash resumes (c) kill-switch off (d) empty-tx reject (e) cap-hit branches        |
| Unit (wiring)  | `tests/unit/bootstrap/capabilities/poly-trade.test.ts`       | `bundle.placeIntent` + `capability.placeTrade` share ONE lazy-init adapter; `HARDCODED_WALLET_SECRETS_OK` resolution lives only in this file |
| Contract       | `packages/ai-tools/tests/poly-place-trade.test.ts`           | tool-shape boundary                                                                                                                          |
| Stack / manual | CP5 live canary trade                                        | real `order_id` in the ledger                                                                                                                |

## Deferred to later phases (explicit pointers)

- **Agent-tool ledger coverage:** add `order-ledger.insertPending` + `markOrderId` calls inside `poly-trade.ts::placeTrade` so the dashboard surfaces agent-initiated placements. Single call-site change; filed as follow-up.
- **P2 multi-target + click-to-copy UI:** `poly_copy_trade_targets` table + `features/copy-trade/target-resolver.ts`. `decide.ts` signature unchanged.
- **P2 multi-tenant wallet resolution:** replaces `buildRealAdapterMethods()` with a tenant-keyed lookup; no other file changes.
- **P3 paper body:** `packages/market-provider/src/adapters/paper/` gains a real body; `container.ts` routes `mode='paper'` targets to it. `trading/`, `wallet-watch/`, `copy-trade/` unchanged.
- **P4 streaming:** `subscribePolymarketUserFills.activity.ts` (WS) + `CopyTradeTriggerWorkflow` (Temporal) become the Fill source for `mirror-coordinator`, replacing `wallet-watch/polymarket-source`. `copy-trade-mirror.job.ts` + the scaffolded card deleted. `trading/` + `decide.ts` + `types.ts` unchanged. `source` label flips to `clob-ws`.

## Change log

| Date       | Change                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-18 | Initial spec — three-layer decomposition (trading / wallet-watch / copy-trade). Supersedes the monolithic-`copy-trade/` design from the pre-split draft. |
