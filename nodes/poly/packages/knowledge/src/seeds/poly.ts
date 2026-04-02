/**
 * Module: `@cogni/poly-knowledge/seeds/poly`
 * Purpose: Poly node re-exports base seeds. Domain-specific seeds added as knowledge accumulates.
 * Side-effects: none
 * @public
 */

// Poly starts with the same base seeds as every node.
// Domain-specific knowledge is added at runtime via KnowledgeStorePort, not hardcoded here.
export { BASE_KNOWLEDGE_SEEDS as POLY_KNOWLEDGE_SEEDS } from "@cogni/node-template-knowledge";
