---
id: story.0117
type: story
title: Actor Billing Model — Agents as First-Class Spenders with Delegated Budgets
status: needs_triage
priority: 1
rank: 99
estimate: 5
summary: Extend the billing model so agents are first-class actors with their own billing identity, credit allocations, and spend tracking — enabling a parent agent to spawn sub-agents with delegated budgets that burn independently and roll up to the tenant.
outcome: Agents have their own actor identity, API credentials, and budget allocations. A parent actor can create child actors with capped spend. All usage is attributed per-actor but liability settles against the tenant's billing account.
spec_refs:
assignees: derekg1729
credit: SnappedAI (Kai) / Connor (moonbags) — MDI partnership proposal (story.0118) revealed the need for agent-level billing
project: proj.dao-gateway
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-26
updated: 2026-02-26
labels: [billing, actors, agents, multi-tenant]
external_refs:
  - story.0118 (MDI partnership — motivating use case)
  - story.0116 (DAO Gateway MVP — gateway is the delivery surface)
  - spike.0115 (research)
---

# Actor Billing Model — Agents as First-Class Spenders with Delegated Budgets

## Context

Today, billing is strictly user-centric: `billing_accounts.owner_user_id` is 1:1 with `users.id`. The `charge_receipts` table has no concept of _which agent_ made a call — only which billing account paid.

MDI's use case reveals the gap: their moot system votes to spawn agents, and each agent needs its own metered budget. The parent agent (or human operator) allocates credits to the child; when the child's budget is exhausted, it's blocked. All liability rolls up to the tenant.

The existing `ActorId` branded type and `actor_type` concept (user | agent | service) already exist in `@cogni/ids` and `docs/spec/rbac.md`. This story promotes actors from an auth/RBAC concept to a **billing-aware entity** with credentials and spend tracking.

## Requirements

- **Actor table**: New `actors` entity with `id`, `tenant_id` (FK → billing_accounts), `kind` (user | system | agent), `parent_actor_id` (nullable, self-referential), `label`, `status`
- **Budget allocations**: New `budget_allocations` entity — a parent actor carves out N credits for a child actor. Child burns from its allocation. When exhausted, child is blocked (preflight rejects). Parent's remaining allocation shrinks by N.
- **Actor credentials**: Hashed API keys per actor. Gateway resolves `Bearer <key>` → actor → tenant. Separate from existing `virtual_keys` (which are sentinel-mode, user-scoped).
- **Attribution on charge_receipts**: `actor_id` column (nullable, FK → actors). Existing rows get a sentinel default. New charges always record which actor spent.
- **Spawn flow**: Parent actor creates child actor + budget allocation in one operation. Returns actor ID + API key. Child's usage is metered independently.
- **Liability separation**: Actor = who made the call. Tenant (billing_account) = who pays. These are always separate concepts.

## Allowed Changes

- New tables: `actors`, `budget_allocations`, `actor_credentials`
- New column: `charge_receipts.actor_id` (nullable)
- New domain model: `src/core/actors/` (model, rules, errors)
- New port: `src/ports/actor.port.ts`
- New adapter: `src/adapters/server/actors/`
- New feature service: `src/features/actors/services/`
- Migration for new tables + charge_receipts column
- Updates to billing write path to record actor_id

## Plan

- [ ] Design the actor domain model (core entities, invariants, error algebra)
- [ ] Write spec for actor billing invariants
- [ ] Create migration: `actors`, `budget_allocations`, `actor_credentials` tables
- [ ] Create migration: add `actor_id` to `charge_receipts` (nullable, default sentinel)
- [ ] Implement `ActorPort` interface (create, spawn, getBalance, getUsage)
- [ ] Implement budget allocation logic (carve, enforce, exhaust)
- [ ] Implement actor credential generation + hashed storage
- [ ] Wire actor_id into the billing write path (commitUsageFact → recordChargeReceipt)
- [ ] Update preflight credit check to enforce budget allocation limits
- [ ] Contract tests for actor port

## Validation

**Spawn + metered usage:**

```bash
# Create a root actor for a tenant
# → returns { actorId, apiKey }

# Root actor spawns child with 1M credit budget
# → returns { childActorId, childApiKey, budgetRemaining }

# Child makes metered call via gateway
# → charge_receipt has actor_id = childActorId

# Child exhausts budget
# → preflight rejects with 402, child is blocked

# Parent's remaining allocation decreased by child's limit
```

**Expected:**

- Actor hierarchy is persisted (parent → child relationship)
- Budget allocation tracks `limit` and `spent` independently per actor
- charge_receipts always have actor_id for new charges
- Existing charge_receipts are unaffected (nullable column)

## Review Checklist

- [ ] **Work Item:** `story.0117` linked in PR body
- [ ] **Spec:** actor model invariants (attribution ≠ liability, budget monotonicity)
- [ ] **Tests:** actor CRUD, budget carving, exhaustion blocking, charge attribution
- [ ] **Reviewer:** assigned and approved

## PR / Links

- MDI use case: agent Y spawns agent Z with budget X from Y's allocation
- Existing actor concepts: `@cogni/ids` (ActorId), `docs/spec/rbac.md` (actor types)

## Attribution

- **Use case:** SnappedAI (Kai) / Connor (moonbags) — MDI collective's agent spawning needs
- **Model design:** CogniDAO dev team (actor + budget_allocation primitives)
