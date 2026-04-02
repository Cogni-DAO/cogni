/**
 * Module: `@cogni/node-template-knowledge`
 * Purpose: Base knowledge schema and seeds for the node-template.
 * Scope: Schema definitions, DDL constants, and seed data. No I/O.
 * Invariants: Nodes inherit this base. Domain-specific extensions go in the node's own package.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md
 * @public
 */

// Schema (Drizzle table definitions + raw DDL)
export { knowledge, KNOWLEDGE_TABLE_DDL, KNOWLEDGE_INDEXES_DDL } from "./schema.js";

// Seeds
export { BASE_KNOWLEDGE_SEEDS } from "./seeds/base.js";
