---
id: knowledge-domain-registry-spec
type: spec
title: "Knowledge Domain Registry — FK Enforcement, HTTP API, and Phasing"
status: draft
spec_state: draft
trust: draft
summary: "Makes ENTRY_HAS_DOMAIN a real gate. Every write to `knowledge` (HTTP contributions and `core__knowledge_write`) verifies `domain` exists in `domains` before INSERT; unregistered domains return 400. Cookie-session HTTP + UI for registering domains preserves NODES_BOOT_EMPTY (no migrator seeding). Phased: Phase 1 single-node (operator manages knowledge_operator), Phase 2 registry-node hosts UIs for headless nodes."
read_when: Implementing or reviewing the domain registry, debugging a `DomainNotRegisteredError`, designing a future registry node, or extracting `/knowledge` UI into a shared package.
implements:
owner: derekg1729
created: 2026-05-10
verified:
tags: [knowledge, dolt, domain, registry, fk, syntropy]
---

# Knowledge Domain Registry — FK Enforcement, HTTP API, and Phasing

> Without the registry, `domain` is free text and the knowledge plane silently accumulates entropy. With the registry, every claim is anchored to a registered category.

### Key References

|                    |                                                                             |                                                          |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Schema**         | [knowledge-syntropy](./knowledge-syntropy.md) § Seed Schema                 | `domains` table columns                                  |
| **Infrastructure** | [knowledge-data-plane](./knowledge-data-plane.md)                           | Doltgres server, per-node DBs, `KnowledgeStorePort`      |
| **Cookie-Session** | [knowledge-syntropy](./knowledge-syntropy.md) § Invariants                  | `KNOWLEDGE_BROWSE_VIA_HTTP_REQUIRES_SESSION` (inherited) |
| **UI Reference**   | PR #1308 (`task.5037`)                                                      | `/knowledge` Browse ⇄ Inbox toggle, DataGrid, Sheet      |
| **Future Hosting** | [knowledge-syntropy](./knowledge-syntropy.md) § Critical Path § Rd-PORTABLE | UI extraction into `@cogni/...-knowledge-ui` package     |

---

## Goal

Close the gap where `ENTRY_HAS_DOMAIN` was declared as an invariant but not enforced. Make `domain` a foreign key in spirit — every write to `knowledge` verifies the domain is registered, or fails with `DomainNotRegisteredError`. Provide a UI to register domains so production seeds itself without touching the migrator (preserves `NODES_BOOT_EMPTY`).

---

## Design

### Enforcement Contract

```
INSERT INTO knowledge (..., domain, ...) VALUES (..., $d, ...)
        │
        ▼
  assertDomainRegistered(client, $d)
        │
        ├─ SELECT 1 FROM domains WHERE id = $d LIMIT 1
        │      │
        │      ├─ 0 rows → throw DomainNotRegisteredError
        │      └─ 1 row  → continue
        ▼
  INSERT proceeds
```

Both write paths share one helper. The check lives **in the Doltgres adapters**, not in the capability layer:

| Path                                        | Where the check fires                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `core__knowledge_write` tool                | `DoltgresKnowledgeStoreAdapter.{add,upsert}Knowledge` calls helper            |
| HTTP `POST /api/v1/knowledge/contributions` | `DoltgresKnowledgeContributionAdapter.create` calls helper before INSERT loop |

**Why adapter-level, not capability-level:** the contribution path runs on a per-PR Doltgres branch (different client than `main`); the helper takes the caller's `client` so it queries the same DB state the INSERT will hit. The capability layer (`createKnowledgeCapability`) stays a thin auto-commit wrapper, unmodified.

**Why one helper, not two parallel checks:** the two adapters live in two ports (`KnowledgeStorePort`, `KnowledgeContributionPort`) that don't share inheritance. A shared helper in `packages/knowledge-store/src/adapters/doltgres/util.ts` keeps DRY without coupling the ports.

**SQL safety:** Doltgres requires `sql.unsafe()` + `escapeValue()` (postgres.js extended protocol is broken on Doltgres). The helper must escape `domain` before interpolation. No exceptions.

### Error mapping

| Error class                | HTTP status | Response body                               |
| -------------------------- | ----------- | ------------------------------------------- |
| `DomainNotRegisteredError` | 400         | `{ error: "domain '<id>' not registered" }` |

The `DomainNotRegisteredError` class lives in `packages/knowledge-store/src/domain/schemas.ts` alongside existing port error types. Route handlers (`_handlers.ts`) map it to 400 in their existing typed-error switch.

---

### HTTP API

```
GET  /api/v1/knowledge/domains       cookie-only  →  200 { domains: Domain[] }
POST /api/v1/knowledge/domains       cookie-only  →  201 | 409 | 400
```

### `GET /api/v1/knowledge/domains`

Returns all registered domains with `entry_count`. **Single SQL query** (no N+1):

```sql
SELECT d.id, d.name, d.description, d.created_at, COUNT(k.id) AS entry_count
FROM domains d
LEFT JOIN knowledge k ON k.domain = d.id
GROUP BY d.id, d.name, d.description, d.created_at
ORDER BY d.id;
```

Response shape (Zod contract `packages/node-contracts/src/knowledge.domains.v1.contract.ts`):

```typescript
{
  domains: Array<{
    id: string;
    name: string;
    description: string | null;
    entryCount: number;
    createdAt: string; // ISO timestamp
  }>;
}
```

### `POST /api/v1/knowledge/domains`

Body: `{ id, name, description? }`.

| Outcome                           | Status | Behavior                                                                |
| --------------------------------- | ------ | ----------------------------------------------------------------------- |
| Valid + new id                    | 201    | INSERT + `dolt_commit('-Am', 'register domain <id>')`. Returns the row. |
| Duplicate id                      | 409    | `{ error: "domain '<id>' already registered" }`. No commit.             |
| Invalid input (Zod)               | 400    | Standard contract-validation 400.                                       |
| Not signed in (no session cookie) | 401    | Standard auth 401.                                                      |

DELETE / PUT endpoints are **out of scope** in v0 (per `DEPRECATE_NOT_DELETE` spirit). Domain registration is sticky.

### Auth

Cookie-session only. Bearer / x402 access deferred (same posture as the contributions browse endpoint per `KNOWLEDGE_BROWSE_VIA_HTTP_REQUIRES_SESSION`). Bearer-token agents can **read** via the contracted port methods but cannot register domains.

---

### Port Surface

```typescript
interface KnowledgeStorePort {
  // ... existing methods unchanged

  // NEW
  domainExists(id: string): Promise<boolean>;
  listDomainsFull(): Promise<Domain[]>; // GET endpoint
  registerDomain(input: NewDomain): Promise<Domain>; // POST endpoint
}
```

`listDomains(): Promise<string[]>` (existing) stays for backwards compatibility — it returns DISTINCT domain values from the `knowledge` table, which can drift from `listDomainsFull()`. New callers should prefer `listDomainsFull()`.

`domainExists` and `registerDomain` are convenience wrappers over the shared helper plus an INSERT.

---

### UI Lifecycle (Phase 1, operator-only)

Operator's `/knowledge` page extends the segmented toggle:

```
Before:  [ Browse ] [ Inbox ]
After:   [ Browse ] [ Domains ] [ Inbox ]
```

Domains mode reuses the existing `DataGrid` + Sheet pattern from #1308:

| Element            | Purpose                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `DataGrid` columns | `id` (mono) · `name` · `description` · `entry_count` · `created_at` |
| Header button      | `+ Add domain` opens a Sheet                                        |
| Add Sheet form     | 3 fields: `id`, `name`, `description?`                              |
| On submit          | POST + invalidate React Query key `["knowledge", "domains"]`        |
| On 409             | Inline error in Sheet (`already registered`)                        |

No edit, no delete, no row-detail Sheet in v0. The grid is read + register only.

---

### Seeding (preserves `NODES_BOOT_EMPTY`)

The migrator does **not** seed the `domains` table. Production candidate-a starts with 0 rows. The operator (Derek) registers the starter domains via UI clicks on first visit:

| id                   | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `meta`               | Knowledge about the knowledge system itself         |
| `prediction-market`  | Polymarket and adjacent prediction-market knowledge |
| `infrastructure`     | Runtime, deploy, observability                      |
| `governance`         | DAO formation, attribution, voting                  |
| `reservations`       | Restaurant / venue knowledge for resy               |
| `validate_candidate` | Reserved for `/validate-candidate` smoke writes     |

The local-dev seed script (`scripts/db/seed-doltgres.mts`) MAY include `validate_candidate` in `BASE_DOMAIN_SEEDS` so dev environments don't 400 on smoke writes. Production gets nothing from the migrator.

---

### Phasing

#### Phase 1 — Operator-Only Registry (THIS spec; task.5038)

```
┌──────────────────────────────────────────────────┐
│  Operator Next.js app  (already hosts /knowledge) │
│                                                   │
│   ┌───────────────────────────────────────────┐   │
│   │  /knowledge   [Browse] [Domains*] [Inbox] │   │
│   │                          │                 │   │
│   │              + Add domain ▼                 │   │
│   │                                             │   │
│   └───────────────────────────────────────────┘   │
│                       │                            │
│                       ▼                            │
│      POST /api/v1/knowledge/domains                │
│                       │                            │
│                       ▼                            │
│            knowledge_operator.domains               │
└──────────────────────────────────────────────────┘

Server-side FK gate (the locking move):
┌──────────────────────────────────────────────────┐
│   Any write to knowledge_operator                  │
│       ├── HTTP /knowledge/contributions             │
│       └── core__knowledge_write tool                │
│                       │                              │
│                       ▼                              │
│        domain ∈ domains?                            │
│            ├─ yes → INSERT proceeds                  │
│            └─ no  → 400 DomainNotRegisteredError    │
└──────────────────────────────────────────────────┘
```

**Scope:**

- Backend (node-agnostic): port methods, adapter helper, contract, error class — all in `packages/`.
- HTTP + UI (operator-bound): three new endpoints + 3-mode toggle in the existing `/knowledge` page.
- Migrator unchanged. Seeds are UI-driven.

**Not in Phase 1:** UI extraction, multi-node hosting, registry-node app shell.

#### Phase 2 — Registry Node (FUTURE, file when a 2nd node needs `/knowledge`)

```
┌──────────────────────────────────────────────────────────────┐
│  Registry node Next.js app  (NEW; vFuture)                     │
│                                                                 │
│   /registry/<node-id>/knowledge                                │
│                  │                                              │
│                  ▼                                              │
│   Mounts @cogni/...-knowledge-ui shared package                │
│   (extracted via Rd-PORTABLE work item)                        │
│                  │                                              │
│       ┌──────────┼──────────┬─────────────┐                    │
│       ▼          ▼          ▼             ▼                    │
│  knowledge_   knowledge_  knowledge_   knowledge_              │
│  operator     poly        resy         <headless>              │
│                                                                 │
│  Empowers headless nodes (knowledge + agents only,             │
│  no own Next.js app) to participate in the system.             │
└──────────────────────────────────────────────────────────────┘
```

**What Phase 2 inherits unchanged from Phase 1:**

- `KnowledgeStorePort` methods (`domainExists`, `listDomainsFull`, `registerDomain`)
- `assertDomainRegistered` helper
- `DomainNotRegisteredError` class
- `knowledge.domains.v1.contract.ts` Zod contract
- Auto-commit semantics

**What Phase 2 adds (NOT in this PR):**

- Per-node URL routing (`/registry/<node-id>/knowledge`)
- Per-node Doltgres client factory (parameterize `DOLTGRES_URL_<NODE>` at request time)
- UI extraction (depends on `Rd-PORTABLE`)
- Cross-node session/auth scope (which nodes can a session manage?)

Phase 1 must therefore avoid hard-coding `knowledge_operator` anywhere in `packages/` — the existing per-node client factory pattern (`buildDoltgresClient(url)`) already satisfies this.

---

## Invariants

| Rule                            | Constraint                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOMAIN_FK_ENFORCED_AT_WRITE`   | Every write to `knowledge` verifies `domain` exists in `domains` before INSERT. Unregistered → `DomainNotRegisteredError` → HTTP 400.                            |
| `DOMAIN_REGISTRY_VIA_UI`        | New domains are registered via cookie-session POST. Migrator never seeds `domains` in production. Even base domains are registered via UI clicks on first visit. |
| `DOMAIN_CHECK_AT_ADAPTER_LAYER` | The check lives in the Doltgres adapters (not in `createKnowledgeCapability`), so it shares the caller's client and works on per-PR contribution branches.       |
| `DOMAIN_REGISTRATION_IS_STICKY` | No DELETE / PUT endpoints in v0. Domain rows are append-only. (Inherits `DEPRECATE_NOT_DELETE` spirit.)                                                          |
| `DOMAIN_HTTP_COOKIE_ONLY`       | GET + POST `/api/v1/knowledge/domains` reject Bearer / x402. Inherits `KNOWLEDGE_BROWSE_VIA_HTTP_REQUIRES_SESSION`.                                              |
| `DOMAIN_LIST_SINGLE_QUERY`      | `listDomainsFull()` returns rows + `entry_count` in one SQL query (`LEFT JOIN knowledge … GROUP BY`). No N+1.                                                    |
| `DOMAIN_HELPER_SQL_SAFE`        | The shared helper escapes its `domain` argument via `escapeValue()` (Doltgres requires `sql.unsafe`).                                                            |
| `DOMAIN_REGISTER_AUTOCOMMITS`   | `registerDomain()` issues `dolt_commit('-Am', 'register domain <id>')` after INSERT. (Inherits `AUTO_COMMIT_ON_WRITE`.)                                          |

---

## Non-Goals

- Multi-node UI hosting (Phase 2 / registry node)
- DELETE / PUT domain endpoints
- Per-domain RBAC (`domain_grants` table is vFuture)
- `entry_types` registry (P1 EDO work; architecturally similar but ships serially)
- Bearer / x402 access to `/api/v1/knowledge/domains`
- UI extraction into a shared package (`Rd-PORTABLE`; filed when a 2nd node needs `/knowledge`)

---

## File Pointers

| File                                                                                         | Purpose                                                         |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/knowledge-store/src/port/knowledge-store.port.ts`                                  | `domainExists`, `listDomainsFull`, `registerDomain` on the port |
| `packages/knowledge-store/src/domain/schemas.ts`                                             | `Domain`, `NewDomain`, `DomainNotRegisteredError`               |
| `packages/knowledge-store/src/adapters/doltgres/util.ts`                                     | `assertDomainRegistered(client, domain)` helper                 |
| `packages/knowledge-store/src/adapters/doltgres/index.ts`                                    | Adapter calls helper before write                               |
| `packages/knowledge-store/src/adapters/doltgres/contribution-adapter.ts`                     | Adapter calls helper before INSERT loop                         |
| `packages/node-contracts/src/knowledge.domains.v1.contract.ts`                               | Zod contract for GET/POST                                       |
| `nodes/operator/app/src/app/api/v1/knowledge/domains/route.ts`                               | Route wrapper                                                   |
| `nodes/operator/app/src/app/api/v1/knowledge/domains/_handlers.ts`                           | `handleList`, `handleCreate` — error mapping                    |
| `nodes/operator/app/src/app/(app)/knowledge/view.tsx`                                        | 3-mode toggle (Browse · Domains · Inbox)                        |
| `nodes/operator/app/src/app/(app)/knowledge/_api/{fetch,create}Domain.ts`                    | Client-side fetchers                                            |
| `nodes/operator/app/src/app/(app)/knowledge/_components/{domain-columns,AddDomainSheet}.tsx` | UI components                                                   |

## Related

- [knowledge-syntropy](./knowledge-syntropy.md) — protocol, Critical Path § P0.5
- [knowledge-data-plane](./knowledge-data-plane.md) — `KnowledgeStorePort`, Doltgres infra
- task.5038 — Phase 1 implementation
- `Rd-PORTABLE` (in syntropy) — UI extraction precondition for Phase 2
