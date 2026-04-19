// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-doltgres-schema/knowledge`
 * Purpose: Poly's Doltgres knowledge schema. Today it re-exports the base `knowledge` table from @cogni/node-template-knowledge; poly-specific companion tables (e.g. polyMarketCategories) land here when needed.
 * Scope: Drizzle table definitions only. Targets Doltgres via pg wire protocol (dialect: postgresql).
 * Invariants:
 *   - DB_PER_NODE: this schema applies to `knowledge_poly` only. Operator and resy get their own @cogni/<node>-doltgres-schema packages when they adopt Doltgres.
 *   - SCHEMA_GENERIC_CONTENT_SPECIFIC: poly-specific content lives in rows (domain + tags JSONB), not columns. Add companion tables here only for genuinely new entities.
 *   - Dialect separation: this package is NOT globbed by nodes/poly/drizzle.config.ts (which targets Postgres); only by nodes/poly/drizzle.doltgres.config.ts.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md, docs/spec/multi-node-tenancy.md, work/items/task.0311.poly-knowledge-syntropy-seed.md
 * @public
 */

// Base knowledge table — inherited from node-template, identical across nodes
// until schema divergence is needed. Safe re-export; the Drizzle table object
// is the same instance across all nodes' Doltgres schema packages.
export { knowledge } from "@cogni/node-template-knowledge";

// Poly-specific companion tables go here as they're needed, e.g.:
// export const polyMarketCategories = pgTable("poly_market_categories", { ... });
