/**
 * Module: `@cogni/poly-knowledge/schema`
 * Purpose: Poly node knowledge schema — re-exports base + future companion tables.
 * Scope: Schema definitions only. No I/O.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md
 * @public
 */

// Re-export base knowledge table from node-template
export { knowledge, KNOWLEDGE_TABLE_DDL, KNOWLEDGE_INDEXES_DDL } from "@cogni/node-template-knowledge";

// Future: add poly-specific companion tables here
// export const polyMarketCategories = pgTable("poly_market_categories", { ... });
