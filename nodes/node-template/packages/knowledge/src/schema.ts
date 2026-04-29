/**
 * Module: `@cogni/node-template-knowledge/schema`
 * Purpose: Base knowledge Drizzle table — single source of truth.
 *   Consumed by drizzle-kit via per-node Doltgres drizzle configs
 *   (e.g., nodes/poly/drizzle.doltgres.config.ts) that re-export this table
 *   through their own schema entry point (nodes/<node>/app/schema/knowledge.ts).
 *   drizzle-kit `generate` emits SQL migrations; application happens via psql
 *   on the VM (see nodes/poly/app/schema/README.md for the Doltgres-specific
 *   runtime-migrator divergence rationale).
 * Scope: Drizzle table definitions only. Targets Doltgres (pg wire).
 * Invariants:
 *   - SCHEMA_GENERIC_CONTENT_SPECIFIC: Domain specificity in `domain` column + `tags` JSONB.
 *   - AWARENESS_HOT_KNOWLEDGE_COLD: Separate from awareness tables in Postgres.
 *   - No FK references to Postgres tables (different database server).
 *   - No RLS — access control via Doltgres roles (knowledge_reader / knowledge_writer).
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md, nodes/poly/app/schema/README.md
 * @public
 */

import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Knowledge — domain-specific facts, claims, and curated assertions with provenance.
 * Generic schema: domain specificity lives in row content, not table structure.
 *
 * Nodes inherit this table via their own schema entry point and may add
 * companion tables for domain-specific extensions (e.g., poly_market_categories).
 */
export const knowledge = pgTable(
  "knowledge",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(),
    entityId: text("entity_id"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    confidencePct: integer("confidence_pct"),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref"),
    tags: jsonb("tags").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_knowledge_domain").on(table.domain),
    index("idx_knowledge_entity").on(table.entityId),
    index("idx_knowledge_source_type").on(table.sourceType),
  ],
);

/**
 * Knowledge contributions metadata — tracks external-agent submissions while
 * their proposed `knowledge` rows live on a `contrib/<agent>-<id>` Dolt branch.
 * State / principal / idempotency / close-reason live here on `main` so they
 * survive branch deletion. See docs/design/knowledge-contribution-api.md.
 */
export const knowledgeContributions = pgTable(
  "knowledge_contributions",
  {
    id: text("id").primaryKey(),
    branch: text("branch").notNull(),
    state: text("state").notNull(),
    principalId: text("principal_id").notNull(),
    principalKind: text("principal_kind").notNull(),
    message: text("message").notNull(),
    entryCount: integer("entry_count").notNull(),
    commitHash: text("commit_hash").notNull(),
    mergedCommit: text("merged_commit"),
    closedReason: text("closed_reason"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (table) => [
    index("idx_knowledge_contrib_state").on(table.state),
    index("idx_knowledge_contrib_principal").on(table.principalId, table.state),
    uniqueIndex("uniq_knowledge_contrib_idempotency").on(table.principalId, table.idempotencyKey),
  ],
);
