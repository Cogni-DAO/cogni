---
id: task.0167
type: task
title: "Knowledge store package scaffold — domain types, Drizzle schema, Zod validation"
status: needs_design
priority: 1
rank: 10
estimate: 2
summary: "Create packages/knowledge-store/ (domain types, Zod schemas, attribute registry) and add Drizzle tables (entity, relation, observation) to packages/db-schema/knowledge.ts with source_record_id FK to ingestion_receipts."
outcome: "packages/knowledge-store/ exports domain types and Zod schemas. packages/db-schema/ exports knowledge tables via @cogni/db-schema/knowledge. Migration creates entity, relation, observation tables in Postgres. pnpm check passes."
spec_refs:
assignees: []
credit:
project: proj.knowledge-store
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-16
updated: 2026-03-16
labels: [infrastructure, knowledge, data]
external_refs:
---

# Knowledge store package scaffold — domain types, Drizzle schema, Zod validation

## Design

### Outcome

A working `packages/knowledge-store/` package exporting domain types and Zod validation schemas, plus three new Drizzle tables (`entity`, `relation`, `observation`) in `packages/db-schema/knowledge.ts`. The tables are the canonical Layer 2 of the knowledge store — structured, tenant-scoped, with hard FK provenance back to `ingestion_receipts`.

### Approach

**Solution**: Two-package delivery following established patterns.

1. **`packages/db-schema/knowledge.ts`** — Drizzle table definitions only (no queries, no logic). Follows the exact pattern of `attribution.ts`: import from `drizzle-orm/pg-core`, reference `ingestion_receipts` for FK. Add subpath export `@cogni/db-schema/knowledge` to `package.json`. Re-export from `index.ts`.

2. **`packages/knowledge-store/`** — Capability package (port + domain + adapters shape). Crawl scope: domain types and Zod schemas only. Ports and adapters are separate tasks.

**Reuses**:

- `packages/db-schema/` — table definition pattern from `attribution.ts`
- `packages/db-schema/attribution.ts` — `ingestionReceipts` table for FK reference
- Capability package scaffold pattern from existing packages (e.g., `ingestion-core`, `work-items`)

**Rejected**:

- **Tables in knowledge-store package**: Fragments schema ownership. `db-schema` is the single authority for Drizzle tables and migrations (DB_SCHEMA_OWNS_TABLES constraint).
- **Postgres enums for type fields**: Fork-heavy systems hate enum migrations. String columns + Zod validation.
- **Generic single-table design**: Entity, relation, observation have different lifecycles, invariants, and indexes. Separate tables.

### Invariants

- [ ] DB_SCHEMA_OWNS_TABLES: All Drizzle table definitions in `packages/db-schema/knowledge.ts`, not in `packages/knowledge-store/`
- [ ] HARD_FK_TO_RECEIPTS: `source_record_id` is a hard FK to `ingestion_receipts` composite PK (`node_id`, `receipt_id`)
- [ ] TYPES_ARE_STRINGS: `entity_type`, `relation_type`, `signal_type` are `text` columns, not Postgres enums
- [ ] TENANT_SCOPED: All canonical tables include `tenant_id` (text, RLS-ready)
- [ ] ATTRIBUTES_JSONB: Entity `attributes` are JSONB, validated by Zod at app layer not DB constraints
- [ ] PROVENANCE_REQUIRED: Every entity/observation row has a `source_record_id` tracing to `ingestion_receipts`
- [ ] PACKAGES_NO_SRC_IMPORTS: `knowledge-store` never imports `@/` or `src/` paths
- [ ] COMPOSITE_BUILD: Package uses TypeScript composite mode
- [ ] SEPARATE_TABLES: Entity, relation, observation are separate tables (not one generic row)

### Files

#### Create

- `packages/db-schema/src/knowledge.ts` — Drizzle tables: `knowledgeEntities`, `knowledgeRelations`, `knowledgeObservations`. Follows `attribution.ts` pattern.
- `packages/knowledge-store/package.json` — `@cogni/knowledge-store`, deps on `@cogni/db-schema`, `zod`
- `packages/knowledge-store/tsconfig.json` — Composite mode, references `db-schema`
- `packages/knowledge-store/tsup.config.ts` — Standard build config
- `packages/knowledge-store/src/index.ts` — Barrel export
- `packages/knowledge-store/src/domain/types.ts` — `Entity`, `Relation`, `Observation` TypeScript types, `EntityType`/`RelationType`/`SignalType` string literal helpers
- `packages/knowledge-store/src/domain/schemas.ts` — Zod schemas for entity attributes validation, `AttributeSchemaRegistry` type (Map<string, ZodSchema>)
- `packages/knowledge-store/AGENTS.md` — Package documentation

#### Modify

- `packages/db-schema/src/index.ts` — Add `export * from "./knowledge"`
- `packages/db-schema/package.json` — Add subpath export `./knowledge` → `dist/knowledge.js`
- `packages/db-schema/AGENTS.md` — Add `@cogni/db-schema/knowledge` to Public Surface
- `tsconfig.json` (root) — Add project reference for `packages/knowledge-store`
- `package.json` (root) — Add `@cogni/knowledge-store` workspace dependency

### Schema Design

**`knowledgeEntities`** table:

| Column              | Type                                 | Notes                                             |
| ------------------- | ------------------------------------ | ------------------------------------------------- |
| `id`                | `uuid` PK                            | Stable identifier                                 |
| `tenant_id`         | `text` NOT NULL                      | `'global'` or `billing_account_id`                |
| `entity_type`       | `text` NOT NULL                      | Niche-defined, Zod-validated                      |
| `canonical_name`    | `text` NOT NULL                      | Best-known name                                   |
| `attributes`        | `jsonb`                              | Niche-extensible, Zod-validated per `entity_type` |
| `source_node_id`    | `uuid` NOT NULL                      | FK component for `ingestion_receipts`             |
| `source_receipt_id` | `text` NOT NULL                      | FK component for `ingestion_receipts`             |
| `first_seen_at`     | `timestamptz` NOT NULL               |                                                   |
| `last_updated_at`   | `timestamptz` NOT NULL               |                                                   |
| `created_at`        | `timestamptz` NOT NULL DEFAULT now() |                                                   |

Indexes: `(tenant_id, entity_type)`, `(tenant_id, canonical_name)`. Unique: `(tenant_id, entity_type, canonical_name)` for exact-match dedup.

**`knowledgeRelations`** table:

| Column              | Type                                 | Notes                                 |
| ------------------- | ------------------------------------ | ------------------------------------- |
| `id`                | `uuid` PK                            |                                       |
| `tenant_id`         | `text` NOT NULL                      |                                       |
| `source_entity_id`  | `uuid` NOT NULL                      | FK to `knowledgeEntities`             |
| `target_entity_id`  | `uuid` NOT NULL                      | FK to `knowledgeEntities`             |
| `relation_type`     | `text` NOT NULL                      | Niche-defined                         |
| `attributes`        | `jsonb`                              | Edge metadata                         |
| `source_node_id`    | `uuid` NOT NULL                      | FK component for `ingestion_receipts` |
| `source_receipt_id` | `text` NOT NULL                      | FK component for `ingestion_receipts` |
| `created_at`        | `timestamptz` NOT NULL DEFAULT now() |                                       |

Indexes: `(tenant_id, source_entity_id)`, `(tenant_id, target_entity_id)`. Unique: `(tenant_id, source_entity_id, target_entity_id, relation_type)`.

**`knowledgeObservations`** table:

| Column              | Type                                 | Notes                                 |
| ------------------- | ------------------------------------ | ------------------------------------- |
| `id`                | `uuid` PK                            |                                       |
| `tenant_id`         | `text` NOT NULL                      |                                       |
| `entity_id`         | `uuid` NOT NULL                      | FK to `knowledgeEntities`             |
| `signal_type`       | `text` NOT NULL                      | Niche-defined                         |
| `value`             | `jsonb` NOT NULL                     | Numeric or structured                 |
| `observed_at`       | `timestamptz` NOT NULL               | When measured                         |
| `source_node_id`    | `uuid` NOT NULL                      | FK component for `ingestion_receipts` |
| `source_receipt_id` | `text` NOT NULL                      | FK component for `ingestion_receipts` |
| `created_at`        | `timestamptz` NOT NULL DEFAULT now() |                                       |

Indexes: `(tenant_id, entity_id, signal_type)`, `(tenant_id, entity_id, observed_at)`.

### Implementation Notes

**Composite FK to `ingestion_receipts`**: The `ingestion_receipts` table has a composite PK of `(node_id, receipt_id)`. Knowledge tables reference this as `(source_node_id, source_receipt_id)` with a composite FK constraint.

**Attribute schema registry**: `packages/knowledge-store/src/domain/schemas.ts` exports an `AttributeSchemaRegistry` type — a `Map<string, ZodSchema>` keyed by `entity_type`. The adapter constructor (future task) accepts this map. For this scaffold task, only the type and a helper to build/validate against the registry are needed.

**Migration**: After adding `knowledge.ts` to `db-schema`, run `drizzle-kit generate` from the app to create the migration file. The migration lands in `apps/web/src/adapters/server/db/migrations/`.

## Validation

- [ ] `packages/knowledge-store/` exists with correct package.json, tsconfig.json, tsup.config.ts
- [ ] `packages/db-schema/knowledge.ts` defines three tables with correct columns and indexes
- [ ] `@cogni/db-schema/knowledge` subpath export resolves correctly
- [ ] `packages/knowledge-store/src/domain/types.ts` exports domain types
- [ ] `packages/knowledge-store/src/domain/schemas.ts` exports Zod schemas and `AttributeSchemaRegistry`
- [ ] `pnpm check` passes
- [ ] `pnpm packages:build` builds both packages successfully
- [ ] `pnpm --filter @cogni/knowledge-store typecheck` passes
- [ ] No `@/` or `src/` imports in `packages/knowledge-store/`

## Review Checklist

- [ ] **Work Item:** `task.0167` linked in PR body
- [ ] **Spec:** DB_SCHEMA_OWNS_TABLES upheld — tables in db-schema, not knowledge-store
- [ ] **Tests:** schema validation tests exist
- [ ] **Reviewer:** assigned and approved
