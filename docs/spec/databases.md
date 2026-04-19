---
id: databases-spec
type: spec
title: Database & Migration Architecture
status: active
trust: draft
summary: Database organization, migration strategies, and URL construction patterns
read_when: Working with databases, migrations, or connection configuration
owner: derekg1729
created: 2026-02-05
verified: 2026-04-18
tags: [databases]
---

# Database & Migration Architecture

This document describes database organization, migration strategies, and database-specific configuration patterns.

**For stack deployment modes and environment details, see [Environments](environments.md).**

## Quick Start: Primary Development Workflow

**If you only need to know ONE thing:**

```bash
# Daily development (fake adapters, no external API calls)
pnpm dev:stack:test           # Start app + infrastructure in test mode
pnpm dev:stack:test:setup     # First time: create test DB + migrate
pnpm test:stack:dev           # Run stack tests
```

**For real AI calls (production adapters):**

```bash
pnpm dev:stack                # Same as above, but hits real LiteLLM/OpenRouter
```

**Docker stacks:** Used primarily in CI, not required for daily development. See sections 2.3-2.5 for details.

---

## Database Separation

**Database Security Model**: Two-user PostgreSQL architecture separating administrative and application access.

**Per-Node Databases (DB_PER_NODE):** Each node gets its own database on a shared Postgres server. The database IS the node boundary — no tenancy columns. See [Multi-Node Tenancy](multi-node-tenancy.md).

**Postgres vs Doltgres:** This spec covers the Postgres (awareness plane) side. The knowledge plane runs on a separate Doltgres server with per-node `knowledge_<node>` databases and git-like versioning — see [Knowledge Data Plane](knowledge-data-plane.md).

| Environment | Databases                                                         | Configured via                   |
| ----------- | ----------------------------------------------------------------- | -------------------------------- |
| Development | `cogni_operator`, `cogni_poly`, `cogni_resy`                      | `COGNI_NODE_DBS` in `.env.local` |
| Test        | `cogni_template_stack_test`, `cogni_poly_test`, `cogni_resy_test` | `COGNI_NODE_DBS` in `.env.test`  |
| CI          | `cogni_template_test`                                             | `COGNI_NODE_DBS` in `ci.yaml`    |
| Production  | `cogni_operator` (single-node for now)                            | `COGNI_NODE_DBS` in deploy env   |

`COGNI_NODE_DBS` is required — `provision.sh` fails fast if not set. No defaults, no fallback chain.

All stack deployment modes use the same migration tooling but connect to appropriate database instances. Test environments always use the test database and reset it between test runs.

## Database Provisioning (Infrastructure-as-Code)

To ensure a repeatable and consistent database state across environments (especially for `docker compose` setups), we use a dedicated provisioning service.

### The `db-provision` Service

In `docker-compose.dev.yml`, the `db-provision` service handles:

1. **Per-node database creation**: Iterates over `COGNI_NODE_DBS` (comma-separated), creates each database with `app_user` ownership and RLS role hardening.
2. **LiteLLM database creation**: Creates `LITELLM_DB_NAME` (root-owned, shared across nodes).
3. **Role provisioning**: Creates `app_user` (RLS enforced) and `app_service` (BYPASSRLS) roles, shared across all node databases.

Both `COGNI_NODE_DBS` and `LITELLM_DB_NAME` are required — `provision.sh` fails immediately if either is missing.

This service is gated behind the `bootstrap` profile and runs only when explicitly requested.

### Development vs. Production Roles

- **Development:** Local dev connects via `app_user` (RLS enforced) and `app_service` (BYPASSRLS). `provision.sh` applies RLS role hardening to all node databases.
- **Production:** Same two-user model. The application user should NOT have `DROP` or `TRUNCATE` permissions on the schema in production.

## Current Schema Baseline (Phase 0)

- **billing_accounts** — `id` (text PK), `owner_user_id` (unique), `balance_credits BIGINT DEFAULT 0`, timestamps.
- **virtual_keys** — `id` (uuid PK), `billing_account_id` (FK → billing_accounts, cascade), `litellm_virtual_key`, labels/flags, timestamps.
- **credit_ledger** — `id` (uuid PK), `billing_account_id` (FK → billing_accounts, cascade), `virtual_key_id` (FK → virtual_keys, cascade, NOT NULL), `amount BIGINT`, `balance_after BIGINT DEFAULT 0`, `reason`, optional reference/metadata, timestamps.
- Credits are stored as whole units (Stage 6.5 invariant: 1 credit = $0.001 USD, 1 USDC = 1,000 credits). Keep all arithmetic integer-only; no fractional credits.
- Optional: make `credit_ledger.virtual_key_id` nullable if you need ledger rows that are not tied to a specific virtual key (e.g., admin adjustments). Not required for the MVP if every entry is keyed.

## Database URL Configuration

Per [Database RLS Spec](database-rls.md) design decision 7, the runtime app requires **explicit DSN environment variables** — no component-piece fallback.

**Required Environment Variables:**

- `DATABASE_URL` — app_user role (RLS enforced), used by Next.js request paths
- `DATABASE_SERVICE_URL` — app_service role (BYPASSRLS), used by auth, workers, bootstrap

**Startup Invariants (enforced by `assertEnvInvariants`):**

- Both DSNs must use distinct PostgreSQL users
- Neither DSN may use superuser names (`postgres`, `root`, `admin`)
- Both DSNs must be present

**Environment Examples:**

- **Local development:** `postgresql://app_user:password@localhost:55432/cogni_template_dev`
- **Local testing:** `postgresql://app_user:password@localhost:55432/cogni_template_stack_test`
- **Production:** `postgresql://app_user:<secret>@postgres:5432/cogni_template_production?sslmode=require`

**Tooling-Only:** The `buildDatabaseUrl()` helper in `nodes/<node>/app/src/shared/db/db-url.ts` is used only by CLI test tooling (`drop-test-db.ts`, `reset-db.ts`). It is **not** used by the runtime app and **not** used by drizzle configs — per-node drizzle configs (`nodes/<node>/drizzle.config.ts`) require `DATABASE_URL` from env explicitly (task.0324).

## Database Security Architecture

**Three-Role Model**: Production deployments use separate PostgreSQL roles:

- **Root User** (`POSTGRES_ROOT_USER`): Database server administration, user/database creation
- **Application User** (`app_user` via `APP_DB_USER`): Runtime web app connections, RLS enforced
- **Service User** (`app_service` via `APP_DB_SERVICE_PASSWORD`): Priviledged system users, avoid using. Scheduler workers and pre-auth lookups, BYPASSRLS. Connects via `DATABASE_SERVICE_URL`.

See [Database RLS Spec](database-rls.md) for the dual-client architecture and static import enforcement.

**Container Configuration**: The `db-provision` service runs `provision.sh`:

- Creates roles: `app_user` (RLS), `app_service` (BYPASSRLS)
- Iterates `COGNI_NODE_DBS`: creates each database with ownership + RLS hardening
- Creates `LITELLM_DB_NAME`: root-owned, shared LiteLLM database

**Provisioning Variables** (used by `provision.sh`, not by runtime app):

| Variable                  | Purpose                             | Required         |
| ------------------------- | ----------------------------------- | ---------------- |
| `POSTGRES_ROOT_USER`      | Superuser for role/DB creation      | Yes              |
| `POSTGRES_ROOT_PASSWORD`  | Superuser password                  | Yes              |
| `COGNI_NODE_DBS`          | Comma-separated node database names | Yes (no default) |
| `LITELLM_DB_NAME`         | LiteLLM database name               | Yes (no default) |
| `APP_DB_USER`             | Application role name               | Yes              |
| `APP_DB_PASSWORD`         | Application role password           | Yes              |
| `APP_DB_SERVICE_USER`     | Service role name                   | Yes              |
| `APP_DB_SERVICE_PASSWORD` | Service role password               | Yes              |

**Runtime Variables** (used by app, never by provisioning):

| Variable               | Purpose                      |
| ---------------------- | ---------------------------- |
| `DATABASE_URL`         | app_user role (RLS enforced) |
| `DATABASE_SERVICE_URL` | app_service role (BYPASSRLS) |

> **Note:** The runtime app never receives `POSTGRES_ROOT_*`, `APP_DB_*`, or `COGNI_NODE_DBS`. These are provisioning-only.

## 2. Migration Strategy

**Core Principle:** Each node owns its migrations. task.0324 split the previously-shared drizzle config into per-node configs (`nodes/<node>/drizzle.config.ts`). Each node ships its own migrator image built from its own Dockerfile, carrying only that node's schema + migrations + config + the shared `@cogni/db-schema` core.

**Architecture:**

- **Per-node migrator images:** `IMAGE_NAME:IMAGE_TAG-{operator,poly,resy}-migrate` — one image per node, built from `nodes/<node>/app/Dockerfile` stage `migrator`.
- **Per-node drizzle configs:** `nodes/<node>/drizzle.config.ts` (operator, poly, resy, node-template). Schema glob is core-only for operator/resy/node-template, core + local for poly. Each config requires `DATABASE_URL` from env and throws if unset — no fallback.
- **Core schema package:** `packages/db-schema` (`@cogni/db-schema`) — cross-node platform tables.
- **Per-node schema packages:** `nodes/<node>/packages/db-schema` (`@cogni/<node>-db-schema`) — node-local tables. Created per-node when that node ships its first node-local table. Today only `@cogni/poly-db-schema` exists (copy-trade prototype tables). Node-local packages mirror `@cogni/db-schema`'s exports shape (root barrel + per-slice subpath exports) so any workspace consumer (app, worker, graph) can import tables without reaching into app internals.
- **Migration history per DB:** one `drizzle.__drizzle_migrations` table per database (standard drizzle default). `0027_silent_nextwave.sql` is byte-duplicated across `nodes/{operator,poly,resy}/app/src/adapters/server/db/migrations/` because it was applied to every deployed DB before the split — READMEs in each migrations dir warn against deletion.
- **Runner image:** Lean production image (~80MB) with no migration tooling.

**Invariants:**

- **NO_CROSS_NODE_TABLE_LEAK** — node-local tables are defined in that node's own workspace package (e.g. poly's tables live in `@cogni/poly-db-schema` at `nodes/poly/packages/db-schema/`). Adding a node-local table to `@cogni/db-schema` is a review-blocking error.
- **CORE_TABLES_IN_SHARED_PACKAGE** — `@cogni/db-schema` contains only tables every node needs (intersection, not union).
- **EACH_NODE_OWNS_ITS_MIGRATIONS** — `nodes/<node>/app/src/adapters/server/db/migrations/` is that node's authoritative history. Core-table changes are copied to each node's dir manually.
- **EXPLICIT_DATABASE_URL_NO_FALLBACK** — drizzle configs read `DATABASE_URL` from env and throw if unset. No component-piece fallback (matches runtime app invariant from §Database URL Configuration).

**Migration Commands:**

- `pnpm db:migrate` — alias for `db:migrate:dev` (operator dev database via `nodes/operator/drizzle.config.ts`)
- `pnpm db:migrate:dev` — drizzle-kit with `.env.local` (operator dev database)
- `pnpm db:migrate:poly` / `:resy` — drizzle-kit with `DATABASE_URL_POLY` / `DATABASE_URL_RESY` from `.env.local` + that node's config
- `pnpm db:migrate:nodes` — runs all three in sequence
- `pnpm db:migrate:test` — drizzle-kit with `.env.test` (operator test database)
- `pnpm db:migrate:test:poly` / `:resy` — same pattern with `.env.test`
- `pnpm db:migrate:test:nodes` — runs all 3 test DB migrations
- `pnpm db:migrate:direct` — drizzle-kit using operator config + `DATABASE_URL` from current environment (used by testcontainers)
- `pnpm db:migrate:{operator,poly,resy}:container` — container-only: invoked by each node's Dockerfile default CMD
- `pnpm db:generate:{operator,poly,resy}` — generate new migrations for a node's schema (runs drizzle-kit diff)

**Execution Contexts:**

- **Local Dev** (`db:migrate:dev` / `:poly` / `:resy`): runs `drizzle-kit migrate` with `.env.local` + per-node config. For daily development.
- **Local Test** (`db:migrate:test*`): runs with `.env.test`. For test database setup.
- **Direct** (`db:migrate:direct`): runs with operator config using `DATABASE_URL` from environment. For testcontainers (`testcontainers-postgres.global.ts` sets `process.env.DATABASE_URL` before `execSync`).
- **Container** (`db:migrate:{operator,poly,resy}:container`): default CMD of each per-node migrator image. K8s `AtlasMigration`/`migrate-node-app` Jobs invoke these via overlays.

**Future: Atlas + GitOps migrations** — declarative schema, CRD-based Argo integration, destructive-change linting. Deferred to task.0325 with full spike intel preserved.

### 2.1 Local Development

**Databases:** `cogni_operator`, `cogni_poly`, `cogni_resy` (per `COGNI_NODE_DBS`)

**Environment:** `.env.local`

**Commands:**

```bash
pnpm db:setup:nodes          # Provision + migrate + seed all 3 node DBs
pnpm db:migrate:nodes        # Migrate all 3 node DBs
pnpm dev:stack               # Start operator using cogni_operator
pnpm dev:stack:full           # Start operator + poly + resy (each on its own DB)
```

### 2.2 Host Stack Tests

**Databases:** `cogni_template_stack_test` (single-node), + `cogni_poly_test`, `cogni_resy_test` (multi-node)

**Environment:** `.env.test`

**Commands:**

```bash
# Single-node
pnpm dev:stack:test:setup     # Provision + migrate operator test DB
pnpm dev:stack:test           # Start operator in test mode
pnpm test:stack:dev           # Run single-node stack tests

# Multi-node
pnpm dev:stack:test:full:setup  # Provision + migrate all 3 test DBs
pnpm dev:stack:test:full        # Start operator + poly + resy in test mode
pnpm test:stack:multi           # Run multi-node isolation tests
```

**Details:**

- `test:stack:dev` uses `vitest.stack.config.mts` with `.env.test`
- `test:stack:multi` uses `vitest.stack-multi.config.mts` with `.env.test`
- `reset-db.ts` truncates tables in the operator test DB between test suites
- Multi-node tests seed and clean their own data per-test (no global reset)
- See [Full-Stack Testing Guide](../guides/full-stack-testing.md) for details

### 2.3 Docker Dev Stack

**Database:** `cogni_template_dev` (container Postgres)

**Environment:** `.env.local` passed to Docker Compose

**Commands:**

```bash
# First time setup (creates DB + runs migrations)
pnpm docker:dev:stack:setup     # Complete: build stack, create DB, migrate

# Manual steps (if needed)
pnpm docker:dev:stack           # Start containers
pnpm db:provision               # Create database
pnpm db:migrate                 # Run migrations with drizzle-kit
```

**Key Properties:**

- Dev stack owns schema and migrations in shared `postgres_data` volume
- Uses `docker-compose.dev.yml` with db-migrate service for migrations
- Postgres exposed on `localhost:55432` for debugging
- Migrations run via dedicated migrator image (not inside app container)

### 2.4 Docker Stack (Production Simulation)

**Database:** `cogni_template_dev` (reuses dev stack's database)

**Environment:** `.env.local` passed to Docker Compose

**Commands:**

```bash
pnpm docker:stack:setup         # Start production compose (assumes DB exists)
```

**Key Properties:**

- Uses hardened `docker-compose.yml` production configuration
- Shares same `postgres_data` volume as dev stack
- **Assumes database already created and migrated** via `docker:dev:stack:setup`
- `docker:stack:migrate` available but not used in local workflow

**Local Workflow:**

1. **After nuking volumes:** Run `pnpm docker:dev:stack:setup` once to create schema
2. **To simulate prod:** Run `pnpm docker:stack:setup` (reuses existing DB/schema from shared volume)

### 2.5 Docker Stack Testing

**Database:** `cogni_template_stack_test` (container Postgres)

**Environment:** `dotenv -e .env.test -e .env.local` (test overrides base)

**Commands:**

```bash
# 1. Start Docker stack in test mode
pnpm docker:test:stack          # Build and start containers with test env

# 2. Run migrations via db-migrate service
pnpm db:migrate:test

# 3. Run host tests against containerized app
pnpm test:stack:docker
```

**Key Properties:**

- Uses dedicated migrator image for migrations (not app container)
- Environment variables passed via dotenv to Docker Compose
- Migrations run via db-migrate service with `--profile bootstrap`
- Tests run from host, connect to exposed postgres port (55432) and app via HTTPS

## 3. Production Deployments

### 3.1 CI/CD Pattern

In staging and production, environment variables come from GitHub Environments/secrets, not `.env` files.

**GitHub Actions Environment:**

```yaml
env:
  APP_ENV: production
  NODE_ENV: production
  # Database configuration (two-user security model)
  POSTGRES_ROOT_USER: ${{ secrets.POSTGRES_ROOT_USER }}
  POSTGRES_ROOT_PASSWORD: ${{ secrets.POSTGRES_ROOT_PASSWORD }}
  APP_DB_USER: ${{ secrets.APP_DB_USER }}
  APP_DB_PASSWORD: ${{ secrets.APP_DB_PASSWORD }}
  COGNI_NODE_DBS: ${{ secrets.COGNI_NODE_DBS }} # Required, comma-separated
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
  DATABASE_SERVICE_URL: ${{ secrets.DATABASE_SERVICE_URL }}
  COGNI_NODE_ENDPOINTS: ${{ secrets.COGNI_NODE_ENDPOINTS }} # Per-node billing routing
  LITELLM_MASTER_KEY: ${{ secrets.LITELLM_MASTER_KEY }}
  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
  AUTH_SECRET: ${{ secrets.AUTH_SECRET }}
```

**Deployment Steps:**

```yaml
- name: Run migrations
  run: |
    docker compose -f infra/compose/runtime/docker-compose.yml \
      --profile bootstrap run --rm db-migrate

- name: Start application
  run: |
    docker compose -f infra/compose/runtime/docker-compose.yml \
      up -d app
```

**Benefits:**

- Same `DATABASE_URL` for migrations and app
- Dedicated migrator image with pinned drizzle-kit version
- Migrations as repeatable deployment step (idempotent)
- Lean runner image (~80MB) without migration tooling
- db-migrate service receives only DB env vars (least-secret exposure)

## 4. Technical Implementation

### 4.1 Docker Image Architecture

**Per-node image strategy (task.0324):** each deployed node ships two images from its own `nodes/<node>/app/Dockerfile`:

- **Runner image** (`IMAGE_NAME:IMAGE_TAG` for operator; `IMAGE_NAME:IMAGE_TAG-{poly,resy}` for node variants): Lean production image (~80MB) for app runtime only.
- **Migrator image** (`IMAGE_NAME:IMAGE_TAG-{operator,poly,resy}-migrate`): Contains drizzle-kit + that node's migrations + core schema (`packages/db-schema/src`). Node-template ships a scaffold migrator image for forks.

**Runner Stage (no migration tools):** unchanged — same pattern as before.

**Per-node Migrator Stage:** each node's Dockerfile has a `FROM base AS migrator` stage. Stage copies only that node's slice:

```dockerfile
FROM base AS migrator
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/nodes/<node>/drizzle.config.ts ./nodes/<node>/drizzle.config.ts
COPY --from=builder /app/packages/db-schema/src ./packages/db-schema/src
COPY --from=builder /app/nodes/<node>/app/src/shared/db ./nodes/<node>/app/src/shared/db
COPY --from=builder /app/nodes/<node>/app/src/adapters/server/db/migrations ./nodes/<node>/app/src/adapters/server/db/migrations

CMD ["pnpm", "db:migrate:<node>:container"]
```

**Partial isolation, not full sovereignty:** each migrator image still carries `packages/db-schema/src`, so core schema changes rebuild all three migrators. The win is per-node cache invalidation + pattern consistency with existing per-node app images + forks inheriting trivially.

**CI wiring (see `scripts/ci/`):**

Adding a new build-target name requires updating this full chain — missing any one step causes silent failure modes (target gets built but never promoted, or promoted but never resolved on re-flight).

- `detect-affected.sh` — emits the target name when its paths change.
- `build-and-push-images.sh` — builds the image tag from a Dockerfile stage with a distinct GHA cache scope.
- `merge-build-fragments.sh` — `canonical_order` array must include the target for stable JSON ordering across matrix leg merges.
- `compute_migrator_fingerprint.sh` — (migrators only) takes a node arg and hashes only that node's inputs for content-addressed image caching.
- `resolve-pr-build-images.sh` — `ALL_TARGETS` + `resolve_tag()` must know about the tag shape, or the flight's PR-image resolver silently drops the target from the promoted payload (bug.0321 documents the vacuous-green failure mode this produces).
- `promote-build-payload.sh` — pairs each app with its companion migrator digest (`operator-migrator` digest → operator overlay, etc.).

### 4.2 Drizzle Configuration

Each node has its own `nodes/<node>/drizzle.config.ts`. Example (operator):

```typescript
import { defineConfig } from "drizzle-kit";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for drizzle-kit (nodes/operator/drizzle.config.ts)."
    );
  }
  return url;
}

export default defineConfig({
  schema: "./packages/db-schema/src/**/*.ts",
  out: "./nodes/operator/app/src/adapters/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: requireDatabaseUrl() },
  verbose: true,
  strict: true,
});
```

Poly's config uses an array schema that unions core + poly's per-node package source: `["./packages/db-schema/src/**/*.ts", "./nodes/poly/packages/db-schema/src/**/*.ts"]`. drizzle-kit reads raw TS via these globs — no pre-built `dist/` required for migration generation. Resy and node-template are core-only until they ship their first node-local table, at which point they gain a `nodes/<node>/packages/db-schema/` package.

**Why this shape:**

- **No relative imports in the config.** drizzle-kit compiles configs to a temp directory before executing; relative TypeScript imports break from there. All paths are repo-root-relative (drizzle-kit runs with `CWD=repo root`).
- **Explicit `DATABASE_URL`, no fallback.** Caller (pnpm script, testcontainer, k8s Job) must set it. Matches the runtime app invariant in §Database URL Configuration.
- **Per-node `out` dir.** Each node writes migrations to its own `nodes/<node>/app/src/adapters/server/db/migrations/`. Cross-node collisions impossible — nothing shared.

## 5. Trade-offs of Current Approach

### 5.1 Benefits

**Separation of Concerns:**

- Runner image cannot mutate database schema (no pnpm, no drizzle-kit)
- Migrator image has only DB env vars (least-secret exposure)
- Clear security boundary between app runtime and migrations

**Lean Production Image:**

- Runner image ~80MB (Next.js standalone only)
- No dev dependencies in production runtime
- Faster container pulls and startup

**Consistent Migration Tooling:**

- Pinned drizzle-kit version in migrator image
- Idempotent migrations (safe to re-run)
- Same db-migrate service in dev and production

### 5.2 Trade-offs

**Two Images to Build:**

- CI builds both runner and migrator targets
- Tag coupling: `IMAGE_NAME:IMAGE_TAG` and `IMAGE_NAME:IMAGE_TAG-migrate`
- Both must be pushed and pulled during deployment

**Larger Migrator Image:**

- Migrator includes full node_modules (~480MB)
- Acceptable since it only runs during deployments, not at runtime

## 6. Future Improvements (If/When Needed)

### 6.1 Row-Level Security (RLS)

RLS is implemented on all user-scoped tables (P0 complete). Tenant isolation uses `SET LOCAL app.current_user_id` per transaction. The `app_user` role has RLS enforced; `app_service` has BYPASSRLS. The `@cogni/db-client` package exposes two sub-path exports (`@cogni/db-client` for app-role, `@cogni/db-client/service` for service-role), and the adapter layer isolates `getServiceDb()` in a depcruiser-gated file. See [Database RLS Spec](database-rls.md) for full design, adapter wiring tracker, and remaining P1 hardening items.

### 6.2 SSL Enforcement

Non-localhost `DATABASE_URL` values do not currently require `sslmode=require`. Covered in [Database RLS Spec](database-rls.md).

### 6.3 Least-Privilege App Role

`provision.sh` creates the `app_user` role but does not restrict it from DDL operations. Production deployments should revoke `CREATE`, `DROP`, `TRUNCATE`, `ALTER` from the app role. Covered in [Database RLS Spec](database-rls.md).

### 6.4 Migrator Image Optimization

The migrator image (~480MB) includes full node_modules. Potential optimizations:

- Use pnpm's `--filter` to install only drizzle-kit and dependencies
- Multi-stage build to copy only required binaries
- Consider distroless base image for smaller footprint

### 6.2 Enhanced Environment Separation

**Stricter Test Isolation:**

- Container-specific DB reset routines
- Separate test databases for different environments
- Longer-running smoke test environments

**Production Pipeline:**

- Blue/green deployments with migration gating
- Automated migration rollback on failure

## 7. Summary

**Environment Separation:** Host dev DB, host stack test DB, container stack DB are cleanly separated

**Two-Image Architecture:** Lean runner image (~80MB) + dedicated migrator image (~480MB) with clear security boundaries

**Production-Ready Pattern:** Dedicated db-migrate service, same `DATABASE_URL`, migrations as first-class deployment step

**Least-Secret Exposure:** db-migrate service receives only DB env vars, not app secrets

**Tag Coupling:** `APP_IMAGE=IMAGE_NAME:IMAGE_TAG`, `MIGRATOR_IMAGE=IMAGE_NAME:IMAGE_TAG-migrate`
