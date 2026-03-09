---
id: task.0055
type: task
title: "Dedicated DB migrator role — separate DDL from runtime DML"
status: needs_triage
priority: 2
estimate: 2
summary: "app_user is both DB owner (DDL for migrations) and runtime role (DML with RLS). A compromised app_user credential can ALTER/DROP tables. Split into app_migrator (DDL, BYPASSRLS, used only by drizzle-kit) and app_user (DML-only, RLS enforced, no schema mutation)."
outcome: "Three DB roles: app_migrator (DDL + BYPASSRLS, migrations only), app_user (DML + RLS enforced, runtime), app_service (DML + BYPASSRLS, workers). app_user is no longer DB owner and cannot CREATE/ALTER/DROP. FORCE RLS becomes defense-in-depth instead of a critical requirement."
spec_refs:
  - database-rls-spec
  - databases-spec
project: proj.database-ops
branch:
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [infra, database, security, p2]
external_refs:
assignees: derekg1729
credit:
revision: 0
blocked_by:
deploy_verified: false
rank: 10
---

# Dedicated DB migrator role — separate DDL from runtime DML

## Context

Today `app_user` is the DB owner. This means it can run DDL (CREATE TABLE, ALTER TABLE, DROP TABLE) — needed for drizzle-kit migrations — but also means the runtime web app role has far more privilege than needed. The RLS spec (database-rls-spec, invariant LEAST_PRIVILEGE_APP_ROLE) acknowledges this and flags "separate migrator role" as P1 future work.

The system tenant seed migration (0008) exposed this tension: we considered running migrations as `app_service` (BYPASSRLS) to avoid RLS issues, but `app_service` lacks DDL rights. The fix was `set_config()` in the migration SQL, but the root issue remains — `app_user` wears two hats.

### FORCE RLS hack debt

Because `app_user` owns tables, Postgres lets it bypass RLS by default. Every table with `.enableRLS()` requires a **hand-written** companion migration adding `FORCE ROW LEVEL SECURITY` + `CREATE POLICY`. Drizzle has no API for `FORCE RLS` (confirmed Feb 2026). This creates a pattern where every Drizzle-generated migration must be paired with a hand-written one (see 0004, 0005, 0006, 0015). Once `app_user` is no longer table owner, `FORCE RLS` becomes optional defense-in-depth and the hand-written migration pattern can be replaced by a single post-migrate hook.

## Requirements

- New `app_migrator` Postgres role with:
  - `LOGIN`, `BYPASSRLS`
  - Owns the database (transferred from `app_user`)
  - Can CREATE/ALTER/DROP schemas and tables
  - Used exclusively by drizzle-kit (`DATABASE_MIGRATOR_URL`)
- `app_user` demoted:
  - No longer DB owner
  - DML-only: `SELECT, INSERT, UPDATE, DELETE` on application tables
  - `USAGE` on schemas (no `CREATE`)
  - RLS enforced (unchanged)
- `app_service` unchanged (DML + BYPASSRLS for workers)
- New env var: `DATABASE_MIGRATOR_URL` — used by `drizzle.config.ts` and `db-migrate` container
- `drizzle.config.ts` reads `DATABASE_MIGRATOR_URL` (not `DATABASE_URL`)
- `provision.sh` creates `app_migrator` role, transfers DB ownership, revokes DDL from `app_user`
- Startup invariant in `invariants.ts`: reject if `DATABASE_URL` user matches `DATABASE_MIGRATOR_URL` user
- All existing migrations still apply cleanly on fresh DB
- Seed migrations (0008+) still work — `app_migrator` has BYPASSRLS, so `set_config` is optional (but harmless to keep)

## Allowed Changes

- `platform/infra/services/runtime/postgres-init/provision.sh` — new role, ownership transfer
- `drizzle.config.ts` — prefer `DATABASE_MIGRATOR_URL`
- `src/shared/env/server.ts` — add `DATABASE_MIGRATOR_URL` to Zod schema (optional, not needed at runtime)
- `src/shared/env/invariants.ts` — add migrator-vs-runtime role separation check
- `platform/infra/services/runtime/docker-compose.dev.yml` — `db-migrate` service env
- `.env.local.example`, `.env.test.example` — add `DATABASE_MIGRATOR_URL` example
- `.env.local`, `.env.test` — add `DATABASE_MIGRATOR_URL`
- `docs/spec/database-rls.md` — update LEAST_PRIVILEGE_APP_ROLE invariant, role table, file pointers

## Plan

- [ ] Create `app_migrator` role in `provision.sh` (LOGIN, BYPASSRLS, separate password)
- [ ] Transfer DB ownership: `ALTER DATABASE ... OWNER TO app_migrator`
- [ ] Transfer schema ownership: `ALTER SCHEMA public OWNER TO app_migrator`
- [ ] Revoke DDL from `app_user`: remove `CREATE ON SCHEMA public`, ensure only DML grants
- [ ] Update `ALTER DEFAULT PRIVILEGES` to use `FOR ROLE app_migrator` (tables created by migrator inherit DML grants to app_user and app_service)
- [ ] Add `DATABASE_MIGRATOR_URL` env var to `.env.local.example`, `.env.test.example`
- [ ] Update `drizzle.config.ts` to prefer `DATABASE_MIGRATOR_URL`
- [ ] Update `db-migrate` container environment in docker-compose
- [ ] Add role separation invariant check in `invariants.ts`
- [ ] Update database-rls spec with three-role model
- [ ] Test: fresh `db:provision && db:migrate` succeeds
- [ ] Test: `app_user` cannot `CREATE TABLE` or `DROP TABLE`
- [ ] Test: existing RLS integration tests still pass

## Validation

**Command:**

```bash
pnpm db:provision && pnpm db:migrate
```

**Expected:** All migrations apply cleanly, including 0008 seed.

**Command:**

```bash
# Verify app_user cannot DDL
PGPASSWORD=password psql -h localhost -p 55432 -U app_user -d cogni_template_dev \
  -c "CREATE TABLE _test_ddl_check (id int);"
```

**Expected:** `ERROR: permission denied for schema public`

**Command:**

```bash
pnpm check
```

**Expected:** All checks pass.

## Review Checklist

- [ ] **Work Item:** `task.0055` linked in PR body
- [ ] **Spec:** LEAST_PRIVILEGE_APP_ROLE invariant updated for three-role model
- [ ] **Tests:** DDL denial test for app_user, fresh migration test
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Spec: docs/spec/database-rls.md (LEAST_PRIVILEGE_APP_ROLE, Open Questions)
- Spec: docs/spec/databases.md (role model)
- Motivating fix: `set_config` workaround in 0008_seed_system_tenant.sql

## Attribution

-
