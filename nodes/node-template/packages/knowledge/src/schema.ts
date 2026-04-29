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

import { index, jsonb, pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

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
