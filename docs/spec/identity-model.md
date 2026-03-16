---
id: identity-model-spec
type: spec
title: "Identity Model: System Identity Primitives"
status: draft
spec_state: proposed
trust: draft
summary: "Single source of truth for all identity primitives in the Cogni system: node_id (deployment), scope_id (governance domain), user_id (person), billing_account_id (tenancy), dao_address (on-chain), actor_id (economic subject). Defines relationships, scoping rules, and prohibited overloading."
read_when: Working on identity, scoping, multi-project, ledger attribution, node-operator boundaries, or any code that references node_id, scope_id, user_id, or billing_account_id.
owner: derekg1729
created: 2026-02-22
verified: 2026-02-22
tags: [identity, architecture, governance]
---

# Identity Model: System Identity Primitives

> The system uses six orthogonal identity keys. Each has a single, non-overlapping purpose. This spec is the canonical reference for what each key means, where it lives, and what it must never be used for.

## Key References

|          |                                                                      |                                          |
| -------- | -------------------------------------------------------------------- | ---------------------------------------- |
| **Spec** | [Node vs Operator Contract](./node-operator-contract.md)             | Node/Operator boundaries, scope_id intro |
| **Spec** | [Attribution Ledger](./attribution-ledger.md)                        | Ledger scoping by (node_id, scope_id)    |
| **Spec** | [User Identity + Account Bindings](./decentralized-user-identity.md) | user_id, user_bindings, identity_events  |
| **Spec** | [Accounts Design](./accounts-design.md)                              | billing_account_id, credit ledger        |
| **Spec** | [DAO Enforcement](./dao-enforcement.md)                              | dao_address, payment rails               |

## Design

### Identity Primitives

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INFRASTRUCTURE LAYER                         │
│                                                                     │
│  node_id (UUID)                                                     │
│  ─ Deployment/instance identity                                     │
│  ─ One node = one DB, one infra, one `docker compose up`           │
│  ─ Minted at node formation, immutable                              │
│  ─ Lives in: .cogni/repo-spec.yaml, all ledger tables              │
│                                                                     │
│    ┌──────────────────────────────────────────────────────────┐     │
│    │                  GOVERNANCE LAYER                         │     │
│    │                                                          │     │
│    │  scope_id (UUID)                        1:N per node     │     │
│    │  ─ Governance/payout domain (project)                    │     │
│    │  ─ Each scope has: DAO, weight policy, payment rails     │     │
│    │  ─ Deterministic: uuidv5(node_id, scope_key)            │     │
│    │  ─ scope_key = human slug (e.g. 'default')              │     │
│    │  ─ Lives in: .cogni/projects/*.yaml, epoch tables        │     │
│    │                                                          │     │
│    │    ┌──────────────────────────────────────────────┐      │     │
│    │    │  dao_address (TEXT)       1:1 per scope      │      │     │
│    │    │  ─ On-chain contract identity                │      │     │
│    │    │  ─ Aragon DAO address + chain_id             │      │     │
│    │    │  ─ Attribute of a scope, not a DB key        │      │     │
│    │    │  ─ Lives in: .cogni/projects/*.yaml          │      │     │
│    │    └──────────────────────────────────────────────┘      │     │
│    └──────────────────────────────────────────────────────────┘     │
│                                                                     │
│    ┌──────────────────────────────────────────────────────────┐     │
│    │                    TENANCY LAYER                          │     │
│    │                                                          │     │
│    │  billing_account_id (UUID)              1:N per node     │     │
│    │  ─ Payment/subscription tenancy                          │     │
│    │  ─ RLS boundary for user data isolation                  │     │
│    │  ─ = tenantId at runtime (same UUID)                     │     │
│    │  ─ Lives in: billing_accounts.id, all user-data tables   │     │
│    │                                                          │     │
│    │  Orthogonal to scope_id: a user's billing account        │     │
│    │  exists regardless of which projects they contribute to  │     │
│    └──────────────────────────────────────────────────────────┘     │
│                                                                     │
│    ┌──────────────────────────────────────────────────────────┐     │
│    │                   ECONOMIC LAYER                         │     │
│    │                                                          │     │
│    │  actor_id (UUID)                       per-node          │     │
│    │  ─ Economic subject (earns, spends, attributed)          │     │
│    │  ─ Kinds: user | agent | system | org                    │     │
│    │  ─ user actors: 1:1 FK to users.id                       │     │
│    │  ─ agent actors: parent_actor_id for hierarchy            │     │
│    │  ─ Lives in: actors.id, charge_receipts, epoch_allocs    │     │
│    │  ─ Bindings: actor_bindings (wallets, OAuth, ext refs)   │     │
│    │                                                          │     │
│    │  Orthogonal to governance: economic attribution does      │     │
│    │  not imply voting rights or political participation      │     │
│    └──────────────────────────────────────────────────────────┘     │
│                                                                     │
│    ┌──────────────────────────────────────────────────────────┐     │
│    │                    PERSON LAYER                           │     │
│    │                                                          │     │
│    │  user_id (UUID)                         cross-node       │     │
│    │  ─ Canonical person identity                             │     │
│    │  ─ Stable, minted at first contact                       │     │
│    │  ─ Auth-method-agnostic (wallet, Discord, GitHub)        │     │
│    │  ─ Lives in: users.id, ledger attribution, payouts       │     │
│    │  ─ Bindings: user_bindings (provider + external_id)      │     │
│    └──────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

## Definitions

| Key                  | Type | Minted When              | Mutable | Purpose                                    | Canonical Location                        |
| -------------------- | ---- | ------------------------ | ------- | ------------------------------------------ | ----------------------------------------- |
| `node_id`            | UUID | Node formation           | No      | Deployment/instance identity               | `.cogni/repo-spec.yaml`                   |
| `scope_id`           | UUID | Project manifest created | No      | Governance/payout domain (project)         | `.cogni/projects/*.yaml`                  |
| `scope_key`          | TEXT | Project manifest created | No      | Human-readable scope slug                  | `.cogni/projects/*.yaml`, repo-spec.yaml  |
| `user_id`            | UUID | First user contact       | No      | Person identity                            | `users.id`                                |
| `actor_id`           | UUID | Actor creation           | No      | Economic subject (earns/spends/attributed) | `actors.id`                               |
| `billing_account_id` | UUID | Account creation         | No      | Payment/subscription tenancy               | `billing_accounts.id`                     |
| `dao_address`        | TEXT | DAO contract deployed    | No      | On-chain contract identity                 | `.cogni/projects/*.yaml` → `dao.contract` |

## Relationships

```
node_id (1) ──── (N) scope_id          A node hosts multiple projects
scope_id (1) ──── (1) dao_address       Each project has one DAO
node_id (1) ──── (N) billing_account_id A node serves multiple tenants
user_id (1) ──── (1) billing_account_id Each user has one billing account
user_id (1) ──── (N) user_bindings      A user has multiple auth methods
user_id (N) ──── (N) scope_id           Users contribute to multiple projects
                                         (via activity_events + epoch_allocations)
actor_id (1) ──── (1) user_id           For human actors (kind=user)
actor_id (1) ──── (0..1) parent_actor_id Agent hierarchy (kind=agent)
actor_id (1) ──── (N) actor_bindings    Wallets, external refs
actor_id (N) ──── (1) billing_account_id Multiple actors per tenant
```

**Orthogonality:** `scope_id` and `billing_account_id` are independent dimensions. A user's billing account is for paying for AI service consumption. A scope's DAO is for paying contributors. These never intersect — contributing to a project does not require a billing account, and using the AI service does not require contributing to a project.

## Scoping Rules

### Where Each Key Appears

| Table / Context            | `node_id` | `scope_id`  | `user_id` | `actor_id`       | `billing_account_id` |
| -------------------------- | --------- | ----------- | --------- | ---------------- | -------------------- |
| `epochs`                   | PK part   | PK part     | —         | —                | —                    |
| `activity_events`          | PK part   | Column      | —         | —                | —                    |
| `activity_curation`        | Column    | (via epoch) | Column    | —                | —                    |
| `epoch_allocations`        | Column    | (via epoch) | Column    | Column (planned) | —                    |
| `payout_statements`        | Column    | (via epoch) | —         | —                | —                    |
| `source_cursors`           | PK part   | PK part     | —         | —                | —                    |
| `actors`                   | —         | —           | FK (user) | PK               | FK (tenant)          |
| `budget_allocations`       | —         | —           | —         | FK               | —                    |
| `actor_bindings`           | —         | —           | —         | FK               | —                    |
| `billing_accounts`         | —         | —           | FK        | —                | PK                   |
| `credit_ledger`            | —         | —           | —         | —                | FK                   |
| `charge_receipts`          | —         | —           | —         | Column (planned) | FK                   |
| `ai_threads`               | —         | —           | FK        | —                | FK                   |
| Runtime: `tenantId`        | —         | —           | —         | —                | = billing_account_id |
| Runtime: `GraphRunContext` | Available | Available   | Available | Available        | Available            |

### Composite Keys

| Invariant           | Composite Key                                       | Spec Reference        |
| ------------------- | --------------------------------------------------- | --------------------- |
| ONE_OPEN_EPOCH      | `(node_id, scope_id, status) WHERE status='open'`   | attribution-ledger.md |
| EPOCH_WINDOW_UNIQUE | `(node_id, scope_id, period_start, period_end)`     | attribution-ledger.md |
| ACTIVITY_IDEMPOTENT | `(node_id, id)` on activity_events                  | attribution-ledger.md |
| CURSOR_PK           | `(node_id, scope_id, source, stream, source_scope)` | attribution-ledger.md |

## Invariants

### Prohibited Overloading

These are hard constraints. Violating any of them is a design error.

| Key                  | Must Never Be Used For                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `node_id`            | Governance domain, epoch scoping, project identity, DAO ownership. It is infrastructure only.                    |
| `scope_id`           | Deployment identity, infra routing, DB tenancy. It is governance only.                                           |
| `user_id`            | Replaced by `wallet_address`, Discord snowflake, GitHub numeric ID, or DID. Those are bindings.                  |
| `billing_account_id` | Governance scoping, contribution attribution, deployment identity. It is payment tenancy only.                   |
| `actor_id`           | Auth/login identity, payment tenancy, governance voting rights, wallet address. It is economic attribution only. |
| `dao_address`        | Database primary key, tenant scoping, deployment routing. It is an on-chain attribute only.                      |

**Synonym prohibition:** Do not introduce `org_id`, `account_id`, `tenant_id` (DB column), `project_id` (DB column), or `contributor_id` as new terms. The six keys above are the complete set. External provider IDs (e.g., WalletConnect project ID, Terraform workspace ID) must be namespaced (e.g., `walletconnect_project_id`) to avoid collision with `scope_id`.

## V0 Defaults

In V0 (single-project nodes), most keys resolve to a single value:

| Key         | V0 Value                                                       | Multi-Project Behavior           |
| ----------- | -------------------------------------------------------------- | -------------------------------- |
| `node_id`   | From `.cogni/repo-spec.yaml`                                   | Unchanged — one per deployment   |
| `scope_id`  | `uuidv5(node_id, 'default')` — deterministic UUID in repo-spec | One per `.cogni/projects/*.yaml` |
| `scope_key` | `'default'`                                                    | Human slug per project manifest  |

`scope_id` is a deterministic UUID derived from `uuidv5(node_id, scope_key)`. The UUID is declared in `repo-spec.yaml` (V0) or `.cogni/projects/*.yaml` (multi-scope). `scope_key` is the human-readable slug used for display, logging, and as the derivation input.

## Goal

Provide a single, unambiguous reference for every identity primitive in the system. Eliminate confusion between deployment identity, governance domain, person identity, and payment tenancy. Prevent key overloading that leads to painful retrofits.

## Non-Goals

- DID/VC portability (see [User Identity spec](./decentralized-user-identity.md#did-readiness-p2))
- Federation identity protocol (P2+)
- Smart contract registry design
- UI for identity management

## Related

- [Node vs Operator Contract](./node-operator-contract.md) — Node/Operator boundaries, scope_id in definitions
- [Attribution Ledger](./attribution-ledger.md) — Ledger scoping by (node_id, scope_id)
- [User Identity + Account Bindings](./decentralized-user-identity.md) — user_id, bindings, identity_events
- [Accounts Design](./accounts-design.md) — billing_account_id, credit ledger
- [DAO Enforcement](./dao-enforcement.md) — dao_address, repo-spec authority, payment rails
- [RBAC](./rbac.md) — Actor/subject model references user_id and tenantId
- [ROADMAP.md §Tenant Scoping](../../ROADMAP.md#terminology--id-mapping) — Terminology table
