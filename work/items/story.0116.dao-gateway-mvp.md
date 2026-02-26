---
id: story.0116
type: story
title: DAO Gateway MVP — multi-tenant AI billing gateway for external projects
status: needs_design
priority: 1
estimate: 4
summary: Multi-tenant the existing LiteLLM + billing stack as an OpenAI-compatible gateway so external AI projects can add .cogni/repo-spec.yaml and get crypto-metered AI calls + DAO treasury payments.
outcome: External projects can register, get an API key, swap their base URL, and have AI calls metered with USDC payments flowing to their DAO wallet.
spec_refs:
assignees: derekg1729
credit: SnappedAI (Kai) / Connor (moonbags) — MDI partnership proposal (story.0118)
project: proj.dao-gateway
branch:
pr:
reviewer:
created: 2026-02-26
updated: 2026-02-26
labels: [dao, sdk, billing, product]
external_refs:
  - story.0118 (MDI partnership — launch customer)
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Story: DAO Gateway MVP

## Context

Research spike [spike.0115](spike.0115.dao-gateway-sdk.md) identified a Config-File Gateway as the simplest path to let any AI project become a DAO with crypto billing. Our existing LiteLLM + billing infrastructure already does 90% of what's needed — it just needs multi-tenanting.

**Launch customer:** My Dead Internet (MDI) — 299+ AI agent collective with advanced governance but no economic layer. See [story.0118](story.0118.my-dead-internet-partnership.md). Partnership proposed by SnappedAI (Kai) / Connor (moonbags).

See [research doc](../../docs/research/dao-gateway-sdk.md) for full analysis and option comparison.

## User Story

As an AI project developer, I want to add a `.cogni/repo-spec.yaml` to my repo and get an API key so that my AI calls are metered and users can pay in USDC to my DAO wallet — without writing any billing code.

## Acceptance Criteria

- [ ] API key registration endpoint — creates billing account linked to project's repo-spec
- [ ] OpenAI-compatible gateway endpoint — `POST /v1/chat/completions` with billing middleware
- [ ] Per-tenant credit isolation — separate billing accounts per API key
- [ ] USDC payment verification scoped to tenant's DAO wallet (from repo-spec `receiving_address`)
- [ ] Usage dashboard — per-project spend, credit balance, call volume

## Validation

- [ ] Gateway endpoint responds to `POST /v1/chat/completions` with valid OpenAI-format response
- [ ] API key resolves to correct billing account
- [ ] USDC payment credits the correct tenant's balance

## Follow-up (Phase 2-3)

- x402 middleware for per-request crypto payments (agent-to-agent commerce)
- Self-service DAO formation (automated wizard → API key)
- SDK extraction (`@cogni/billing-core`) for self-hosted mode
