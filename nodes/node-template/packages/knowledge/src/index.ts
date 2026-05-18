/**
 * Module: `@cogni/node-template-knowledge`
 * Purpose: Base knowledge Drizzle schema (the syntropy seed bundle) + seeds for the node-template.
 * Scope: Schema definitions and seed data. No I/O.
 * Invariants: Nodes inherit this base. Domain-specific extensions go in the node's own package.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md, docs/spec/knowledge-syntropy.md
 * @public
 */

// Schema (Drizzle table definitions — drizzle-kit owns migrations)
export {
  citations,
  domains,
  knowledge,
  knowledgeContributions,
  sources,
} from "./schema.js";

// Seeds
export { BASE_KNOWLEDGE_SEEDS } from "./seeds/base.js";
export { BASE_DOMAIN_SEEDS } from "./seeds/domains.js";
