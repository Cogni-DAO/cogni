// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/operator-doltgres-schema/knowledge`
 * Purpose: Operator's Doltgres knowledge schema. Re-exports the syntropy seed
 *   bundle from @cogni/node-template-knowledge so operator inherits the
 *   identical knowledge shape every other knowledge-capable node uses.
 *   Operator-specific companion tables (e.g. operator-only audit views) land
 *   here when needed.
 * Scope: Drizzle table definitions only. Targets Doltgres via pg wire protocol (dialect: postgresql).
 * Invariants:
 *   - DB_PER_NODE: this schema applies to `knowledge_operator` only.
 *   - SCHEMA_GENERIC_CONTENT_SPECIFIC: operator-specific content lives in rows (domain + tags), not columns. Add companion tables here only for genuinely new entities.
 *   - Dialect separation: this package is NOT globbed by nodes/operator/drizzle.config.ts (which targets Postgres); only by nodes/operator/drizzle.doltgres.config.ts.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md, docs/spec/knowledge-syntropy.md, work/items/task.0425.knowledge-contribution-api.md
 * @public
 */

// Syntropy seed bundle — inherited from node-template. Identical across all
// knowledge-capable nodes until per-node schema divergence is needed.
export {
  citations,
  domains,
  knowledge,
  knowledgeContributions,
  sources,
} from "@cogni/node-template-knowledge";

// Operator-specific companion tables go here as they're needed.
