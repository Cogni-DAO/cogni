---
id: proj.agentic-granted-trading
type: project
primary_charter: chr.engineering
title: Agentic Granted Trading
state: Active
priority: 1
estimate: 5
summary: Add delegated trading authority for in-platform AI agents so a user can empower an agent to research, recommend, and eventually place Polymarket trades within explicit user-set limits on the user's dedicated trading wallet.
outcome: A Cogni user can authorize one or more in-platform agents to trade on their behalf with bounded scopes, budgets, and approval mode; the agent runtime uses those grants at the signing boundary, and every trade is attributable to the acting agent and revocable without disconnecting the wallet.
assignees: derekg1729
created: 2026-04-23
updated: 2026-04-23
labels: [poly, trading, agents, grants, delegation, wallet]
---

# Agentic Granted Trading

> Related: `proj.poly-copy-trading`, `proj.agentic-interop`, `proj.agent-registry`, `proj.hil-graphs`

## Goal

Turn the current per-tenant trading-wallet foundation into a true delegated-authority system for AI trading agents. Users should be able to keep custody delegated to the app-hosted wallet, choose whether an agent can only research, can propose trades for approval, or can place trades autonomously, and bound that authority with clear budgets and scopes. This project treats grants as execution authority for actors, not as the home for copy-trade strategy or wallet preferences.

## Roadmap

### Crawl (P0)

**Goal:** Make the current wallet/grant model honest and minimally useful for a single in-platform trading agent.

| Deliverable                                                                                      | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Clarify the model: separate trading policy/preferences from execution grants in docs + contracts | Not Started | 1   | (create at P0 start) |
| Replace the implicit “default grant” story with an explicit tenant trading authority baseline    | Not Started | 1   | (create at P0 start) |
| Add actor attribution to authorization and order placement logs (`user`, `copy-engine`, `agent`) | Not Started | 1   | (create at P0 start) |
| Persist acting-agent identity on mirrored / autonomous fills for auditability                    | Not Started | 2   | (create at P0 start) |
| Add a user-visible approval mode: `research-only`, `propose`, `autonomous-with-limits`           | Not Started | 2   | (create at P0 start) |
| Define one first-party agent type that can consume granted trade authority                       | Not Started | 1   | (create at P0 start) |

### Walk (P1)

**Goal:** Support real delegated agent authority with bounded scopes and budgets, independent from copy-trade preferences.

| Deliverable                                                                                              | Status      | Est | Work Item            |
| -------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Introduce agent-scoped execution grants (grantee actor, issuer user, wallet connection, scopes, expiry)  | Not Started | 3   | (create at P1 start) |
| Authorization hot path selects the correct active grant for `(tenant, actor, connection)`                | Not Started | 2   | (create at P1 start) |
| Revocation flow: user can revoke one agent’s authority without disconnecting the wallet                  | Not Started | 2   | (create at P1 start) |
| Budget model: per-order, daily, open-exposure, and concurrent-position ceilings for delegated agents     | Not Started | 3   | (create at P1 start) |
| Human-in-the-loop gate for `propose` mode: agent emits intent, user approves, executor places            | Not Started | 3   | (create at P1 start) |
| Agent-aware ledger and UI: “who placed this trade, under what grant, with what remaining budget”         | Not Started | 2   | (create at P1 start) |
| Candidate-a e2e: create grant → let agent place a bounded trade → revoke → verify next attempt is denied | Not Started | 2   | (create at P1 start) |

### Run (P2+)

**Goal:** Full agentic trading platform where research agents, copy-trade agents, and portfolio agents operate under explicit user-issued authority.

| Deliverable                                                                                                  | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Multi-agent authority: separate grants for research agent, copy-trade agent, and discretionary trading agent | Not Started | 3   | (create at P2 start) |
| Policy engine maps wallet/market research into per-user portfolio constraints before an agent can place      | Not Started | 3   | (create at P2 start) |
| Grant templates and presets: conservative, copy-only, discretionary, research-only                           | Not Started | 2   | (create at P2 start) |
| Time-boxed and event-boxed grants (expires after duration / after spend / after trade count)                 | Not Started | 2   | (create at P2 start) |
| Agent marketplace path: user installs a third-party or custom agent and grants bounded authority             | Not Started | 4   | (create at P2 start) |
| Cross-agent delegation rules: one agent can request authority escalation but cannot self-issue it            | Not Started | 2   | (create at P2 start) |

## Constraints

- Keep copy-trade strategy/preferences out of the grant model. Bet sizing, active-trade count, wallet-specific scaling, and variance mapping belong in a separate trading-policy surface.
- Start with first-party in-platform agents only. Third-party or cross-node agents come after the authority model is solid and observable.
- The signing boundary remains the hard gate. No agent may bypass `authorizeIntent` or submit raw trading actions directly.
- A user must be able to revoke one agent’s authority without revoking the wallet connection or losing funds.
- P0/P1 must make the current “grant” abstraction less magical, not more. If the data model is still one-row-per-tenant in practice, name it honestly.
- Autonomous trading must remain observable on candidate-a by actor, grant, tenant, wallet, and outcome before expanding scope.

## Dependencies

- [ ] `proj.poly-copy-trading` Phase 3 baseline is deploy-verified with per-tenant wallet execution and enable-trading flow
- [ ] `task.0347` or successor lands a separate home for copy-trade preferences / sizing policy
- [ ] Agent identity model is stable enough to distinguish a user from a first-party trading agent
- [ ] Human approval UX exists or is scoped for P1 `propose` mode
- [ ] Ledger and observability surfaces can attribute fills to an acting agent and authority source

## As-Built Specs

- [poly-multi-tenant-auth](../../docs/spec/poly-multi-tenant-auth.md) — current tenant-scoped trading wallet and copy-trade execution baseline
- [poly-trader-wallet-port](../../docs/spec/poly-trader-wallet-port.md) — signing boundary, `authorizeIntent`, approvals lifecycle

## Design Notes

- The key architectural split is:
  - **Trading policy** decides what the account wants to do.
  - **Execution grant** decides who is allowed to do it.
- Today’s `poly_wallet_grants` table behaves more like a tenant trading-policy limit row than a true delegated grant. This project should either make it into a real actor-scoped grant model or simplify/rename it before layering more product behavior on top.
- Copy-trade preferences are not grants. A user preference like “bet $3, max 5 active trades, scale down volatile wallets” should survive whether execution is performed by the mirror engine, a research agent, or the user themselves.
- Real grants become valuable when multiple actors can act on the same wallet:
  - user-driven copy engine
  - in-platform AI research/trading agent
  - future external or marketplace agent
- A healthy end state is: one wallet connection, one or more trading-policy rows, and zero or more actor-specific execution grants.
- P0 should resist overcommitting to a multi-row grant issuance UI if the immediate product need is one first-party trading agent. The important part is correct actor attribution and a clean path to per-actor authority, not maximum CRUD surface on day one.
