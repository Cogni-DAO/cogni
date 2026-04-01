---
id: spec.multi-node-tenancy
type: spec
title: "Multi-Node Tenancy: Auth, Data Isolation, and Metering"
status: active
spec_state: proposed
trust: draft
summary: "Defines trust boundaries for multi-node deployments: shared identity with per-node sessions, DB-per-node isolation, node-local metering as authoritative source, and read-only inter-node communication."
read_when: Working on auth across nodes, per-node database provisioning, billing/metering aggregation, or inter-node API contracts.
implements: []
owner: derekg1729
created: 2026-04-01
verified: 2026-04-01
tags: [multi-node, auth, tenancy, data-isolation, metering]
---

# Multi-Node Tenancy: Auth, Data Isolation, and Metering

## Goal

Define trust boundaries for multi-node deployments across three concerns: authentication, data isolation, and metering/billing.

## Design

> [!CRITICAL]
> Shared identity, isolated sessions. DB-per-node, not tenancy columns. Node-local metering is authoritative; operator aggregation is derived.

## Context

Cogni runs multiple sovereign nodes (operator, poly, resy) on shared infrastructure. Each node is a full-platform Next.js app with its own domain, its own database, and its own billing. The operator provides shared identity and optional aggregation services.

### Current state (V0 — dev only)

- Single Postgres database `cogni_template_dev` shared by all nodes
- Single `AUTH_SECRET` shared across all apps
- 4 identical `auth.ts` files (operator, poly, resy, node-template)
- Cookie sharing on `localhost` across ports (:3000, :3100, :3300)
- Single LiteLLM proxy with one callback endpoint

### Key references

| Spec | Relevance |
| --- | --- |
| [Database RLS](./database-rls.md) | RLS policy mechanics — applies within each node's DB |
| [Identity Model](./identity-model.md) | Identity primitive taxonomy — `user_id` is portable cross-node |
| [Node Operator Contract](./node-operator-contract.md) | DATA_SOVEREIGNTY, NO_CROSS_IMPORTS, WALLET_CUSTODY |
| [Node Launch](./node-launch.md) | `provisionDatabase` step in node creation workflow |
| [System Tenant](./system-tenant.md) | `cogni_system` account lives in operator's DB |
| [Billing Ingest](./billing-ingest.md) | LiteLLM callback pipeline — per-node routing = task.0256 |

---

## Non-Goals

- Runtime plugin system (nodes are separate Next.js apps, not dynamically loaded modules)
- Per-node Postgres servers (V1 uses per-node databases on a shared server)
- Federation protocol design (V3 concern, not this spec)
- Operator repo extraction (ROADMAP Phase 6, gated on paying customer)

## Invariants

All invariants are detailed in their respective sections below. Summary:

| Invariant | Section |
| --- | --- |
| SHARED_IDENTITY_ISOLATED_SESSIONS | Auth Model |
| ORIGIN_SCOPED_COOKIES | Auth Model |
| SSO_THEN_LOCAL_SESSION | Auth Model |
| DB_PER_NODE | Data Isolation |
| DB_IS_BOUNDARY | Data Isolation |
| NODE_LOCAL_METERING_PRIMARY | Data Isolation |
| NO_CROSS_NODE_QUERIES | Data Isolation |
| OPERATOR_AGGREGATES_ARE_DERIVED | Data Isolation |
| NO_CROSS_IMPORTS | Inter-Node Communication |
| NODE_TO_OPERATOR_READ_ONLY | Inter-Node Communication |
| OPERATOR_READS_NODE_VIA_VCS | Inter-Node Communication |

---

## Auth Model

### Auth invariants

| Invariant | Rule |
| --- | --- |
| SHARED_IDENTITY_ISOLATED_SESSIONS | One identity provider (operator), per-node app sessions. A user signs in once via the operator IdP; each node mints and verifies its own local session. |
| ORIGIN_SCOPED_COOKIES | No parent-domain (`.cognidao.org`) session cookie. Each node's session cookie is scoped to its own origin (`poly.cognidao.org`, `resy.cognidao.org`). OWASP: parent-domain cookies expose all subdomains to cross-subdomain session risk. |
| SSO_THEN_LOCAL_SESSION | After IdP verification, the node creates a local JWT/session. The node never trusts a cookie from another origin. |

### Architecture: three realms

**Operator realm** — shared identity provider, shared `user_bindings` database, user account management. The operator is the IdP.

**Node realm** — local authorization, local RLS, local metering. Each node mints its own session after the operator IdP confirms identity. The node's session cookie is origin-scoped and never shared.

**Federation realm** (future) — sovereign nodes can trust the same IdP, a different IdP, or none at all. Trust relationships between nodes are explicit contracts, not shared sessions. Session model does not collapse when a node forks.

### As-built gap analysis

| Aspect | Current (V0) | Target (V1) |
| --- | --- | --- |
| Auth config | 4 identical `auth.ts` files doing full NextAuth per-node | Operator = IdP, nodes = SSO relying parties |
| Session sharing | Implicit via `localhost` cookie sharing | Per-node origin-scoped cookies, no cross-node session |
| AUTH_SECRET | Single shared secret | Per-node secrets; operator IdP has its own |
| SIWE verification | Domain-bound to `NEXTAUTH_URL.host` | Verify against domain in signed SIWE message |
| OAuth callbacks | Per-port in dev (`localhost:3100/api/auth/callback`) | Per-domain registration with providers |

### Production multi-domain requirements

- **SIWE:** Verify against the domain field in the signed SIWE message itself, not a hardcoded `NEXTAUTH_URL.host`. Each node signs for its own domain.
- **OAuth:** Per-node callback URLs registered with providers (GitHub, Discord, Google). Alternative: redirect proxy on operator that dispatches to correct node.
- **Cookies:** Origin-scoped per node. `poly.cognidao.org` cookie is never sent to `resy.cognidao.org`. No `Domain=.cognidao.org` attribute.

---

## Data Isolation Model

### Data invariants

| Invariant | Rule |
| --- | --- |
| DB_PER_NODE | 1 Postgres server, 1 database per node. Each node has its own database, its own migrations, its own schema version. |
| DB_IS_BOUNDARY | The database itself is the node boundary. No `node_id` columns needed in node-local tables — the DB already scopes to this node. User/account-scoped RLS within the node is still legitimate and expected. |
| NODE_LOCAL_METERING_PRIMARY | Each node's local billing/metering data is authoritative. Operator aggregation is derived, never the source of truth. If operator aggregate diverges from node-local, **node-local wins**. |
| NO_CROSS_NODE_QUERIES | Nodes never query each other's database. The operator never queries a node's database directly. |
| OPERATOR_AGGREGATES_ARE_DERIVED | Cross-node views are read-only projections from node-local data, not independent records. They may lag, they may be incomplete, they are never primary. |

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Shared Postgres Server (1 instance, cost-efficient) │
│                                                       │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ operator_db  │  │  poly_db   │  │  resy_db     │ │
│  │              │  │            │  │              │ │
│  │ - users      │  │ - users    │  │ - users      │ │
│  │ - billing    │  │ - billing  │  │ - billing    │ │
│  │ - ai_threads │  │ - ai_...   │  │ - ai_...     │ │
│  │ - aggregation│  │            │  │              │ │
│  │   (derived)  │  │            │  │              │ │
│  └──────────────┘  └────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────┘
```

- **Node-scoped DB, user/account-scoped RLS within that DB.** Multiple users and billing accounts exist per node. RLS (per [Database RLS spec](./database-rls.md)) isolates them from each other within the node's database.
- **Operator DB** contains operator-specific tables (node registry, derived aggregation views, system tenant account). It does not contain copies of node data.

### As-built gap analysis

| Aspect | Current (V0) | Target (V1) |
| --- | --- | --- |
| Database | Single `cogni_template_dev` shared by all nodes | Per-node database (`operator_db`, `poly_db`, `resy_db`) |
| `DATABASE_URL` | Same connection string for all nodes | Per-node env: each node's `DATABASE_URL` points to its own DB |
| Provisioning | Manual | `provisionDatabase` step in [node-launch](./node-launch.md) workflow creates DB + user + runs migrations |
| Schema | Single shared schema | Per-node schema, versioned independently (same base, diverges over time) |

### Operator aggregation plane

The operator needs cross-node cost visibility for gateway metering (proj.operator-plane v0). This is an **aggregation plane**, not a primary data store.

**Principles:**
- The aggregation plane is **derived** (NODE_LOCAL_METERING_PRIMARY)
- Data flows **from** node DBs **to** operator aggregation, never the reverse
- Populated by:
  - LiteLLM callback routing that identifies source node (task.0256)
  - Periodic sync/ETL from node DBs (future, respects DATA_SOVEREIGNTY)
- **NOT** by adding `node_id` columns to every node's `charge_receipts`
- Aggregate records **must** retain a source receipt ref (`source_node_id` + `source_receipt_id` or `source_litellm_call_id`) back to the node-local record, enabling reconciliation

---

## Inter-Node Communication

### Communication invariants

| Invariant | Rule |
| --- | --- |
| NO_CROSS_IMPORTS | Compile-time: no import paths between `nodes/poly/**` and `nodes/resy/**`, or between `nodes/**` and `apps/**`/`services/**`. Enforced by dep-cruiser. |
| NODE_TO_OPERATOR_READ_ONLY | Node → Operator runtime calls are **read-only by default**. Any write operation requires an explicit, versioned API contract. No implicit state sync, no fire-and-forget writes, no silent coupling creep. |
| OPERATOR_READS_NODE_VIA_VCS | Operator → Node only via VCS API (read repo-spec, read manifests). Never direct DB access. Never wallet access. |

### Patterns

- **AI representatives:** Each node's graphs can call operator read-only API endpoints (e.g., query work items, read node registry). Write operations (e.g., dispatch work) require explicit contracts.
- **Operator → Node:** Read repo-spec and project manifests via VCS API. Never read node DB. Never access node wallet.
- **Node → Node:** No direct communication. If poly needs resy data, it goes through operator as intermediary (future federation pattern).

---

## Migration Path

| Phase | What changes | Gate |
| --- | --- | --- |
| **V0** (current) | Shared DB, shared auth. Works for dev, not production. | — |
| **V1** (this spec) | Per-node DB provisioning. SSO with per-node origin-scoped sessions. | Multi-node CICD proven (task.0247) |
| **V2** | Operator aggregation plane for cross-node metering. Derived, not primary. | Paying gateway customer (proj.operator-plane v0) |
| **V3** | Federation. Sovereign nodes trust external IdPs. Inter-node contracts formalized. | Multiple independent node operators |
