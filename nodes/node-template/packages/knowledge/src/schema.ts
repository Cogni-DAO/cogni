/**
 * Module: `@cogni/node-template-knowledge/schema`
 * Purpose: Base knowledge table definition for the knowledge data plane.
 * Scope: Drizzle table definitions only. Lives in Doltgres (not Postgres).
 * Invariants:
 *   - SCHEMA_GENERIC_CONTENT_SPECIFIC: Domain specificity in `domain` column + `tags` JSONB.
 *   - AWARENESS_HOT_KNOWLEDGE_COLD: Separate from awareness tables in Postgres.
 *   - No FK references to Postgres tables (different database server).
 *   - No RLS — access control via Doltgres roles (knowledge_reader / knowledge_writer).
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md
 * @public
 */

import { index, jsonb, pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Knowledge — domain-specific facts, claims, and curated assertions with provenance.
 * Generic schema: domain specificity lives in row content, not table structure.
 *
 * This is the base table inherited by all nodes. Nodes may add companion tables
 * for domain-specific extensions (e.g., poly_market_categories).
 *
 * SYNC: KNOWLEDGE_TABLE_DDL and KNOWLEDGE_INDEXES_DDL below must match this definition.
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
 * SQL DDL for the knowledge table.
 * Used by the adapter for Doltgres provisioning (Drizzle migrations don't run against Doltgres).
 */
export const KNOWLEDGE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  entity_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence_pct INTEGER,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  tags JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

export const KNOWLEDGE_INDEXES_DDL = [
  "CREATE INDEX IF NOT EXISTS idx_knowledge_domain ON knowledge(domain)",
  "CREATE INDEX IF NOT EXISTS idx_knowledge_entity ON knowledge(entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_knowledge_source_type ON knowledge(source_type)",
];
