---
id: proj.dao-gateway
type: project
primary_charter:
title: DAO Gateway — Multi-Tenant AI Billing for External Projects
state: Active
priority: 1
estimate: 15
summary: Multi-tenant the existing billing stack so external AI projects (starting with MDI) can get metered AI calls, credit budgets, and delegated agent spending via API key + gateway.
outcome: MDI agents route traffic through Cogni gateway, metered per-agent, with delegated budgets, all charges settling against MDI's tenant balance.
assignees: derekg1729
created: 2026-02-26
updated: 2026-02-26
labels: [dao, billing, gateway, multi-tenant, agents]
---

# DAO Gateway — Multi-Tenant AI Billing for External Projects

> Research: [dao-gateway-sdk](../../docs/research/dao-gateway-sdk.md) (spike.0115)
> Launch customer: My Dead Internet (MDI) — 299+ AI agent collective (story.0118)

## Goal

Let any AI project — starting with MDI — meter AI usage, prepay credits, and track cost per agent through an OpenAI-compatible gateway. The first experience must be: **get API key → swap base URL → fund account → make metered calls**. No DAO formation required. No code changes for the project.

## Integration Contract (from MDI's perspective)

MDI's integration surface with Cogni is intentionally minimal:

```
MDI server.js
  │
  ├── OPENAI_BASE_URL = https://gateway.cogni.org/v1  (base URL swap)
  ├── Authorization: Bearer <mdi-api-key>              (gateway auth)
  ├── X-Cogni-Agent-Id: <agent-name>                   (per-agent attribution)
  │
  └── Cogni REST API (v0: manual calls from MDI server)
        ├── GET  /api/v1/gateway/balance
        ├── GET  /api/v1/gateway/usage?agent=<id>
        └── POST /api/v1/gateway/agents  (v1: create agent + allocate budget)
```

**v0 requires zero code changes in MDI** beyond a base URL + API key swap and adding an agent ID header. Everything else is optional API calls MDI can adopt incrementally.

## Roadmap

### v0 — Metered Gateway (MDI as Tenant #1)

**Goal:** MDI routes LLM traffic through Cogni. Every call metered. Cost tracked per agent via header. Human operator funds account via USDC on Cogni website.

**Big rocks:**

- Gateway proxy route — OpenAI-compatible passthrough with billing middleware
- API key → tenant resolution (replaces Auth.js session for gateway callers)
- `X-Cogni-Agent-Id` header → `charge_receipts.actor_id` attribution (nullable column)
- Spend cap on the tenant account (hard limit, preflight rejects when exhausted)
- MDI onboarding — create billing account, issue API key, seed initial credits

**Funding model:** Human (Connor/moonbags) pays USDC via existing Cogni payments page. Credits land in MDI's billing account. Gateway calls debit from that pool. No per-agent funding yet — just per-agent cost _tracking_.

**What MDI does NOT need for v0:**

- DAO formation (optional, can do in parallel via cognidao.org/setup/dao)
- Actor/agent tables (agent ID is a freeform header, not a DB entity)
- Budget delegation (single pool, single spend cap)
- OpenClaw skill (MDI calls REST API directly from server.js)

| Deliverable                                                   | Status      | Est | Work Item  |
| ------------------------------------------------------------- | ----------- | --- | ---------- |
| Gateway proxy route (OpenAI-compatible, billing middleware)   | Not Started | 3   | story.0116 |
| API key management (generation, hashed storage, gateway auth) | Not Started | 2   | story.0116 |
| `charge_receipts.actor_id` column (nullable, from header)     | Not Started | 1   | story.0116 |
| Tenant-level spend cap (preflight enforcement)                | Not Started | 1   | story.0116 |
| MDI onboarding (billing account + API key + seed credits)     | Not Started | 1   | story.0118 |
| Usage/balance API endpoints (GET balance, GET usage by agent) | Not Started | 1   | story.0116 |

### v1 — Agent Budgets (First-Class Actors)

**Goal:** Agents become DB entities with their own API keys and budget allocations. Parent can allocate credits to child. Child blocked when budget exhausted.

**Big rocks:**

- `actors` table — agent as a first-class entity (kind: user | agent | system)
- `budget_allocations` — parent carves N credits for child, child burns independently
- `actor_credentials` — per-agent API keys (not just per-tenant)
- Spawn endpoint — create agent + allocate budget in one call
- Budget enforcement — preflight checks agent's allocation, not just tenant pool

**Funding model:** Still USDC-funded by human at the top. The human's credits are the tenant pool. Agents get slices of that pool. No on-chain token usage yet.

**Contract change for MDI:** Instead of `X-Cogni-Agent-Id` header (freeform), each agent gets a real API key. MDI's `spawn_agent` moot action calls Cogni API to create the agent + allocate budget. More structured, more enforceable.

| Deliverable                                       | Status      | Est | Work Item  |
| ------------------------------------------------- | ----------- | --- | ---------- |
| `actors` table + domain model                     | Not Started | 2   | story.0117 |
| `budget_allocations` + delegation logic           | Not Started | 2   | story.0117 |
| `actor_credentials` + per-agent API keys          | Not Started | 2   | story.0117 |
| Spawn endpoint (create agent + budget)            | Not Started | 1   | story.0117 |
| Budget enforcement in preflight                   | Not Started | 1   | story.0117 |
| OpenClaw skill (getBalance, getUsage, spawnAgent) | Not Started | 2   | story.0118 |

### v2 — Epochs + Activity Rewards

**Goal:** Activity-based credit rewards. MDI activity data feeds into valuation engine. Agents earn credits each epoch.

**Big rocks:**

- Data ingestion plugin for MDI activity (fragments contributed, quality scores, moot participation)
- Valuation engine plugin — maps MDI activity → credit rewards per epoch
- Epoch-based distribution to actors (existing epoch infra, extended to agents)
- All DB-based — no on-chain settlement yet

**Funding model:** Credits still enter via USDC top-up. But now credits also flow _inward_ as epoch rewards. Agents that contribute more earn more budget.

| Deliverable                         | Status      | Est | Work Item            |
| ----------------------------------- | ----------- | --- | -------------------- |
| MDI activity ingestion adapter      | Not Started | 3   | (create at v2 start) |
| Valuation engine plugin for MDI     | Not Started | 3   | (create at v2 start) |
| Epoch rewards distributed to actors | Not Started | 2   | (create at v2 start) |

### v3 — On-Chain $SNAP

**Goal:** Agents can claim $SNAP token rewards to a wallet. Agents can make DAO proposals and vote.

**Big rocks:**

- Wallet management for agents (1 wallet per actor — Coinbase AgentKit or similar, Privy gets expensive at scale)
- $SNAP claim flow — actor claims earned credits as on-chain tokens
- DAO proposal + voting — agents participate in governance via $SNAP
- x402 middleware — per-request crypto payments for agent-to-agent commerce

**Open questions:**

- Wallet custody model for 299+ agents — managed wallets (Coinbase/Privy) vs derived keys?
- Gas sponsorship for agent transactions? (Base: transactions are <$0.01, but still requires ETH funding). futarchy..?
- Voting weight model — 1 token = 1 vote, or MDI's existing quality-weighted model?

### v4 — Recursive Sub-DAO Spawning

**Goal:** An agent collective can spawn a child DAO with its own treasury, governance, and agent pool.

**Big rocks:**

- Sub-DAO factory — parent DAO spawns child with initial treasury allocation
- Cross-DAO agent mobility — agents can operate across DAO boundaries
- Federated identity — actor recognized across multiple DAOs
- SDK extraction — `@cogni/billing-core`, `@cogni/gateway-middleware` for self-hosted mode

## Constraints

- **v0 is maximally simple.** Freeform agent ID header, single tenant pool, human-funded. No new tables beyond charge_receipts column.
- **v1 adds structure.** Actor table, budget delegation, per-agent keys. Still off-chain, still human-funded.
- **v2 adds economics.** Epoch rewards create a feedback loop. Still DB-based settlement.
- **v3 goes on-chain.** Token claims, voting, wallet management. First real $SNAP utility.
- **v4 is recursive.** Sub-DAOs, federation, SDK. Only if v0-v3 prove the model.
- **OpenAI-compatible API at every stage.** Gateway is always a drop-in base URL swap.
- **Single LiteLLM instance shared across tenants** for v0-v1. Per-tenant isolation is v2+.

## Dependencies

- [x] Existing billing infrastructure (credit_ledger, charge_receipts, payment_attempts)
- [x] LiteLLM proxy + OpenRouter
- [x] USDC payment flow (existing)
- [ ] MDI partnership coordination (story.0118)
- [ ] DAO formation wizard tested with real user (v0, optional parallel track)

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Why v0 avoids the actor table

The simplest thing that works for MDI is a freeform `X-Cogni-Agent-Id` header logged to `charge_receipts.actor_id`. This gives per-agent cost visibility immediately. No schema migration beyond a nullable column. MDI can start routing traffic and seeing cost breakdowns before we build the full actor model.

The actor table (v1) adds _enforcement_ — real API keys per agent, budget caps, spawn delegation. But enforcement without visibility is useless. Ship visibility first.

### What repo-spec IS in this project

**Not** a first-run dependency. Optional import/export for portable declarative policy:

- treasury wallet address
- spend policy defaults
- model/provider allowlist

Parsed at onboarding/sync time, normalized into gateway DB. Live source of truth is the **gateway DB/API**, not git.

### Relationship to existing projects

- **proj.ai-operator-wallet**: Cogni's own outbound payments (OpenRouter top-up). Tenants don't need operator wallets.
- **proj.accounts-api-keys**: Existing sentinel virtual_keys. Gateway API keys are a superset.

### Open questions for MDI (TBD before v0)

1. How do they currently make LLM calls? (OpenAI SDK? OpenRouter? direct?)
2. How many of 299 agents actually make LLM calls?
3. Does Kai stay independent or route through gateway?
4. Priority: cost visibility (v0) or budget enforcement (v1)?
5. For `spawn_agent` moot — what does MDI need from Cogni at spawn time?
