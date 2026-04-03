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
updated: 2026-04-01
labels: [poly, prediction-markets, ai, langgraph, temporal]
---

# Cogni Poly — Prediction Market Intelligence Bot

## Goal

Build a prediction market bot that starts by reading and searching live markets (Polymarket, Kalshi), graduates to continuous autonomous scanning and signal generation with real edge, and ultimately runs paper trading simulations with DAO treasury accounting. Each phase delivers standalone user value: Crawl gives market access + search, Walk gives intelligence + alpha, Run gives simulated returns and the foundation for real money.

## Roadmap

### Crawl (P0) — Market Port

**Goal:** Live market data flowing through the system. Users can browse and search active markets across platforms. The landing page shows real data instead of mocks.

| Deliverable                                                                   | Status | Est | Work Item      |
| ----------------------------------------------------------------------------- | ------ | --- | -------------- |
| Backend research + API integration plan                                       | Done   | 3   | task.0226      |
| Polymarket domain pack — adapters, normalizers, triggers, scoring, API routes | Done   | 5   | task.0227      |
| `@cogni/market-provider` — port, Zod schemas, Polymarket + Kalshi adapters    | Done   | 3   | task.0230      |
| `@cogni/poly-core` — domain types, normalizers, triggers, scoring             | Done   | 2   | (in task.0227) |
| `db-schema/ingestion` — ObservationEvent table                                | Done   | 1   | (in task.0227) |
| PollAdapters wrapping MarketProviderPort                                      | Done   | 1   | (in task.0227) |
| Landing page APIs (`/markets`, `/signals`, `/status`)                         | Done   | 2   | (in task.0227) |
| Landing page UI — live market cards, category filters, platform links         | Done   | 2   | (in task.0227) |
| `core__market_list` AI tool + poly-brain LangGraph agent                      | Done   | 2   | (in task.0230) |
| Live market capability wired into chat UI container                           | Done   | 1   | (in task.0230) |

### Walk (P1) — Intelligence Engine

**Goal:** Continuous autonomous scanning with threshold-triggered AI analysis. Redis live stream feeds the UI. Significant observations persist to Postgres. AI brain fires on triggers, not timers.

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

### Run (P2+) — Paper Trading & Treasury

**Goal:** Simulated trading with full position tracking and P&L accounting. DAO treasury grows on paper. "Follow a wallet" lets users shadow successful traders. System proves edge before real money.

| Deliverable                                                                | Status      | Est | Work Item            |
| -------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Paper trading engine — simulated order execution against live odds         | Not Started | 4   | (create at P2 start) |
| Position tracking + P&L ledger (integrated with `@cogni/financial-ledger`) | Not Started | 3   | (create at P2 start) |
| Balance sheet dashboard — portfolio view, historical returns, Sharpe ratio | Not Started | 3   | (create at P2 start) |
| Follow-a-wallet — track and mirror top Polymarket wallets                  | Not Started | 3   | (create at P2 start) |
| Strategy backtesting — replay historical signals against resolved markets  | Not Started | 3   | (create at P2 start) |
| DAO governance integration — community votes on risk parameters, strategy  | Not Started | 2   | (create at P2 start) |
| Human-in-the-loop approval flow — signal → approve → execute               | Not Started | 3   | (create at P2 start) |

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

- [AI Awareness & Decision Plane](../../docs/spec/monitoring-engine.md) — record types, decision layers, invariants
- [Data Streams](../../docs/spec/data-streams.md) — Redis live plane, selective Postgres persistence, SSE
- [Knowledge Data Plane](../../docs/spec/knowledge-data-plane.md) — versioned strategy/prompt expertise (draft)

## Design Notes

- **Two-tier persistence** (data-streams-spec): Redis streams hold every poll sample (ephemeral, MAXLEN-trimmed). Only threshold crossings + hourly checkpoints persist to Postgres. ~100x reduction vs full firehose.

- **Market provider port** (task.0230): Single `MarketProviderPort` abstraction used by both the AI tool (`core__market_list`) and the data pipeline (`PollAdapter` wraps it). One HTTP client per platform, not two.

- **Poly-brain vs poly-synth**: Two distinct graphs. `poly-brain` is the chat agent (ReAct, tools, conversational). `poly-synth` is the autonomous analysis graph (structured input → assessment → scoring, no tools, Walk scope).

- **Knowledge vs awareness split** (knowledge-data-plane-spec): Awareness = what the AI sees now (observations, triggers, signals). Knowledge = what the AI has learned (strategies, prompts, evaluations). Different lifecycles, different storage.

- **Semantic search for street intel** (spike.0229): The hardest open question. Connecting "warehouse fire" to "CPI market" requires multi-hop reasoning. Spike will benchmark embeddings vs LLM-as-judge vs hybrid.

- **Follow-a-wallet** (Run phase): Polymarket transactions are on-chain (Polygon). Can index top wallets' positions. Needs separate research spike when P2 starts.
