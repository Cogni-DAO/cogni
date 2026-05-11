// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/port/edo-resolver`
 * Purpose: EdoResolverPort interface — causal and evaluative operations over the citation DAG (pending resolutions, hypothesis resolution, confidence recompute).
 * Scope: Port interface + types only. Does not contain implementations, I/O, or framework dependencies.
 * Invariants:
 *   - RECOMPUTE_IS_PURE_FROM_CITATIONS: recompute reads ALL relevant citations and computes from scratch — never increments.
 *   - RESOLVER_IDEMPOTENT: double-resolving the same hypothesis is a no-op.
 * Side-effects: none
 * Links: docs/spec/knowledge-syntropy.md
 * @public
 */

import type { Knowledge } from "../domain/schemas.js";

/**
 * Pending-resolutions query options.
 */
export interface PendingResolutionsOptions {
  /**
   * Maximum rows to return. Honors `RESOLVER_MAX_BATCH_PER_TICK` —
   * the cron passes a small cap (v0: 10) to bound LLM fan-out.
   */
  limit?: number;
  /**
   * If set, returns only hypotheses whose `resolution_strategy` matches
   * this exact value or this namespace prefix (e.g. `"agent"`, `"market:"`).
   * If omitted, returns all non-null resolution_strategy rows.
   */
  strategy?: string;
}

/**
 * The edge type recorded by `resolveHypothesis`. v0: hypothesis was either
 * right (validates) or wrong (invalidates). Future kinds (`partially_validates`,
 * `inconclusive`) extend this without breaking the v0 binary.
 */
export type ResolutionEdge = "validates" | "invalidates";

/**
 * Input to `resolveHypothesis` — what the resolver gathered for the outcome.
 * The outcome row is filed in `knowledge` with `entry_type='outcome'`;
 * a citation row is filed in `citations` of type `validates`/`invalidates`
 * pointing at the resolved hypothesis.
 */
export interface ResolutionInput {
  /** ID of the hypothesis being resolved. */
  hypothesisId: string;
  /**
   * Domain for the outcome row. Typically inherited from the hypothesis;
   * caller passes through so the port doesn't need to read the hypothesis
   * twice (resolver already has it from `pendingResolutions`).
   */
  domain: string;
  /** Outcome entry id (deterministic for idempotency, e.g. `outcome:<hypothesisId>`). */
  outcomeId: string;
  /** Outcome title — one-line summary of what happened. */
  outcomeTitle: string;
  /** Outcome content — the observed result. */
  outcomeContent: string;
  /** Did the prediction hold? `validates` | `invalidates`. */
  edge: ResolutionEdge;
  /** Where the outcome data came from. */
  sourceType:
    | "human"
    | "agent"
    | "analysis_signal"
    | "external"
    | "derived";
  /** Optional pointer (URL, signal ID, etc.). */
  sourceRef?: string | null;
  /** Optional node identifier ("operator", "poly-cron", etc.). */
  sourceNode?: string | null;
}

/**
 * Result of resolving a hypothesis.
 */
export interface ResolutionResult {
  /** The outcome row that was filed. */
  outcomeId: string;
  /** Citation row id for the validates/invalidates edge. */
  citationId: string;
  /** Recomputed confidence on the hypothesis (1-hop walk per RECOMPUTE_IS_PURE_FROM_CITATIONS). */
  resolvedConfidence: number;
  /** True if the hypothesis was already resolved (idempotent re-fire). */
  alreadyResolved: boolean;
}

/**
 * EdoResolverPort — closes the hypothesis loop.
 *
 * Implementations sit alongside the storage adapter for the same node's
 * Doltgres DB. The resolver reads pending hypotheses, writes outcome rows +
 * validates/invalidates citations, and recomputes confidence on the cited
 * hypothesis — all via the same `KnowledgeStorePort` adapter, with one Dolt
 * commit per resolution.
 */
export interface EdoResolverPort {
  /**
   * Return hypotheses where `evaluate_at <= now()` and `resolution_strategy
   * IS NOT NULL` (i.e. opted into automation). NULL strategy means manual —
   * the cron skips, the row sits until an external `core__edo_record_outcome`.
   *
   * Filters out already-resolved hypotheses (those with ≥1 incoming
   * validates/invalidates citation).
   */
  pendingResolutions(
    now: Date,
    opts?: PendingResolutionsOptions,
  ): Promise<Knowledge[]>;

  /**
   * File the outcome + validates/invalidates citation + recompute confidence,
   * atomically inside one Dolt commit. Idempotent: if the hypothesis already
   * has a resolving citation, returns the existing state (alreadyResolved=true)
   * without writing.
   */
  resolveHypothesis(input: ResolutionInput): Promise<ResolutionResult>;

  /**
   * Recompute the confidence_pct on a knowledge row by reading its 1-hop
   * citation neighborhood and applying the formula from knowledge-syntropy.md
   * § Confidence Is Computed, Not Assigned.
   *
   * Pure: reads all relevant citations + the row, computes from scratch,
   * writes the result. Order-independent under concurrency
   * (RECOMPUTE_IS_PURE_FROM_CITATIONS). Returns the new confidence.
   */
  recomputeConfidence(entryId: string): Promise<number>;
}
