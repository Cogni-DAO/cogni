---
id: task.0315
type: task
title: "Poly copy-trade prototype — v0 top-wallet scoreboard, v0.1 shadow 1-wallet mirror"
status: needs_closeout
priority: 2
estimate: 5
rank: 5
branch: research/poly-copy-trading-wallets
summary: "One-shot prototype task. v0 (PR-A, this PR): poly-brain + dashboard answer 'who are the top Polymarket wallets?' via a new core__wallet_top_traders tool + /dashboard Top Wallets card backed by the Polymarket Data API. v0.1 (PR-B, not in this PR): single-wallet shadow mirror via @polymarket/clob-client. No new packages, no ports, no ranking pipeline, no awareness-plane tables. If it works, we scale it; if it doesn't, we learned cheaply."
outcome: "A running prototype in the poly node: (v0) ask poly-brain 'top wallets this week' and get a ranked, scored list inline in chat; (v0.1) operator clicks a wallet on the dashboard Top Wallets card → a Polymarket user WebSocket streams that wallet's fills through Redis → a Temporal workflow mirrors each fill via the MarketProviderPort Run methods (Privy-signed on Polygon) at `mirror_usdc` size. Default per-target mode is paper; flipping to live + global kill-switch enabled triggers real orders. End-to-end latency from target's fill to our order placed: sub-2s on the hot path."
spec_refs:
  - architecture
  - langgraph-patterns
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-17
updated: 2026-04-18
labels: [poly, polymarket, follow-wallet, copy-trading, prototype]
external_refs:
  - docs/research/poly-copy-trading-wallets.md
---

# Poly Copy-Trade Prototype

> Research: [poly-copy-trading-wallets](../../docs/research/poly-copy-trading-wallets.md)
> Spike: [spike.0314](./spike.0314.poly-copy-trading-wallets.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)

## Plan (PR-A checkpoints)

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

## Context

Research (spike.0314) mapped the OSS and data landscape. Rather than decompose into five follow-ups, this single task ships a working prototype in two increments and stops. If the prototype proves the idea, we write real tasks with real specs. If it doesn't, we kill the feature with minimum sunk cost.

## Design

### Outcome

Two working increments, shipped as **two PRs under this one task**:

- **v0 (PR-A, read-only, merges independently) — scoreboard, chat + dashboard:**
  - user asks `poly-brain` "who are the top Polymarket wallets right now?" → agent calls a new `core__wallet_top_traders` tool → scored list with wallet / PnL / win-rate / volume / activity score rendered as a markdown table in chat.
  - `/(app)/dashboard` gets a new "Top Wallets" card — server-component table of the top ~10 wallets with the same columns, backed by the same `WalletCapability`.
- **v0.1 (PR-B, click-to-copy + realtime mirror) — shadow mirror of one wallet:** operator clicks a wallet on the Top Wallets dashboard card → row inserted into `poly_copy_trade_targets (wallet, mode='paper'|'live', mirror_usdc, max_daily_usdc, max_fills_per_hour, enabled, ...)`. A long-lived **Polymarket user WebSocket subscription** for each enabled target publishes `PolymarketFillObserved` events to the existing `@cogni/node-streams` bus. A subscriber consumes the stream, runs mirror-service decision logic, and — only if every guard passes — routes placement through the existing `MarketProviderPort`'s **Run-phase surface** (`placeOrder` / `cancelOrder` / `getOrder`). Adapter selection per-target: `mode='live'` → polymarket-clob adapter (Privy-signed on Polygon); `mode='paper'` → paper adapter (stub in PR-B, body in follow-up). A 5-min reconciliation job runs as a safety net for any WebSocket gaps. Live mode requires the target's `mode='live'` AND global kill-switch row `enabled=true`.

### Approach

**Solution:** port patterns from `Polymarket/agents` + `GiordanoSouza/polymarket-copy-trading-bot` (see research doc). TS-only, no Python.

v0.1 composes four existing primitives — `@cogni/node-streams` (Redis live plane), Temporal (I/O + workflows), the existing `MarketProviderPort` (reads + Run-phase writes), and the existing `PrivyOperatorWalletAdapter` (extended for Polygon EIP-712 typed-data signing). The only new code is wiring + a per-target config table + a UI button.

#### 1. Data flow — 3-tier, realtime, spec-aligned

Follows the `STREAM_THEN_EVALUATE` + `TEMPORAL_OWNS_IO` invariants from [data-streams-spec](../../docs/spec/data-streams.md).

```
Tier 1 — External source (Polymarket CLOB user-channel WebSocket, per enabled target wallet)
   │
   │  Temporal activity `subscribePolymarketUserFills` (long-lived, one per enabled target)
   │  — normalizes each frame to `PolymarketFillObserved`, XADDs with source_ref
   ▼
Tier 2 — `streams:copy-trade:polymarket-fills` (Redis stream, MAXLEN 2000, ~16h @ typical rate)
   │     └── SSE tails this via `/api/v1/node/stream` → dashboard "Copy Trade Live" card
   │
   │  Temporal workflow `CopyTradeTriggerWorkflow` — pure, replay-safe
   │  — reads `poly_copy_trade_targets` + last-N fills dedupe table
   │  — applies: target-wallet match → already-placed dedupe → per-target caps → global kill switch
   │  — on match: XADDs `triggers:copy-trade` + signals child workflow
   ▼
Tier 2 — `triggers:copy-trade` (Redis stream, MAXLEN 500) + `poly_copy_trade_fills` INSERT (commit point)
   │
   │  Child workflow `MirrorOrderWorkflow` — one activity call per decision
   │  — activity: `container.marketProvider.placeOrder(intent)` via port
   │  — idempotent by `client_order_id = hash(target_wallet || fill_id)`
   ▼
Tier 3 — Postgres: order_id + status written back to `poly_copy_trade_fills`; decision audit row in `poly_copy_trade_decisions`
```

Reconciliation safety net: a Temporal scheduled workflow every 5 min calls `listUserActivity(target)` on the Data API and XADDs any fills that don't appear in the last 16 h of the Redis stream. Missed WS frames flow through the normal pipeline from there. No bespoke reconciliation logic.

#### 2. Config — DB-backed, not env vars (except CLOB secrets)

Per-target config lives in a new table `poly_copy_trade_targets` so the operator can click-to-copy from the Top Wallets dashboard card (shipped in PR-A) and tune sizing without redeploy:

```sql
poly_copy_trade_targets (
  id            uuid PRIMARY KEY,
  wallet        text UNIQUE NOT NULL,         -- the tracked Polymarket proxy wallet
  mode          text NOT NULL CHECK (mode IN ('paper','live')) DEFAULT 'paper',
  mirror_usdc            numeric(10,2) NOT NULL DEFAULT 1.00,
  max_daily_usdc         numeric(10,2) NOT NULL DEFAULT 10.00,
  max_fills_per_hour     integer       NOT NULL DEFAULT 5,
  enabled       boolean NOT NULL DEFAULT true,    -- per-target kill
  added_by      text NOT NULL,                     -- user_id who clicked
  added_at      timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
)
```

Global kill switch: single-row table `poly_copy_trade_config.enabled` (boolean) — flipping to `false` halts ALL live placements within one workflow tick. Per-target `mode='paper'` or `enabled=false` halts just that target.

Env vars shrink to the minimum: CLOB L2 secrets (appropriate for env/vault per user directive) + deployment role flag. The prior design's `COPY_TRADE_TARGET_WALLET`, `COPY_TRADE_MIRROR_USDC`, `COPY_TRADE_DRY_RUN`, `COPY_TRADE_MAX_DAILY_USDC`, `COPY_TRADE_MAX_FILLS_PER_HOUR`, `COPY_TRADE_OPERATOR_JURISDICTION`, `POLY_PROXY_SIGNER_PRIVATE_KEY` are all removed.

#### 3. Click-to-copy UI

Dashboard Top Wallets card (PR-A) gets a "Copy" action per row → POST `/api/v1/poly/copy-targets` with `{wallet}` + sensible defaults. A new sibling card "Copy Targets" lists active targets with live status (mode toggle, enable/disable, remove). The card subscribes to the existing `/api/v1/node/stream` SSE for live fill/decision events so the operator sees mirror activity in real time.

#### 4. Port + signer — reuse what exists

- **`MarketProviderPort` grows three Run-phase methods** (`placeOrder` / `cancelOrder` / `getOrder`) — exactly the extension anticipated by the port's own header comment ("Run: placeOrder(), getPositions() added when trading starts"). No new port, no new package.
- **Signer = Privy, Polygon EIP-712 typed-data** — extend `PrivyOperatorWalletAdapter` with a `signPolymarketOrder(typedData)` method (Privy supports Polygon directly per user confirmation). The Polymarket market-provider adapter calls this via a narrow injected signer interface (`PolymarketOrderSigner`), so the market adapter never touches Privy config or key material. Zero new custody surface, zero new env vars for signing.
- **Safe-proxy model explicit**: the Privy EOA signs orders; the **Polymarket Safe proxy** (deployed on first ToS acceptance) holds USDC.e and receives fills. Funding goes to the proxy, not the EOA. Both addresses surface in the adapter config so the dashboard can display the funded balance.

#### 5. Paper-trading seam (stub only in this PR)

`packages/market-provider/src/adapters/paper/` — interface wired, body throws `NotImplemented`. Reserved for the follow-up that adds a `paper_orders` table with synthetic book-snapshot fill prices. Container wiring already selects the adapter by `target.mode`, so the follow-up is a zero-touch swap for the pipeline code.

#### 6. Scope note — PR split

This is larger than a typical 5-point task. If it grows past ~10 days of work, split along the seam:

- **PR-B1**: MarketProviderPort Run-phase extension + polymarket adapter Run methods + Privy `signPolymarketOrder` + Temporal workflows (ingester, trigger, mirror) + dedupe/decision tables + global kill switch. Target: single hardcoded wallet for first live order evidence.
- **PR-B2**: `poly_copy_trade_targets` table + click-to-copy UI + Copy Targets card + per-target caps replacing hardcode. Unblocks multi-target + operator self-service.

Ship as one PR if scope stays tight; split if B1 alone takes >1 week.

**Strategic seam — grow `MarketProviderPort`, do NOT add a new package:**

`packages/market-provider/src/port/market-provider.port.ts` already documents:
> Crawl: listMarkets() only. Walk: getPrices(), getOrderbook() added when pipeline needs them. Run: placeOrder(), getPositions() added when trading starts.

PR-B is the Run-phase expansion that was anticipated when the port was built. Add three methods to the existing interface:

```ts
export interface MarketProviderPort {
  readonly provider: MarketProvider;
  listMarkets(params?: ListMarketsParams): Promise<NormalizedMarket[]>;
  // Run-phase (new in PR-B):
  placeOrder(intent: OrderIntent): Promise<OrderReceipt>; // idempotent via client_order_id
  cancelOrder(orderId: string): Promise<void>;
  getOrder(orderId: string): Promise<OrderStatus>;
}
```

Invariants on the Run surface:
- `NO_GENERIC_SIGNING` — `OrderIntent` is a typed domain object; adapter encodes + signs internally. No `signBytes()` surface.
- `IDEMPOTENT_BY_CLIENT_ID` — caller supplies `client_order_id` (derived deterministically from `(tracked_wallet, tracked_fill_id)`); duplicate placement is a no-op at the adapter. Crash-loops can't double-fill.
- `EFFECT_TYPED` — `OrderReceipt` carries `{orderId, status, filledAt, adapter: 'polymarket-clob' | 'paper'}` so audit rows distinguish live vs. simulated.
- `CREDENTIALS_VIA_PORT` — signing material comes from the existing `MarketCredentials.walletKey` on `MarketProviderConfig`, resolved at adapter construction from a connection or env shim. The port doesn't care whether the credential originated from a Cogni-owned wallet or a user-linked Polymarket/Kalshi account — that resolution happens upstream in the connections layer.

**Adapters (both live under `packages/market-provider/src/adapters/`):**

- **`polymarket/` adapter** — today it implements `listMarkets` via the Gamma/Data API. PR-B extends the same adapter class with the Run methods via `@polymarket/clob-client`. The clob-client import is lazily loaded and gated on the presence of `MarketCredentials.walletKey` at call time, so read-only adapter instances (no wallet key configured) never pull the SDK or materialize signer material.
- **`paper/` adapter** (stub-only in this PR — interface defined, body deferred) — same port, provider-agnostic. On `placeOrder` it reads a book snapshot from whichever live adapter was configured as its "price oracle", writes the intent + synthetic fill price to a `paper_orders` table, returns a synthetic `orderId`. This is the strategic place for simulation + tracking — dropping it in later doesn't touch the mirror job or the port.

**Wallet-key resolution (v0.1, deliberately un-opinionated):**

User guidance: don't overengineer wallet custody for v0. Long-term we want users to connect their own Polymarket/Kalshi accounts to their Cogni node; v0 can use a Cogni-owned signer. The port doesn't change shape across those cases — `MarketCredentials.walletKey` resolution moves from env to the connections table later. For PR-B, `walletKey` is resolved from one of (in order of preference):

1. **Existing Privy operator wallet** if Privy supports Polygon EIP-712 order signing for the CLOB message type. (Open question — needs the same 30-min SDK check as clob-client. If yes: zero new custody surface, reuse `PrivyOperatorWalletAdapter` infra.)
2. **Env-var EOA** (`POLY_PROXY_SIGNER_PRIVATE_KEY`) as a fallback, loaded only when the adapter is constructed with a wallet-key credential — never at module import time.

Either path, the key lives inside the polymarket adapter; app/job code only sees the port.

**Pre-PR-B spike (~30 min):** confirm Privy supports Polymarket's EIP-712 typed-data order message on Polygon. If yes → route `.1` via Privy. If no → env-var EOA for prototype, migrate to Privy (or user-connected wallets) in a follow-up. Record in `docs/research/` and link from the PR description.

**Reuses:**

- Existing `PolymarketAdapter` HTTP + retry.
- Existing `MarketCapability` / `core__market_list` pattern (v0).
- **The existing `MarketProviderPort`** — Run-phase methods were explicitly anticipated (see port file's own header comment). We grow the port; we do not fork a new one.
- **The existing `MarketCredentials.walletKey` field** on `MarketProviderConfig` — already scoped for "Polymarket trading — Run phase". Credential resolution stays in the connections layer (Cogni-owned today, user-linked tomorrow); the port is unchanged across that shift.
- **The existing Privy operator wallet**, potentially, as the v0.1 signer — subject to a 30-min spike on Polygon EIP-712 support. Avoids introducing a second key-custody surface.
- `@polymarket/clob-client` (TS, MIT, first-party) — encapsulated behind the existing Polymarket adapter; no other module imports it.
- `@cogni/scheduler-core` for the polling loop.
- Patterns (not code) from `Polymarket/agents` and `GiordanoSouza/polymarket-copy-trading-bot`.

**Rejected:**

- **A new `MarketExecutorPort` / `@cogni/market-executor` package** — considered, rejected. The existing `MarketProviderPort` was explicitly designed to grow into the Run phase, and splitting reads from writes would fragment the provider abstraction and duplicate `MarketCredentials`. Extend the existing port.
- **Extending `OperatorWalletPort` with `placePolymarketOrder`** — rejected. Different effect (off-chain match vs. on-chain transfer), different chain, different idempotency. CLOB order placement belongs on the market port, not the wallet port. Wallet port remains for transfers; market port gains signing via its credential slot.
- **`clob-executor.ts` inside `nodes/poly/app/`** (the prior design) — private-key loading inside app code violates `KEY_NEVER_IN_APP`. Moved into the polymarket market-provider adapter where key custody is the adapter's explicit responsibility.
- **`DRY_RUN` as a conditional inside the live adapter** — mixes adapter identities, prevents paper-tracking analysis. Replaced by per-target `mode` column → adapter selection at the port boundary.
- **30 s scheduler-core poll as the primary trigger** — prior design. Violated `STREAM_THEN_EVALUATE`, lost ~15 s of fill-to-order latency on average (killing any realistic slippage edge), and ignored the existing Redis live plane + Temporal infra. Replaced by WebSocket → `streams:copy-trade:polymarket-fills` → Temporal trigger workflow.
- **Bootstrap `setInterval` or long-lived Next.js process owning the WebSocket** — violates `TEMPORAL_OWNS_IO` and the `data-streams-spec` constraint that bootstrap publishers must NOT poll external sources. The WS subscriber is a Temporal activity with heartbeats.
- **Awareness-plane `ObservationEvent` insert** — considered. Skipped for PR-B: `observation_events` is the AI-awareness durability table, not the right home for copy-trade fills. We use `triggers:copy-trade` (Redis) + `poly_copy_trade_fills` (Postgres, our own commit point) + `poly_copy_trade_decisions` (Postgres, our own audit) instead. If `poly-synth` later wants to analyze mirror activity, it reads these tables directly.
- **Env-var per-target config** — considered. Rejected: operator must click-to-copy from the dashboard; env-var + redeploy per wallet change is the wrong UX. DB-backed `poly_copy_trade_targets` is the proper shape. Only CLOB L2 secrets and the `POLY_ROLE` deployment flag stay in env.
- **Self-attested legal-gate env var (`COPY_TRADE_OPERATOR_JURISDICTION`)** — removed. Trivially bypassable, gave false assurance. Single-operator prototype; legal responsibility lives in the PR description's alignment-decisions checklist.
- **Separate private-key env var (`POLY_PROXY_SIGNER_PRIVATE_KEY`)** — removed. Privy already holds the operator wallet key via HSM; the new Privy `signPolymarketOrder` method handles Polygon EIP-712. Zero new key-custody surface.
- **A new `MarketExecutorPort` / `@cogni/market-executor` package** — rejected earlier; still the right call.
- **Extending `OperatorWalletPort` with `placePolymarketOrder`** — rejected. Wallet port stays for transfers. But it *does* gain `signPolymarketOrder` (typed-data signing is a natural wallet capability, not a market one).
- `poly_tracked_wallets` table / weekly ranking batch — unnecessary; Data-API leaderboard is live.
- Importing any Python OSS — different runtime, viral licenses where applicable.
- Multi-wallet category scoping, ranking sophistication — defer.
- Real money by default — per-target default is `mode='paper'`.

### Files

**v0 scoreboard (new, small):**

- `packages/market-provider/src/adapters/polymarket/data-api.ts` — three Data-API methods + Zod schemas.
- `packages/ai-tools/src/tools/wallet-top-traders.ts` — `core__wallet_top_traders` tool; return shape is a markdown table string so chat renders cleanly without bespoke formatting.
- `packages/ai-tools/src/index.ts` — export the tool id + `WalletCapability` interface.
- `nodes/poly/app/src/bootstrap/capabilities/wallet.ts` — capability resolver delegating to the adapter.
- `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts` — bind the new tool.
- `nodes/poly/graphs/src/graphs/poly-brain/tools.ts` — add to `POLY_BRAIN_TOOL_IDS`.
- `nodes/poly/app/src/app/(app)/dashboard/_components/top-wallets-card.tsx` — server component, renders the top ~10 wallets in a table (existing dashboard-card pattern).
- `nodes/poly/app/src/app/(app)/dashboard/_api/top-wallets.ts` — reads `WalletCapability` from the container, returns a typed DTO to the card. Keeps dashboard layer out of adapter imports.
- `nodes/poly/app/src/app/(app)/dashboard/page.tsx` — slot the new card into the existing grid.

**v0.1 mirror (realtime, Temporal + node-streams):**

*Port + adapters (`packages/market-provider`):*

- `packages/market-provider/src/port/market-provider.port.ts` — extend `MarketProviderPort` with `placeOrder` / `cancelOrder` / `getOrder`.
- `packages/market-provider/src/domain/order.ts` (new) — `OrderIntent` / `OrderReceipt` / `OrderStatus` Zod schemas + `PolymarketFillObserved` event schema.
- `packages/market-provider/src/port/polymarket-order-signer.port.ts` (new) — narrow interface `{ signPolymarketOrder(typedData): Promise<Hex> }` that the polymarket adapter depends on. Decouples the market adapter from Privy.
- `packages/market-provider/src/adapters/polymarket/` — extend existing adapter with Run methods; injects a `PolymarketOrderSigner` and the Safe-proxy address at construction. Sole importer of `@polymarket/clob-client`.
- `packages/market-provider/src/adapters/paper/` — **stub only** (interface wired, body throws `NotImplemented`). Reserved for follow-up.

*Signer (`packages/operator-wallet`):*

- `packages/operator-wallet/src/port/operator-wallet.port.ts` — add `signPolymarketOrder(typedData: Eip712TypedData): Promise<Hex>`.
- `packages/operator-wallet/src/adapters/privy/privy-operator-wallet.adapter.ts` — implement the new method via Privy's Polygon typed-data signing. Parameterize chain scoping so the existing Base-specific methods continue to use `BASE_CAIP2` and the new method uses `POLYGON_CAIP2` (`eip155:137`). Expose `PolymarketOrderSigner` in the container by narrowing the full `OperatorWalletPort`.

*Temporal workflows + activities (`nodes/poly/app/src/features/copy-trade/`):*

- `activities/subscribePolymarketUserFills.activity.ts` — long-lived activity, one instance per enabled target. Opens the Polymarket user WebSocket, normalizes frames, XADDs to `streams:copy-trade:polymarket-fills` with `source_ref={wallet, fill_id}`. Heartbeats so Temporal can restart on drop.
- `activities/placeMirrorOrder.activity.ts` — calls `container.marketProvider.placeOrder(intent)`. Idempotent via `client_order_id`. Writes `order_id` + status back to `poly_copy_trade_fills`.
- `workflows/CopyTradeIngesterWorkflow.ts` — parent workflow: on each enable/disable event from `poly_copy_trade_targets`, starts or cancels a child activity per wallet.
- `workflows/CopyTradeTriggerWorkflow.ts` — tails the fills stream (via activity that XREAD-BLOCKs), evaluates pure triggers against target-match + dedupe + caps + global kill, on match signals `MirrorOrderWorkflow` and XADDs `triggers:copy-trade`.
- `workflows/MirrorOrderWorkflow.ts` — single activity `placeMirrorOrder`, retry-safe, writes `poly_copy_trade_decisions` audit row on completion.
- `workflows/ReconcileFillsWorkflow.ts` — scheduled every 5 min; Data-API `listUserActivity(target)` diff against Redis stream's last 16 h; missing fills XADDed into the normal pipeline.

*DB schema (poly-local; if reusable cross-node, promote to `@cogni/db-schema/copy-trade`):*

- `nodes/poly/app/src/shared/db/schema.ts` — add:
  - `poly_copy_trade_targets` (per-wallet config, schema above)
  - `poly_copy_trade_config` (singleton_id=1, `enabled boolean`) — global kill switch
  - `poly_copy_trade_fills (target_id uuid, fill_id text, observed_at timestamptz, client_order_id text, order_id text null, status text, PRIMARY KEY (target_id, fill_id))` — dedupe + commit point
  - `poly_copy_trade_decisions (id uuid, target_id uuid, fill_id text, outcome text, reason text null, intent jsonb, receipt jsonb null, decided_at timestamptz)` — audit log

*UI (`nodes/poly/app/src/app/(app)/dashboard/`):*

- `_components/top-wallets-card.tsx` — add "Copy" button per row (wired to server action).
- `_components/copy-targets-card.tsx` (new) — lists `poly_copy_trade_targets`, mode toggle, enable/disable/remove, live decision feed via existing `useNodeStream()`.
- `_api/copy-targets.ts` (new) — server action CRUD on targets table. RBAC: operator role only.
- `_components/copy-trade-live-feed.tsx` (new) — subscribes to `/api/v1/node/stream`, filters on `copy_trade_fill` / `copy_trade_decision` event types.

*Node-streams event types (`packages/market-provider/src/domain/` + poly node union):*

- Extend the poly node's `NodeEvent` union with `PolymarketFillObserved` + `CopyTradeDecisionMade` (for the curated `node:{nodeId}:events` stream the dashboard already consumes).

*Container wiring (`nodes/poly/app/src/bootstrap/`):*

- `container.ts` — construct `PolymarketMarketProviderAdapter` with the Privy-backed `PolymarketOrderSigner` when `POLY_ROLE === 'trader'`. In any other role, the adapter is constructed read-only (no signer) and `placeOrder` throws if called — web replicas never load `@polymarket/clob-client` or Privy Polygon signing.
- `capabilities/market.ts` (existing) — unchanged signature, now returns a port with Run methods available when the trader role is wired.

*Env vars — shrunk:*

- `nodes/poly/app/src/shared/env/server-env.ts` — add only:
  - `POLY_ROLE` (deployment-role flag: `'trader' | 'web' | 'scheduler'`)
  - `POLY_CLOB_API_KEY`, `POLY_CLOB_API_SECRET`, `POLY_CLOB_PASSPHRASE` (CLOB L2 auth — correct place for these per secrets-in-vault directive)
- `.env.example` — document the four above. Remove all prior `COPY_TRADE_*` proposals.

**Observability (in scope, not deferred):**

- One Pino log per job tick with (new_fills, skipped_reason_counts, placed_count, cap_remaining).
- Prometheus counters: `poly_copy_trade_fills_seen_total`, `poly_copy_trade_decisions_total{outcome=placed|skipped|error, reason=...}`, `poly_copy_trade_live_orders_total`, `poly_copy_trade_cap_hit_total{dimension=daily|hourly}`.
- One new Grafana dashboard JSON checked in alongside the code (single panel group: tick rate, decisions by outcome, cap-hit rate, last-fill-age). Without this the 2-week shadow soak has nothing to watch. ~20 min of work.
- `poly_copy_trade_decisions` log table includes a **shadow `proportional_size_usdc` column** that records what proportional sizing would have decided, even though we act on fixed USDC. Preserves the option to re-analyze the soak data without a second run.

**Secret boundary:**

- **Signing key**: held by Privy (existing operator wallet HSM). Neither the market adapter nor app code ever sees raw key material. Polygon EIP-712 typed-data signing is a new named method on `OperatorWalletPort` / `PrivyOperatorWalletAdapter`.
- **Addresses (public, stored with the Privy wallet config or in a small new adapter-config area):**
  - `signer_address` — the Privy-managed EOA that signs CLOB orders. Holds no funds.
  - `safe_proxy_address` — the Polymarket Safe proxy deployed on ToS acceptance. **Holds USDC.e and receives fills.** Resolved once via `@polymarket/clob-client.getSafeAddress()` or derived at adapter construction.
- **CLOB L2 credentials** (env/vault, per directive to keep CLOB secrets in env): `POLY_CLOB_API_KEY`, `POLY_CLOB_API_SECRET`, `POLY_CLOB_PASSPHRASE`. Only loaded when `POLY_ROLE === 'trader'`.
- **Manual one-time setup** (documented in the PR, not automated): accept Polymarket ToS with the Privy EOA, record the Safe proxy address, fund the proxy (not the EOA) with USDC.e on Polygon, fund the EOA with a few POL for occasional gas (cancels/withdrawals).

**Tests:**

- Contract tests for the three adapter methods (fixture-based).
- One stack test asserting `poly-brain` can invoke `core__wallet_top_traders` end-to-end.
- Unit tests for mirror-service: persisted dedupe, daily cap, hourly cap, legal gate, kill-switch — one test per skip-reason branch.
- Integration test: a full tick in shadow mode inserts a `poly_copy_trade_fills` row and does NOT import `@polymarket/clob-client`.
- No live CLOB call in CI. The `DRY_RUN=false` path is exercised manually once, in a controlled run, and the `order_id` pasted into the PR description as evidence.

**Pre-PR-A prep (~1 hour, zero code — do this first):**

- **Leaderboard curl — DONE 2026-04-17:** `GET https://data-api.polymarket.com/v1/leaderboard` → 200, array of `{rank, proxyWallet, userName, xUsername, verifiedBadge, vol, pnl, profileImage}`. No window param honored (tested `window=`, `period=`, `timeRange=`, `interval=` — all return identical bytes). No win-rate field. **Implication for v0:** drop `activityScore = PnL × winRate × log(vol)` from the design; use `ROI = pnl/vol × 100` as the primary rank metric, with `vol` + `pnl` displayed alongside. Fixture saved at `docs/research/fixtures/polymarket-leaderboard.json` — use it as the stack-test fixture directly.
- **Clob-client TS SDK verification (30 min, no code):** **moved here from PR-B prep.** Read `@polymarket/clob-client` source + README and confirm: (a) proxy-wallet signing end-to-end in TS, (b) L2 API-key auth path exists, (c) `NegRiskAdapter` / multi-outcome markets are addressable. If any gap, either scope v0.1 to single-outcome markets or fall back to `viem` + `@polymarket/order-utils` for raw EIP-712. Record the outcome in a short note under `docs/research/` and reference it from the PR-B description. Doing this before PR-A because a SDK gap changes the shape of `clob-executor.ts` enough to re-inform PR-A's capability boundaries.
- **Tool-output rendering check (5 min):** send a sample markdown table through the existing poly-brain tool-output path to confirm chat renders it cleanly. If it doesn't, the tool returns structured JSON and the app does the rendering on the dashboard side — adjust before writing the tool schema.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] TS_ONLY_RUNTIME: no Python, no IPC, no new runtime
- [ ] NO_NEW_PACKAGE: all new code lives in existing `packages/market-provider`, `packages/ai-tools`, or `nodes/poly/app`
- [ ] NO_NEW_PORT_PACKAGE: no new `packages/*-port` — a `WalletCapability` interface exported from `packages/ai-tools` alongside `MarketCapability` is OK; a full port package is not
- [ ] CONTRACT_IS_SOT: Zod schemas for Data-API + tool input/output (spec: architecture)
- [ ] CAPABILITY_NOT_ADAPTER: the tool imports the capability interface, not the adapter
- [ ] TOOL_ID_NAMESPACED: `core__wallet_top_traders`, `effect: read_only` (spec: architecture)
- [ ] DEFAULT_MODE_PAPER: new targets default to `mode='paper'`; flipping to `'live'` is explicit per-target
- [ ] DEDUPE_PERSISTED: dedupe via `poly_copy_trade_fills` Postgres table keyed `(target_id, fill_id)`, NOT in-memory — restart does not double-fire
- [ ] GLOBAL_KILL_DB_ROW: `poly_copy_trade_config.enabled=false` halts ALL live placements within one workflow tick, no redeploy
- [ ] PER_TARGET_KILL: `poly_copy_trade_targets.enabled=false` halts that target; `mode='paper'` routes through the paper adapter
- [ ] HARD_CAP_DAILY: trigger workflow enforces `target.max_daily_usdc`
- [ ] HARD_CAP_HOURLY: trigger workflow enforces `target.max_fills_per_hour`
- [ ] KEY_IN_ADAPTER_ONLY: `@polymarket/clob-client` is imported only by the Polymarket market-provider adapter; Polygon EIP-712 signing lives only inside `PrivyOperatorWalletAdapter`; web / non-trader replicas load neither
- [ ] PORT_IS_EXISTING: Run-phase methods extend the existing `MarketProviderPort`; no new port package
- [ ] SIGNER_VIA_PORT: polymarket adapter receives a narrow `PolymarketOrderSigner` by constructor injection; never imports Privy or env directly
- [ ] IDEMPOTENT_BY_CLIENT_ID: `client_order_id = hash(target_id || fill_id)`; duplicate placements are a no-op at the CLOB
- [ ] STREAM_THEN_EVALUATE: every Polymarket fill is XADDed to `streams:copy-trade:polymarket-fills` before trigger evaluation (spec: data-streams)
- [ ] TEMPORAL_OWNS_IO: WebSocket subscription, stream reads/writes, and DB writes all happen in Temporal activities; workflow code is pure (spec: data-streams)
- [ ] TRIGGERS_ARE_PURE: `CopyTradeTriggerWorkflow` is a pure, replay-safe function of stream entries + DB snapshot (spec: data-streams)
- [ ] REDIS_MAXLEN_ENFORCED: `streams:copy-trade:polymarket-fills` MAXLEN 2000; `triggers:copy-trade` MAXLEN 500 (spec: data-streams)
- [ ] SOURCE_REF_ALWAYS: every Redis entry carries `{target_wallet, fill_id}` for drill-back (spec: data-streams)
- [ ] CONFIG_IN_DB: per-target sizing + mode + caps live in `poly_copy_trade_targets`, not env vars
- [ ] SECRETS_MINIMAL_ENV: only CLOB L2 secrets + `POLY_ROLE` are env/vault; no private key in env (Privy holds it)
- [ ] LLM_STAYS_IN_GRAPH: the mirror loop contains no LLM calls; v0 scoreboard reasoning happens in `poly-brain` via the tool (spec: langgraph-patterns)
- [ ] OBSERVABILITY_COMMITMENT: every decision (placed / skipped-reason / error) emits a Pino log and increments a Prometheus counter (spec: architecture)

## Validation

**v0:**

- [ ] `poly-brain` chat: "show me the top 10 Polymarket wallets this week" returns a ranked list with PnL + win-rate + volume + activity score
- [ ] Stack test exercises the tool end-to-end against a recorded fixture
- [ ] Contract test covers malformed Data-API response (fails closed)

**v0.1 (merge gates — all must pass before PR-B merges):**

- [ ] Click "Copy" on the dashboard Top Wallets card → row appears in `poly_copy_trade_targets` with `mode='paper'` default
- [ ] With `mode='paper'` on a live target, a real fill XADDs to `streams:copy-trade:polymarket-fills` within ≤2 s; the trigger workflow writes a `poly_copy_trade_decisions` row with `outcome='paper'`; dashboard's "Copy Trade Live" feed renders the event
- [ ] With `mode='live'` + `poly_copy_trade_config.enabled=true` in a controlled run, a real mirror order is placed on Polymarket for `mirror_usdc` and the `order_id` is persisted in `poly_copy_trade_fills`
- [ ] Flipping `poly_copy_trade_config.enabled=false` halts further live orders within one workflow tick, no redeploy
- [ ] Replay test: Temporal workflow rerun with the same stream state produces identical decisions (TRIGGERS_ARE_PURE)
- [ ] Unit test: `client_order_id` collision → adapter returns existing `OrderReceipt` without placing (IDEMPOTENT_BY_CLIENT_ID)
- [ ] Unit test: per-target daily + hourly caps block further placements once hit
- [ ] Unit test: `mode='paper'` routes through paper adapter stub (throws `NotImplemented` in PR-B; follow-up fills in the body)
- [ ] Reconciliation test: kill the WS activity mid-burst → reconcile-workflow XADDs missed fills within 5 min; no dedupe violation
- [ ] Replica without `POLY_ROLE=trader` starts cleanly and does NOT load `@polymarket/clob-client` or Privy Polygon signing (absence-of-module-load assertion)

**Overall merge gate:**

- [ ] `pnpm check` passes

**Post-merge sign-off (NOT a merge gate — tracked separately):**

- After PR-B merges, run a 2-week `DRY_RUN=true` shadow soak against one well-chosen wallet. Compare shadow-decision PnL against the target wallet's realized PnL at `observed_at + 5 s` book prices. If slippage-adjusted edge survives, create real follow-up tasks with evidence. If not, revert the `live_enabled` path and leave v0 in place.

## Out of Scope (explicitly — push back if scope creeps)

- Multi-wallet tracking
- `poly_tracked_wallets` table, weekly ranking batch
- `ObservationEvent(kind=polymarket_wallet_trade)` / poly-synth analysis
- Category scoping, survivorship-bias guards beyond the Data-API defaults
- `poly-brain` cite-wallet tool (citation DAG into knowledge plane)
- Goldsky subgraph, CLOB WebSocket, Polygon block-listener
- Real-money default; multi-user / retail-facing mirroring
- Per-strategy attribution across proxies; operator-wallet integration
- Slippage modeling beyond a live-book sanity check in the mirror log

If any of these get requested mid-flight, create a follow-up task instead of expanding this one.

## Alignment Decisions (confirmed by operator before `/implement`)

- **Operator jurisdiction:** this prototype operates **single-operator only** — no user-facing mirroring, no retail exposure, no multi-tenant. The `LEGAL_GATE` invariant guards the operator's jurisdiction, not end-users'. Scope expansion requires explicit re-scoping in a new task.
- **Proxy-wallet key custody:** before PR-B merges, the PR description must name (a) the human who holds the proxy-wallet private key, (b) where it lives (password manager / secrets vault / env file on one machine), (c) the rotation plan. "We'll figure it out later" is not acceptable for a key that signs on-chain transactions from a Cogni-controlled wallet.

## Notes on v0.1 → "is this worth productizing?"

Run v0.1 in `DRY_RUN=true` for 2 weeks against one well-chosen wallet (e.g. a top-30d trader in a single category). Compare hypothetical mirror PnL (fills would have happened at the live book at `observed_at + 5 s`) against the target wallet's realized PnL. If the ratio is poor, slippage kills the feature — stop. If it's decent, write the real follow-up tasks with evidence in hand.
