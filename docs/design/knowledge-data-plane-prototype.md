---
id: knowledge-data-plane-prototype
type: design
title: "Knowledge Data Plane — Prototype Design & Agent Tooling Plan"
status: draft
spec_refs:
  - knowledge-data-plane-spec
created: 2026-04-01
---

# Knowledge Data Plane — Prototype Design & Agent Tooling Plan

## Spike Results Summary

Doltgres v0.56.0 validated against the full stack: postgres.js driver, Drizzle schema types, role-based auth, and all Dolt versioning functions. **13/13 integration tests passing.**

### What Works

| Capability                         | Status | Implementation                                       |
| ---------------------------------- | ------ | ---------------------------------------------------- |
| DDL (CREATE TABLE/INDEX, ALTER)    | ✅     | Standard Postgres DDL via `sql.unsafe()`             |
| CRUD (INSERT/SELECT/UPDATE/DELETE) | ✅     | `sql.unsafe()` with safe value escaping              |
| JSONB storage                      | ✅     | Stored and retrieved correctly                       |
| `dolt_commit()`                    | ✅     | Returns `{ dolt_commit: ['hash'] }`                  |
| `dolt_hashof('HEAD')`              | ✅     | Returns current HEAD commit hash                     |
| `dolt_log`                         | ✅     | Full commit history with hash, author, message, date |
| `dolt_diff()`                      | ✅     | Shows added/modified/removed rows between refs       |
| CREATE DATABASE                    | ✅     | Per-node databases work                              |
| CREATE ROLE / GRANT                | ✅     | Reader/writer role separation verified               |
| Drizzle schema types               | ✅     | `pgTable()` definitions for type generation          |

### What Doesn't Work (with workarounds)

| Limitation                         | Workaround                          | Impact                                                |
| ---------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| postgres.js parameterized queries  | `sql.unsafe()` + `escapeValue()`    | Adapter handles internally; port consumers unaffected |
| JSONB `@>` operator                | `CAST(tags AS TEXT) LIKE '%"tag"%'` | Slightly less precise matching; sufficient for MVP    |
| ILIKE                              | `LOWER(col) LIKE lower_pattern`     | Equivalent behavior, standard SQL                     |
| `pg_type` access for non-superuser | `fetch_types: false` on connection  | Set in `buildDoltgresClient()`                        |
| Drizzle `.where()` with params     | Not used; adapter uses raw SQL      | Drizzle only for schema definition                    |

---

## Auth Model

### Alignment with Postgres Per-Node Pattern

Same two-role pattern as the Postgres awareness plane, adapted for knowledge:

```
┌─────────────────────────────────────────────────────────┐
│ Doltgres Server                                          │
│                                                         │
│  knowledge_operator   ← base knowledge (operator curates) │
│  knowledge_poly       ← poly node sovereign store         │
│  knowledge_resy       ← resy node sovereign store         │
│                                                         │
│  Roles (per-database):                                  │
│    postgres            — superuser (provisioning only)   │
│    knowledge_writer    — DML + dolt_commit               │
│    knowledge_reader    — SELECT only                     │
└─────────────────────────────────────────────────────────┘
```

### Access Matrix

| Actor                                     | Role             | Permissions       | Use Case                               |
| ----------------------------------------- | ---------------- | ----------------- | -------------------------------------- |
| Brain agent (poly-brain, analysis graphs) | knowledge_reader | SELECT            | Read strategies, facts during analysis |
| Curation agent (knowledge curator)        | knowledge_writer | DML + dolt_commit | Add/update knowledge, commit changes   |
| Provisioning (infra)                      | postgres         | DDL + CREATE DB   | Create databases, apply migrations     |
| External agent (future)                   | x402_reader      | SELECT (metered)  | Pay-per-read via x402 protocol         |

### No RLS (Intentional)

Unlike Postgres (multi-tenant, user-scoped RLS), Doltgres knowledge databases are **per-node, single-tenant**. All data in `knowledge_poly` belongs to the poly node. Access control is at the **role + database** level, not row level.

---

## Migration Strategy

### Schema Application

Doltgres doesn't fully support `pg_catalog` introspection, so:

1. **Schema DDL lives in `@cogni/db-schema/knowledge`** — standard Drizzle pgTable definitions
2. **Migrations applied via raw SQL** — `sql.unsafe(ddl)`, NOT `drizzle-kit push`
3. **Each migration committed** — `dolt_commit('-Am', 'migration: add X')` creates audit trail
4. **Init script** in Docker compose creates DB + applies schema + initial commit

### Migration Lifecycle

```
1. Define table in packages/db-schema/src/knowledge.ts (Drizzle)
2. Generate DDL (manual or drizzle-kit generate --custom)
3. Apply via provisioning script: sql.unsafe(ddl)
4. Commit: dolt_commit('-Am', 'migration: description')
5. Schema version tracked in Dolt commit history (no separate migration table needed)
```

### Key Difference from Postgres Migrations

Postgres migrations use `drizzle-kit push` → `migrations/` directory → sequential SQL files. Doltgres migrations use **committed DDL** — the schema itself is versioned in the Dolt commit graph. You can `dolt_diff('HEAD~1', 'HEAD', 'dolt_schemas')` to see what changed.

---

## Agent Tooling Plan

### Goal

Every internal agent can query the knowledge store. The fastest path to first-class tools:

### Phase 1: BoundTools + Capability Wiring (Done)

Three tools registered in `TOOL_CATALOG` (`packages/ai-tools/src/catalog.ts`):

| Tool                     | Effect       | Description                                             |
| ------------------------ | ------------ | ------------------------------------------------------- |
| `core__knowledge_search` | read_only    | Search by domain + text query                           |
| `core__knowledge_read`   | read_only    | Get a specific knowledge entry by ID, or list by domain |
| `core__knowledge_write`  | state_change | Add entry + auto-commit (confidence defaults to 30%)    |

Wiring chain:

```
packages/knowledge-store/src/capability.ts    ← createKnowledgeCapability(port) — shared, pure
packages/ai-tools/src/capabilities/knowledge  ← KnowledgeCapability interface + CONFIDENCE defaults
packages/ai-tools/src/tools/knowledge-*.ts    ← 3 BoundTool implementations
nodes/{node}/app/src/bootstrap/container.ts   ← env → client → adapter → capability → bindings
```

`createKnowledgeCapability(port)` wraps `KnowledgeStorePort` as a `KnowledgeCapability`. Every `write()` auto-commits with a descriptive message. Confidence defaults: `DRAFT=30`, `VERIFIED=80`, `HARDENED=95`.

### Phase 2: Portable CLI (Walk)

A standalone CLI that any developer or agent can use outside the monorepo:

```bash
# Query
cogni-knowledge search --domain prediction-market --query "base rate"
cogni-knowledge list --domain prediction-market --tags macro,fed
cogni-knowledge get fed-rate-001

# Write + commit
cogni-knowledge add --domain prediction-market --title "New insight" --content "..." --source-type derived
cogni-knowledge commit "add new insight from analysis run #42"

# Version control
cogni-knowledge log --limit 10
cogni-knowledge diff HEAD~1 HEAD
```

Implementation: thin wrapper around `KnowledgeStorePort` that reads `DOLTGRES_URL` from env.

### Phase 3: External Agent Access via x402 (Run)

```
External Agent → x402 payment → API Gateway → knowledge_reader role → SELECT
```

- External agents pay per query via x402 micropayment protocol
- Read-only access (no writes, no commits)
- Rate-limited by payment velocity
- Node operator sets price per query

### Phase 4: Agentic Contributions (Run+)

External agents can **propose** knowledge, but it goes through a review gate:

```
External Agent → x402 payment → staging table (contributions) → Review (human/AI) → Merge into knowledge
```

- Contributions land in a `knowledge_contributions` staging table
- Node's curation agent or human reviews
- Accepted contributions promoted to `knowledge` table + committed
- Rejected contributions logged for audit

---

## Docker Compose Service (for docker-compose.dev.yml)

```yaml
# Doltgres — versioned knowledge store (per knowledge-data-plane spec)
doltgres:
  image: dolthub/doltgresql:latest
  container_name: doltgres
  restart: unless-stopped
  labels:
    - "autoheal=true"
  networks:
    - cogni-edge
  ports:
    - "5435:5432"
  environment:
    DOLTGRES_PASSWORD: ${DOLTGRES_PASSWORD:-doltgres}
  volumes:
    - doltgres_data:/var/lib/doltgres
  healthcheck:
    test: ["CMD-SHELL", "nc -z localhost 5432 || exit 1"]
    interval: 10s
    timeout: 2s
    retries: 5
    start_period: 15s
```

### Provisioning Script (doltgres-init/provision.sh)

```bash
#!/bin/bash
# Idempotent Doltgres provisioning: databases + roles + schema + seed
set -euo pipefail

export PGPASSWORD="${DOLTGRES_PASSWORD}"

psql() { command psql -h doltgres -U postgres "$@"; }

# 1. Create per-node databases
for db in knowledge_operator knowledge_poly; do
  psql -d postgres -c "CREATE DATABASE $db" 2>/dev/null || true
done

# 2. Create roles
psql -d postgres -c "CREATE ROLE knowledge_reader WITH LOGIN PASSWORD '${KNOWLEDGE_READER_PASSWORD}'" 2>/dev/null || true
psql -d postgres -c "CREATE ROLE knowledge_writer WITH LOGIN PASSWORD '${KNOWLEDGE_WRITER_PASSWORD}'" 2>/dev/null || true

# 3. Apply schema + grants to each database
for db in knowledge_operator knowledge_poly; do
  psql -d "$db" <<SQL
    CREATE TABLE IF NOT EXISTS knowledge (...);
    GRANT USAGE ON SCHEMA public TO knowledge_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO knowledge_reader;
    GRANT USAGE ON SCHEMA public TO knowledge_writer;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO knowledge_writer;
    SELECT dolt_commit('-Am', 'provision: schema + roles');
SQL
done

# 4. Seed operator base knowledge
psql -d knowledge_operator <<SQL
  INSERT INTO knowledge (...) VALUES (...) ON CONFLICT DO NOTHING;
  SELECT dolt_commit('-Am', 'seed: operator base knowledge');
SQL
```

---

## File Inventory

### Created

| File                                                                  | Purpose                                |
| --------------------------------------------------------------------- | -------------------------------------- |
| `packages/db-schema/src/knowledge.ts`                                 | Drizzle table definition for knowledge |
| `packages/knowledge-store/package.json`                               | Package manifest                       |
| `packages/knowledge-store/tsconfig.json`                              | TypeScript config                      |
| `packages/knowledge-store/tsup.config.ts`                             | Build config                           |
| `packages/knowledge-store/vitest.config.ts`                           | Test config                            |
| `packages/knowledge-store/AGENTS.md`                                  | Package documentation                  |
| `packages/knowledge-store/src/index.ts`                               | Root barrel                            |
| `packages/knowledge-store/src/domain/schemas.ts`                      | Zod schemas + types                    |
| `packages/knowledge-store/src/port/knowledge-store.port.ts`           | Port interface                         |
| `packages/knowledge-store/src/adapters/doltgres/index.ts`             | Adapter implementation                 |
| `packages/knowledge-store/src/adapters/doltgres/build-client.ts`      | Connection factory                     |
| `packages/knowledge-store/tests/doltgres-adapter.integration.test.ts` | 13 integration tests                   |

### Modified

| File                                | Change                             |
| ----------------------------------- | ---------------------------------- |
| `packages/db-schema/src/index.ts`   | Added knowledge re-export          |
| `packages/db-schema/package.json`   | Added `./knowledge` subpath export |
| `packages/db-schema/tsup.config.ts` | Added knowledge entry point        |
