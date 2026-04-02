/**
 * Module: `@cogni/node-template-knowledge/seeds/base`
 * Purpose: Base knowledge seeds inherited by all nodes.
 * Scope: Seed data definitions only. No I/O — the provisioning script applies these.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md
 * @public
 */

import type { NewKnowledge } from "@cogni/knowledge-store";

/**
 * Base knowledge seeds — generic domain knowledge that every node inherits.
 * Nodes extend this with domain-specific seeds in their own seeds/ directory.
 */
export const BASE_KNOWLEDGE_SEEDS: NewKnowledge[] = [
  {
    id: "cogni-meta-001",
    domain: "meta",
    title: "Knowledge store overview",
    content:
      "This node uses a Doltgres-backed knowledge store with git-like versioning. " +
      "Knowledge is separated from hot operational data (awareness plane). " +
      "Use commit() after writes to create versioned snapshots.",
    sourceType: "human",
    tags: ["meta", "knowledge-store", "onboarding"],
  },
];
