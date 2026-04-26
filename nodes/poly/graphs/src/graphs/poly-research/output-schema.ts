// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-graphs/graphs/poly-research/output-schema`
 * Purpose: Re-export the canonical PolyResearchReport contract for graph-local use (task.0386).
 * Scope: Pure re-exports. Tool code imports from here; contract body lives in node-contracts. Does not define new types, does not load env.
 * Invariants: SINGLE_CONTRACT_SOURCE.
 * Side-effects: none
 * Links: packages/node-contracts/src/poly.research-report.v1.contract.ts
 * @public
 */

export {
  type PolyResearchCandidate,
  PolyResearchCandidateSchema,
  type PolyResearchCandidateStats,
  PolyResearchCandidateStatsSchema,
  type PolyResearchReport,
  PolyResearchReportSchema,
} from "@cogni/node-contracts";
