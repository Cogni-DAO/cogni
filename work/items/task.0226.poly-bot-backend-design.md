---
id: task.0226
type: task
title: "Cogni Poly — backend research, design & integration for prediction market bot"
status: done
priority: 1
rank: 2
estimate: 3
summary: Research prediction market APIs (Polymarket, Kalshi), design the bot backend architecture, and integrate with existing cogni infra (scheduler, AI core, DAO governance).
outcome: Architecture doc with API integration plan, signal pipeline design, human-in-the-loop approval flow, and deployment strategy on existing cogni stack.
spec_refs:
assignees: derekg1729
credit:
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-04-01
labels: [poly, prediction-markets, ai, research, design]
external_refs:
---

# Cogni Poly — Backend Research & Design

## Context

The `apps/poly` landing page establishes the product vision: a community-built AI prediction market bot that researches, monitors, and signals across platforms (Polymarket, Kalshi, etc.) with human-in-the-loop approval for bet execution.

This task covers the backend research and architecture design needed before implementation.

## Research Questions

| Area                   | Questions                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Polymarket API**     | REST/WS endpoints for market data, order placement. Auth model (API key? wallet signing?). Rate limits. CLOB vs AMM.   |
| **Kalshi API**         | REST API for market listing, order execution. Auth (OAuth? API key?). Regulated restrictions. Position limits.         |
| **Manifold/Metaculus** | Public APIs for market data (read-only initially). Usefulness as signal sources even without execution.                |
| **Legal**              | Regulatory considerations for community-pooled prediction market participation. DAO liability. US/non-US restrictions. |

## Design Areas

### 1. Market Data Ingestion

- Polling vs WebSocket for each platform
- Normalization layer: unified market/contract schema across platforms
- Storage: time-series odds data, market metadata
- Integration with existing `@cogni/ingestion-core` package

### 2. Signal Pipeline

- AI research agent: what model, what inputs (market data + news + social)
- Criteria matching: user/community-defined watchlists
- Confidence scoring and thesis generation
- Signal delivery: push notifications, in-app, Discord/Telegram

### 3. Human-in-the-Loop Approval Flow

- Signal → approval request → execution (or skip)
- Auto-approve rules: per-user thresholds (confidence %, category, max stake)
- Approval UX: one-tap approve in mobile, Discord bot reaction, etc.
- Integration with existing `@cogni/scheduler-core` for timed execution

### 4. Execution Layer

- Platform-specific order placement adapters
- Position tracking and P&L accounting
- Integration with `@cogni/financial-ledger` for treasury tracking
- Risk limits: max position size, max daily exposure, portfolio correlation

### 5. Community Intelligence Loop

- How community feedback (approvals, skips, overrides) feeds back into model
- Shared watchlists and criteria as first-class entities
- DAO governance for risk parameters and strategy changes
- Integration with `@cogni/aragon-osx` for on-chain governance

### 6. Langgraph Brain Heartbeat Loop

- **Continuous analysis graph**: a langgraph graph that runs on a schedule (Temporal cron), scans markets, and produces structured output
- **Zod-shaped output schema**: define a `MarketSignal` Zod schema that the graph must conform to — market, platform, category, probability, direction, confidence, thesis, sources
- **Variable-length output**: each run produces 0-N signals (dynamically sized), rendered as composable UI components on the landing page
- **Public heartbeat endpoint**: `GET /api/v1/poly/brain/status` returns current state (scanning/analyzing/idle), markets scanned count, signals generated today, last heartbeat timestamp
- **Public signals endpoint**: `GET /api/v1/poly/brain/signals` returns most recent N signals in the Zod schema shape — no auth required, this is the public-facing "what is the bot thinking" feed
- **SSE stream** (stretch): real-time streaming of brain activity to the landing page via the existing Redis Streams → SSE pattern from `apps/web`
- **Integration with existing graph run infra**: reuse `@cogni/langgraph-graphs` package, `@cogni/scheduler-core` for cron scheduling, `@cogni/ai-core` for event types

### 7. Infrastructure

- Deployment: reuse existing Docker + OpenTofu → Spheron pipeline
- Scheduling: Temporal workflows for continuous market scanning + brain heartbeat loop
- Observability: Pino → Grafana Cloud, same as main app
- Separate service or feature within `apps/web`? (likely separate `apps/poly` with shared packages)

## Deliverables

1. **Research doc** — API capabilities, rate limits, auth for each platform
2. **Architecture doc** — signal pipeline, approval flow, execution layer, brain heartbeat loop
3. **Zod schema** — `MarketSignal`, `BrainStatus`, `BrainHeartbeatOutput` schemas in `src/contracts/`
4. **Integration plan** — which existing cogni packages to reuse vs new packages needed
5. **Spike PR** — proof-of-concept: langgraph graph that fetches market data from Polymarket + Kalshi, produces `MarketSignal[]` output, served via public API to `apps/poly` landing page

## PR / Links

- Landing page PR: [#12](https://github.com/Cogni-DAO/cogni-resy-helper/pull/12)
- Handoff: [handoff](../handoffs/task.0226.handoff.md)
- MVP Agent Workflows & Taps Design: [task.0227](task.0227.poly-mvp-agent-workflows-and-taps.md)

## Validation

- [ ] Research doc covers all four platform APIs with auth model, rate limits, and data schemas
- [ ] Architecture doc reviewed and approved by at least one other contributor
- [ ] Zod schemas compile and pass contract tests
- [ ] Spike PR fetches live market data from at least one platform and renders on landing page
