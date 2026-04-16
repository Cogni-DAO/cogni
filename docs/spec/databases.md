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
verified: 2026-02-05
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

**Tooling-Only:** The `buildDatabaseUrl()` helper in `src/shared/db/db-url.ts` is used only by CLI tooling (`drizzle.config.ts`, `drop-test-db.ts`, `reset-db.ts`). It is **not** used by the runtime app.

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

**Core Principle:** Migrations run via a dedicated `MIGRATOR_IMAGE` that contains only migration tooling. The app runtime image has no pnpm or migration capabilities.

**Architecture:**

- **MIGRATOR_IMAGE:** Separate Docker image (`IMAGE_NAME:IMAGE_TAG-migrate`) containing drizzle-kit and migrations
- **db-migrate service:** Docker Compose service that runs migrations using the migrator image
- **Runner image:** Lean production image (~80MB) with no migration tooling

**Migration Commands:**

- `pnpm db:migrate` — Alias for `db:migrate:dev` (operator dev database)
- `pnpm db:migrate:dev` — drizzle-kit with `.env.local` (operator dev database)
- `pnpm db:migrate:poly` — drizzle-kit with `DATABASE_URL_POLY` from `.env.local`
- `pnpm db:migrate:resy` — drizzle-kit with `DATABASE_URL_RESY` from `.env.local`
- `pnpm db:migrate:nodes` — runs `db:migrate:dev` + `db:migrate:poly` + `db:migrate:resy`
- `pnpm db:migrate:test` — drizzle-kit with `.env.test` (operator test database)
- `pnpm db:migrate:test:poly` — drizzle-kit with `DATABASE_URL_POLY` from `.env.test`
- `pnpm db:migrate:test:resy` — drizzle-kit with `DATABASE_URL_RESY` from `.env.test`
- `pnpm db:migrate:test:nodes` — runs all 3 test DB migrations
- `pnpm db:migrate:direct` — drizzle-kit using `DATABASE_URL` from current environment
- `pnpm db:migrate:container` — container-only: used inside migrator Docker image

**Execution Contexts:**

- **Local Dev** (`db:migrate`, `db:migrate:dev`): Runs `drizzle-kit migrate` with `.env.local`. For daily development.
- **Local Test** (`db:migrate:test`): Runs `drizzle-kit migrate` with `.env.test`. For test database setup.
- **Direct** (`db:migrate:direct`): Runs `drizzle-kit migrate` using `DATABASE_URL` from environment. For testcontainers and CI.
- **Container** (`db:migrate:container`): Internal command used by Docker migrator image. Not for direct use.

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

**Two-Image Strategy:**

- **Runner image** (`IMAGE_NAME:IMAGE_TAG`): Lean production image (~80MB) for app runtime only
- **Migrator image** (`IMAGE_NAME:IMAGE_TAG-migrate`): Contains drizzle-kit and migrations (~480MB)

**Runner Stage (no migration tools):**

```dockerfile
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && apk add --no-cache curl

ENV NODE_ENV=production

# Copy runtime bundle only (no pnpm, no migrations)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
CMD ["node", "server.js"]
```

**Migrator Stage:**

```dockerfile
FROM base AS migrator
WORKDIR /app

RUN apk add --no-cache g++ make python3

# Install deps with drizzle-kit
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# Copy migration files only
COPY drizzle.config.ts ./
COPY src/shared/db ./src/shared/db
COPY src/adapters/server/db/migrations ./src/adapters/server/db/migrations

CMD ["pnpm", "db:migrate:container"]
```

### 4.2 Drizzle Configuration

The `drizzle.config.ts` uses `process.env.DATABASE_URL` directly (pure CLI boundary):

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/shared/db/schema.ts",
  out: "./src/adapters/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!, // Works in all environments
  },
  verbose: true,
  strict: true,
});
```

**Why this works:**

- No TypeScript path resolution needed in containers
- Same config file works for host (`dotenv` loads env) and container (env pre-loaded)
- Pure CLI boundary - reads environment, nothing else

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
