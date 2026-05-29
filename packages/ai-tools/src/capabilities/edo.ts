// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/capabilities/edo`
 * Purpose: EdoCapability interface and parameter types for atomic four-beat operations on the hypothesis loop.
 * Scope: Interface + parameter types only. Does not contain I/O, implementations, or framework dependencies.
 * Invariants:
 *   - AUTH_VIA_CAPABILITY_INTERFACE: tools receive this, never a DSN.
 *   - EDO_TOOLS_ATOMIC: each method writes entry + edges + commit in one call.
 * Side-effects: none
 * Links: docs/spec/knowledge-syntropy.md
 * @public
 */

import type { KnowledgeEntry } from "./knowledge.js";

/**
 * Source type for EDO writes. Mirrors the domain SourceType enum.
 */
export type EdoSourceType =
  | "human"
  | "agent"
  | "analysis_signal"
  | "external"
  | "derived";

/**
 * Inputs to `hypothesize`. Files a `hypothesis` row + N `evidence_for`
 * citations + commits.
 */
export interface HypothesizeParams {
  id: string;
  domain: string;
  title: string;
  content: string;
  /** When the hypothesis should resolve. REQUIRED (HYPOTHESIS_HAS_EVALUATE_AT). */
  evaluateAt: Date;
  /**
   * Resolution strategy. NULL/undefined = manual (cron skips; row sits until
   * explicit `recordOutcome`). v0 non-null value: `'agent'`. Future kinds
   * (`market:<id>`, `metric:<query>`, `http:<url>`, `deadline`) add values.
   */
  resolutionStrategy?: string | null;
  /** IDs of event/observation/finding rows that motivate this prediction. */
  evidenceForIds?: string[];
  sourceType: EdoSourceType;
  sourceRef?: string;
  sourceNode?: string;
  tags?: string[];
  confidencePct?: number;
}

/**
 * Inputs to `decide`. Files a `decision` row + 1 `derives_from` citation +
 * commits. The decision MUST derive from a hypothesis
 * (DECISION_CITES_HYPOTHESIS + EDGE_TYPE_MATCHES_CITED_ENTRY_TYPE).
 */
export interface DecideParams {
  id: string;
  domain: string;
  title: string;
  content: string;
  /** ID of the hypothesis being acted on. MUST refer to entry_type='hypothesis'. */
  derivesFromHypothesisId: string;
  sourceType: EdoSourceType;
  sourceRef?: string;
  sourceNode?: string;
  tags?: string[];
  confidencePct?: number;
}

/**
 * Inputs to `recordOutcome`. Files an `outcome` row + 1 validates/invalidates
 * citation + recomputes confidence on the hypothesis + commits.
 */
export interface RecordOutcomeParams {
  id: string;
  domain: string;
  title: string;
  content: string;
  /** ID of the hypothesis being resolved. */
  hypothesisId: string;
  /** Did the prediction hold? */
  edge: "validates" | "invalidates";
  sourceType: EdoSourceType;
  sourceRef?: string;
  sourceNode?: string;
  tags?: string[];
  confidencePct?: number;
}

/**
 * Output of `recordOutcome` — includes the recomputed confidence on the
 * hypothesis so the agent can see the loop close.
 */
export interface RecordOutcomeResult {
  outcome: KnowledgeEntry;
  hypothesisId: string;
  resolvedConfidence: number;
  citationId: string;
  /** True if the hypothesis was already resolved; this call was a no-op. */
  alreadyResolved: boolean;
}

/**
 * EdoCapability — atomic four-beat operations on the hypothesis loop.
 *
 * Backed by `KnowledgeStorePort` + `EdoResolverPort` + auto-commit. Each call
 * is a single Doltgres commit: row + edges + (for outcomes) confidence
 * recompute.
 */
export interface EdoCapability {
  /** File a hypothesis row with evaluate_at + N evidence_for edges + commit. */
  hypothesize(params: HypothesizeParams): Promise<KnowledgeEntry>;
  /** File a decision row + 1 derives_from edge + commit. */
  decide(params: DecideParams): Promise<KnowledgeEntry>;
  /**
   * File an outcome row + 1 validates/invalidates edge + recompute confidence +
   * commit. Idempotent on already-resolved hypotheses.
   */
  recordOutcome(params: RecordOutcomeParams): Promise<RecordOutcomeResult>;
}
