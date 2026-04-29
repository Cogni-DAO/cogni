---
id: task.0428
type: task
title: "Doltgres work-item create/read/patch API — new items only (v0)"
status: done
priority: 0
rank: 5
estimate: 3
summary: "Stand up `knowledge_operator` Doltgres + a single `work_items` table with a `node` column, and expose Create/Read/Patch over `/api/v1/work/items/*` behind operator API-key auth. NEW work items go through the API; existing markdown files in `work/items/*.md` remain as-is (devs/agents read them in repo). No importer, no facade swap, no transition state-machine, no relations/external-refs tables — those land in v1."
outcome: "An external agent (registered via `/contribute-to-cogni`) can POST a new work item, GET it back, PATCH it, and GET again — all via curl with their API key. `_index.md` merge conflicts on parallel main-trunk PRs end for any new item created via the API."
spec_refs: [knowledge-data-plane-spec, work-items-port, development-lifecycle]
assignees: []
credit:
project: proj.agentic-project-management
branch: feat/task.0428-doltgres-work-items-source-of-truth
pr:
reviewer:
revision: 2
blocked_by:
deploy_verified: true
created: 2026-04-28
updated: 2026-04-28
labels: [work-system, agents, doltgres, operator, api]
external_refs:
---

# Doltgres work-item create/read/patch API — new items only (v0)

## Requirements

- New Doltgres database `knowledge_operator` provisioned on the shared Doltgres server (`DOLTGRES_PER_NODE_DATABASE` invariant).
- New package `nodes/operator/packages/doltgres-schema/` with **one** drizzle table: `work_items` (relations + external-refs deferred to v1). Schema applied by the operator's drizzle-kit migrator as a k8s PreSync Job (`SCHEMA_VIA_DRIZZLE_PRESYNC`); `stamp-commit.mjs` captures DDL in `dolt_log`.
- New **operator-local** Doltgres adapter at `nodes/operator/app/src/adapters/server/db/doltgres/work-items-adapter.ts` implementing `WorkItemQueryPort` + a minimal `WorkItemCommandPort` slice (`create`, `patch` only). Auto-commits on every write (`AUTO_COMMIT_ON_WRITE`).
- `WorkItem.node: string` (NOT NULL, default `"shared"`); `WorkQuery.node?: string | string[]`. Add to `@cogni/work-items` types/ports — additive, no markdown-adapter behavior change required (markdown items continue to be read-from-disk by other tooling; this v0 doesn't read markdown through any adapter).
- Operator HTTP routes use the existing `getSessionUser` resolver (Bearer-first, session-cookie fallback — `nodes/operator/app/src/app/_lib/auth/session.ts`). Registered agents pass their `apiKey` as `Authorization: Bearer <key>`; browser users hit the same routes via session cookie. No new middleware:
  - `POST /api/v1/work/items` — create (server-allocated ID, returns full row)
  - `GET /api/v1/work/items` — list with `node`, `types`, `statuses`, `limit` filters
  - `GET /api/v1/work/items/:id` — fetch one
  - `PATCH /api/v1/work/items/:id` — open-shape patch on whitelisted fields (`title`, `summary`, `outcome`, `status`, `priority`, `rank`, `estimate`, `labels`, `branch`, `pr`, `reviewer`, `node`). No `expectedRevision`, no transition state-machine — whoever holds a valid token is trusted. v1 hardens this.
- All HTTP shapes defined in `packages/node-contracts/src/work/*.contract.ts` with Zod (`CONTRACTS_ARE_TRUTH`).
- **ID allocation reserves the `5000+` range for Doltgres-allocated IDs.** `create` selects `MAX(numeric_suffix)` per type from `work_items`, takes `max(found, 4999) + 1`. Existing markdown items occupy `0001–0499X`; Doltgres-allocated IDs start at `task.5000` / `bug.5000` / etc. and never collide with the legacy markdown range. Concurrent `create` calls run inside a transaction so the `MAX → INSERT` is atomic per type.
- **Author attribution in `dolt_log`.** The adapter `create` and `patch` accept an `author: { kind: "user" | "agent"; id: string; name?: string }` derived from `getSessionUser` in the route handler. Auto-commit messages embed the author: `dolt_commit('-Am', '<intent> <id> by <kind>:<name|id>')`. Multi-agent contributing leaves a clean audit trail in `dolt_log`.
- **Connection URL.** Adapter reads `DOLTGRES_URL_OPERATOR` (parallel to existing `DOLTGRES_URL_POLY`). `scripts/ci/deploy-infra.sh` derives it from `POSTGRES_ROOT_PASSWORD` and writes it to candidate/preview/prod k8s secrets — same pattern poly uses (`RUNTIME_URL_IS_SUPERUSER`).

## Out of scope (v1+)

- One-shot markdown importer (existing items remain readable as `.md` in repo)
- Operator dashboard rewire to the new endpoint (still reads markdown facade; keeps showing existing items, won't show Doltgres-only items until v1)
- `WorkItemCommandPort` full surface (`transitionStatus`, `setAssignees`, `upsertRelation`, `upsertExternalRef`, `claim`/`release`)
- `work_relations` + `work_external_refs` tables
- `expectedRevision` optimistic concurrency on PATCH
- Status transition validation (`isValidTransition`) on a dedicated `/transition` endpoint
- Per-project node taxonomy (heuristic mapping from project → `node` column)
- Markdown deprecation / facade swap / dashboard wiring
- Cross-node propagation (other nodes still write items as `.md`)
- Obsidian-compatible export from Doltgres
- MCP server

## Allowed Changes

- `nodes/operator/packages/doltgres-schema/` (NEW) — `work_items` drizzle schema + `stamp-commit.mjs`
- `nodes/operator/drizzle.doltgres.config.ts` (NEW)
- `nodes/operator/app/src/adapters/server/db/doltgres-migrations/` (NEW) — checked-in drizzle-kit output
- `infra/k8s/base/operator-doltgres/` (NEW) — PreSync Job manifest (mirrors poly's)
- `infra/compose/runtime/doltgres-init/provision.sh` — append `knowledge_operator` to the database list
- `nodes/operator/app/src/adapters/server/db/doltgres/work-items-adapter.ts` (NEW) — operator-local adapter (Query + create/patch)
- `nodes/operator/app/src/bootstrap/container.ts` — wire the adapter
- `packages/work-items/src/types.ts` — add `node: string` to `WorkItem`
- `packages/work-items/src/ports.ts` — add `node?: string | string[]` to `WorkQuery`
- `packages/node-contracts/src/work/items.{list,get,create,patch}.contract.ts` — extend list contract with `node`; create the three new contracts
- `nodes/operator/app/src/app/api/v1/work/items/route.ts` — add POST; thread `node` filter on GET
- `nodes/operator/app/src/app/api/v1/work/items/[id]/route.ts` — add PATCH
- `scripts/ci/deploy-infra.sh` — derive `DOLTGRES_URL_OPERATOR` from `POSTGRES_ROOT_PASSWORD`, write into candidate/preview/prod k8s secrets
- `docs/spec/work-items-port.md` — note the `node` field, the `5000+` ID range reservation, and operator-local Doltgres adapter as v0 surface
- `work/items/_index.md` — title/estimate update
- `work/projects/proj.agentic-project-management.md` — adjust P3 row

**Deployment impact:** `candidate-flight-infra` is required for this PR — new k8s manifest + new env-var secret + new database in `provision.sh`.

### v0 leaves `_index.md` stale by design

`work:index` regenerates `_index.md` from `work/items/*.md`. New items created via the API live only in Doltgres and **will not appear in `_index.md`** until v1 ships either (a) a Doltgres → markdown export step in `work:index`, or (b) the dashboard rewire that makes the operator UI the canonical browse surface. This is intentional — Derek's stated goal is to get work items out of git so parallel main-trunk PRs stop conflicting on `_index.md`. Treat `_index.md` as "legacy markdown items only" for the duration of v0.

## Design

### Outcome

An external agent (registered via `/contribute-to-cogni`) can POST a new work item, GET it, PATCH it, and GET again — all over HTTPS with their API key. New work items stop colliding on `_index.md`. Existing markdown items continue to live in repo, untouched.

### Approach

**Solution:** Single `work_items` table in `knowledge_operator` Doltgres DB. **Operator-local** adapter (not a shared package) implements `WorkItemQueryPort` + a tiny `WorkItemCommandPort` slice (`create` + `patch`). Four routes under existing `/api/v1/work/items/*`, behind the same API-key middleware `/api/v1/vcs/flight` uses. No importer, no facade swap, no markdown adapter changes — markdown stays exactly as it is for old items.

**Reuses:**

- `@cogni/work-items` port + types (task.0155, done) — only adds the `node` field
- ID-allocation logic from `MarkdownWorkItemAdapter` (copy, don't import)
- `@cogni/knowledge-store/adapters/doltgres` `buildDoltgresClient()` — already imported in operator's `bootstrap/container.ts`, no new cross-package dep (adapter is operator-local)
- `nodes/poly/packages/doltgres-schema/` patterns for the schema package scaffold
- `infra/k8s/base/poly-doltgres/` PreSync Job manifest pattern
- Existing operator API-key auth middleware
- Existing `/api/v1/work/items` route handlers (extend in place)

**Rejected (v0):**

- **Adapter in `packages/work-items/`** — would pull `drizzle-orm` + `postgres` into a near-dependency-free shared package, and would require importing `@cogni/knowledge-store` from `@cogni/work-items` (layering violation). Operator-local first; promote when a 2nd consumer materializes.
- **Importer** — pain is _new_ items, not querying the existing 295. Devs/agents grep `work/items/*.md` for old content. Adds idempotency tests, project→node taxonomy, Job-step plumbing — none of it on the critical path to "first agent writes a new item."
- **Dashboard facade swap** — would force the importer or leave the dashboard empty. Defer; the dashboard fix is its own follow-up.
- **`WorkItemCommandPort.transitionStatus` + `/transition` endpoint** — open PATCH covers status updates for v0. State-machine validation lands in v1 alongside `expectedRevision`.
- **`work_relations` + `work_external_refs` tables** — nothing in v0 reads them.
- **`expectedRevision` optimistic concurrency** — single-writer assumption is reasonable while only one agent operates per item; concurrency lands when the dashboard rewires to multi-writer.
- **Mutating `docs/spec/knowledge-data-plane.md`** — that spec is for the knowledge plane. Work items colocate in the same Doltgres server but aren't knowledge. Document the colocation in `work-items-port.md` instead, with a link out.
- **Bake markdown into the operator image** — fastest dashboard fix but doesn't solve `_index.md` write conflicts; user explicitly chose Doltgres.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] DOLTGRES_PER_NODE_DATABASE: Work items live in `knowledge_operator`, not a shared cross-node DB or branch (spec: knowledge-data-plane-spec)
- [ ] AUTO_COMMIT_ON_WRITE: `create` and `patch` perform `dolt_commit('-Am', '<intent>')` before returning (spec: knowledge-data-plane-spec)
- [ ] SCHEMA_VIA_DRIZZLE_PRESYNC: Schema applied by operator drizzle-kit migrator as k8s PreSync Job; `provision.sh` only creates DB + roles (spec: knowledge-data-plane-spec)
- [ ] PORT_BEFORE_BACKEND: Routes consume `WorkItemQueryPort` + `WorkItemCommandPort.create/patch` from `@cogni/work-items`; no inline SQL (spec: work-items-port)
- [ ] CONTRACTS_ARE_TRUTH: All HTTP shapes in `packages/node-contracts/src/work/*.contract.ts` with Zod; routes use `z.infer` only (spec: architecture)
- [ ] NODE_NOT_NULL: `work_items.node` is `text NOT NULL` with default `"shared"` at the column level (spec: knowledge-data-plane-spec SCHEMA_GENERIC_CONTENT_SPECIFIC)
- [ ] AUTH_VIA_GETSESSIONUSER: All four routes use `wrapRouteHandlerWithLogging({ auth: { mode: "required", getSessionUser } })`; no new middleware. Both Bearer tokens (agents) and session cookies (browsers) are accepted by the existing resolver (spec: ai-pipeline-e2e)
- [ ] OPERATOR_LOCAL_ADAPTER_V0: Doltgres adapter lives at `nodes/operator/app/src/adapters/server/db/doltgres/`, NOT in `packages/work-items/`. Promote to a shared package only when a 2nd consumer appears (spec: packages-architecture)
- [ ] PATCH_ALLOWLIST: PATCH only mutates `title`, `summary`, `outcome`, `status`, `priority`, `rank`, `estimate`, `labels`, `branch`, `pr`, `reviewer`, `node`. ID, `created_at`, `updated_at` are server-managed (spec: work-items-port)
- [ ] ID_ALLOC_ATOMIC: `create` selects max numeric suffix per type within a transaction and allocates next; concurrent creates do not collide (spec: work-items-port)
- [ ] ID_RANGE_RESERVED: Doltgres-allocated IDs start at `5000` per type. The allocator computes `max(MAX(numeric_suffix in work_items), 4999) + 1`. Existing markdown items occupy `0001–04XX` and never collide (spec: work-items-port)
- [ ] AUTHOR_ATTRIBUTED: `create` and `patch` accept an `author` argument derived from `getSessionUser`. Auto-commit messages embed `<kind>:<name|id>` so `dolt_log` shows which agent or user made each write (spec: knowledge-data-plane-spec AUTO_COMMIT_ON_WRITE)

### Files

- Create: `nodes/operator/packages/doltgres-schema/src/work-items.ts` — `work_items` drizzle table
- Create: `nodes/operator/packages/doltgres-schema/src/index.ts` + `package.json` + `tsconfig.json` + `tsup.config.ts` + `stamp-commit.mjs` + `AGENTS.md` (mirror `nodes/poly/packages/doltgres-schema/`)
- Create: `nodes/operator/drizzle.doltgres.config.ts`
- Create: `nodes/operator/app/src/adapters/server/db/doltgres-migrations/0000_init.sql` (+ meta)
- Create: `infra/k8s/base/operator-doltgres/migrate-operator-doltgres.yaml`
- Modify: `infra/compose/runtime/doltgres-init/provision.sh` — append `knowledge_operator`
- Create: `nodes/operator/app/src/adapters/server/db/doltgres/work-items-adapter.ts` — operator-local adapter
- Modify: `nodes/operator/app/src/bootstrap/container.ts` — construct + register adapter
- Modify: `packages/work-items/src/types.ts` — add `node: string`
- Modify: `packages/work-items/src/ports.ts` — add `node?: string | string[]` to `WorkQuery`
- Create: `packages/node-contracts/src/work/items.create.contract.ts`
- Create: `packages/node-contracts/src/work/items.patch.contract.ts`
- Create: `packages/node-contracts/src/work/items.get.contract.ts`
- Modify: `packages/node-contracts/src/work/items.list.contract.ts` — add `node` filter
- Modify: `nodes/operator/app/src/app/api/v1/work/items/route.ts` — add POST + thread `node` on GET
- Modify: `nodes/operator/app/src/app/api/v1/work/items/[id]/route.ts` — add PATCH
- Modify: `nodes/operator/app/src/app/_facades/work/items.server.ts` — only the new POST/PATCH/GET-by-id wiring; **list still reads markdown** for v0
- Modify: `scripts/ci/deploy-infra.sh` — derive + write `DOLTGRES_URL_OPERATOR` (mirror existing `DOLTGRES_URL_POLY` derivation)
- Modify: `docs/spec/work-items-port.md` — note `node` field + `5000+` ID range + operator-local Doltgres v0 surface
- Modify: `work/items/_index.md`, `work/projects/proj.agentic-project-management.md`

> **Adjacent in-flight design:** task.0421 (`Per-node package carve-out standard`) is `needs_design`. This task follows poly's existing `nodes/<node>/packages/doltgres-schema/` pattern. If 0421 lands a different package layout before 0423 merges, re-conform 0423's package structure during closeout — minor migration, not a blocker.

## Plan

### Checkpoint 1 — Schema package + initial migration

- Milestone: `@cogni/operator-doltgres-schema` builds; `0000_init.sql` checked in; `pnpm packages:build` + `pnpm check:fast` pass
- Invariants: SCHEMA_GENERIC_CONTENT_SPECIFIC, NODE_NOT_NULL, ID_RANGE_RESERVED (column-level CHECK)
- Todos:
  - Scaffold `nodes/operator/packages/doltgres-schema/` (package.json, tsconfig, tsup, AGENTS.md, stamp-commit.mjs)
  - Define `work_items` drizzle table in `src/work-items.ts`
  - Wire `nodes/operator/drizzle.doltgres.config.ts`
  - Add `db:generate:operator:doltgres` + `db:migrate:operator:doltgres[:container]` scripts
  - Generate `0000_init_work_items.sql` via drizzle-kit
  - Add workspace dep + tsconfig project reference

### Checkpoint 2 — `@cogni/work-items` types + contracts

- Milestone: `node` field on `WorkItem` + `WorkQuery`; create/get/patch Zod contracts in node-contracts; list contract extended; full type-check passes
- Invariants: PATCH_ALLOWLIST, CONTRACTS_ARE_TRUTH
- Todos:
  - `packages/work-items/src/types.ts` — add `node: string` to `WorkItem`
  - `packages/work-items/src/ports.ts` — add `node?: string | string[]` to `WorkQuery`; extend `WorkItemCommandPort.create` input with `node`
  - `packages/work-items/src/adapters/markdown/frontmatter.ts` — read `node` from frontmatter (default `"shared"`); round-trip on write
  - `packages/node-contracts/src/work/items.list.contract.ts` — add `node` filter
  - `packages/node-contracts/src/work/items.create.contract.ts` — NEW
  - `packages/node-contracts/src/work/items.get.contract.ts` — NEW
  - `packages/node-contracts/src/work/items.patch.contract.ts` — NEW (allowlist enforced in Zod)

### Checkpoint 3 — Operator-local Doltgres adapter + tests

- Milestone: `DoltgresWorkItemAdapter` implementing Query + create/patch; integration tests pass against testcontainer Doltgres
- Invariants: AUTO_COMMIT_ON_WRITE, ID_ALLOC_ATOMIC, ID_RANGE_RESERVED, AUTHOR_ATTRIBUTED, OPERATOR_LOCAL_ADAPTER_V0
- Todos:
  - `nodes/operator/app/src/adapters/server/db/doltgres/work-items-adapter.ts` — implementation
  - `nodes/operator/app/src/adapters/server/db/doltgres/__tests__/work-items-adapter.component.test.ts` — testcontainer Doltgres
  - Test cases: create returns id ≥ 5000, dolt_log shows author, patch allowlist rejects non-allowlist fields, list filters by node, concurrent creates don't collide
- Validation/Testing:
  - [ ] component: `pnpm test:component nodes/operator/app/src/adapters/server/db/doltgres/`

### Checkpoint 4 — Routes + bootstrap wiring

- Milestone: POST/GET/GET-by-id/PATCH all live; `pnpm dev:stack` boots; manual curl POST → GET → PATCH → GET succeeds
- Invariants: AUTH_VIA_GETSESSIONUSER, PORT_BEFORE_BACKEND, PATCH_ALLOWLIST
- Todos:
  - `nodes/operator/app/src/bootstrap/container.ts` — construct adapter from `DOLTGRES_URL_OPERATOR`
  - `nodes/operator/app/src/app/_facades/work/items.server.ts` — add `getById`, `create`, `patch` facades (list still reads markdown for v0)
  - `nodes/operator/app/src/app/api/v1/work/items/route.ts` — add POST; thread `node` on GET (still reads markdown source)
  - `nodes/operator/app/src/app/api/v1/work/items/[id]/route.ts` — add PATCH; GET reads doltgres
  - Unit: facade-level tests with adapter fakes
- Validation/Testing:
  - [ ] unit: facade smoke
  - [ ] manual: `pnpm dev:stack` + curl smoke

### Checkpoint 5 — Deploy plumbing + final check

- Milestone: candidate-a operator overlay has doltgres migrator initContainer; `DOLTGRES_URL_OPERATOR` derived in `deploy-infra.sh`; `pnpm check` green
- Invariants: SCHEMA_VIA_DRIZZLE_PRESYNC (initContainer is the v0 PreSync surrogate, matching poly), DOLTGRES_PER_NODE_DATABASE
- Todos:
  - `nodes/operator/app/src/adapters/server/db/migrate-doltgres.mjs` — copy poly's verbatim
  - `nodes/operator/app/Dockerfile` — copy doltgres-migrations + migrate-doltgres.mjs into image (mirror poly's Dockerfile)
  - `infra/k8s/overlays/candidate-a/operator/kustomization.yaml` — add migrate-doltgres initContainer
  - `infra/k8s/overlays/preview/operator/kustomization.yaml` — same
  - `scripts/ci/deploy-infra.sh` — derive `DOLTGRES_URL_OPERATOR` from `POSTGRES_ROOT_PASSWORD`
  - Final: `pnpm check` green; status → `needs_closeout`

## Validation

```yaml
exercise:
  - kind: api
    description: "Agent creates, reads, patches, re-reads a work item via the new endpoint"
    actor: "external agent registered via /contribute-to-cogni"
    steps:
      - "curl https://test.cognidao.org/.well-known/agent.json"
      - 'curl -X POST https://test.cognidao.org/api/v1/agent/register -H "content-type: application/json" -d ''{"name":"task.0428-validator"}'' → apiKey'
      - 'POST /api/v1/work/items with body {"type":"task","title":"v0 doltgres write proof","node":"operator","summary":"first item ever created via API"} → 201, returns full row with server-allocated id (e.g. task.04XX)'
      - "GET /api/v1/work/items/<id> → 200, body matches"
      - 'PATCH /api/v1/work/items/<id> with body {"status":"done","summary":"validated"} → 200, returns updated row'
      - "GET /api/v1/work/items/<id> → 200, status=done, summary=validated"
      - 'GET /api/v1/work/items?node=operator → 200, list contains the new id'
  pass_criteria:
    - "All four calls return 2xx with Authorization: Bearer <apiKey>, 401 without"
    - "Allocated ID is >= 5000 (no collision with legacy markdown range)"
    - "Round-trip data matches: what was POSTed/PATCHed is what GET returns"
    - "Auto-commit + author attribution verified in unit/integration tests (testcontainer Doltgres) — not gated on candidate-a"
observability:
  - "Operator pino logs show route_id=work.items.{create,get,list,patch} for each call (sanity check that the routes are the ones being hit, not Loki-as-a-gate)"
```

## Review Checklist

- [ ] **Work Item:** `task.0428` linked in PR body
- [ ] **Auth:** all four routes reject without operator API key
- [ ] **Spec:** `work-items-port.md` documents `node` field + v0 operator-local adapter
- [ ] **Contracts:** all HTTP shapes in `packages/node-contracts/src/work/`
- [ ] **PreSync:** `migrate-operator-doltgres` Job applies cleanly on candidate-a
- [ ] **Validation comment:** posted on PR with the four curl outputs (POST → GET → PATCH → GET) + a `dolt_log` snippet showing the auto-commits
- [ ] **deploy_verified:** flipped after the agent self-exercise above succeeds on candidate-a

## PR / Links

- Project: proj.agentic-project-management
- Predecessors: task.0155 (port shipped), task.0156 (markdown adapter shipped)
- Follow-up (v1): markdown importer, dashboard rewire, transition state-machine, relations + external-refs tables, optimistic concurrency

## Attribution

- derekg1729 — direction + locked decisions (Doltgres-as-source-of-truth, operator-first, HTTP not MCP, `node` column, defer importer/dashboard, agent self-validates)
- design synthesis — claude (this `/design` run, post-review trim)
