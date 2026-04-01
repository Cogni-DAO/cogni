---
id: task.0231
type: task
title: "Knowledge Data Plane — Doltgres Server, Schema, Adapter, Poly Seeds"
status: needs_implement
priority: 2
rank: 1
estimate: 4
summary: "Stand up Doltgres server in dev stack, create knowledge_operator + knowledge_poly databases, scaffold packages/knowledge-store with KnowledgeStorePort + Drizzle adapter, seed domain-specific knowledge. Doltgres is Postgres-compatible — same Drizzle schemas, same driver, adds commit/log/diff."
outcome: "Agents read domain knowledge from a typed port backed by Doltgres. knowledge_operator has base knowledge. knowledge_poly has poly-specific seeds. dolt_commit + dolt_log work. Standard Drizzle queries for reads/writes."
spec_refs:
  - knowledge-data-plane-spec
  - monitoring-engine-spec
assignees: derekg1729
project: proj.poly-prediction-bot
branch: feat/knowledge-data-plane
created: 2026-03-31
updated: 2026-04-01
---

# Knowledge Data Plane — Doltgres Server, Schema, Adapter, Poly Seeds

> Spec: [knowledge-data-plane](../../docs/spec/knowledge-data-plane.md) | Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)

## Context

The knowledge-data-plane spec separates hot awareness (Postgres) from cold curated knowledge (Doltgres). Doltgres is a **Postgres-compatible drop-in** with native git-like versioning — same wire protocol, same Drizzle schemas, same `postgres` driver. The only additions are `dolt_commit()`, `dolt_log()`, `dolt_diff()` for versioning workflows.

Task.0227's poly-synth graph needs to read strategy + prompt content from a typed port instead of hardcoded strings. This task gives them a proper home in Doltgres with commit-based versioning.

---

## Design

### Outcome

Analysis graphs read strategy and prompt content from `KnowledgeStorePort` instead of hardcoded strings. Knowledge accumulates in typed, versioned tables.

### Approach

**Solution**: Doltgres server in docker-compose + knowledge tables via Drizzle + per-node databases (`knowledge_operator`, `knowledge_poly`). One new capability package (`packages/knowledge-store/`), one new db-schema file (`packages/db-schema/src/knowledge.ts`). Standard Drizzle for reads/writes, `dolt_commit()`/`dolt_log()` for versioning.

**Reuses**:

- Existing Drizzle ORM + migration tooling (Doltgres is Postgres-compatible)
- Existing `@cogni/db-schema` slice pattern (flat file, same as attribution.ts)
- Existing capability package shape (port + domain + adapters)
- Standard `postgres` driver (Doltgres speaks Postgres wire protocol)

**Rejected**:

- **Plain Postgres** — loses native versioning. Manual `version` columns recreate what Doltgres gives natively. We've decided Doltgres is the backend.
- **MySQL-compatible Dolt** — Doltgres exists now, so no need for mysql2 driver or separate SQL dialect.
- **Knowledge tables in `db-schema/ingestion`** — knowledge is a different concern from awareness data. Wrong slice boundary.
- **No knowledge store / hardcoded strategies** — creates tech debt in task.0227.
- **Full entity/relation/observation model** — over-engineered. Strategy + prompt versioning is the 80/20.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] AWARENESS_HOT_KNOWLEDGE_COLD: Knowledge tables are separate from awareness tables (spec: knowledge-data-plane)
- [ ] PORT_BEFORE_BACKEND: All access via `KnowledgeStorePort`, not direct Drizzle queries (spec: knowledge-data-plane)
- [ ] KNOWLEDGE_SOVEREIGN_BY_DEFAULT: Node knowledge is local/private by default; sharing is explicit (spec: knowledge-data-plane)
- [ ] SCHEMA_GENERIC_CONTENT_SPECIFIC: Domain specificity in `domain` column + `params` JSONB, not table structure (spec: knowledge-data-plane)
- [ ] NO_PACKAGES_TO_SRC: Package cannot import from `src/**` (spec: architecture)
- [ ] PACKAGES_BUILD_BEFORE_APP: Package builds before Next.js app (spec: build-architecture)
- [ ] SIMPLE_SOLUTION: Leverages existing Postgres/Drizzle/db-client patterns — zero new infrastructure
- [ ] ARCHITECTURE_ALIGNMENT: Capability package shape (port + domain + adapters) per existing packages

### Files

**Create:**

- `packages/db-schema/src/knowledge.ts` — Drizzle table definition (flat file, matches existing pattern: `attribution.ts`, `billing.ts`, etc.). MVP table: `knowledge` (domain-specific facts/claims). Strategy + prompt tables added in Walk/Run phases.
- `packages/knowledge-store/src/port/knowledge-store.port.ts` — `KnowledgeStorePort` interface
- `packages/knowledge-store/src/domain/schemas.ts` — Zod schemas for knowledge types
- `packages/knowledge-store/src/adapters/doltgres.adapter.ts` — `DoltgresKnowledgeStoreAdapter` (Drizzle queries + dolt_commit/log/diff)
- `packages/knowledge-store/src/index.ts` — barrel export (port + domain)
- `packages/knowledge-store/package.json`, `tsconfig.json`, `tsup.config.ts`
- `packages/knowledge-store/AGENTS.md`
- `packages/knowledge-store/tests/` — unit tests (schemas), contract tests (adapter vs Postgres)

**Modify:**

- `infra/compose/runtime/docker-compose.dev.yml` — add `doltgres` service (Postgres-compatible, port 5433)
- `packages/db-schema/src/index.ts` — add knowledge slice re-export
- `packages/db-schema/package.json` — add `@cogni/db-schema/knowledge` subpath export
- `package.json` (root) — add `@cogni/knowledge-store` workspace dependency
- `tsconfig.json` (root) — add reference
- `.env.local.example` — add `DOLTGRES_URL` (Postgres DSN against Doltgres server)
- Drizzle migration — new tables (runs against Doltgres, same DDL as Postgres)

**Seed:**

- Initial `prediction-market` strategy ("Calibrated Market Analyst")
- Initial `poly-synth-prompt` prompt definition + v1 with system prompt text

---

## Deliverables

### P0 — Doltgres Infrastructure (1 day)

| #   | Deliverable    | Description                                                                                         |
| --- | -------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Docker Compose | `doltgres` service in docker-compose.dev.yml. Port 5433. Volume. Health check. Postgres-compatible. |
| 2   | Init script    | Creates `knowledge_operator` + `knowledge_poly` databases. Idempotent.                              |
| 3   | Env config     | `DOLTGRES_URL` in .env.local.example (Postgres DSN format)                                          |

### P1 — Schema + Package (1.5 days)

| #   | Deliverable          | Description                                                                                                                                                         |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | Drizzle schema       | `packages/db-schema/src/knowledge.ts` — `knowledge` table (domain facts/claims). Flat file matching existing pattern. Strategy/prompt tables added in later phases. |
| 5   | Subpath export       | `@cogni/db-schema/knowledge` subpath in package.json exports                                                                                                        |
| 6   | Migration            | Drizzle migration against Doltgres (same DDL as Postgres)                                                                                                           |
| 7   | Package scaffold     | `packages/knowledge-store/` — package.json, tsconfig, tsup, AGENTS.md                                                                                               |
| 8   | Domain types + Zod   | Knowledge, NewKnowledge schemas                                                                                                                                     |
| 9   | `KnowledgeStorePort` | Read + write + commit/log interface per spec                                                                                                                        |
| 10  | Root config          | Add workspace dep, tsconfig reference, biome override                                                                                                               |

### P2 — Adapter + Tests (1 day)

| #   | Deliverable                     | Description                                                                                            |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 11  | `DoltgresKnowledgeStoreAdapter` | Drizzle for reads/writes. `dolt_commit()`, `dolt_log()`, `currentCommit()` via raw SQL for versioning. |
| 12  | Unit tests                      | Schema validation (pure Zod), ID format tests                                                          |
| 13  | Adapter tests                   | Against dev-stack Doltgres: write → commit → log → verify commit hash                                  |

### P3 — Seed Data (0.5 day)

| #   | Deliverable        | Description                                                                        |
| --- | ------------------ | ---------------------------------------------------------------------------------- |
| 14  | Operator base seed | Base domain knowledge into `knowledge_operator`, committed                         |
| 15  | Poly seed          | Poly-specific domain knowledge (market patterns, base rates) into `knowledge_poly` |
| 16  | Seed script        | `pnpm knowledge:seed` — applies seeds, commits each with descriptive message       |

## Acceptance Criteria

- [ ] `pnpm dev:stack` starts Doltgres alongside Postgres; both healthy
- [ ] `pnpm check` passes (lint + type + format)
- [ ] `packages/knowledge-store/` builds and exports port + domain types
- [ ] Can read seed knowledge from `knowledge_poly` via `KnowledgeStorePort`
- [ ] Can write new knowledge + `commit()` — visible in `log()`
- [ ] `knowledge_operator` and `knowledge_poly` are separate databases
- [ ] Drizzle migration applies cleanly to Doltgres
- [ ] AGENTS.md documented for new package

## Validation

```bash
pnpm check                    # lint + type + format
pnpm packages:build           # builds knowledge-store
pnpm test                     # unit tests (Zod schemas)
pnpm dev:stack                # Doltgres + Postgres both healthy, seeds queryable
```

## Risks

| Risk                                         | Mitigation                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Doltgres Drizzle compatibility               | Verify Drizzle migrations and queries work against Doltgres. Spike early in P1.             |
| `dolt_commit`/`dolt_log` via postgres driver | These are Dolt-specific SQL functions. Verify they work through standard `postgres` driver. |
| Dev stack startup order                      | Doltgres health check + `depends_on` in compose. Same pattern as postgres service.          |

## Out of Scope

- Dolt branching (future — MVP is single-branch `main`)
- Dolt remotes / push-pull between nodes (future)
- Full awareness pipeline (task.0227)
- Automatic promotion gate
- UI for knowledge browsing
- `analysis_runs.knowledge_commit` column (added when task.0227 wires analysis)
