---
id: proj.poly-prediction-bot
type: project
primary_charter:
title: "Cogni Poly — Prediction Market Intelligence Bot"
state: Active
priority: 1
estimate: 5
summary: Build an autonomous prediction market bot that ingests live market data, generates AI-powered trading signals, and progressively moves toward paper trading and DAO-managed treasury growth.
outcome: A self-improving prediction market intelligence system — from read-only market access through autonomous analysis to simulated trading with tracked P&L.
assignees: derekg1729
created: 2026-03-31
updated: 2026-04-19
child_projects:
  - proj.poly-copy-trading
labels: [poly, prediction-markets, ai, langgraph, temporal, copy-trading]
---

# Cogni Poly — Prediction Market Intelligence Bot

## Goal

Build a prediction market bot that starts by reading and searching live markets (Polymarket, Kalshi), graduates to continuous autonomous scanning and signal generation with real edge, and ultimately runs paper trading simulations with DAO treasury accounting. Each phase delivers standalone user value: Crawl gives market access + search, Walk gives intelligence + alpha, Run gives simulated returns and the foundation for real money.

## Roadmap

### Crawl (P0) — Market Port

**Goal:** Live market data flowing through the system. Users can browse and search active markets across platforms.

> **Ground-truth audit 2026-04-17:** this table was inflated. Rows that named files / packages / routes that do not exist in the tree (no `@cogni/poly-core` package, no `observation_events` table, no `/markets` `/signals` `/status` routes, no landing-page market-cards UI, no `poly-synth` graph, no Temporal market/analysis workflows) have been corrected to **Not Started** with notes. Items marked **Done** are grep-verified.

| Deliverable                                                                                | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Backend research + API integration plan                                                    | Done        | 3   | task.0226            |
| `@cogni/market-provider` — port + Zod schemas + Polymarket Gamma + Kalshi read adapters    | Done        | 3   | task.0230            |
| `core__market_list` AI tool                                                                | Done        | 1   | (in task.0230)       |
| `core__wallet_top_traders` AI tool + poly-brain chat binding + /dashboard Top Wallets card | Done        | 3   | task.0315 v0 (PR-A)  |
| `@cogni/poly-core` domain package                                                          | Not Started | 2   | (not created yet)    |
| Awareness-plane `observation_events` table                                                 | Not Started | 1   | (deferred; see note) |
| `PollAdapter` wrapping `MarketProviderPort`                                                | Not Started | 2   | (create when needed) |
| Landing page APIs (`/markets`, `/signals`, `/status`)                                      | Not Started | 2   | (create when needed) |
| Landing page UI — live market cards, category filters, platform links                      | Not Started | 3   | (create when needed) |

**Note on `observation_events`:** task.0315's design explicitly defers this table with a named trigger (second consumer arrives — `poly-synth` cross-wallet analysis, a second domain, or a third-party plug-in). Do NOT add it speculatively. Dedicated copy-trade tables (`poly_copy_trade_{fills,config,decisions}`, shipped in task.0315 CP3.3) cover the v0.1 needs.

### Walk (P1) — Intelligence Engine

**Goal:** Continuous autonomous scanning with threshold-triggered AI analysis. Redis live stream feeds the UI. Significant observations persist to Postgres. AI brain fires on triggers, not timers.

> **Not started.** Every row below is un-implemented. Listing them as "Not Started" is tracking, not progress.

| Deliverable                                                                 | Status      | Est | Work Item            |
| --------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Redis 7 infrastructure (upstream merge from operator repo)                  | Blocked     | 1   | (upstream task.0174) |
| Data streams spec — Redis live plane + selective Postgres persistence       | Done        | 1   | (data-streams-spec)  |
| Knowledge data plane — strategy/prompt versioning for analysis graphs       | In Review   | 3   | task.0231            |
| Temporal MarketStreamWorkflow (poll → Redis → triggers → selective persist) | Not Started | 3   | (create at P1 start) |
| SSE endpoint — frontend tails Redis for live updates                        | Not Started | 2   | (create at P1 start) |
| `poly-synth` LangGraph reasoning graph (structured analysis, not chat)      | Not Started | 3   | (create at P1 start) |
| Temporal AnalysisRunWorkflow (context → LLM → score → persist)              | Not Started | 3   | (create at P1 start) |
| Semantic search spike — observation-to-market matching                      | Not Started | 2   | spike.0229           |
| Street intel workflow — user observations matched to live markets           | Not Started | 3   | story.0228           |
| Calibration loop — outcomes → base rate updates                             | Not Started | 3   | (create at P1 start) |
| Enrichment sources — GDELT news, Metaculus expert forecasts                 | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Autonomous Copy-Trading

**Spun out to its own project on 2026-04-19.** See [proj.poly-copy-trading](proj.poly-copy-trading.md) for the full roadmap across (1) v0 single-operator prototype, (2) v1 hardening + multi-target, (3) per-user multi-tenant operator wallets + RLS, and (4) streaming + adversarial-robust ranking.

Paper-trading infrastructure + DAO treasury integration + strategy backtesting + human-in-the-loop approval remain unscoped. Create a dedicated project when those deliverables are picked up; they are orthogonal to the autonomous-mirror track.

## Constraints

- No real money in Crawl or Walk — paper trading only until edge is proven with statistical significance
- All prediction market operations must be audit-logged for DAO transparency
- Must work without Temporal in local dev (adapters callable standalone for testing)
- Polymarket adapter must handle CLOB API (not just AMM) — that's where the liquidity is
- LLM reasoning stays in LangGraph, I/O stays in Temporal — never mix (per temporal-patterns-spec)
- Rate limits respected per platform — backoff built into adapters, not callers
- US regulatory constraints acknowledged — no execution features for US users until legal review

## Dependencies

- [x] Landing page (`apps/poly`) — merged in PR #12
- [x] Polymarket domain pack — merged in PR #13
- [x] `@cogni/market-provider` package — on feat/market-provider-package branch
- [x] Kalshi API access (API key + RSA private key in .env.local)
- [x] Polymarket API access (public Gamma API, no key needed)
- [ ] Redis 7 infrastructure — exists in operator repo (task.0174), needs upstream merge
- [ ] Temporal scheduled workflows for continuous polling (Walk)
- [ ] TimescaleDB extension (optional — plain table works without it)

## As-Built Specs

- [Data Streams](../../docs/spec/data-streams.md) — Redis live plane, selective Postgres persistence, SSE
- [Knowledge Data Plane](../../docs/spec/knowledge-data-plane.md) — Doltgres knowledge plane, per-node DBs, agent tools (active)
- [Poly Mirror v0](../../docs/spec/poly-copy-trade-phase1.md) — three-layer decomposition (trading / wallet-watch / copy-trade), order-ledger, placement invariants (task.0315)
- ~~AI Awareness & Decision Plane (`docs/spec/monitoring-engine.md`)~~ — referenced in the original roadmap but the file does not exist. Deleted from pointers until it's written.

## Design Notes

- **Two-tier persistence** (data-streams-spec): Redis streams hold every poll sample (ephemeral, MAXLEN-trimmed). Only threshold crossings + hourly checkpoints persist to Postgres. ~100x reduction vs full firehose.

- **Market provider port** (task.0230): Single `MarketProviderPort` abstraction used by both the AI tool (`core__market_list`) and the data pipeline (`PollAdapter` wraps it). One HTTP client per platform, not two.

- **Poly-brain vs poly-synth**: Two distinct graphs. `poly-brain` is the chat agent (ReAct, tools, conversational). `poly-synth` is the autonomous analysis graph (structured input → assessment → scoring, no tools, Walk scope).

- **Knowledge vs awareness split** (knowledge-data-plane-spec): Awareness = what the AI sees now (observations, triggers, signals). Knowledge = what the AI has learned (strategies, prompts, evaluations). Different lifecycles, different storage.

- **Semantic search for street intel** (spike.0229): The hardest open question. Connecting "warehouse fire" to "CPI market" requires multi-hop reasoning. Spike will benchmark embeddings vs LLM-as-judge vs hybrid.

- **Follow-a-wallet** (Run phase): Polymarket transactions are on-chain (Polygon). Can index top wallets' positions. Needs separate research spike when P2 starts.
