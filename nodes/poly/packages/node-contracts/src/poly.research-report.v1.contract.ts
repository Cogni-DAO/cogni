// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-contracts/poly.research-report.v1.contract`
 * Purpose: Output contract for the `poly-research` LangGraph peer graph (task.0386).
 * Scope: Zod report contract consumed as `responseFormat` + serialized in HTTP response. Does not execute graphs, does not load env.
 * Invariants:
 *   - PURE_LIBRARY: No env, no adapters
 *   - SINGLE_CONTRACT_SOURCE: Tool graph imports from here, never redefines
 * Side-effects: none
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @public
 */

import { z } from "zod";

import { PolyAddressSchema } from "./poly.wallet-analysis.v1.contract";

/**
 * Per-candidate stats. Sparse by design: the agent is free to leave fields
 * null/empty when evidence is weak. Downstream callers (ranking UI, future
 * Dolt persistence in task.0334) should treat null as "unknown", not "zero".
 */
export const PolyResearchCandidateStatsSchema = z.object({
  /** All-time or windowed realized PnL in USDC as reconstructed by the agent. */
  totalPnl: z.number(),
  /** Resolved-markets win-rate in [0,1]. Null when sample too small to compute. */
  winRate: z.number().min(0).max(1).nullable(),
  /** Number of resolved markets the win-rate was computed against. */
  sampleSize: z.number().int().nonnegative(),
  /** Categories the wallet focuses on (e.g. ["sports", "politics"]). */
  categoryFocus: z.array(z.string()).optional(),
});
export type PolyResearchCandidateStats = z.infer<
  typeof PolyResearchCandidateStatsSchema
>;

/**
 * One candidate wallet in the ranked research output.
 */
export const PolyResearchCandidateSchema = z.object({
  proxyWallet: PolyAddressSchema,
  /** Polymarket handle / display username; null when unverified. */
  userName: z.string().nullable(),
  /** 1-indexed rank within the report. */
  rank: z.number().int().positive(),
  /** Qualitative confidence the agent has in this candidate. */
  confidence: z.enum(["low", "medium", "high"]),
  stats: PolyResearchCandidateStatsSchema,
  /** Short prose justifying the ranking decision. */
  reasoning: z.string(),
  /** Evidence URLs the agent relied on (Polymarket profile, markets, etc.). */
  evidenceUrls: z.array(z.string().url()),
});
export type PolyResearchCandidate = z.infer<typeof PolyResearchCandidateSchema>;

/**
 * Structured research report — the final-message output of the `poly-research` graph.
 */
export const PolyResearchReportSchema = z.object({
  /** Verbatim (or paraphrased) research query submitted to the graph. */
  query: z.string(),
  /** Plain-English summary of the discovery methodology used. */
  methodology: z.string(),
  /** Ranked candidates. */
  candidates: z.array(PolyResearchCandidateSchema),
  /** Known limitations / biases of this run (sample size, rate limits, etc.). */
  caveats: z.array(z.string()),
  /** Agent's top-level recommendation; null when not asked for one. */
  recommendation: z
    .enum(["mirror-high-confidence", "monitor", "reject"])
    .nullable(),
});
export type PolyResearchReport = z.infer<typeof PolyResearchReportSchema>;
