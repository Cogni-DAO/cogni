---
id: task.0315
type: task
title: "Poly copy-trade prototype — v0 top-wallet scoreboard, v0.1 live 1-wallet mirror"
status: needs_implement
priority: 2
estimate: 3
rank: 5
summary: "One-shot prototype task. v0: poly-brain answers 'who are the top Polymarket wallets and what are their activity scores?' via a new core__wallet_top_traders tool backed by the Polymarket Data API. v0.1: pick one wallet, mirror its new fills from a Cogni-owned proxy wallet using @polymarket/clob-client. No new packages, no ports, no ranking pipeline, no awareness-plane tables. If it works, we scale it; if it doesn't, we learned cheaply."
outcome: "A running prototype in the poly node: (v0) ask poly-brain 'top wallets this week' and get a ranked, scored list inline in chat; (v0.1) set ONE tracked wallet via env/config, a 30-second poller detects new fills, a mirror order is placed on Polymarket via @polymarket/clob-client with a small fixed USDC size. All behind a DRY_RUN flag until we trust it."
spec_refs:
  - architecture
  - langgraph-patterns
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-17
updated: 2026-04-17
labels: [poly, polymarket, follow-wallet, copy-trading, prototype]
external_refs:
  - docs/research/poly-copy-trading-wallets.md
---

# Poly Copy-Trade Prototype

> Research: [poly-copy-trading-wallets](../../docs/research/poly-copy-trading-wallets.md)
> Spike: [spike.0314](./spike.0314.poly-copy-trading-wallets.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)

## Context

Research (spike.0314) mapped the OSS and data landscape. Rather than decompose into five follow-ups, this single task ships a working prototype in two increments and stops. If the prototype proves the idea, we write real tasks with real specs. If it doesn't, we kill the feature with minimum sunk cost.

## Design

### Outcome

Two working increments behind feature flags, both driven from `poly-brain`:

- **v0 — scoreboard:** user asks `poly-brain` "who are the top Polymarket wallets right now?" → agent calls a new `core__wallet_top_traders` tool → response is a scored list with wallet, PnL, win-rate, volume, activity score.
- **v0.1 — one-wallet mirror:** operator sets one target wallet in config. A 30-second poller detects new fills on that wallet. Each fill triggers a proportional mirror order via `@polymarket/clob-client` from a Cogni-owned proxy wallet. Runs `DRY_RUN=true` by default — logs the order it _would_ place without hitting the CLOB.

### Approach

**Solution:** port patterns from `Polymarket/agents` + `GiordanoSouza/polymarket-copy-trading-bot` (see research doc). TS-only, no Python. Three pieces:

1. **Polymarket Data-API calls** — three thin methods on the existing `PolymarketAdapter`: `listTopTraders`, `listUserActivity`, `listUserPositions`. No new port, no new package.
2. **v0 scoreboard tool** — one new LangGraph tool `core__wallet_top_traders` cloned from the `core__market_list` shape (`packages/ai-tools/src/tools/market-list.ts`). Activity score = simple blend of PnL × win-rate × log(volume); premature to over-engineer.
3. **v0.1 mirror loop** — a `@cogni/scheduler-core` job registered under `nodes/poly/app/src/bootstrap/jobs/copyTradeMirror.job.ts`, mirroring the shipped `syncGovernanceSchedules.job.ts` pattern. Every 30 s it polls `listUserActivity(TARGET_WALLET)`, dedupes on `(wallet, fill_id)`, and for each new fill calls `@polymarket/clob-client` to place a matching GTC limit order sized at `MIRROR_USDC`. Guarded by `DRY_RUN` (default `true`), hard daily cap, and `pg_advisory_lock` for single-writer safety across replicas.

**Reuses:**

- Existing `PolymarketAdapter` HTTP + retry.
- Existing `MarketCapability` / `core__market_list` pattern — clone it.
- `@polymarket/clob-client` (TS, MIT, first-party) for order placement.
- Patterns (not code) from `Polymarket/agents` (module split) and `GiordanoSouza/polymarket-copy-trading-bot` (poll → dedupe → sizing → place).

**Rejected:**

- New `WalletProviderPort` / new package / new spec — premature; one provider, one prototype.
- Awareness-plane `ObservationEvent(kind=polymarket_wallet_trade)` — unnecessary for a one-wallet prototype. Add it when we need N wallets + `poly-synth` analysis.
- `poly_tracked_wallets` table / weekly ranking batch — unnecessary; v0 returns the Data-API leaderboard live.
- Importing any Python OSS — different runtime, viral licenses where applicable.
- Goldsky subgraph / block-listener — Data API is sufficient at prototype scale.
- Multi-wallet, category scoping, ranking sophistication — defer until v0.1 proves edge exists.
- Real money by default — `DRY_RUN=true` until explicitly flipped.

### Files

**v0 scoreboard (new, small):**

- `packages/market-provider/src/adapters/polymarket/data-api.ts` — three Data-API methods + Zod schemas.
- `packages/ai-tools/src/tools/wallet-top-traders.ts` — `core__wallet_top_traders` tool.
- `packages/ai-tools/src/index.ts` — export the tool id.
- `nodes/poly/app/src/bootstrap/capabilities/wallet.ts` — capability resolver delegating to the adapter.
- `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts` — bind the new tool.
- `nodes/poly/graphs/src/graphs/poly-brain/tools.ts` — add to `POLY_BRAIN_TOOL_IDS`.

**v0.1 mirror (new, small — follows existing `bootstrap/jobs/*.job.ts` + `@cogni/scheduler-core` pattern):**

- `nodes/poly/app/src/features/copy-trade/mirror-service.ts` — pure domain logic: dedupe `(wallet, fill_id)`, sizing, hard-cap check, decide-to-place. No I/O.
- `nodes/poly/app/src/features/copy-trade/clob-executor.ts` — thin wrapper around `@polymarket/clob-client`. Takes a decided order, signs + places it (or no-ops under `DRY_RUN=true`). Owns the only import of the clob client and the proxy-wallet private key.
- `nodes/poly/app/src/bootstrap/jobs/copyTradeMirror.job.ts` — `scheduler-core` job that polls `listUserActivity(TARGET_WALLET)` every 30 s, calls the mirror-service, calls the clob-executor. Mirrors the shape of `syncGovernanceSchedules.job.ts`. Uses `pg_advisory_lock` so only one replica runs the loop.
- `nodes/poly/app/src/shared/env/server-env.ts` — add `COPY_TRADE_*` env vars (all optional; feature inert when `COPY_TRADE_TARGET_WALLET` unset).
- `.env.example` — document the new env vars.

**Secret boundary (proxy-wallet keys):**

- `POLY_PROXY_WALLET_ADDRESS` — on-chain proxy wallet holding USDC.e on Polygon (public).
- `POLY_PROXY_SIGNER_PRIVATE_KEY` — the EOA private key that signs CLOB orders. **Loaded only inside `clob-executor.ts` via `serverEnv`. Never crosses into tool code, graph code, or any capability.**
- `POLY_CLOB_API_KEY` / `POLY_CLOB_API_SECRET` / `POLY_CLOB_PASSPHRASE` — CLOB API credentials if Polymarket requires the L2 auth flow.
- Manual one-time setup (documented in the PR, not automated): create the proxy wallet, sign Polymarket ToS, fund with USDC.e. Not in scope to automate for a prototype.

**Tests:**

- Contract tests for the three adapter methods (fixture-based).
- One stack test asserting `poly-brain` can invoke `core__wallet_top_traders` end-to-end.
- One unit test for the mirror worker's dedupe + sizing logic (no live CLOB call in CI).

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] TS_ONLY_RUNTIME: no Python, no IPC, no new runtime
- [ ] NO_NEW_PACKAGE: all new code lives in existing `packages/market-provider`, `packages/ai-tools`, or `nodes/poly/app`
- [ ] NO_NEW_PORT: no new port interfaces — adapter-local methods + app-local capability
- [ ] CONTRACT_IS_SOT: Zod schemas for Data-API + tool input/output (spec: architecture)
- [ ] CAPABILITY_NOT_ADAPTER: the tool imports the capability interface, not the adapter
- [ ] TOOL_ID_NAMESPACED: `core__wallet_top_traders`, `effect: read_only` (spec: architecture)
- [ ] DRY_RUN_DEFAULT: `COPY_TRADE_DRY_RUN` defaults to `true`; real trades require an explicit flip
- [ ] HARD_CAP: mirror-worker enforces `COPY_TRADE_MAX_DAILY_USDC` and refuses further orders past the cap
- [ ] IDEMPOTENT_FILLS: in-memory `(wallet, fill_id)` dedupe; restart replays are logged, not re-executed
- [ ] SIMPLE_SOLUTION: port patterns from OSS references; no ranking pipeline, no awareness-plane tables (spec: architecture)
- [ ] SIMPLE_OVER_GENERIC: one target wallet, one sizing rule, one proxy wallet — no multi-tenancy
- [ ] SCHEDULER_CORE_FOR_BACKGROUND: v0.1 loop runs as a `bootstrap/jobs/*.job.ts` via `@cogni/scheduler-core`, not a bespoke `setInterval` (spec: architecture)
- [ ] SINGLE_WRITER: job acquires `pg_advisory_lock` so multi-replica deployments don't double-fire (mirrors `syncGovernanceSchedules.job.ts`)
- [ ] SECRETS_STAY_IN_EXECUTOR: the proxy-wallet private key is imported only by `clob-executor.ts`; tool code, capability code, and the graph never touch it (spec: architecture)
- [ ] LLM_STAYS_IN_GRAPH: the mirror loop contains no LLM calls; v0 scoreboard reasoning happens in `poly-brain` via the tool (spec: langgraph-patterns)

## Validation

**v0:**

- [ ] `poly-brain` chat: "show me the top 10 Polymarket wallets this week" returns a ranked list with PnL + win-rate + volume + activity score
- [ ] Stack test exercises the tool end-to-end against a recorded fixture
- [ ] Contract test covers malformed Data-API response (fails closed)

**v0.1:**

- [ ] With `DRY_RUN=true` and a live target wallet, the mirror worker logs a would-be order within ≤60 s of a real fill on that wallet
- [ ] With `DRY_RUN=false`, a real mirror order is placed on Polymarket for the configured `MIRROR_USDC` amount (manually verified once, in a controlled run)
- [ ] Hard cap refuses further orders after hitting `COPY_TRADE_MAX_DAILY_USDC`
- [ ] Restarting the worker does not re-execute already-processed fills (in-memory dedupe survives the poll window; cross-restart re-runs are acceptable for a prototype and logged loudly)

**Overall:**

- [ ] `pnpm check` passes
- [ ] A 2-week shadow run (`DRY_RUN=true`) produces enough data to decide whether to invest in a real copy-trade feature — this is the exit criterion for writing follow-up tasks

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

## Notes on v0.1 → "is this worth productizing?"

Run v0.1 in `DRY_RUN=true` for 2 weeks against one well-chosen wallet (e.g. a top-30d trader in a single category). Compare hypothetical mirror PnL (fills would have happened at the live book at `observed_at + 5 s`) against the target wallet's realized PnL. If the ratio is poor, slippage kills the feature — stop. If it's decent, write the real follow-up tasks with evidence in hand.
