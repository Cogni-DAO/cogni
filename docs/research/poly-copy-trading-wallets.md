---
id: research-poly-copy-trading-wallets
type: research
title: "Knowledge Chunk: Copy-Trading Polymarket Wallets — Discovery, Tracking, Mirroring"
status: active
trust: draft
summary: "Survey of approaches to identify, rank, track, and eventually mirror successful Polymarket wallets from the poly node. Recommends a three-tier pipeline (Data-API discovery → activity poller → ObservationEvent → poly-synth → paper-trading mirror), reusing the existing market-provider + awareness plane. Rejects third-party analytics scraping and rejects running a bespoke chain indexer until Data-API latency is proven insufficient."
read_when: Designing a follow-a-wallet feature for the poly node; deciding between the Polymarket Data API, Goldsky subgraph, and direct chain indexing; scoping the jump from signals to paper trading to real execution.
owner: derekg1729
created: 2026-04-16
verified: 2026-04-17
tags:
  [
    knowledge-chunk,
    polymarket,
    poly-node,
    copy-trading,
    follow-wallet,
    clob,
    goldsky,
    awareness-plane,
  ]
---

# Copy-Trading Polymarket Wallets — Research

> source: agent research session 2026-04-16 | confidence: medium | freshness: re-check when Polymarket changes Data-API surface or when proxy-wallet model changes

## Question

How should the poly node **identify, rank, track, and (eventually) mirror** successful Polymarket wallets so they become a first-class signal source for `poly-brain` / `poly-synth`, and later a paper-trading and eventually real-money strategy — without running our own chain indexer, violating third-party ToS, or cross-wiring the knowledge and awareness planes?

## Context

The `proj.poly-prediction-bot` roadmap already names **Follow-a-wallet — track and mirror top Polymarket wallets** as a Run-phase deliverable. Today nothing wallet-specific is shipped: the Polymarket adapter (`@cogni/market-provider/adapters/polymarket`) only exposes market listings. The awareness plane (`ObservationEvent`, `poly-synth` analysis graph) is shipped and is the obvious landing place for per-wallet trade observations.

Two constraints bound this work:

- **No real money in Crawl or Walk** — paper trading only until edge is proven. The project's Run-phase constraint still holds.
- **US regulatory posture** — US users are blocked from Polymarket; proxying their trades is off-limits until legal review. Paper trading and DAO-treasury-scale execution are separate questions from retail mirroring.

So the practical goal of this research is not "build the copy-trade engine", it is "pick the data and signal architecture that makes the Run-phase 'follow-a-wallet' feature low-risk to add later."

## Findings

### Data sources — who holds wallet activity?

| Source                              | What it gives you                                                               | Latency           | Cost          | Fit                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------- | ----------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Polymarket Data API**             | Leaderboards, per-user activity, positions, PnL; same host as public Gamma/CLOB | Seconds           | Free, no auth | **Best first hop.** Same rate-budget we already track; no new infra. **Verified 2026-04-17:** `GET https://data-api.polymarket.com/v1/leaderboard` returns 200 with `[{rank, proxyWallet, userName, xUsername, verifiedBadge, vol, pnl, profileImage}, …]`. No window query param honored — single static snapshot. No win-rate field; derive `ROI = pnl/vol × 100` instead. Fixture saved at `docs/research/fixtures/polymarket-leaderboard.json`. |
| **Goldsky Polymarket subgraph**     | Historical orders/fills/positions via GraphQL on the on-chain CLOB              | ~1 min            | Free tier     | **Best for backfill + wallet discovery.** Already referenced by prior research.                                                                                                                                                                                                                                                                                                                                                                     |
| **Polygon RPC + CTFExchange logs**  | Raw `OrderFilled` / `OrderMatched` events; canonical source                     | Block time (~2 s) | Free RPC      | Lowest latency, highest glue. **Not worth it** until Data-API latency is proven bad.                                                                                                                                                                                                                                                                                                                                                                |
| **Third-party analytics (scraped)** | PolymarketAnalytics, PolyTracker, Alpha Analytics leaderboards                  | Minutes           | Free/paid     | **Reject.** ToS risk, fragility, no SLA, duplicates the Data API.                                                                                                                                                                                                                                                                                                                                                                                   |
| **Hugging Face datasets**           | `SII-WANGZJ/Polymarket_data` (1.1 B records) + others from prior research doc   | Historical        | Free          | Useful for one-shot wallet discovery / backtests; not a live source.                                                                                                                                                                                                                                                                                                                                                                                |
| **Dune Analytics**                  | Curated dashboards + SQL over Polygon                                           | Minutes           | Free tier     | Good for exploration, not a production feed.                                                                                                                                                                                                                                                                                                                                                                                                        |

Empirical reality check:

- Polymarket leaderboards are dominated by a **short list** of known pros (e.g. `Fredi9999`, `Theo4`) plus whales whose "edge" is capital rather than skill. The ranking model has to reward _repeated_ calibrated edge over _single_ large wins.
- Public order-book resting orders **by user** are not exposed via the Data API as of this writing — activity/positions/fills are, placements are not. Without CLOB WebSocket subscriptions filtered by maker address, we are **fill-only** (post-trade signal).
- Per-wallet market specialization matters: a sports-book whale is not a useful signal for a CPI market. Ranking must be category-scoped.

### OSS / SDK landscape

**Correction to earlier drafts:** there _is_ a small ecosystem of OSS copy-trading bots for Polymarket — an earlier version of this doc said there wasn't and that was wrong. The landscape is small and quality-heterogeneous, but real. A large fraction of GitHub search results are SEO-spam / affiliate-link traps with keyword-stuffed descriptions (`amadeusprotocol/*`, `samanalalokaya/*`, `vhrlyz/*`, `gamma-trade-lab/*`, `unitmargaretaustin/*`, `dev-protocol/polymarket-copytrading-bot-sport`) — **ignore those**. The list below is after filtering.

#### Primitives (libraries we'd actually import)

| Library                    | Purpose                                              | License | Fit                                                                         |
| -------------------------- | ---------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `@polymarket/clob-client`  | Official TS client for CLOB: orders, trades, markets | MIT     | **Execution adapter**. Extend `MarketProviderPort` only when Phase 3 opens. |
| `@polymarket/order-utils`  | EIP-712 order signing helpers                        | MIT     | Required if we ever place an order.                                         |
| `py-clob-client`           | Python reference SDK                                 | MIT     | Reference only — we are TS-first.                                           |
| `python-order-utils`       | Python order helpers                                 | MIT     | Reference only.                                                             |
| `viem` / `ethers`          | Polygon RPC + event listening                        | MIT     | Already available. Use if Phase 2 needs block-level events.                 |
| `graphql-request` / `urql` | Goldsky subgraph queries                             | MIT     | Trivial glue for backfill jobs.                                             |

#### Frameworks / reference bots (to learn from, not blindly adopt)

| Repo                                                                                                                                                                                                    | What                                                                                                                                                                              | Lang / License       | Useful for us?                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Polymarket/agents](https://github.com/Polymarket/agents)                                                                                                                                               | **Official Polymarket AI-agent framework.** Gamma client, order building/signing, Pydantic models, LangChain + Chroma RAG hooks.                                                  | Python 3.9 / MIT     | **Highest-value reference.** Canonical first-party primitives. No copy-trading built in; we'd re-implement the patterns in TS. Not a dependency (wrong runtime) but our **TS code should mirror its module shapes.** |
| [Drakkar-Software/OctoBot-Prediction-Market](https://github.com/Drakkar-Software/OctoBot-Prediction-Market)                                                                                             | Extension of OctoBot (established OSS trading-bot framework) for Polymarket — copy trading + arbitrage, UI.                                                                       | Python / **GPL-3.0** | **Reject as dependency** — GPL is viral, UI-heavy, and the copy-trading path is marked 🚧 in the README. Worth watching for patterns once shipped.                                                                   |
| [GiordanoSouza/polymarket-copy-trading-bot](https://github.com/GiordanoSouza/polymarket-copy-trading-bot)                                                                                               | **Working Python copy-bot.** Flow: Polymarket API → Supabase → main loop → sizing constraints → `py-clob-client` → CLOB. Table schema: `historic_trades`, `polymarket_positions`. | Python / MIT         | **Best architecture reference.** Concrete, readable, matches our own design almost 1:1 (awareness-plane table → constraint filter → mirror execution). Port the _shape_, not the code.                               |
| [warproxxx/poly-maker](https://github.com/warproxxx/poly-maker)                                                                                                                                         | Market-making bot (different use case but battle-tested adapter code).                                                                                                            | Python / MIT         | Reference for Polymarket-specific adapter quirks + rate-limit behavior.                                                                                                                                              |
| [leolopez007/polymarket-trade-tracker](https://github.com/leolopez007/polymarket-trade-tracker)                                                                                                         | PnL + maker/taker role analysis, split/merge tracking, chart export.                                                                                                              | — / OSS              | **Reference for Tier 1 ranking logic.**                                                                                                                                                                              |
| [harish-garg/Awesome-Polymarket-Tools](https://github.com/harish-garg/Awesome-Polymarket-Tools) · [aarora4/Awesome-Prediction-Market-Tools](https://github.com/aarora4/Awesome-Prediction-Market-Tools) | Curated indexes.                                                                                                                                                                  | List                 | **Start here** when surveying new tools.                                                                                                                                                                             |

**Key takeaway:** we're TS-first and LangGraph-native; the strongest OSS (`Polymarket/agents`, `GiordanoSouza/polymarket-copy-trading-bot`) is Python. Right move is **port patterns, not code** — adopt `@polymarket/clob-client` (TS, first-party) as the only real dependency and mirror the architecture of the Python bots behind our existing `MarketProviderPort` / awareness-plane pipeline.

**Market-structure update (Feb 2026):** Polymarket removed the ~500 ms artificial taker-order delay for crypto markets. This materially improves the slippage math for mirror execution vs what this doc originally assumed — the edge-validation spike (`spike.0318`) should re-baseline against post-delay-removal book dynamics, not the old 500 ms penalty.

### Signal pipeline — where this plugs in

The awareness plane already has the seams for this:

```
poll Data API /activity/{wallet}   ──► ObservationEvent (kind=polymarket_wallet_trade)
                                              │
                                              ▼
                               poly-synth analysis graph
                                              │
                                              ▼
                                   MarketSignal / analysis_signal
                                              │
                                              ▼
                    paper-trading engine (Run phase) ─┐
                                              │       │
                                              ▼       ▼
                    knowledge_poly (status=candidate; entry_type=rule/finding;
                                    citation: supports → analysis_signal id)
```

The `ObservationEvent.kind=polymarket_wallet_trade` shape is the only new primitive. Everything downstream — `poly-synth`, the knowledge promotion bridge documented in `task.0311`, the future paper-trading engine — is either shipped or already scoped.

### Mirror execution — forward-looking

Whenever the project moves past paper trading, mirroring costs these moving parts:

- **Polymarket proxy-wallet model** — each user has a Gnosis-Safe-like proxy on Polygon. EOA signs orders (EIP-712); matching is on-chain. Gas is negligible (~$0.01 / match). We need **our own** proxy wallet with USDC.e on Polygon and a signed ToS agreement.
- **Sizing policy** — fractional relative to tracked position (cap at X USDC or Y% of node treasury). Ties into `@cogni/financial-ledger`.
- **Slippage model** — we fill after the tracked wallet. By the time our order lands, the best liquidity is gone. The expected-value model must discount tracked-wallet PnL by our realistic slippage curve. This is a **fatal issue** if ignored; many naive copy-bots lose to slippage in isolation.
- **Per-strategy attribution** — do we use one proxy wallet with N sub-accounts (cheap, harder to audit) or N proxy wallets (clean audit, more ToS overhead)? Deferred.
- **Legal gate** — US restrictions unresolved. Paper trading has no such gate.

### Architecture fit — three tiers

| Tier | What                                                                                      | Cadence      | Data source                                        | Persistence                                            |
| ---- | ----------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------- | ------------------------------------------------------ |
| 1    | **Discovery + ranking.** Rank candidate wallets by risk-adjusted PnL, win-rate, category. | Weekly batch | Data API leaderboards + Goldsky historical + HF    | `poly_tracked_wallets` table (awareness plane)         |
| 2    | **Live position tracking.** Watch N wallets from the Tier-1 roster. Emit on new fills.    | 30 s poll    | Data API `/activity/{wallet}` (fallback: CTF logs) | `ObservationEvent(kind=polymarket_wallet_trade)`       |
| 3    | **Mirror execution.** Paper first, real later.                                            | Event-driven | `@polymarket/clob-client`                          | `financial-ledger` paper account → real after legal OK |

Each tier is independently useful. Tier 1 alone already gives `poly-brain` the question-answer "who should I be watching this week?". Tiers 2+3 compound it.

## Recommendation

**Minimum-viable slice (MVP, 2–3 PR-sized tasks):**

- **Tier 1 (discovery)** — extend the existing `PolymarketAdapter` with read-only leaderboard + user-activity + user-positions methods. Weekly job scores wallets; writes ranked roster into a new small Postgres table.
- **Tier 2 (live tracking)** — a Temporal-scheduled 30-second poller per tracked wallet, fan-in to `ObservationEvent(kind=polymarket_wallet_trade)`. Use the existing `poly-synth` graph downstream — no new analysis code needed for v0.
- **Knowledge write-back** — once the signal quality is measurable, promote validated rules into `knowledge_poly` via the task.0311 bridge. This is the compounding loop.

**Explicitly deferred:**

- No block-level chain indexer until Data-API latency is proven inadequate under load.
- No third-party analytics scraping (ToS + reliability).
- No mirror execution until a dedicated edge-validation spike shows real edge net of slippage.
- No Goldsky subgraph in the MVP — keep it for one-shot discovery queries, not a live feed.

**Top 0.1 % (when cost/effort are no object):**

- CLOB WebSocket subscription filtered by maker addresses in the Tier-1 roster — placement-level signal beats fill-only signal for leading markets.
- Our own Polygon block-listener mirroring every `OrderFilled` on the CTFExchange, parsed down to our roster addresses — removes Data-API dependency.
- Per-wallet strategy clustering via embedding-over-trade-history, so the rank isn't just "high PnL" but "high PnL at a strategy class we want more of".
- Category-aware calibration models (Brier score per market class) before a wallet's signal counts.

**Hype to discount:**

- "Just mirror the leaderboard" — leaderboard-chasing is exactly what markets price in, and survivorship bias makes it worse than random.
- Third-party copy-trading UIs as inspiration — they are paid products; their edge is capital and UX, not information we lack.

## Open questions

- Does the Data API expose per-wallet **order placements** (not just fills) reliably? If not, Tier 2 is fill-only and requires CLOB WebSocket or chain listener for leading signal.
- What is the empirical latency gap between a tracked wallet's fill and a 30-second poller's observation? Needs a 2-week instrumentation spike before any mirror logic.
- How do we handle wallets that hit Polymarket anti-wash-trading / self-match rules when we mirror them? We are not them — our mirror may fail where theirs succeeded.
- Proxy-wallet attribution: one node-owned proxy mirroring N strategies, vs N proxies for cleaner DAO audit? Tied into the operator-wallet discussion in `proj.ai-operator-wallet`.
- Legal posture of DAO-treasury-scale trading on Polymarket from a non-US corporate structure — needs counsel separate from retail US user questions.
- Does `@polymarket/clob-client` support the full order lifecycle we need (GTC limits, cancel, reprice) in TS, or are we looking at Python parity?

## Proposed Layout

Directional, not binding.

### Project

No new project. This work extends `proj.poly-prediction-bot` — specifically the Run-phase **Follow-a-wallet** deliverable — and reuses the existing awareness / knowledge planes.

### Specs

- **New:** `docs/spec/wallet-tracking.md` — defines the `poly_tracked_wallets` table, the `ObservationEvent(kind=polymarket_wallet_trade)` contract, the ranking invariants (minimum resolved-market count, category scoping, survivorship guard), and the isolation rule that mirror execution is gated behind a separate `OrderExecutionPort`.
- **Update:** `docs/spec/monitoring-engine.md` — register the new observation kind.
- **Update:** `nodes/poly/AGENTS.md` — document the tracked-wallet roster location + how the scheduled ranking job is configured.

### Tasks (PR-sized, rough sequence)

1. `task.*` **Polymarket Data-API read methods** — extend `@cogni/market-provider/adapters/polymarket` with `listTopTraders`, `listUserActivity`, `listUserPositions`. Read-only. Rate-limit-aware. No new port methods yet.
2. `task.*` **Wallet-ranking batch job** — weekly scheduler job (Temporal or `@cogni/scheduler-core`) that scores wallets by Sharpe-like PnL + win-rate + category fit + min-N-markets floor, and upserts into a new `poly_tracked_wallets` table. Awareness-plane Postgres, not Dolt.
3. `task.*` **Live wallet poller → ObservationEvent** — Temporal workflow polls each tracked wallet's `/activity` every 30 s, emits `ObservationEvent(kind=polymarket_wallet_trade)` on each new fill. Idempotent on `(wallet, fill_id)`.
4. `spike.*` **Signal-edge validation** — run for ≥2 weeks across the Tier-1 roster; measure whether copy-signals (pre-slippage) have statistically significant edge vs market baseline. **Gate for everything downstream**: if edge < slippage, Phase 3 never ships.
5. `task.*` **Paper-trading mirror** — when a tracked wallet trades, simulate a proportional mirror fill at the live book and record to `@cogni/financial-ledger` paper account. Nightly P&L report.
6. `spike.*` **Execution adapter design** — evaluate `@polymarket/clob-client` behind a new `OrderExecutionPort`. Resolve proxy-wallet model (1 vs N), legal gating, sizing policy, slippage model. Output: design doc + decision log.
7. `task.*` **Knowledge-plane write-back** — promote validated wallet-derived rules into `knowledge_poly` (`entry_type=rule`, `status=candidate`) with `citations.citation_type=supports` pointing to the analysis_signal IDs. Implements the bridge side of `task.0311`.

### Explicitly out of scope here

- Bespoke Polygon block-listener (deferred until Data-API latency fails us).
- CLOB WebSocket client for placement-level signal (top-0.1 % tier).
- On-chain execution of real trades (Phase 3; blocked on spike.\* edge validation + legal review).
- Cross-venue mirroring (Kalshi follow-a-wallet is a different legal + data world).
- A UI for the tracked-wallet roster — a chat-tool exposure via `core__market_list`-style surface is enough for v0.
