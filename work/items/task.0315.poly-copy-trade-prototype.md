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
outcome: "A running prototype in the poly node: (v0) ask poly-brain 'top wallets this week' and get a ranked, scored list inline in chat; (v0.1) set ONE tracked wallet via env/config, a 30-second poller detects new fills, a mirror order is placed on Polymarket via @polymarket/clob-client with a small fixed USDC size. All behind a DRY_RUN flag until we trust it."
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
- **v0.1 (PR-B, behind feature flag) — shadow mirror of one wallet:** operator sets one target wallet in config. A 30-second scheduler-core job detects new fills, decides a mirror order, and — **only if every guard passes** — routes placement through the existing `MarketProviderPort`'s **Run-phase surface** (`placeOrder` / `cancelOrder` / `getOrder` — methods the port was designed to grow into, see port comment "Run: placeOrder(), getPositions() added when trading starts"). Two adapters implement the Run surface behind the same port: the **polymarket-clob** adapter (signs real orders via `@polymarket/clob-client` + a wallet key resolved from `MarketCredentials`) and a **paper** adapter (interface-defined here, body deferred — writes intents to a `paper_orders` table with a synthetic book-snapshot fill price). Default adapter for PR-B is polymarket-clob with `DRY_RUN=true` short-circuiting to a noop receipt; once the paper adapter ships, `DRY_RUN` becomes adapter selection, not an `if` inside the live adapter. Live mode requires `DRY_RUN=false` AND a DB kill-switch row flipped to `true`.

### Approach

**Solution:** port patterns from `Polymarket/agents` + `GiordanoSouza/polymarket-copy-trading-bot` (see research doc). TS-only, no Python. Three pieces:

1. **Polymarket Data-API calls** — three thin methods on the existing `PolymarketAdapter`: `listTopTraders`, `listUserActivity`, `listUserPositions`. No new port, no new package (v0 / PR-A, already shipped).
2. **v0 scoreboard tool** — one new LangGraph tool `core__wallet_top_traders` cloned from the `core__market_list` shape. (v0 / PR-A, already shipped.)
3. **v0.1 mirror loop** — a `@cogni/scheduler-core` job registered under `nodes/poly/app/src/bootstrap/jobs/copyTradeMirror.job.ts`, mirroring the shipped `syncGovernanceSchedules.job.ts` pattern. Every 30 s it polls `listUserActivity(TARGET_WALLET)`, dedupes against `poly_copy_trade_fills (PK wallet, fill_id)`, decides a mirror order with **fixed-USDC sizing** (`MIRROR_USDC` per fill), and for each new fill calls `container.marketExecutor.placeOrder(intent)` if and only if every guard passes. Guards: `DRY_RUN=true` default (swaps the adapter, not a conditional inside the adapter), DB-row kill switch `poly_copy_trade_config.live_enabled`, `pg_advisory_lock` for single-writer safety, hard daily USDC + fills-per-hour caps, legal-gate env assertion. Feature flag: job inert unless `COPY_TRADE_TARGET_WALLET` is set.

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
- **`DRY_RUN` as a conditional inside the live adapter** — the prior design had the executor no-op under `DRY_RUN=true`. Mixes two adapter identities in one module, leaves dead paths in the trader process, and prevents paper-tracking analysis. Replaced by a future paper-adapter swap at container wiring; for PR-B alone, `DRY_RUN=true` short-circuits inside the job (acceptable interim until the paper adapter ships).
- Awareness-plane `ObservationEvent(kind=polymarket_wallet_trade)` — defer until N wallets + `poly-synth` analysis.
- `poly_tracked_wallets` table / weekly ranking batch — unnecessary; Data-API leaderboard is live.
- Importing any Python OSS — different runtime, viral licenses where applicable.
- Goldsky subgraph / CLOB WebSocket / Polygon block-listener — 30 s HTTP poll is sufficient for prototype. **Documented tradeoff:** 30 s latency eats some slippage edge; if the shadow soak shows slippage is the killer, the fix is to swap the job for a WebSocket subscription behind the same port — mirror-service logic untouched.
- Multi-wallet, category scoping, ranking sophistication — defer.
- Real money by default — adapter selection defaults to paper.

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

**v0.1 mirror (new, small — follows existing `bootstrap/jobs/*.job.ts` + `@cogni/scheduler-core` pattern):**

- `packages/market-provider/src/port/market-provider.port.ts` — extend `MarketProviderPort` with `placeOrder` / `cancelOrder` / `getOrder`; add `OrderIntent` / `OrderReceipt` / `OrderStatus` Zod schemas under `src/domain/`.
- `packages/market-provider/src/adapters/polymarket/` — extend the existing adapter with the three Run methods. Lazy-loads `@polymarket/clob-client` only when a wallet-key credential is present. Adapter is the sole importer of the clob client and the only module that ever sees the wallet key in memory.
- `packages/market-provider/src/adapters/paper/` — **stub only in this PR** (interface wired, body throws `NotImplemented`). Reserved for the paper-trading follow-up.
- `nodes/poly/app/src/features/copy-trade/mirror-service.ts` — pure domain logic: persisted-dedupe query, sizing (fixed USDC), daily-cap check, fills-per-hour check, legal-gate check, kill-switch check → emits a `MirrorDecision` (`place` / `skip-reason`). Calls `container.marketProvider.placeOrder(intent)` when placing. No direct SDK imports.
- `nodes/poly/app/src/bootstrap/jobs/copyTradeMirror.job.ts` — `scheduler-core` job, polls `listUserActivity(TARGET_WALLET)` every 30 s, persists every decision (placed or skipped) with reason to Pino + a `poly_copy_trade_decisions` log table, acquires `pg_advisory_lock` to ensure single-writer.
- `nodes/poly/app/src/shared/db/schema.ts` — add two tables:
  - `poly_copy_trade_fills (wallet text, fill_id text, decided_at timestamptz, order_id text null, PRIMARY KEY (wallet, fill_id))` — the dedupe source of truth.
  - `poly_copy_trade_config (singleton_id int PK = 1, live_enabled boolean not null default false, updated_at timestamptz, updated_by text)` — the runtime kill switch, must be `true` AND `DRY_RUN=false` for a real order to place.
- `nodes/poly/app/src/shared/env/server-env.ts` — add `COPY_TRADE_TARGET_WALLET`, `COPY_TRADE_MIRROR_USDC`, `COPY_TRADE_DRY_RUN` (default `true`), `COPY_TRADE_MAX_DAILY_USDC`, `COPY_TRADE_MAX_FILLS_PER_HOUR`, `COPY_TRADE_OPERATOR_JURISDICTION` (must be set; checked against a block-list), `POLY_ROLE`.
- `.env.example` — document the new env vars.

**Observability (in scope, not deferred):**

- One Pino log per job tick with (new_fills, skipped_reason_counts, placed_count, cap_remaining).
- Prometheus counters: `poly_copy_trade_fills_seen_total`, `poly_copy_trade_decisions_total{outcome=placed|skipped|error, reason=...}`, `poly_copy_trade_live_orders_total`, `poly_copy_trade_cap_hit_total{dimension=daily|hourly}`.
- One new Grafana dashboard JSON checked in alongside the code (single panel group: tick rate, decisions by outcome, cap-hit rate, last-fill-age). Without this the 2-week shadow soak has nothing to watch. ~20 min of work.
- `poly_copy_trade_decisions` log table includes a **shadow `proportional_size_usdc` column** that records what proportional sizing would have decided, even though we act on fixed USDC. Preserves the option to re-analyze the soak data without a second run.

**Secret boundary (proxy-wallet keys):**

- `POLY_PROXY_WALLET_ADDRESS` — on-chain proxy wallet holding USDC.e on Polygon (public).
- Signer: resolved via `MarketCredentials.walletKey`. **Preferred path (subject to spike):** Privy operator wallet signs Polygon EIP-712 CLOB orders — zero new key surface. **Fallback path:** `POLY_PROXY_SIGNER_PRIVATE_KEY` env var, loaded only inside the Polymarket adapter when constructed with a wallet-key credential. Never crosses into tool code, graph code, or the mirror job.
- `POLY_CLOB_API_KEY` / `POLY_CLOB_API_SECRET` / `POLY_CLOB_PASSPHRASE` — CLOB API credentials if Polymarket requires the L2 auth flow.
- Manual one-time setup (documented in the PR, not automated): create the proxy wallet, sign Polymarket ToS, fund with USDC.e. Not in scope to automate for a prototype.

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
- [ ] DRY_RUN_DEFAULT: `COPY_TRADE_DRY_RUN` defaults to `true`; real trades require an explicit flip
- [ ] DEDUPE_PERSISTED: dedupe via `poly_copy_trade_fills` Postgres table keyed `(wallet, fill_id)`, NOT in-memory — restart crash does not double-fire
- [ ] KILL_SWITCH_DB_ROW: a real order requires `poly_copy_trade_config.live_enabled = true` AND `DRY_RUN=false` — an operator flips the DB row to halt instantly without redeploy
- [ ] HARD_CAP_DAILY: job enforces `COPY_TRADE_MAX_DAILY_USDC`
- [ ] HARD_CAP_HOURLY: job enforces `COPY_TRADE_MAX_FILLS_PER_HOUR`
- [ ] LEGAL_GATE: `COPY_TRADE_OPERATOR_JURISDICTION` must be set and not in the block-list (`US` included) for any live order; shadow mode runs regardless
- [ ] KEY_IN_ADAPTER_ONLY: the Polymarket adapter is the only module that imports `@polymarket/clob-client` or materializes a wallet-key credential; web / scheduler-sync replicas constructed without `walletKey` never load the clob SDK (lazy-import boundary)
- [ ] PORT_IS_EXISTING: Run-phase methods extend the existing `MarketProviderPort`; no new port package is introduced
- [ ] CREDENTIALS_VIA_PORT: signer material flows through `MarketCredentials.walletKey`; app/job code never touches raw keys
- [ ] IDEMPOTENT_BY_CLIENT_ID: `OrderIntent.client_order_id` is derived deterministically from `(tracked_wallet, tracked_fill_id)`; duplicate placement is a no-op at the adapter
- [ ] SIMPLE_SOLUTION: port patterns from OSS references; no ranking pipeline, no awareness-plane tables (spec: architecture)
- [ ] SIMPLE_OVER_GENERIC: one target wallet, one sizing rule (fixed USDC per fill), one proxy wallet — no multi-tenancy
- [ ] SCHEDULER_CORE_FOR_BACKGROUND: v0.1 loop runs as a `bootstrap/jobs/*.job.ts` via `@cogni/scheduler-core`, not a bespoke `setInterval` (spec: architecture)
- [ ] SINGLE_WRITER: job acquires `pg_advisory_lock` so multi-replica deployments don't double-fire (mirrors `syncGovernanceSchedules.job.ts`)
- [ ] SECRETS_STAY_IN_EXECUTOR: the proxy-wallet private key is imported only by `clob-executor.ts`; tool code, capability code, and the graph never touch it (spec: architecture)
- [ ] LLM_STAYS_IN_GRAPH: the mirror loop contains no LLM calls; v0 scoreboard reasoning happens in `poly-brain` via the tool (spec: langgraph-patterns)
- [ ] OBSERVABILITY_COMMITMENT: every decision (placed / skipped-reason / error) emits a Pino log and increments a Prometheus counter (spec: architecture)

## Validation

**v0:**

- [ ] `poly-brain` chat: "show me the top 10 Polymarket wallets this week" returns a ranked list with PnL + win-rate + volume + activity score
- [ ] Stack test exercises the tool end-to-end against a recorded fixture
- [ ] Contract test covers malformed Data-API response (fails closed)

**v0.1 (merge gates — all must pass before PR-B merges):**

- [ ] With `DRY_RUN=true` and a live target wallet, the job persists a `MirrorDecision(outcome=shadow)` row within ≤60 s of a real fill on that wallet
- [ ] With `DRY_RUN=false` + `live_enabled=true` in a controlled run, a real mirror order is placed on Polymarket for `MIRROR_USDC` and the `order_id` is persisted in `poly_copy_trade_fills`
- [ ] Flipping `poly_copy_trade_config.live_enabled = false` stops further live orders within one poll cycle, no redeploy required
- [ ] Unit test: restarting mid-burst does not double-fire — dedupe-table insert is the commit point
- [ ] Unit test: daily USDC cap blocks further orders once hit
- [ ] Unit test: hourly fills cap blocks further orders once hit
- [ ] Unit test: legal-gate rejects when `COPY_TRADE_OPERATOR_JURISDICTION` is in the block-list
- [ ] Replica without `POLY_ROLE=trader` starts cleanly and does NOT materialize the signer key in memory (tested by an absence-of-module-load assertion)

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
