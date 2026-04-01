---
id: task.0256
type: task
title: "Per-node billing pipeline: DB isolation + auth isolation + LiteLLM callback routing"
status: needs_closeout
priority: 0
rank: 1
estimate: 5
summary: "Each node gets its own database, its own auth secret, and its own LiteLLM callback endpoint. Sign in to poly → LLM usage lands in poly_db. Navigate to resy → must sign in again. LLM usage lands in resy_db. Zero cross-node data leakage."
outcome: "Sign in to poly → chat → charge_receipt in poly_db. Navigate to resy → blocked (no session). Sign in to resy → chat → charge_receipt in resy_db. poly_db has zero resy entries. resy_db has zero poly entries."
spec_refs: billing-ingest-spec, node-operator-x402-spec, node-operator-contract, spec.multi-node-tenancy
assignees: derekg1729
credit:
project: proj.operator-plane
branch: feat/task-0256-per-node-billing-v2
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [billing, litellm, multi-node, infra, auth, database]
external_refs:
---

## Context

Today all nodes share one database (`cogni_template_dev`), one `AUTH_SECRET`,
and one LiteLLM callback endpoint (`http://app:3000/api/internal/billing/ingest`).
This means:

- Sign in to poly = signed in everywhere (shared cookie on localhost)
- LLM call from poly = charge_receipt in the shared DB, indistinguishable from operator
- No data isolation between nodes

Per `spec.multi-node-tenancy`, the target is:

- **DB_PER_NODE:** 1 Postgres server, 1 database per node
- **ORIGIN_SCOPED_COOKIES:** per-node sessions, no cross-node cookie sharing
- **NODE_LOCAL_METERING_PRIMARY:** each node's billing is authoritative in its own DB

This task delivers all three in one vertical.

## Design Decisions

### 1. Per-node database provisioning

Modify `infra/compose/runtime/postgres-init/provision.sh` to create 3 databases
on the shared Postgres server: `cogni_operator`, `cogni_poly`, `cogni_resy`.
Each gets its own `app_user` / `app_service` role pair (or shared roles with
per-DB grants — whichever matches existing RLS pattern).

Each node's `.env` / compose env sets its own `DATABASE_URL` pointing to its DB.
Existing migration tooling (`pnpm db:migrate`) runs per-node.

### 2. Per-node auth secrets

Each node gets its own `AUTH_SECRET` in `.env.local`. In dev, these can be
deterministic (e.g., `AUTH_SECRET_OPERATOR=...`, `AUTH_SECRET_POLY=...`).
The dev scripts (`dev:poly`, `dev:resy`) pass the correct secret per node.

Cookies remain origin-scoped (NextAuth default on different ports). No
`.cognidao.org` parent domain cookie. Sign in on poly (:3100) does NOT
grant a session on resy (:3300).

### 3. LiteLLM callback routing

**Chosen: Option A — node identity in request metadata.**

Each node stamps `node_id` in LiteLLM request metadata via the existing
`x-litellm-spend-logs-metadata` header. LiteLLM passes metadata through to
the `generic_api` callback payload. A lightweight callback router (nginx or
Node script in compose) inspects `metadata.node_id` and forwards to the
correct node's `/api/internal/billing/ingest` endpoint.

Why Option A:

- Metadata pass-through already proven (used for `run_id`)
- No LiteLLM source changes needed
- Router is ~20 lines of nginx config or a tiny proxy
- Per-node endpoints = each node writes to its own DB (NO_CROSS_NODE_QUERIES)

**Option D ruled out** per spec (violates NO_CROSS_NODE_QUERIES).

### 4. Auth token strategy

Shared `BILLING_INGEST_TOKEN` across all nodes (V0 simplicity). The token
authenticates the callback from LiteLLM to the node — since LiteLLM is a
shared service, a shared token is appropriate. Per-node tokens are a V1
improvement if isolation needs tighten.

## Allowed Changes

- `infra/compose/runtime/postgres-init/provision.sh` — create per-node DBs + roles
- `infra/compose/runtime/docker-compose.yml` — per-node DB env vars, callback router service
- `infra/compose/runtime/docker-compose.dev.yml` — same for dev
- `infra/compose/runtime/configs/litellm.config.yaml` — callback endpoint config
- `.env.local.example` / `.env.test.example` — per-node DATABASE_URL + AUTH_SECRET vars
- `package.json` (root) — update dev:poly/dev:resy scripts with per-node env
- Node app env wiring (NEXTAUTH_SECRET, DATABASE_URL per node)
- New `infra/compose/runtime/configs/callback-router.*` if nginx proxy needed
- LLM port adapter or middleware — inject node_id into outgoing LiteLLM metadata
- `docs/spec/billing-ingest.md` — update if contract changes

## Plan

### Checkpoint 1: Per-node databases

- Milestone: 3 separate databases on shared Postgres, each node connects to its own
- Invariants: DB_PER_NODE, DB_IS_BOUNDARY
- Todos:
  - [ ] Update `infra/compose/runtime/postgres-init/provision.sh` to loop over
        `COGNI_NODE_DBS` env var (default: `cogni_operator,cogni_poly,cogni_resy`)
        creating each DB + granting app_user/app_service roles on each
  - [ ] Add per-node env vars to `.env.local.example`:
        `DATABASE_URL_OPERATOR`, `DATABASE_URL_POLY`, `DATABASE_URL_RESY`
        (+ SERVICE variants). Keep `DATABASE_URL` as operator default for backward compat.
  - [ ] Update `docker-compose.dev.yml` `db-provision` to pass `COGNI_NODE_DBS`
  - [ ] Add `db:provision:nodes` and `db:migrate:nodes` scripts to root `package.json`
        that provision + migrate all 3 node DBs
  - [ ] Update `dev:poly` script to pass `DATABASE_URL=$DATABASE_URL_POLY`
        and `DATABASE_SERVICE_URL=$DATABASE_SERVICE_URL_POLY`
  - [ ] Update `dev:resy` script similarly with resy DB vars
- Validation:
  - [ ] `pnpm db:provision:nodes` creates 3 databases on shared Postgres
  - [ ] `pnpm db:migrate:nodes` runs migrations on all 3
  - [ ] `pnpm check` passes

### Checkpoint 2: Per-node auth isolation

- Milestone: Sign in on poly does NOT grant session on resy
- Invariants: ORIGIN_SCOPED_COOKIES
- Todos:
  - [ ] Add `AUTH_SECRET_POLY` and `AUTH_SECRET_RESY` to `.env.local.example`
        (generated via `openssl rand -base64 32`, distinct from `AUTH_SECRET`)
  - [ ] Update `dev:poly` script: pass `AUTH_SECRET=$AUTH_SECRET_POLY`
  - [ ] Update `dev:resy` script: pass `AUTH_SECRET=$AUTH_SECRET_RESY`
  - [ ] Operator keeps using `AUTH_SECRET` (default, backward compat)
- Validation:
  - [ ] Sessions are already origin-scoped on different ports (NextAuth default).
        Per-node secrets ensure tokens minted by poly can't be verified by resy.
  - [ ] `pnpm check` passes

### Checkpoint 3: LiteLLM callback routing

- Milestone: LLM call from poly → charge_receipt in poly_db only
- Invariants: NODE_LOCAL_METERING_PRIMARY, NO_CROSS_NODE_QUERIES,
  CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID, CALLBACK_AUTHENTICATED
- Todos:
  - [ ] Add `node_id` to `spendLogsMetadata` type in LLM port
        (`apps/operator/src/ports/llm.port.ts:147` and all node copies)
  - [ ] Set `node_id` in LiteLLM adapter when building metadata
        (`apps/operator/src/adapters/server/ai/litellm.adapter.ts:240` and node copies)
        Source: new `COGNI_NODE_ID` env var (e.g., "operator", "poly", "resy")
  - [ ] Create `infra/compose/runtime/configs/billing-callback-router.conf` —
        nginx config that receives POST from LiteLLM, parses JSON body for
        `[0].metadata.spend_logs_metadata.node_id`, proxies to correct node
  - [ ] Add `billing-callback-router` service to `docker-compose.dev.yml`
        (nginx container with the above config)
  - [ ] Update `GENERIC_LOGGER_ENDPOINT` to point at router service
  - [ ] Pass `COGNI_NODE_ID` env to each node's dev script and compose service
- Validation:
  - [ ] LLM call from poly → callback routed to poly:3100 → charge in poly_db
  - [ ] LLM call from resy → callback routed to resy:3300 → charge in resy_db
  - [ ] LLM call from operator → callback routed to operator:3000 → charge in operator_db
  - [ ] Cross-query: `SELECT count(*) FROM cogni_poly.charge_receipts` has zero resy entries
  - [ ] `pnpm check` passes

## Validation

```bash
pnpm dev:stack:full
# 1. Open poly (:3100) → sign in → chat → verify charge_receipt in poly_db
# 2. Navigate to resy (:3300) → verify NO session (must sign in)
# 3. Sign in to resy → chat → verify charge_receipt in resy_db
# 4. Query: SELECT count(*) FROM poly_db.charge_receipts → only poly entries
# 5. Query: SELECT count(*) FROM resy_db.charge_receipts → only resy entries
pnpm check
```

## Non-goals

- Operator aggregation plane (V2 per multi-node-tenancy migration path)
- Per-node LiteLLM instances (METERING_IS_LOCAL deferred for operator-repo nodes)
- Production multi-domain auth (SSO IdP flow — task.0248 concern)
- Federation auth (V3)

## PR / Links

- Spec: `docs/spec/multi-node-tenancy.md` (DB_PER_NODE, ORIGIN_SCOPED_COOKIES, NODE_LOCAL_METERING_PRIMARY)
- Spec: `docs/spec/billing-ingest.md`
- Related: task.0029 (original callback billing implementation)
- Related: task.0247 (multi-node CICD deployment)
- Related: task.0248 (platform extraction — unblocked once this proves the data model)
