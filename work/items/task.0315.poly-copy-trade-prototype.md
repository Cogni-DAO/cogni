---
id: task.0315
type: task
title: "Poly copy-trade prototype — v0 top-wallet scoreboard, v0.1 shadow 1-wallet mirror"
status: needs_implement
priority: 2
estimate: 5
rank: 5
branch: feat/poly-mirror-dashboard
pr: "918"
revision: 5
summary: "One-shot prototype task. v0 (PR-A, this PR): poly-brain + dashboard answer 'who are the top Polymarket wallets?' via a new core__wallet_top_traders tool + /dashboard Top Wallets card backed by the Polymarket Data API. v0.1 (PR-B, not in this PR): single-wallet shadow mirror via @polymarket/clob-client. No new packages, no ports, no ranking pipeline, no awareness-plane tables. If it works, we scale it; if it doesn't, we learned cheaply."
outcome: "A running prototype in the poly node. v0 (PR-A, shipped): ask poly-brain 'top wallets this week' and get a ranked list in chat + dashboard. v0.1 = four phases on a stable `decide()` boundary — P1 ships first live Polymarket order_id on one hardcoded target via disposable 30s poll scaffolding; P2 adds click-to-copy UI (DB-authoritative-when-populated, env fallback retained); P3 ships paper-adapter body so paper PnL over a real shadow soak becomes the evidence gate; P4 upgrades to WS → Redis streams → Temporal, gated on P3 evidence that edge survives slippage."
spec_refs:
  - architecture
  - langgraph-patterns
assignees: derekg1729
project: proj.poly-copy-trading
created: 2026-04-17
updated: 2026-04-19
labels: [poly, polymarket, follow-wallet, copy-trading, prototype]
external_refs:
  - docs/research/poly-copy-trading-wallets.md
---

# Poly Copy-Trade Prototype

> Research: [poly-copy-trading-wallets](../../docs/research/poly-copy-trading-wallets.md)
> Spike: [spike.0314](./spike.0314.poly-copy-trading-wallets.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)

## Plan

**v0 — PR-A checkpoints (shipped):**

- [x] **Checkpoint 1 — market-provider Data-API client** ✅ PR-A
  - Milestone: `PolymarketDataApiClient` class in `@cogni/market-provider`, verified against the saved fixture.
  - Invariants: PACKAGES_NO_ENV, READ_ONLY, CONTRACT_IS_SOT.
  - Todos: new `polymarket.data-api.types.ts` (Zod schemas) + `polymarket.data-api.client.ts` (class), extend barrel.
  - Validation: `pnpm -F @cogni/market-provider test` + fixture-driven parsing test.

- [x] **Checkpoint 2 — ai-tools `core__wallet_top_traders`** ✅ PR-A
  - Milestone: bound tool + stub registered in `TOOL_CATALOG`, passes schema tests.
  - Invariants: TOOL_ID_NAMESPACED, EFFECT_TYPED, REDACTION_REQUIRED, NO_LANGCHAIN.
  - Todos: new `tools/wallet-top-traders.ts`, extend `index.ts` exports + `catalog.ts`.
  - Validation: `pnpm -F @cogni/ai-tools test`.

- [x] **Checkpoint 3 — poly node wiring** ✅ PR-A
  - Milestone: `createWalletCapability` + tool binding + `POLY_BRAIN_TOOL_IDS` entry live in the container.
  - Invariants: CAPABILITY_INJECTION, SCOPE_IS_SACRED.
  - Todos: new `bootstrap/capabilities/wallet.ts`; update `container.ts`, `tool-bindings.ts`, `poly-brain/tools.ts`.
  - Validation: `pnpm -F poly-app typecheck` + unit test on the factory.

- [x] **Checkpoint 4 — dashboard "Top Wallets" card** ✅ PR-A
  - Milestone: `/dashboard` renders a live top-10 table with a DAY/WEEK/MONTH/ALL selector.
  - Invariants: SIMPLE_SOLUTION, CAPABILITY_NOT_ADAPTER in the API route.
  - Todos: new `/api/v1/poly/top-wallets/route.ts`, `_api/fetchTopWallets.ts`, `_components/TopWalletsCard.tsx`; modify `view.tsx`.
  - Validation: `pnpm check` clean; manual hit of the API route in dev confirms live data.

**v0.1 — four phases (each = one PR):**

- [x] **Phase 0 — Pre-flight** (no code). Findings recorded below ("Phase 0 — Findings"). P1 migration header will cite them verbatim.
- [ ] **Phase 1 — PR-B1 — First live order** (~1 week). Four checkpoints on the design branch (`design/poly-copy-trade-pr-b`, PR #890). 🎯 Real `order_id` on one hardcoded target.
  - [x] **CP1** — types + ports (`MarketProviderPort` Run methods, `OrderIntent/OrderReceipt/OrderStatus/Fill` Zod, `PolymarketOrderSigner` port, `OperatorWalletPort.signPolymarketOrder`, paper-adapter stub). Package-land only, no runtime wiring. Unit tests on Zod round-trip. ✅ commit `8293eb665`.
  - [ ] **CP2** — Privy Polygon EIP-712 signer + viem-compat shim + real `clob-client`-driven experiment. **Design-reviewed 2026-04-17 (revision 2):** CP2 must prove CP3's actual seam, not a primitive.
    - **Adapter method** — implement `signPolymarketOrder(typedData)` via `@privy-io/node` `wallets().ethereum().signTypedData(walletId, input)` (verified exists in SDK v0.10.1 — `resources/wallets/wallets.d.ts:542`). **SDK gotcha**: Privy input uses `primary_type` (snake_case) not `primaryType`; adapter must translate our `Eip712TypedData` (camelCase per EIP-712 convention) → Privy's `EthereumSignTypedDataRpcInput.Params.TypedData` shape. **Verify before writing** (5-min SDK read): (a) whether `authorization_context` is a valid field on `signTypedData` input (it is on `sendTransaction` — not documented in our source read yet); (b) exact response field name on `EthereumSignTypedDataRpcResponse.Data` (draft assumes `.signature`). Both flagged as unconfirmed in the draft body; must be resolved before commit.
    - **Chain allow-set, NOT single-value hardcode** — declare `POLYGON_ALLOWED_CHAIN_IDS = new Set([137])` (Polygon mainnet today). Doc-comment notes that adding Amoy (`80002`) behind a dev-only env gate is trivial when CP4 wants a testnet dress rehearsal. `signPolymarketOrder` MUST reject `!POLYGON_ALLOWED_CHAIN_IDS.has(typedData.domain.chainId)` at line 1, before calling Privy. Existing Base methods remain pinned to `BASE_CAIP2` (unchanged).
    - **viem-compat signer shim (new deliverable)** — `packages/operator-wallet/src/adapters/privy/polymarket-signer-shim.ts` exposes `makePolymarketSignerForClobClient(adapter) → { address, signTypedData, _signTypedData }` where the two signing methods take `(domain, types, value)` per viem/ethers-v5 convention and internally route through our narrow `signPolymarketOrder(Eip712TypedData)`. This is the shape `@polymarket/clob-client` calls internally. **Shipping the shim in CP2 (not CP3)** is what makes CP2 a real proof of CP3's path instead of a primitive test.
    - **Mocked-Privy unit tests**: (a) chain-100 typedData → CHAIN_MISMATCH error, zero Privy method calls; (b) chain-137 typedData → translation to `primary_type` snake_case is correct; (c) shim `_signTypedData(domain, types, value)` reassembles to the same `Eip712TypedData` the adapter expects.
    - **Live-testable deliverable** (evidence gate): `scripts/experiments/sign-polymarket-order.ts` constructs a real Polymarket CLOB order via **`@polymarket/order-utils`** (or `@polymarket/clob-client`'s order-building helper — whichever is the exported surface), then either (A) passes the produced `Eip712TypedData` to `adapter.signPolymarketOrder` directly for a minimal proof, or (B) — preferred — instantiates `new ClobClient(host, chainId, shim)` and calls `clobClient.createOrder({...})` in dry-run mode to prove the full seam (builder + shim + adapter + Privy all talk). Then verify the 65-byte signature against `expectedAddress` via `viem.verifyTypedData()`. Zero on-chain cost, no USDC, no Safe proxy, no ToS required — `createOrder` only signs.
    - **Why OSS envelope construction, not hand-rolled**: Polymarket has revved the order struct (neg-risk adapter added `signatureType: uint8`; CTF exchange verifyingContract varies per market class). Hand-rolling the envelope in CP2 risks going stale while `order-utils` stays current — and CP3's "green" would only prove a primitive we already trusted instead of the full CP3 path. Adopting `@polymarket/order-utils` here is the OSS-first move the reviewer flagged.
    - Script output + signature hex + clob-client's logged envelope pasted into the PR as CP2 evidence.
  - [ ] **CP3** — split into sub-CPs:
    - **CP3.1** ✅ on-chain USDC.e MaxUint256 allowances for {Exchange, Neg-Risk Exchange, Neg-Risk Adapter}.
    - **CP3.1.5** ✅ delete dead signer surface (CP1 `PolymarketOrderSigner` port + `OperatorWalletPort.signPolymarketOrder` + stub + 4 fakes + contract test) — pulled forward from original CP3.4 per design-review 2026-04-17.
    - **CP3.2** polymarket CLOB adapter Run methods via `@polymarket/clob-client`. Constructor takes viem `LocalAccount` + `ApiKeyCreds`. `DA_EMPTY_HASH_REJECTED` normalizer. Contract test vs recorded clob-client fixture. Move `@polymarket/clob-client` to `packages/market-provider` as optional peerDep (**explicit AC**).
    - **CP3.3** Drizzle migrations for `poly_copy_trade_{fills,config,decisions}`. Migration header cites the P0.2 `fill_id` shape verbatim AND pins `client_order_id` hash: `keccak256(utf8Bytes(target_id + ':' + fill_id))` truncated to 32 bytes (0x + 64 hex). `poly_copy_trade_config.enabled` defaults to `false` (fail-closed).
  - [ ] **CP4** — split into sub-CPs. **CP4.1/4.2/4.25 shipped on main via PR #900 (squash `b0765ef99`).** CP4.3+CP4.5 land on the fresh branch `feat/poly-mirror-v0`, restructured into three layers per the refined design (2026-04-18). See [docs/spec/poly-copy-trade-phase1.md](../../docs/spec/poly-copy-trade-phase1.md) for the layer map + invariants.
    - **CP4.1** ✅ pure `decide()` — `features/copy-trade/{decide,types}.ts`. Shipped in PR #900.
    - **CP4.2** ✅ `clob-executor` seam — shipped in PR #900 at `features/copy-trade/clob-executor.ts`; MOVED to `features/trading/clob-executor.ts` in CP4.3a (not copy-trade-specific).
    - **CP4.25** ✅ agent-callable tool stack — `core__poly_place_trade` / `list_orders` / `cancel_order` via `bootstrap/capabilities/poly-trade.ts`. Single-tenant Privy-wallet resolution isolated in `buildRealAdapterMethods()` (`HARDCODED_WALLET_SECRETS_OK`). Shipped in PR #900.
    - [ ] **CP4.3 — Autonomous 30s mirror poll** (three-layer decomposition; `@scaffolding` only on the job shim).
      - **CP4.3a — `PolyTradeBundle` seam split.** `createPolyTradeCapability()` returns `{ capability, placeIntent }`. `placeIntent(OrderIntent)` is the raw placement seam (caller-supplied `client_order_id`, wrapped by the same executor + adapter the agent tool uses). Agent path unchanged. Capability-factory test asserts both paths share ONE lazy-init adapter (`buildRealAdapterMethods` called once).
      - **CP4.3b — `features/trading/` (generic).** NEW layer. `trading/clob-executor.ts` (moved from `copy-trade/`), `trading/order-ledger.ts` (`insertPending` / `markOrderId` / `markError` / `snapshotState`), `trading/order-ledger.types.ts`. AGENTS.md: MUST NOT import `copy-trade/` or `wallet-watch/`. Vocabulary: "order," "intent," "receipt," "ledger."
      - **CP4.3c — `features/wallet-watch/` (generic).** NEW layer. `wallet-watch/polymarket-source.ts` (Data-API `listUserActivity` + cursor), `wallet-watch/activity-poll.ts` (pure `nextFills(source, since) → {fills, newSince}`). Emits `Fill[]` only — no policy concepts. AGENTS.md: MUST NOT import `copy-trade/` or `trading/`.
      - **CP4.3d — `features/copy-trade/mirror-coordinator.ts` (thin).** NEW. Pure `runOnce(deps)` glues `wallet-watch` → `decide` → `trading`. The ONLY file that imports from both `trading/` and `wallet-watch/`. Replaces the monolithic `poll.ts` / `state-reader.ts` / `fill-recorder.ts` / `normalize-activity.ts` files from the pre-split plan. Coordinator tests cover (a) idempotent re-run (b) insert-then-crash resume (c) kill-switch off (d) empty-tx reject (e) cap-hit.
      - **CP4.3e — Job shim + bootstrap wiring.** `bootstrap/jobs/copy-trade-mirror.job.ts` (`@scaffolding` / `Deleted-in-phase: 4`) — scheduler-core 30s tick → `mirror-coordinator.runOnce()`. Boot-guarded by `POLY_ROLE === "trader"`; logs `event:poly.mirror.poll.singleton_claim`; counter `poly_mirror_poll_ticks_total`. `SINGLE_WRITER` invariant = `POLY_ROLE=trader` + `replicas=1` (joint). No scheduler-worker split in P1.
      - **Metrics added in CP4.3:** `poly_mirror_decisions_total{outcome,reason,source="data-api"}`, `poly_mirror_kill_switch_fail_closed_total`, `poly_mirror_data_api_empty_tx_hash_total`, `poly_mirror_poll_ticks_total`. Prefix is `poly_mirror_*` (not `poly_copy_trade_*`) to track the layer: coordinator emits, ledger/watcher don't.
    - [ ] **CP4.5 — Read-only dashboard card** (generic ledger view; instance is `@scaffolding` / `Deleted-in-phase: 4`).
      - File: `app/(app)/dashboard/_components/order-activity-card.tsx`. Generic recent-orders card over `order-ledger`, takes a filter prop. Server component, `revalidate: 5`. The copy-trade-filtered instance (`target_id IS NOT NULL`) is the `@scaffolding` instance. The generic card survives P4.
      - Query: `SELECT decided_at, target_wallet, market_id, side, size_usdc, limit_price, status, order_id FROM poly_copy_trade_fills ORDER BY decided_at DESC LIMIT 50`.
      - **RLS:** migration 0027 documents "No RLS on these tables" — same DB client the ledger writes with. No new policy required.
      - Row link: `order_id` → `https://polymarket.com/profile/<operator>/trade/<order_id>` for live rows.
    - **Out of scope (explicitly):** retroactive ledger writes from the agent-tool path (follow-up), multi-tenant Privy wallet resolution, per-target DB rows, paper-adapter body, WS ingester, SSE card, Grafana dashboard JSON, index tuning, DB table rename from `poly_copy_trade_*` to layer-neutral names (deferred to P2).
- [ ] **Phase 2 — PR-B2 — Click-to-copy UI + RLS tenant-scoping** (~5 days). `poly_copy_trade_targets` table + dashboard "Copy" button + Copy Targets card. DB-authoritative-when-populated; env fallback retained. Env-removal filed as follow-up.
  - **MUST*FIX_P2 — Add RLS to `poly_copy_trade*{fills,decisions,config}`.** Migration 0027 landed these tables as system-owned (no RLS). P1 `feat/poly-mirror-v0` plumbs `serviceDb` (BYPASSRLS) through the `Container` interface for the three read APIs — this is a deliberate v0 shortcut, not a design choice. Multi-tenant wallet resolution in P2 MUST land with tenant scoping or we ship a security regression. Required work: (1) `ALTER TABLE ... ADD COLUMN owner_user_id uuid NOT NULL` on the three tables (backfill cogni_system for existing rows — trivial, no prod data); (2) `CREATE POLICY ... USING (owner_user_id = current_setting('app.user_id')::uuid)` on each; (3) mirror-coordinator + order-ledger wrap writes in `withTenantScope(db, operatorUserId, ...)`; (4) read APIs switch from `getContainer().serviceDb` to `getAppDb()` + session-scoped reads; (5) remove `Container.serviceDb` field (currently a foot-gun for any future route). See `packages/db-client/src/tenant-scope.ts` for the existing pattern + migration 0027 header for the original flag.
- [ ] **Phase 3 — PR-B3 — Paper-adapter body** (~3 days). 14-day soak produces the Phase 4 GO/NO-GO evidence. Sunsets the project if no edge.
- [ ] **Phase 4 — PR-B4 — Streaming upgrade** (~1.5 weeks, **gated on P3 evidence**). WS → Redis streams → Temporal trigger → existing `decide()`. Dual-run 48h; cutover gate = zero double-fires.

## Context

Research (spike.0314) mapped the OSS and data landscape. v0.1 is structured around a **stable `decide()` boundary**: the decision function, executor, and Postgres tables are written once in P1 and survive every future migration. Scaffolding (30s poll, SELECT-backed dashboard card, `COPY_TRADE_*` env vars) is intentionally disposable — headers label it `@scaffolding` with the phase that deletes it. This avoids building the full 3-tier streaming pipeline before real fills have been observed, and avoids throwaway polling code being hardened into tech debt.

## Design

### Outcome

Two working increments, shipped as **two PRs under this one task**:

- **v0 (PR-A, read-only, merges independently) — scoreboard, chat + dashboard:**
  - user asks `poly-brain` "who are the top Polymarket wallets right now?" → agent calls a new `core__wallet_top_traders` tool → scored list with wallet / PnL / win-rate / volume / activity score rendered as a markdown table in chat.
  - `/(app)/dashboard` gets a new "Top Wallets" card — server-component table of the top ~10 wallets with the same columns, backed by the same `WalletCapability`.
- **v0.1 (PR-B, click-to-copy + realtime mirror) — shadow mirror of one wallet:** operator clicks a wallet on the Top Wallets dashboard card → row inserted into `poly_copy_trade_targets (wallet, mode='paper'|'live', mirror_usdc, max_daily_usdc, max_fills_per_hour, enabled, ...)`. A long-lived **Polymarket user WebSocket subscription** for each enabled target publishes `PolymarketFillObserved` events to the existing `@cogni/node-streams` bus. A subscriber consumes the stream, runs mirror-service decision logic, and — only if every guard passes — routes placement through the existing `MarketProviderPort`'s **Run-phase surface** (`placeOrder` / `cancelOrder` / `getOrder`). Adapter selection per-target: `mode='live'` → polymarket-clob adapter (Privy-signed on Polygon); `mode='paper'` → paper adapter (stub in PR-B, body in follow-up). A 5-min reconciliation job runs as a safety net for any WebSocket gaps. Live mode requires the target's `mode='live'` AND global kill-switch row `enabled=true`.

### Approach

**Solution:** design around a stable decision boundary. Scaffolding for data ingress is intentionally disposable; everything load-bearing lives in files that survive every future migration. Four phases, each with an explicit permanent core + labeled scaffolding + one precise E2E proof.

### Stable boundary — survives every phase

The thing that does not change between v0.1 and v1 is the decision function:

```ts
// nodes/poly/app/src/features/copy-trade/decide.ts  (pure, zero I/O)
function decide(
  fill: Fill,
  config: TargetConfig,
  state: RuntimeState
): MirrorDecision;
```

- `Fill` = normalized `{target_wallet, fill_id, market_id, outcome, side, price, size_usdc, observed_at}`.
- `TargetConfig` = `{mirror_usdc, max_daily_usdc, max_fills_per_hour, mode, enabled}`. P1 sources from env; P2+ sources from DB. Signature unchanged.
- `RuntimeState` = `{today_spent_usdc, fills_last_hour, global_enabled, already_placed_ids}` — a snapshot at call time.
- Returns `{action: 'place' | 'skip', reason, intent?}`.

What changes between phases is only how `Fill` objects arrive and how `decide()` is invoked. The function, its unit tests, and the executor it hands to are written once in Phase 1 and touched in no subsequent phase.

### Permanent deliverables (stable across all phases)

Written in Phase 1 unless otherwise noted. No later phase modifies these — only grows the calling sites.

- `packages/market-provider/src/port/market-provider.port.ts` — Run-phase methods `placeOrder` / `cancelOrder` / `getOrder`.
- `packages/market-provider/src/domain/order.ts` — `OrderIntent` / `OrderReceipt` / `OrderStatus` / `Fill` Zod schemas.
- `packages/market-provider/src/adapters/polymarket/clob.adapter.ts` — Run methods via `@polymarket/clob-client`. Sole importer of the CLOB SDK. Constructor takes viem `LocalAccount` + `ApiKeyCreds` (no custom signer port — CP3.1.5 deleted `PolymarketOrderSigner` as dead surface).
- `packages/operator-wallet/` — **no Polymarket surface**. Privy adapter gains no new methods; CLOB signing uses `@privy-io/node/viem#createViemAccount` directly in the trader-role runtime.
- `nodes/poly/app/src/features/copy-trade/decide.ts` — pure function, heavy unit tests.
- `nodes/poly/app/src/features/copy-trade/clob-executor.ts` — takes a `MirrorIntent`, returns `{order_id}` or throws. Dynamic-import-gated on `POLY_ROLE === 'trader'`; sole importer of `@polymarket/clob-client` + `createViemAccount`.
- `nodes/poly/app/src/shared/db/schema.ts` — `poly_copy_trade_fills`, `poly_copy_trade_config`, `poly_copy_trade_decisions`. Schema below.
- `packages/market-provider/src/adapters/paper/` — adapter shape frozen in P1 (throws `NotImplemented`); body lands in Phase 3.
- Observability on `decide()` outcomes only: Pino log + Prometheus `decisions_total{outcome, reason}` counter per call. Poll-mechanism metrics are **not** instrumented.

DB schema (set in Phase 1, grown additively):

```sql
poly_copy_trade_fills (
  target_id    uuid        NOT NULL,   -- P1: synthetic UUID per env target; P2: FK to poly_copy_trade_targets
  fill_id      text        NOT NULL,   -- shape decided in Phase 0.2 (committed in this migration's header)
  observed_at  timestamptz NOT NULL,
  client_order_id text     NOT NULL,   -- keccak256(utf8Bytes(target_id || ':' || fill_id)), 0x-prefixed 64 hex
  order_id     text        NULL,       -- NULL until placeOrder completes
  status       text        NOT NULL,
  PRIMARY KEY (target_id, fill_id)
);

poly_copy_trade_config (
  singleton_id smallint PRIMARY KEY CHECK (singleton_id = 1),
  enabled      boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL,
  updated_by   text NOT NULL
);

poly_copy_trade_decisions (
  id         uuid PRIMARY KEY,
  target_id  uuid NOT NULL,
  fill_id    text NOT NULL,
  outcome    text NOT NULL,      -- 'placed' | 'skipped' | 'error'
  reason     text NULL,
  intent     jsonb NOT NULL,
  receipt    jsonb NULL,
  decided_at timestamptz NOT NULL
);
```

---

### Phase 0 — Pre-flight (no code, ~30 min)

| Check | Deliverable                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1   | Is a Temporal worker hosted in `POLY_ROLE=trader` today? One-line answer in PR-B1 description. Not a P1 blocker — affects P4 sizing.                                                                                                                                                                                                                                                                      |
| 0.2   | **Concrete schema decision** for `poly_copy_trade_fills.fill_id`: does Data-API `listUserActivity` emit the same identifier a future user-channel WS frame will emit? Output is a one-line decision committed in the P1 migration's header comment: "`fill_id` IS the canonical `<shape>`" OR "`fill_id` IS a composite `{source, native_id}`". One sentence of rationale. Not observations — a decision. |

**🎯 Phase 0 E2E validation:** The Phase 1 schema migration file header contains the chosen `fill_id` shape + rationale; PR-B1 references it.

### Phase 0 — Findings

**0.1 — Temporal worker presence:** Temporal is deployed repo-wide; a generic `scheduler-worker` runs platform-wide schedules. **No poly-specific Temporal worker exists today.** Implication: P1–P3 need none (scheduler-core hosts the disposable poll). P4 must introduce a poly-owned trader worker (registered in `POLY_ROLE=trader`) alongside the WS ingester activity — this work is already listed under P4 Files. No P1 blocker.

**0.2 — `fill_id` shape decision:** **`fill_id` IS a composite `"<source>:<native_id>"` text.** Namespaced sources with per-source native id:

- `data-api` → native_id = `${transactionHash}:${asset}:${side}:${timestamp}`
  - **Empty-hash rows are REJECTED at normalization** (skipped with a warn log + `data_api_empty_tx_hash_total` counter increment). `transactionHash` is declared `.optional().default("")` in `polymarket.data-api.types.ts` defensively; in practice the Polymarket Data-API populates it for every settled trade. A trade without a settlement tx hash cannot be reliably deduped cross-source and cannot have been mirrored anyway.
  - `timestamp` (unix seconds from the Data-API response) is included in the native_id to disambiguate multi-match settlements within a single Polygon tx (one tx can settle several matches against the same `(asset, side)` within a second of each other — without `timestamp` they'd collapse to the same PK and silently drop).
- `clob-ws` (P4) → native_id = operator `trade_id` (**exact shape committed in the P4 migration header** before the WS ingester activity lands — see `FILL_ID_SHAPE_DECIDED` invariant).

  Canonical example: `"data-api:0xabc…def:0x7e…9a:BUY:1713302400"`.

  **Rationale:** Data-API `/trades` (verified against `polymarket.data-api.types.ts`) surfaces on-chain-settled trades with `transactionHash + asset + side + timestamp` but **no operator-assigned match id**. A future CLOB WS user channel emits an operator `trade_id` from a separate identifier space that does not round-trip to a settlement tx hash. Attempting a canonical id via timestamp+price+size hashing is fragile (batching, rounding, ordering). Composite ids are explicit about source lineage and let P1 (DA) and P4 (WS) PKs coexist without bilingual dedupe.

  **Uniqueness invariant for DA native_id.** `(transactionHash, asset, side, timestamp)` is unique within the Data-API response surface because: (a) empty hashes are rejected (see above); (b) one tx affects a user's balance for one `(asset, side)` at one settlement timestamp (Polygon block timestamp at 1-second resolution). Batched settlements that share a tx hash are disambiguated by per-match `timestamp` values in the Data-API record. If a collision ever occurs, the PK violation is caught, logged with both rows, and surfaces to the operator — preferable to silent drops.

**Implication for P4 cutover (amendment).** A composite-keyed PK does NOT prevent two-source double-placement on a single logical match (DA row and WS row are distinct PKs). Therefore during the 48 h P4 dual-run, the DA poll runs in **observe-only** mode — `decide()` is still called and its outcome recorded to `poly_copy_trade_decisions`, but the executor is NOT invoked. WS is the sole placing path throughout the dual-run. The idempotency gate becomes provable by construction (single placing path → zero duplicate `(target_id, fill_id)` rows with non-null `order_id`), and the existing `decision_paths_diverged` counter captures observability divergence without doubling fills. This amendment is reflected in the Phase 4 subsection below.

---

### Phase 1 — First live order (PR-B1, ~1 week)

**Goal:** a real Polymarket `order_id` lands in `poly_copy_trade_fills` from a real fill on one hardcoded target wallet.

**Permanent:** see "Permanent deliverables" above.

**Disposable scaffolding** — each file's header MUST include `@scaffolding` + `Deleted-in-phase: 4`:

- `nodes/poly/app/src/bootstrap/jobs/copyTradeMirror.job.ts` — `@cogni/scheduler-core` 30 s poll calling `listUserActivity(ENV_TARGET_WALLET)` → normalizes to `Fill` → invokes `decide()` → on `place` calls `clob-executor`. ~80 lines. No retry hardening, no scheduling tuning, no poll-specific Grafana panels.
- `nodes/poly/app/src/app/(app)/dashboard/_components/copy-trade-activity-card.tsx` — server component, `SELECT * FROM poly_copy_trade_fills ORDER BY decided_at DESC LIMIT 50` with 5 s revalidate. No SSE, no streams. Phase 4 replaces with SSE reader; React surface unchanged.

**Env vars** (scaffolding-tier; fallback-retained in P2, removed in a dedicated deprecation PR after P2):

- `POLY_ROLE` (deployment role: `trader` | `web` | `scheduler`) — stays across all phases.
- `POLY_CLOB_API_KEY`, `POLY_CLOB_API_SECRET`, `POLY_CLOB_PASSPHRASE` (CLOB L2 auth — stay in env/vault across all phases).
- `COPY_TRADE_TARGET_WALLET`, `COPY_TRADE_MODE` (`paper` | `live`), `COPY_TRADE_MIRROR_USDC`, `COPY_TRADE_MAX_DAILY_USDC`, `COPY_TRADE_MAX_FILLS_PER_HOUR` — scaffolding, removed after P2.

**Signer:** Privy-managed EOA via `@privy-io/node/viem#createViemAccount` → viem `LocalAccount` consumed directly by `@polymarket/clob-client`. No bespoke `PolymarketOrderSigner` port, no wallet-port method — CP2 probing confirmed the EOA path works directly against the CLOB. The CP1 `signPolymarketOrder` port stub was deleted in CP3.1.5 as dead surface. See [docs/guides/polymarket-account-setup.md](../../docs/guides/polymarket-account-setup.md).

**Custody model — direct-EOA path** (no Safe proxy, verified 2026-04-17):

- `operator EOA` = Privy HSM-custodied wallet, **holds USDC.e and receives fills directly**. Polymarket's CLOB accepts direct-EOA accounts created via `createOrDeriveApiKey`.
- **No Safe proxy, no ToS browser step, no `getSafeAddress()` call.** The Safe-proxy model documented in Polymarket's UI docs is for their browser-onboarded accounts; an API-first EOA path bypasses it.
- One-time: `derive-polymarket-api-keys` (idempotent) → `approve-polymarket-allowances` (MaxUint256 for Exchange, Neg-Risk Exchange, Neg-Risk Adapter) → fund the EOA with USDC.e on Polygon + a few POL for gas. Operator wallet `0xdCCa8…5056` is onboarded as of CP3.1.

**Explicitly deferred from P1:** WebSocket ingester, Redis streams, Temporal workflows, Temporal worker wiring, `ObservationEvent` table, node-stream event types, reconciliation workflow, multi-target, click-to-copy UI, paper-adapter body, Grafana dashboards for the poll itself.

**🎯 Phase 1 E2E validation (ONE scenario):**

> Set `COPY_TRADE_TARGET_WALLET=<high-volume Polymarket wallet>`, `COPY_TRADE_MODE=live`, `UPDATE poly_copy_trade_config SET enabled=true`. Within 60 s of that wallet's next real fill, a row appears in `poly_copy_trade_fills` with a non-null `order_id`, AND the Polymarket web UI under the Cogni operator EOA (`0xdCCa8…5056`) shows an open position for `$1 USDC` on the same market. Paste `order_id` + screenshot into the PR.

---

### Phase 2 — Click-to-copy UI, DB-authoritative-when-populated (PR-B2, ~4 days)

**Goal:** operator manages copy targets via dashboard, no redeploy. Phase 1's env path remains functional as a fallback.

**Permanent:**

- `poly_copy_trade_targets` table — `(id uuid PK, wallet text UNIQUE, mode text CHECK IN ('paper','live') DEFAULT 'paper', mirror_usdc numeric(10,2) DEFAULT 1.00, max_daily_usdc numeric(10,2) DEFAULT 10.00, max_fills_per_hour int DEFAULT 5, enabled boolean DEFAULT true, added_by text, added_at timestamptz, updated_at timestamptz)`.
- `_api/copy-targets.ts` — server-action CRUD, RBAC: operator role only.
- Top Wallets card: "Copy" button per row → inserts target row with `mode='paper'` default.
- `copy-targets-card.tsx` — lists active targets, mode toggle, enable/disable, remove.
- Target-resolution rule (applied in poll + any future caller):

  ```
  targets = SELECT * FROM poly_copy_trade_targets WHERE enabled = true
  if (targets.length === 0 && COPY_TRADE_TARGET_WALLET is set) {
    log.warn("DB empty; using env fallback. Add a DB target to silence.")
    targets = [buildTargetFromEnv()]
  }
  ```

  **DB is authoritative when populated.** Env fallback only fires when the DB has zero enabled rows. This preserves Phase 1's working demo if Phase 2 ships with an empty targets table. **Env removal is explicitly deferred to a separate deprecation PR filed at P2 closeout — not in this PR.**

**Scaffolding retained:** the 30 s poll (still `Deleted-in-phase: 4`), the SQL-backed dashboard card.

**🎯 Phase 2 E2E validation (ONE scenario):**

> With `COPY_TRADE_TARGET_WALLET` unset, open `/dashboard`, click "Copy" on a top wallet → row appears in `poly_copy_trade_targets`, `mode='paper'` default. Flip to `mode='live'` via the Copy Targets card. Within one poll cycle (≤30 s) of that wallet's next fill, a new `poly_copy_trade_fills` row appears with non-null `order_id`. Click "Remove" → no further orders place. Then with env var SET and the DB target removed, the env fallback is used within one poll cycle (confirming fallback works); a warning log fires.

---

### Phase 3 — Paper-adapter body (PR-B3, ~3 days)

**Goal:** produce real paper-PnL data. This phase's output is the **evidence gate for Phase 4** — without it, Phase 4 would be gated on a handful of $1 live orders, which is too noisy to justify a ~1.5-week streaming investment.

**Permanent:**

- `packages/market-provider/src/adapters/paper/` — full body. On `placeOrder(intent)`: read a book snapshot from the Polymarket read path at `observed_at + N` seconds (configurable, default 5 s), write synthetic fill price to `paper_orders` table, return a synthetic `order_id`.
- `paper_orders` table — `(id, target_id, fill_id, market_id, intent jsonb, observed_at, synthetic_price, synthetic_size, synthetic_filled_at)`.
- Container routes to `paper` adapter when `target.mode='paper'`; `decide()` unchanged; executor swap is at the container boundary only.

**🎯 Phase 3 E2E validation (ONE scenario):**

> Set `mode='paper'` on a target with known 30-day realized PnL. Run for 14 days. At end of window: (a) every tracked fill produced a `paper_orders` row within 10 s of `observed_at`; (b) cumulative paper PnL is within a **pre-declared tolerance band** (e.g. ±30 %) of the target's realized PnL; (c) the PnL curves' correlation coefficient is > 0.8. If any fail, the paper model is the bug — fix before using it to gate P4.

**Phase 4 gate criterion** (derived from P3 output): at least ONE candidate target's 14-day paper PnL, adjusted for modeled slippage, survives as positive. If no candidate survives after testing multiple, the feature sunsets at Phase 3 — Phase 4 is not built.

---

### Phase 4 — Streaming upgrade (PR-B4, ~1.5 weeks — GATED on Phase 3 evidence)

**Gate:** P3 paper-soak evidence shows positive slippage-adjusted edge on at least one representative wallet over 14 days. If not, this phase does not start.

**Permanent:**

- Temporal worker wiring in `POLY_ROLE=trader` — **new worker** (P0.1 confirmed no poly-specific worker exists today; the platform `scheduler-worker` does not host poly activities).
- `subscribePolymarketUserFills` activity — long-lived WS, normalizes frames to the **same `Fill` shape** `decide()` already consumes, XADDs to `streams:copy-trade:polymarket-fills` with `source_ref={target_wallet, fill_id}`. Heartbeats.
- `CopyTradeTriggerWorkflow` — tails the stream (XREAD BLOCK via activity), **calls the existing `decide()`**, pure/replay-safe; on `place` signals `MirrorOrderWorkflow` and XADDs `triggers:copy-trade`.
- `MirrorOrderWorkflow` — single activity = the existing `clob-executor` call.
- `ReconcileFillsWorkflow` — 5 min scheduled; Data-API diff vs. stream's last 16 h; missing fills XADDed into the normal pipeline. **Cross-source join key** (also used by the P4 cutover gate): `(target_wallet, market_id, side, size_usdc, observed_at ± 300 s)`. The 300 s window accommodates the delay between CLOB operator match time and Polygon settlement block timestamp (typically 5–60 s, with a safety margin for network congestion).
- Dashboard card: swap SELECT-backed component for `/api/v1/node/stream` SSE reader. Renders identical decision-row list.
- Node-stream event types: `PolymarketFillObserved`, `CopyTradeDecisionMade`.

**Dual-run cutover:**

1. Deploy WS+Temporal alongside the poll. **DA poll runs in observe-only mode** during dual-run (calls `decide()`, records to `poly_copy_trade_decisions`, does NOT invoke `clob-executor`) — forced by the P0.2 composite `fill_id` decision, which makes DA and WS rows distinct PKs for the same logical match. WS is the sole placing path. `client_order_id` idempotency + `poly_copy_trade_fills` PK dedupe still backstop at-most-once on the WS path.
2. Run 48 h dual-run.
3. **Cutover gate — three-part, logical-match based** (the earlier single `GROUP BY fill_id HAVING COUNT(*)>1` query was vacuous given composite PKs + observe-only DA path: same logical match produces distinct `fill_id`s across sources, and only WS populates `order_id`, so the query is unreachable by construction. Replaced with):

   **(a) Zero double-placements per logical match.** Join rows that refer to the same real-world fill (cross-source match key: `(target_wallet, market_id, side, size_usdc, observed_at ± 300 s)` — see Non-blocking note below for rationale of the window):

   ```sql
   WITH matched AS (
     SELECT
       d.target_id,
       d.intent->>'market_id'   AS market_id,
       d.intent->>'side'        AS side,
       (d.intent->>'size_usdc')::numeric AS size_usdc,
       date_trunc('second', d.decided_at) AS ts_bucket,
       f.fill_id,
       f.order_id
     FROM poly_copy_trade_decisions d
     JOIN poly_copy_trade_fills f USING (target_id, fill_id)
     WHERE d.decided_at > '<dual-run-start>'
   )
   SELECT target_id, market_id, side, size_usdc,
          COUNT(*) FILTER (WHERE order_id IS NOT NULL) AS placed_count
   FROM matched
   GROUP BY target_id, market_id, side, size_usdc,
            width_bucket(EXTRACT(epoch FROM ts_bucket)::int, 0, 2147483647, 10000) -- ~5-min buckets
   HAVING COUNT(*) FILTER (WHERE order_id IS NOT NULL) > 1;
   ```

   Must return **zero rows**. By construction during observe-only dual-run this is trivial — but the query is intentionally the same one that runs post-cutover when WS is the only path, so it catches regressions if the observe-only gating is ever inverted.

   **(b) WS placement coverage ≥ 95 %.** WS must have placed at least 95 % of fills the observe-only DA path reported (logical-match-joined). Below that threshold the WS ingester is dropping fills and the cutover is NOT cleared — file a bug and extend the dual-run.

   ```sql
   -- rough shape: for each logical match observed by DA, did WS place an order?
   -- Passes if (matches_with_ws_order / matches_observed_by_da) ≥ 0.95 over the full 48 h window.
   ```

   **(c) `decision_paths_diverged` counter ≤ 5 % of total decisions.** Divergence beyond that suggests one source is systematically missing fills and needs investigation before cutover.

   100 % decision agreement is NOT the gate (different observation windows naturally disagree on timing). The three sub-gates together assert: no double-placements (a), WS isn't silently dropping (b), divergence stays within explained bounds (c).

4. Delete `copyTradeMirror.job.ts`. Delete the SQL-backed dashboard card. File the env-fallback deprecation PR promised at P2 closeout.

**🎯 Phase 4 E2E validation (ONE scenario):**

> During the 48 h dual-run, all three cutover sub-gates pass: (a) the logical-match SQL returns zero rows; (b) WS placement coverage ≥ 95 % of DA-observed matches; (c) `decision_paths_diverged` counter ≤ 5 % of total decisions. The dashboard live feed (SSE path) renders the decision in <2 s of the WS-observed fill. Kill the WS activity mid-burst → the reconcile workflow XADDs the missed fills within 5 min; normal pipeline places them; no dedupe violation.

---

### ObservationEvents — deferred with named trigger

Do NOT land in any phase above. Land when the **second consumer** arrives (e.g., `poly-synth` cross-wallet analysis; a second domain like Kalshi copy-trade; a third-party analytics plug-in). Designing the schema against one use case produces the wrong schema. A ~50-line backfill reads `poly_copy_trade_fills` + `poly_copy_trade_decisions` to seed history at that time. A tracking work-item is filed at P2 closeout and linked from the awareness-plane spec.

---

**Reuses:**

- Existing `PolymarketAdapter` HTTP + retry (PR-A).
- Existing `MarketProviderPort` — Run methods were anticipated by the port's own header comment.
- Existing Privy operator wallet — gains Polygon EIP-712 typed-data signing; zero new key-custody surface.
- `@polymarket/clob-client` (MIT) — encapsulated behind the polymarket adapter.
- `@cogni/scheduler-core` — for the disposable P1/P2 poll.
- `@cogni/node-streams` + Temporal — arrive in P4 (gated on P3 evidence).
- Patterns (not code) from `Polymarket/agents` and `GiordanoSouza/polymarket-copy-trading-bot`.

**Rejected:**

- **Building the 3-tier streaming pipeline first.** Ships nothing in P1, blocks on Temporal worker wiring, over-designs stream event shapes before real fills have been observed, and commits the P4 complexity before P3 paper-PnL has proven the edge exists. Replaced by disposable-poll + stable-boundary approach per senior-architect review.
- **Paper-adapter body after streaming** (prior ordering). Rejected: P4's gate becomes "handful of $1 live orders", too noisy to base a 1.5-week investment decision on. Paper body moves before streaming so the 14-day soak becomes real evidence.
- **Env-var removal in the UI PR (P2).** Rejected per reviewer: P2's job is the UI surface; ripping out P1's working env path in the same change increases blast radius for no scope win. DB-authoritative-when-populated with env fallback ships in P2; env-removal is a separate deprecation PR.
- **"100 % decision agreement" as P4 cutover gate.** Rejected: poll and WS have different observation windows and will naturally disagree on timing/order; demanding 100 % agreement is unachievable. Replaced by idempotency gate: zero double-fires, exactly one `order_id` per `Fill`.
- **Extending `OperatorWalletPort` with `placePolymarketOrder`.** Wallet port stays transfer-only. Order placement belongs on `MarketProviderPort`.
- **New `MarketExecutorPort` / `@cogni/market-executor` package.** `MarketProviderPort` was designed to grow Run methods; splitting read/write fragments credentials and provider abstraction.
- **Custom `PolymarketOrderSigner` port + `OperatorWalletPort.signPolymarketOrder` method.** Initially added in CP1; deleted in CP3.1.5 as dead surface once CP2 proved `@privy-io/node/viem#createViemAccount` produces a viem `LocalAccount` that `@polymarket/clob-client` consumes natively. No hand-rolled translation, no shim.
- **`DRY_RUN` flag as a conditional inside the live adapter.** Replaced by per-target `mode` column — adapter swap at the container boundary, no mixed identities.
- **Awareness-plane `ObservationEvent` insert in P1/P2/P3/P4.** Deferred with named trigger (above). Premature abstraction against a single consumer.
- **Self-attested legal-gate env var.** Trivially bypassable theater. Legal responsibility in the PR alignment-decisions checklist.
- **Separate `POLY_PROXY_SIGNER_PRIVATE_KEY` env var.** Privy HSM holds the key; `createViemAccount` routes signs through the HSM. No new key surface.
- Importing any Python OSS — different runtime, viral licenses where applicable.
- `poly_tracked_wallets` / weekly ranking batch — Data-API leaderboard is live.
- Category scoping, ranking sophistication — defer.

### Files (v0 / PR-A, shipped)

- `packages/market-provider/src/adapters/polymarket/data-api.ts` — three Data-API methods + Zod schemas.
- `packages/ai-tools/src/tools/wallet-top-traders.ts` — `core__wallet_top_traders` tool.
- `packages/ai-tools/src/index.ts` — tool id + `WalletCapability` interface.
- `nodes/poly/app/src/bootstrap/capabilities/wallet.ts` — capability resolver.
- `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts` + `nodes/poly/graphs/src/graphs/poly-brain/tools.ts` — wiring.
- `nodes/poly/app/src/app/(app)/dashboard/_{api,components}/top-wallets*` + `page.tsx` — Top Wallets card.

### Files — by phase (v0.1)

**Phase 1 — First live order:**

- `packages/market-provider/src/port/market-provider.port.ts` — extend with `placeOrder` / `cancelOrder` / `getOrder`.
- `packages/market-provider/src/domain/order.ts` — `OrderIntent` / `OrderReceipt` / `OrderStatus` / `Fill` Zod schemas.
- `packages/market-provider/src/adapters/polymarket/clob.adapter.ts` — Run methods via `@polymarket/clob-client`; viem `LocalAccount` + `ApiKeyCreds` injected at construction. **`@polymarket/clob-client` moves to this package as optional peerDep in CP3.2 (explicit AC).**
- `packages/market-provider/src/adapters/paper/` — interface scaffolded, body throws `NotImplemented`. `providerIdentity` is constructor-configurable (default `polymarket`).
- `packages/operator-wallet/` — **no changes.** Polymarket signing does not live on this port; `createViemAccount` is called directly from `clob-executor.ts`.
- `nodes/poly/app/src/features/copy-trade/decide.ts` — pure `decide()`, heavy unit tests.
- `nodes/poly/app/src/features/copy-trade/clob-executor.ts` — takes `MirrorIntent`, returns `{order_id}`. Dynamic-import-gated on `POLY_ROLE === 'trader'`. Sole importer of `@polymarket/clob-client` + `@privy-io/node/viem#createViemAccount`.
- `nodes/poly/app/src/bootstrap/jobs/copyTradeMirror.job.ts` — `@scaffolding` / `Deleted-in-phase: 4`. 30 s poll → normalize → `decide()` → executor.
- `nodes/poly/app/src/app/(app)/dashboard/_components/copy-trade-activity-card.tsx` — `@scaffolding` / `Deleted-in-phase: 4`. SELECT-backed card.
- `nodes/poly/app/src/shared/db/schema.ts` — add `poly_copy_trade_fills`, `poly_copy_trade_config`, `poly_copy_trade_decisions`. Migration header declares the Phase 0.2 `fill_id` shape.
- `nodes/poly/app/src/bootstrap/container.ts` — construct polymarket adapter with signer when `POLY_ROLE === 'trader'`; other roles get read-only adapter whose `placeOrder` throws.
- `nodes/poly/app/src/shared/env/server-env.ts` — add `POLY_ROLE`, `POLY_CLOB_*`, scaffolding `COPY_TRADE_*`.
- `.env.example` — document the above.
- Tests: unit tests on `decide()` (one per skip-reason branch + cap edges + idempotency); contract tests on the polymarket adapter Run methods against a recorded `@polymarket/clob-client` fixture; absence-of-module-load assertion for non-trader replicas.

**Phase 2 — Click-to-copy UI:**

- `nodes/poly/app/src/shared/db/schema.ts` — add `poly_copy_trade_targets` (schema above). Migrate `poly_copy_trade_fills.target_id` FK to the new table (backfill synthetic UUIDs for any P1 rows).
- `nodes/poly/app/src/app/(app)/dashboard/_api/copy-targets.ts` — server action CRUD, operator-role RBAC.
- `nodes/poly/app/src/app/(app)/dashboard/_components/top-wallets-card.tsx` — add "Copy" button per row.
- `nodes/poly/app/src/app/(app)/dashboard/_components/copy-targets-card.tsx` (new) — list, mode toggle, enable/disable, remove.
- `nodes/poly/app/src/features/copy-trade/target-resolver.ts` (new) — implements the DB-authoritative-when-populated rule; emits a warn log when env fallback fires.
- Closeout deliverable: a follow-up work-item filed to deprecate env fallback after P2 has been running cleanly for 1 week.
- Tests: integration test for the DB-vs-env fallback branching (both populated, DB empty + env set, both empty).

**Phase 3 — Paper-adapter body:**

- `packages/market-provider/src/adapters/paper/` — body: pull book snapshot at `observed_at + N s`, write synthetic fill, return synthetic receipt.
- `nodes/poly/app/src/shared/db/schema.ts` — add `paper_orders`.
- `nodes/poly/app/src/features/copy-trade/paper-analysis.ts` (optional) — small utility that computes cumulative paper PnL vs tracked realized PnL for the 14-day soak report.
- Closeout deliverable: the paper-soak report with the Phase 4 gate decision (GO / NO-GO + numbers).

**Phase 4 — Streaming upgrade (gated on P3):**

- `nodes/poly/app/src/adapters/server/temporal/worker.ts` — **new worker** for `POLY_ROLE=trader` (P0.1 confirmed no poly-specific worker exists today).
- `nodes/poly/app/src/features/copy-trade/activities/subscribePolymarketUserFills.activity.ts` — long-lived WS, normalizes frames to `Fill`, XADDs to `streams:copy-trade:polymarket-fills`.
- `nodes/poly/app/src/features/copy-trade/activities/placeMirrorOrder.activity.ts` — calls existing `clob-executor`.
- `nodes/poly/app/src/features/copy-trade/workflows/CopyTradeIngesterWorkflow.ts` — starts/cancels per-target WS activities on target enable/disable events.
- `nodes/poly/app/src/features/copy-trade/workflows/CopyTradeTriggerWorkflow.ts` — tails stream, calls `decide()`, signals `MirrorOrderWorkflow`.
- `nodes/poly/app/src/features/copy-trade/workflows/MirrorOrderWorkflow.ts` — single-activity workflow.
- `nodes/poly/app/src/features/copy-trade/workflows/ReconcileFillsWorkflow.ts` — 5 min scheduled reconcile.
- `packages/market-provider/src/domain/node-events.ts` — `PolymarketFillObserved`, `CopyTradeDecisionMade` event types; poly NodeEvent union extended.
- `nodes/poly/app/src/app/(app)/dashboard/_components/copy-trade-activity-card.tsx` — swap SELECT for SSE-over-`/api/v1/node/stream` reader.
- `nodes/poly/app/src/bootstrap/jobs/copyTradeMirror.job.ts` — **DELETED** post-cutover.
- New deprecation PR filed for `COPY_TRADE_*` env-var fallback (promised at P2 closeout).

### Observability

- Every `decide()` outcome: Pino log + Prometheus `decisions_total{outcome, reason, source}` counter. `source ∈ {data-api, clob-ws}` — the source label is introduced in P1 (always `data-api`), carried through every phase, and becomes the divergence dimension during P4 dual-run (required so observe-only DA decisions don't double-count the `active` path in dashboards).
- Additional counters:
  - `live_orders_total{source}` — distinguishes P1 DA-placed orders from P4 WS-placed orders; enables the WS-coverage gate (P4 cutover sub-gate (b)).
  - `cap_hit_total{dimension=daily|hourly}`.
  - `data_api_empty_tx_hash_total` (P1+) — increments every time a Data-API trade with empty `transactionHash` is rejected at normalization (per the P0.2 uniqueness invariant). A sustained non-zero rate suggests Data-API behavior has changed and the `fill_id` shape needs re-evaluation.
  - `decision_paths_diverged` (P4) — increments when a logical-match join (same key as `ReconcileFillsWorkflow`) finds a fill observed by only one of {DA, WS} within the dual-run window. Feeds cutover sub-gate (c).
  - `env_fallback_in_use` (gauge, flips to 1 when P2 fallback fires).
- Grafana dashboard JSON: single panel group covering decisions by outcome + source, cap-hit rate, last-fill age, live-order throughput by source, empty-hash reject rate, divergence rate. Lands in Phase 2 (once the surface is stable); P4 extends with the divergence panel.
- Poll-mechanism metrics are NOT instrumented. The scaffolding is disposable; dashboard panels for it would become tech debt.

### Secret boundary

- Signing key: Privy HSM only. Neither the market adapter nor app code sees raw key material. The trader-role runtime obtains a viem `LocalAccount` via `createViemAccount(privy, {...})` that routes signs through the HSM; `@polymarket/clob-client` consumes that account natively.
- Single operator EOA holds USDC.e and receives fills (no Safe proxy — see "Custody model" above). Stored with the Privy wallet config; exposed via `OperatorWalletPort.getAddress()`.
- CLOB L2 credentials: env/vault across all phases, per operator directive. Only loaded when `POLY_ROLE === 'trader'`.
- One-time manual ops (PR description, not automated): run `derive-polymarket-api-keys`, run `approve-polymarket-allowances`, fund the EOA with USDC.e + a few POL for gas.

### Tests

Per-phase unit + integration tests are listed inline under each Phase's Files block above. Live CLOB placement is never exercised in CI — only in the Phase 1 controlled manual run, with the `order_id` pasted into the PR description as evidence.

### Historical — PR-A prep (now shipped)

- Leaderboard curl verified 2026-04-17 (no window param, no win-rate). Fixture saved at `docs/research/fixtures/polymarket-leaderboard.json`; ROI derived from `pnl/vol`.
- `@polymarket/clob-client` TS SDK verification — covered by PR-A's research doc linked above.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] STABLE_BOUNDARY: `decide()` is pure, zero I/O, and no phase after P1 modifies it — only grows its callers.
- [ ] DECIDE_NOT_DUPLICATED: poll (P1), DB-driven poll (P2), and Temporal trigger (P4) all call the same `decide()` module.
- [ ] CLOB_EXECUTOR_SOLE_SIGNER: `clob-executor.ts` is the only importer of `@polymarket/clob-client` and `@privy-io/node/viem`; dynamic-import-gated on `POLY_ROLE === 'trader'`.
- [ ] SIGNER_VIA_LOCAL_ACCOUNT: the CLOB adapter takes a viem `LocalAccount` (from `createViemAccount`) via constructor; no Privy imports in the adapter, no env reads, no custom signer port.
- [ ] PORT_IS_EXISTING: Run-phase methods extend the existing `MarketProviderPort`; no new port package.
- [ ] SCAFFOLDING_LABELED: every disposable file's header states `@scaffolding` + `Deleted-in-phase: N`. Must include the phase number at which deletion occurs.
- [ ] DB_AUTHORITATIVE_WHEN_POPULATED (P2+): once `poly_copy_trade_targets` has ≥1 enabled row, the env fallback is NOT consulted; env only fires when DB is empty.
- [ ] ENV_FALLBACK_LOGGED (P2): every tick that consults env instead of DB emits a warn log + flips the `env_fallback_in_use` gauge to 1.
- [ ] ENV*REMOVAL_DEFERRED (P2): the `COPY_TRADE*\*` env vars are NOT removed in the same PR as the UI; a follow-up deprecation work-item is filed at P2 closeout.
- [ ] DEDUPE_PERSISTED: `poly_copy_trade_fills` PK `(target_id, fill_id)` is the commit point; in-memory dedupe is forbidden.
- [ ] GLOBAL_KILL_DB_ROW: flipping `poly_copy_trade_config.enabled=false` halts live placements within one poll/workflow cycle. **Fail-closed**: if the config SELECT fails (DB unreachable / timeout), the poll treats `enabled` as `false` and skips placement, emitting `kill_switch_fail_closed_total`. Migration header sets `enabled DEFAULT false`.
- [ ] PER_TARGET_KILL (P2+): `poly_copy_trade_targets.enabled=false` halts that target; `mode='paper'` routes through the paper adapter (body from P3 on).
- [ ] HARD_CAP_DAILY / HARD_CAP_HOURLY: enforced by `decide()` against `TargetConfig` caps.
- [ ] IDEMPOTENT_BY_CLIENT_ID: `client_order_id = keccak256(utf8Bytes(target_id + ':' + fill_id))` as a 0x-prefixed 32-byte hex (64 hex chars). Function pinned in the CP3.3 migration header alongside the `fill_id` shape; both the executor and any future WS path MUST use this exact function. CLOB dedupes at placement; PK dedupes at commit.
- [ ] DECIDE_OBSERVED: every `decide()` outcome emits Pino + `decisions_total{outcome, reason, source}`. The `source` label is mandatory from P1 onwards (always `data-api` in P1–P3; adds `clob-ws` in P4). Poll-mechanism metrics are NOT instrumented (tech-debt avoidance).
- [ ] FILL_ID_SHAPE_DECIDED: the Phase 1 migration header declares the `data-api` `fill_id` shape per P0.2: composite `"<source>:<native_id>"` where `source ∈ {data-api, clob-ws}` and `data-api` native_id = `${transactionHash}:${asset}:${side}:${timestamp}` with empty-hash rows rejected at normalization. **The Phase 4 migration header MUST commit the final `clob-ws` native_id shape before the WS ingester activity lands** (shape is confirmed at P4 implementation time, not speculatively in P1). No bilingual dedupe across phases.
- [ ] DA_EMPTY_HASH_REJECTED (P1+): Data-API trades with empty `transactionHash` are skipped at the normalizer with a warn log + `data_api_empty_tx_hash_total` counter increment. Never inserted into `poly_copy_trade_fills`. Uniqueness of the DA `fill_id` depends on this rejection.
- [ ] CLOB_SECRETS_MINIMAL_ENV: only CLOB L2 secrets + `POLY_ROLE` in env; no private keys.
- [ ] OBSERVATION_EVENTS_DEFERRED: no writes to `observation_events` from copy-trade code until the named second-consumer trigger fires.
- [ ] STREAM_THEN_EVALUATE (P4): every WS frame XADDs before trigger evaluation (spec: data-streams).
- [ ] TEMPORAL_OWNS_IO (P4): WS subscription + stream reads/writes + DB writes all in Temporal activities (spec: data-streams).
- [ ] TRIGGERS_ARE_PURE (P4): `CopyTradeTriggerWorkflow` is pure/replay-safe and calls `decide()` (spec: data-streams).
- [ ] CUTOVER_IDEMPOTENCY_GATE (P4): 48 h dual-run passes all three sub-gates — (a) logical-match SQL finds zero logical matches with >1 non-null `order_id`; (b) WS placement coverage ≥ 95 % of DA-observed matches (via the same cross-source join key used by `ReconcileFillsWorkflow`); (c) `decision_paths_diverged` ≤ 5 % of total decisions. Decision-path agreement is NOT the gate.
- [ ] OBSERVE_ONLY_DUAL_RUN_P4: during the 48 h P4 dual-run, `clob-executor` is invoked solely from the WS path. The DA poll records `decide()` outcomes to `poly_copy_trade_decisions` (for divergence analysis) but MUST NOT invoke the executor. This is the only mechanism preventing composite-PK double-placement and is enforced by code (a `dryRun: boolean` gate on the DA code path that flips to `true` during dual-run) rather than prose alone.

## Validation

**v0 (PR-A, shipped):**

- [x] `poly-brain` chat returns the ranked wallet list.
- [x] Dashboard Top Wallets card renders the live leaderboard.

**Phase 0 — Pre-flight gate (no code):**

- [x] `fill_id` shape + rationale recorded in Phase 0 — Findings (composite `"<source>:<native_id>"`; P1 migration header cites this verbatim).
- [x] Temporal-worker presence recorded: platform `scheduler-worker` runs; no poly-specific worker today. P4 adds one.

**🎯 Phase 1 — First live order:**

- [ ] With `COPY_TRADE_TARGET_WALLET=<target>`, `COPY_TRADE_MODE=live`, `poly_copy_trade_config.enabled=true`: within 60 s of the target's next real fill, a `poly_copy_trade_fills` row appears with non-null `order_id`; Polymarket web UI under the Cogni Safe proxy shows the open position. `order_id` + screenshot pasted into the PR.
- [ ] Flipping `poly_copy_trade_config.enabled=false` halts further placements within one poll cycle; no redeploy.
- [ ] Unit: `client_order_id` collision → adapter returns existing receipt without placing.
- [ ] Unit: daily + hourly caps block further placements once hit (one test per branch in `decide()`).
- [ ] Non-trader replica boots without loading `@polymarket/clob-client` or Privy Polygon signing (absence-of-module-load assertion).
- [ ] Every scaffolding file header contains `@scaffolding` + `Deleted-in-phase: 4`.

**🎯 Phase 2 — Click-to-copy UI:**

- [ ] Click "Copy" on the Top Wallets card → row in `poly_copy_trade_targets` with `mode='paper'` default.
- [ ] With ≥1 DB target, env is NOT consulted; `env_fallback_in_use` gauge = 0.
- [ ] With DB empty and env set, env fallback is used within one poll cycle; warn log + gauge = 1.
- [ ] Flipping `mode='live'` via the Copy Targets card → next fill produces a `poly_copy_trade_fills` row with non-null `order_id` within one poll cycle.
- [ ] "Remove" stops further placements for that target.
- [ ] Env-fallback deprecation work-item exists and is linked in the PR.

**🎯 Phase 3 — Paper-adapter body:**

- [ ] Every tracked fill on a `mode='paper'` target produces a `paper_orders` row within 10 s of `observed_at` for 14 continuous days.
- [ ] Cumulative paper PnL is within the pre-declared tolerance band (e.g. ±30 %) of the target's realized PnL; PnL correlation > 0.8.
- [ ] Phase 4 GO/NO-GO decision is recorded in the closeout doc with numbers.

**🎯 Phase 4 — Streaming upgrade (only if P3 gate = GO):**

- [ ] 48 h dual-run: all three cutover sub-gates pass — (a) logical-match SQL returns zero rows; (b) WS placement coverage ≥ 95 % of DA-observed matches; (c) `decision_paths_diverged` ≤ 5 % of total decisions.
- [ ] Dashboard SSE path renders a decision in <2 s of the WS-observed fill.
- [ ] Kill WS activity mid-burst → reconcile workflow XADDs missed fills within 5 min; normal pipeline places them; no dedupe violation.
- [ ] Post-cutover: `copyTradeMirror.job.ts` deleted; SQL-backed dashboard card deleted; env-fallback deprecation PR opened.

**Overall merge gate (every phase PR):**

- [ ] `pnpm check` passes.

**Post-merge sign-off (tracked separately, not a merge gate):**

- After Phase 3 completes, the paper-soak report is the authoritative record of whether Phase 4 should be built. No edge → feature sunsets at P3; Phase 4 is not started.

## Out of Scope (push back if scope creeps)

- `ObservationEvent(kind=polymarket_wallet_trade)` / `poly-synth` cross-wallet analysis — deferred with named trigger (second consumer).
- `poly_tracked_wallets` / weekly ranking batch — Data-API leaderboard is live.
- Category scoping, survivorship-bias guards beyond Data-API defaults.
- `poly-brain` cite-wallet tool (citation DAG into knowledge plane).
- Goldsky subgraph / Polygon block-listener — CLOB WS (in P4) is sufficient.
- Multi-user / retail-facing mirroring — single-operator only (see Alignment Decisions).
- Per-strategy attribution across proxies; operator-wallet integration.
- Slippage modeling beyond the P3 paper-soak comparison.
- Env-var removal in the same PR as the P2 UI change — filed as a separate deprecation PR after P2.

Any requests here mid-flight → new follow-up task.

## Review Feedback (revision 1, 2026-04-16)

Phase 0 findings are directionally sound but have substantive issues that will bite P1's migration and P4's cutover. Fix before `/implement P1`:

1. **`fill_id` composite is not unique** (L167–172). `polymarket.data-api.types.ts` declares `transactionHash: z.string().optional().default("")`. Empty-hash rows collapse to `data-api::<asset>:<side>` → PK violation silently drops fills. Multi-match settlements within one tx also share `(tx, asset, side)`. Decide between (a) include `timestamp` in `native_id`, or (b) reject/repair rows with empty `transactionHash`. Commit the final shape — with rationale for uniqueness — in the P1 migration header.

2. **P4 cutover SQL is vacuous** (L281–287, L441). Composite prefixes make DA and WS rows different PKs for the same logical match, so `GROUP BY target_id, fill_id HAVING COUNT(*)>1` is unreachable by the unique constraint. Combined with the observe-only amendment, only WS inserts non-null `order_id`s — "zero double-placements" holds by construction and proves nothing. Replace with a cross-source join on `(target_wallet, conditionId, side, timestamp ± Δ)` and assert ≤1 non-null `order_id` per logical match, or make the gate `decision_paths_diverged` bounded + WS-order count ≈ DA-observed count within tolerance.

3. **`decision_paths_diverged` counter referenced but not declared** (L176, L289 vs L395–398). Add it to the Observability section's counter list.

4. **`decisions_total` needs a dual-run label** (L395). Without `mode=active|observe_only` (or equivalent), observe-only DA decisions double-count during the 48 h window, breaking any dashboard keyed on the counter.

5. **`OBSERVE_ONLY_DUAL_RUN_P4` invariant missing** (L418–442). The executor-not-invoked amendment is the only mechanism preventing double-placement during dual-run. Prose is insufficient — add an invariant mandating that `clob-executor` is invoked solely from the WS path during dual-run, and that the DA poll records decisions without placing.

6. **`FILL_ID_SHAPE_DECIDED` must mandate a P4 header commit** (L435). Current wording decides only the data-api shape. Add a clause requiring the P4 migration header to commit the final `clob-ws` native_id shape before the WS ingester activity lands.

7. **Stale conditional phrasing** (L267, L381). "(if P0.1 showed it was missing)" — P0.1 is definitive. Replace with a direct statement.

Non-blocking: in P4 reconcile prose, pre-commit the cross-source join key (likely `(target_wallet, conditionId, side, size, timestamp ± Δ)`) so the reconcile activity has an unambiguous target when implemented.

### Response to revision 1 (revision 2, 2026-04-16)

All seven items addressed. P1 is unblocked pending operator ack of the uniqueness rationale.

1. **`fill_id` uniqueness — both fixes applied.** Empty-hash rows are rejected at normalization (new `DA_EMPTY_HASH_REJECTED` invariant + `data_api_empty_tx_hash_total` counter). `timestamp` added to the DA native_id to disambiguate same-tx multi-match settlements. New shape: `"data-api:${transactionHash}:${asset}:${side}:${timestamp}"`. Rationale paragraph added to Phase 0 Findings explaining why this combination is unique within the Data-API surface.
2. **P4 cutover — replaced with three-sub-gate logical-match approach.** (a) SQL joins decisions+fills by `(target_wallet, market_id, side, size_usdc, observed_at ± 300 s)` and asserts ≤1 non-null `order_id` per logical match; (b) WS placement coverage ≥ 95 % of DA-observed matches; (c) `decision_paths_diverged` ≤ 5 %. Validation checkbox + P4 E2E scenario updated to match. Updated `CUTOVER_IDEMPOTENCY_GATE` invariant to cite all three.
3. **`decision_paths_diverged` declared.** Added to Observability counter list with definition (logical-match join key identical to `ReconcileFillsWorkflow`).
4. **`decisions_total` source label.** Added `source ∈ {data-api, clob-ws}` label, introduced in P1 and carried through every phase. Applied the same label to `live_orders_total` so the WS-coverage gate has a direct counter. Updated `DECIDE_OBSERVED` invariant.
5. **`OBSERVE_ONLY_DUAL_RUN_P4` invariant added.** Enforced in code via a `dryRun: boolean` flag on the DA path (not prose). Called out that this is the only mechanism preventing composite-PK double-placement.
6. **`FILL_ID_SHAPE_DECIDED` strengthened.** Now requires the P4 migration header to commit the final `clob-ws` native_id shape before the WS ingester activity lands. Explicit non-goal: do NOT speculatively commit the `clob-ws` shape in P1.
7. **Stale conditionals removed.** Both "if P0.1 showed" sites (L268 Permanent, L382 Files) rewritten as direct statements — "new worker (P0.1 confirmed no poly-specific worker exists today)".

Non-blocking note applied: `ReconcileFillsWorkflow` now specifies the join key in-line as `(target_wallet, market_id, side, size_usdc, observed_at ± 300 s)`, with rationale on the 300 s window (operator-match-to-Polygon-settlement delay typically 5–60 s; safety margin for network congestion). The P4 cutover gate uses the identical key.

Incidental fix: L429 had a corrupted `ENV*REMOVAL_DEFERRED` / `COPY_TRADE*\*` from prior markdown-escape damage; restored to `ENV_REMOVAL_DEFERRED` / `COPY_TRADE_*`.

### CP2 review feedback (revision 3, 2026-04-17)

External design reviewer flagged the CP2 plan as REQUEST CHANGES because the proposed experiment would hand-roll the Polymarket CLOB order envelope instead of using OSS, and the narrow `PolymarketOrderSigner` port shape doesn't plug into `@polymarket/clob-client` (which expects a viem-WalletClient / ethers-v5 `Signer` with `signTypedData(domain, types, value)` or `_signTypedData`). Net effect: CP2-green wouldn't actually prove CP3's path.

All four reviewer items folded into the CP2 bullet above:

1. **OSS-First (experiment script)** — CP2 experiment now imports `@polymarket/order-utils` (or the clob-client order-building helper) to construct the envelope. Hand-rolling the struct risked going stale against neg-risk adapter revs (`signatureType: uint8`) and per-market-class verifyingContract variation. Task bullet now calls out this rationale explicitly.

2. **Architecture — viem-compat signer shim lands in CP2, not CP3** — new deliverable `packages/operator-wallet/src/adapters/privy/polymarket-signer-shim.ts` exposes `{ address, signTypedData, _signTypedData }` matching the shape `@polymarket/clob-client` calls. CP2 experiment preferably drives `new ClobClient(host, chainId, shim).createOrder({...})` dry-run (createOrder only signs, zero funds move), proving builder + shim + adapter + Privy all talk. Adapter method + shim + unit tests + experiment now one CP2 scope.

3. **Chain allow-set instead of single-value** — `POLYGON_ALLOWED_CHAIN_IDS = new Set([137])` with a doc comment for Amoy (80002) testnet rehearsal headroom. Trivial to add now; annoying to retrofit when CP4 wants dress rehearsal.

4. **SDK fields must be verified before adapter body** — `authorization_context` acceptance on `signTypedData` input and the exact `EthereumSignTypedDataRpcResponse.Data` response field name (draft assumed `.signature`) both explicitly listed as "verify before writing" in the bullet. 5-min SDK read against `node_modules/@privy-io/node/resources/wallets/wallets.d.ts` — avoids a debug cycle.

Net: CP2 ships one adapter method + one shim + three mocked unit tests + one live clob-client-driven experiment. Still scoped small; structurally proves CP3's full seam.

### CP2 SDK verify-first results (2026-04-17)

Pre-implementation SDK reads against `node_modules/.pnpm/@privy-io+node@0.10.1.../node_modules/@privy-io/node` to resolve the two unconfirmed items from the reviewer feedback:

1. **`authorization_context` on `signTypedData` input: CONFIRMED accepted (optional).** `PrivyEthereumService.signTypedData(walletId, input: SignTypedDataInput)` — the `SignTypedDataInput` type unrolls to `PrivyWalletsRpcInput<EthereumSignTypedDataRpcInput>` = `Prettify<WithIdempotency<WithAuthorization<Omit<EthereumSignTypedDataRpcInput, 'chain_type' | 'method'>>>>`. `WithAuthorization` (defined in `public-api/services/types.d.ts`) merges `AuthorizationConfig = { authorization_context?: AuthorizationContext }`. Therefore our adapter can pass `authorization_context: this.authContext` exactly the way it does for `sendTransaction` today. Field name: `authorization_context` (snake_case on the wire; the SDK method's internal destructuring converts to camelCase for the request header).

2. **Response field name: `.signature` (0x-hex string).** `signTypedData` is typed `Promise<EthereumSignTypedDataRpcResponse.Data>` — the service method already unwraps the `{ method, data }` envelope. `Data = { encoding: 'hex'; signature: string }` (`resources/wallets/wallets.d.ts:L~580`). Adapter can return `(result.signature.startsWith("0x") ? result.signature : "0x" + result.signature) as \`0x${string}\``defensively — the`encoding: 'hex'` enum doesn't guarantee 0x-prefix. Unit test should check both prefix shapes.

3. **Incidental find: Polymarket OSS packages are NOT installed.** Neither `@polymarket/clob-client` nor `@polymarket/order-utils` appears in `pnpm-lock.yaml`. Both were planned as CP3 additions, but the reviewer-preferred CP2 experiment path (`new ClobClient(host, 137, shim).createOrder({...})`) requires at least `@polymarket/clob-client` (which brings `order-utils` transitively). **Decision: install `@polymarket/clob-client` in CP2**, NOT CP3. Rationale: (a) the reviewer's point that "CP2 must prove CP3's seam" only works if the OSS is present in CP2; (b) installing once is cheaper than scoping two PRs around the same dep addition; (c) CP3's surface shrinks to adapter wiring only, which is what we want anyway.

   Plan addendum: `pnpm add -F @cogni/operator-wallet @polymarket/clob-client` at the start of CP2 implementation. Pin the version; add the dep to `packages/operator-wallet/AGENTS.md` under External deps. The shim + experiment script import directly from this package.

### CP2 revision 4 (2026-04-17) — use `@privy-io/node/viem`, delete the shim

Second pre-implementation grep (prompted by reviewer feedback "are we using the right amount of OSS") discovered `@privy-io/node` ships a first-party viem adapter at the `/viem` subpath export. `createViemAccount(client, { walletId, address, authorizationContext })` returns a viem `LocalAccount` that **already implements every translation v3 proposed to hand-build**.

**Evidence — `node_modules/@privy-io/node/viem.js:38-58`** (verbatim):

```js
signTypedData: async (typedData) => {
  const { message, domain, types, primaryType } = replaceBigInts(
    typedData,
    toHex
  );
  const { signature } = await client
    .wallets()
    .ethereum()
    .signTypedData(walletId, {
      params: {
        typed_data: { domain, message, primary_type: primaryType, types },
      },
      ...(authorizationContext
        ? { authorization_context: authorizationContext }
        : {}),
    });
  return signature;
};
```

That covers: camelCase→snake_case translation, `authorization_context` passthrough, `.signature` unwrap, `LocalAccount`-shaped output. A viem `LocalAccount` is exactly what `@polymarket/clob-client`'s constructor accepts as a signer — no shim required.

**v3 → v4 delta:**

| v3 artifact                                             | v4 disposition                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PrivyOperatorWalletAdapter.signPolymarketOrder` body   | **Deleted from CP2 scope.** Stub stays (CP1-committed); real signing flows via `createViemAccount` outside the adapter.         |
| `polymarket-signer-shim.ts`                             | **Deleted.** `createViemAccount` IS the shim.                                                                                   |
| camelCase→snake_case translation                        | Delegated to `@privy-io/node/viem`.                                                                                             |
| `POLYGON_ALLOWED_CHAIN_IDS` guard + CHAIN_MISMATCH test | **Deleted.** `new ClobClient(host, 137, account)` owns chain context; Privy signs whatever `domain.chainId` clob-client builds. |
| Three mocked unit tests                                 | Collapses to one: the experiment script itself is the proof (real HSM signature → `viem.verifyTypedData` → address match).      |
| `@polymarket/clob-client` install in CP2                | **Keep** (v3 decision stands).                                                                                                  |
| Live experiment script                                  | **Keep** — shrinks to ~20 lines; no hand-rolled envelope.                                                                       |

**CP1 dead-surface acknowledgement:** `OperatorWalletPort.signPolymarketOrder` and `packages/market-provider/src/port/polymarket-order-signer.port.ts` were added in CP1 under the assumption that signing would flow through our port. With `createViemAccount` doing the work, these two surfaces become unused. **Not removed in CP2** (scope). Tracked for CP3: when the polymarket market-provider adapter is wired, it will take a viem `LocalAccount` in its constructor (not a `PolymarketOrderSigner`). The port file + `signPolymarketOrder` port method are deleted in CP3 as part of that wiring. Noted as a follow-up line in CP3's Todos.

**CP2 deliverables (revision 4):**

1. `pnpm add -F @cogni/operator-wallet @polymarket/clob-client viem` (viem already transitive via `@privy-io/node` peer dep; explicit is cleaner). Update `packages/operator-wallet/AGENTS.md` External deps.
2. `scripts/experiments/sign-polymarket-order.ts` — imports `createViemAccount` from `@privy-io/node/viem`, instantiates `new ClobClient(host, 137, account)`, calls `createOrder(...)` in a dry-run configuration, feeds the resulting typed-data + signature to `viem.verifyTypedData` against `expectedAddress`. Prints PASS + signature hex. Zero funds, zero gas, zero USDC, zero ToS, zero on-chain.
3. Paste experiment output into the PR as CP2 evidence.

**No new adapter code, no new shim, no new unit tests.** CP2 is pure wiring + one experiment script + one doc update. If `createOrder` dry-run rejects (e.g., needs a funded Safe proxy to even build the envelope), fall back to building an order-utils envelope manually and signing via `account.signTypedData(envelope)` — still no shim, still uses `createViemAccount`.

**Risk notes:**

- `ClobClient.createOrder` may refuse without L2 API credentials. If so, the experiment uses `@polymarket/order-utils`'s envelope builder directly + `account.signTypedData(envelope)`. This is the graceful fallback; confirm during implementation.
- Privy's `LocalAccount` is derived from `authorizationContext` passed at account-creation time, not per-call. Confirm this matches our existing `this.authContext` usage pattern. (Expected: yes — authorizationContext is constructed once from operator credentials.)

No blockers. Ready to write CP2 code.

## Review Feedback (revision 4, 2026-04-17 — post-CP3.2 review)

CP3.1.5 (`efbf49901`) approved — clean deletion. CP3.2 (`3b9e1797a`) architecture sound; 5 blocking correctness issues + 5 non-blocking suggestions. Address before CP4 or CP5 live-test.

### Blocking (must fix before CP5 dress rehearsal)

- [ ] **CP3.2-R4-B1 — Tick-size + neg-risk must be per-market.** `PolymarketClobAdapter.placeOrder` (L111) hardcodes `{ tickSize: "0.01", negRisk: false }`. Fetch via `ClobClient.getTickSize(tokenID)` + `ClobClient.getNegRisk(tokenID)` before `createAndPostOrder`. Hardcoded values will silently misroute against most real markets (0.001-tick liquid markets, neg-risk multi-outcome markets).
- [ ] **CP3.2-R4-B2 — Guard must reject `success: false`.** `mapOrderResponseToReceipt` (L172) checks only `!r.orderID`. `ClobClient.OrderResponse` can have `success: false` + `errorMsg` + `orderID` all populated on rejection. Change to `if (r.success === false || !r.orderID) throw ...`. Add a unit test for the rejection-with-orderID case.
- [ ] **CP3.2-R4-B3 — `mapOpenOrderToReceipt` corrupts `client_order_id` semantics.** L222 sets `client_order_id: open.id` (the platform id) to satisfy the Zod `min(1)` constraint. Callers correlating `getOrder` results back to their own bookkeeping via `client_order_id` will break. Options: (a) change `getOrder` signature to `(orderId: string, clientOrderId: string): Promise<OrderReceipt>` and echo the arg; (b) make `OrderReceipt.client_order_id` nullable in the schema; (c) rename the field to `platform_order_id` for the openOrder case. Pick one — CP4 `decide()` will trip over this.
- [ ] **CP3.2-R4-B4 — Missing recorded-fixture contract test.** Task spec AC says "Contract test against a recorded clob-client fixture." Current tests mock `createAndPostOrder` directly (valid pattern, but doesn't catch clob-client response-schema drift). Add `packages/market-provider/tests/fixtures/clob-create-order-success.json` + `clob-create-order-rejected.json` recorded from the CP5 dress run, and a test that feeds each through `mapOrderResponseToReceipt`.
- [ ] **CP3.2-R4-B5 — Dress-rehearsal place-then-cancel race.** `scripts/experiments/place-polymarket-order.ts` L141/L160 relies on "far-below-market; should not fill." If the market has any seller at ≤0.01, the BUY fills in the ~100ms before the cancel fires and the cancel noops silently. Fix: either `OrderType.FOK` (fill-or-kill, atomic) OR check `receipt.status === "filled" || receipt.filled_size_usdc > 0` after placement and log a loud warning with share count. FOK is cleaner.

### Non-blocking suggestions

- [ ] **CP3.2-R4-S1 — Validate `funderAddress` matches signer address** in `PolymarketClobAdapter` constructor. Prevents cryptic "unapproved spender" errors from a caller-side config bug.
- [ ] **CP3.2-R4-S2 — Pre-flight balance/allowance probe** in the dress-rehearsal script. Reuse `probe-polymarket-account.ts` logic; 2s check, bails cleanly if state regressed.
- [ ] **CP3.2-R4-S3 — Tick-step validation** for `POLY_DRESS_REHEARSAL_PRICE`. Fetch tick for the given token; reject if `price % tickSize !== 0`. Same dependency as B1.
- [ ] **CP3.2-R4-S4 — Replace `Object.create(...prototype)` test hack** in `polymarket-clob-adapter.test.ts:126-135`. Either accept a pre-built `ClobClient` as optional constructor arg (clean test seam) or use `vi.spyOn` on the prototype. Current pattern breaks silently if the adapter gains constructor state.
- [ ] **CP3.2-R4-S5 — Document float-precision model** on `PolymarketClobAdapter.placeOrder` size conversion (`size_usdc / limit_price`). For `price=0.33`, 1 USDC → 3.0303… shares; clob-client rounds on send but the round-trip is inexact. Inline comment or docblock note.

### Out of scope for this review

- CP3.3 DB migrations (`poly_copy_trade_{fills,config,decisions}`) — currently in uncommitted WIP in the worktree; review when the commit lands.
- CP4.1 `decide()` + CP4.2 `clob-executor` + CP4.25 agent-tool stack — shipped on main via PR #900 (squash `b0765ef99`). CP4.3 (autonomous mirror poll, three-layer decomposition) + CP4.5 (dashboard card) pending on fresh branch `feat/poly-mirror-v0`; design captured in [docs/spec/poly-copy-trade-phase1.md](../../docs/spec/poly-copy-trade-phase1.md).

## Alignment Decisions (confirmed by operator before `/implement`)

- **Single-operator prototype.** No user-facing mirroring, no retail exposure, no multi-tenant. Scope expansion requires re-scoping in a new task.
- **Legal responsibility is the operator's**, tracked in the PR description's alignment-decisions checklist, not an env-var gate.
- **Key custody is Privy HSM.** No private-key env var. Direct-EOA path against the Polymarket CLOB (no Safe proxy — see "Custody model" in Phase 1). Rotation plan is Privy's standard HSM rotation.

## Notes on "is this worth productizing?"

The Phase 3 paper soak answers this with real numbers, not hypotheticals. Run P3 for 14 days on candidate wallets; if no wallet shows positive slippage-adjusted edge, the feature sunsets at P3 and Phase 4 (streaming) is not built. If it does survive, Phase 4 ships the realtime path.

## PR / Links

- Handoff: [handoff](../handoffs/task.0315.handoff.md)
- PR #890 (Phase 1): https://github.com/Cogni-DAO/node-template/pull/890
- Guide: [polymarket-account-setup](../../docs/guides/polymarket-account-setup.md)
- Archived handoffs: [work/handoffs/archive/task.0315/](../handoffs/archive/task.0315/)
