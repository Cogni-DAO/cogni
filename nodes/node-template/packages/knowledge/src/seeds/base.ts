/**
 * Module: `@cogni/node-template-knowledge/seeds/base`
 * Purpose: Base knowledge seeds inherited by all nodes.
 * Scope: Seed data definitions only. No I/O — the provisioning script applies these.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md, docs/spec/knowledge-syntropy.md
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
    confidencePct: 80,
    tags: ["meta", "knowledge-store", "onboarding"],
  },
  {
    id: "cogni-meta-confidence-convention",
    domain: "meta",
    title: "Confidence-score convention across the knowledge plane",
    content:
      "Every row in every knowledge table carries a `confidence_pct` integer (0-100) " +
      "representing 'our confidence this row is 100% clear and accurate'. New rows " +
      "default to 40 — start low; raise as evidence accumulates. Future guidance / " +
      "rubrics will define the path to higher scores. Will we ever reach 100%? TBD. " +
      "Suggested anchors: 40 = baseline (just inserted, not corroborated), " +
      "60 = candidate (multiple corroborating sources, no contradictions), " +
      "80 = verified (human-reviewed or outcome-validated), " +
      "95 = hardened (statistically significant, repeatedly confirmed), " +
      "100 = factual and works (objectively verifiable + currently functioning — " +
      "e.g., a code path with passing tests, a settled mathematical fact). " +
      "Below 100 = the room where new evidence can still refine.",
    sourceType: "human",
    confidencePct: 80,
    tags: ["meta", "confidence", "convention", "syntropy"],
  },
];
