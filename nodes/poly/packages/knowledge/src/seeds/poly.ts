/**
 * Module: `@cogni/poly-knowledge/seeds/poly`
 * Purpose: Prediction market domain knowledge seeds for the poly node.
 * Side-effects: none
 * @public
 */

import type { NewKnowledge } from "@cogni/knowledge-store";
import { CONFIDENCE } from "@cogni/ai-tools";

/** Base seeds inherited from node-template */
export { BASE_KNOWLEDGE_SEEDS } from "@cogni/node-template-knowledge";

/** Poly-specific prediction market knowledge seeds */
export const POLY_KNOWLEDGE_SEEDS: NewKnowledge[] = [
  {
    id: "poly-strategy-001",
    domain: "strategy",
    title: "Calibrated market analyst",
    content:
      "Base rate anchoring → news update integration → fair probability estimation → thesis formation. " +
      "Always start from historical base rates before incorporating current information. " +
      "Explicitly state confidence intervals. Flag when market price diverges >15% from estimated fair value.",
    sourceType: "human",
    confidencePct: CONFIDENCE.VERIFIED,
    tags: ["strategy", "analysis", "methodology"],
  },
  {
    id: "poly-impl-001",
    domain: "implementation",
    title: "Market data polling architecture",
    content:
      "Polymarket data flows through MarketProviderPort → PollAdapter → Redis stream → selective Postgres persistence. " +
      "Polling interval is configured per market based on liquidity and time-to-resolution. " +
      "High-liquidity markets (>$1M) poll every 60s. Low-liquidity markets poll every 300s.",
    sourceType: "derived",
    confidencePct: CONFIDENCE.DRAFT,
    tags: ["implementation", "architecture", "polling"],
  },
  {
    id: "poly-impl-002",
    domain: "implementation",
    title: "Signal generation pipeline",
    content:
      "Signals are generated when observation triggers fire (price movement >5%, volume spike >2x baseline). " +
      "Trigger → analysis graph → scored signal → persist to awareness plane. " +
      "High-confidence signals (>70%) are promoted to knowledge via the promotion gate.",
    sourceType: "derived",
    confidencePct: CONFIDENCE.DRAFT,
    tags: ["implementation", "signals", "pipeline"],
  },
];
