// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/adapters/doltgres/edo-resolver`
 * Purpose: DoltgresEdoResolverAdapter — Doltgres-backed implementation of EdoResolverPort with pure-from-citations 1-hop confidence walks.
 * Scope: Adapter only. Does not contain port interfaces, env loading, or runtime lifecycle. SQL via sql.unsafe() + escapeValue() (Doltgres has no extended query protocol).
 * Invariants:
 *   - RECOMPUTE_IS_PURE_FROM_CITATIONS: recompute reads citations and computes from scratch.
 *   - RESOLVER_IDEMPOTENT: re-resolving an already-resolved hypothesis is a no-op.
 *   - All SQL via sql.unsafe() + escapeValue() for injection safety.
 * Side-effects: IO (database reads + writes + dolt_commit)
 * Links: docs/spec/knowledge-syntropy.md
 * @public
 */

import type { Sql } from "postgres";

import type { Citation, Knowledge } from "../../domain/schemas.js";
import type {
  EdoResolverPort,
  PendingResolutionsOptions,
  ResolutionInput,
  ResolutionResult,
} from "../../port/edo-resolver.port.js";
import type { KnowledgeStorePort } from "../../port/knowledge-store.port.js";
import { escapeValue } from "./util.js";

// ---------------------------------------------------------------------------
// Confidence formula constants (knowledge-syntropy § Confidence Is Computed)
// ---------------------------------------------------------------------------

const SUPPORT_BUMP = 10;
const SUPPORT_CAP = 50;
const CONTRADICT_PENALTY = 15;
const CLAMP_MIN = 0;
const CLAMP_MAX = 100;

// Initial confidence per source_type (knowledge-syntropy § Write Protocol).
const INITIAL_BY_SOURCE: Record<string, number> = {
  agent: 30,
  analysis_signal: 40,
  external: 50,
  human: 70,
  derived: 40,
};
const INITIAL_DEFAULT = 40;

function initialConfidenceForSource(sourceType: string): number {
  return INITIAL_BY_SOURCE[sourceType] ?? INITIAL_DEFAULT;
}

function isSupporting(citationType: string): boolean {
  return (
    citationType === "supports" ||
    citationType === "validates" ||
    citationType === "evidence_for" ||
    citationType === "extends"
  );
}

function isContradicting(citationType: string): boolean {
  return citationType === "contradicts" || citationType === "invalidates";
}

function clamp(n: number): number {
  return Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, n));
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface DoltgresEdoResolverConfig {
  sql: Sql;
  /**
   * The KnowledgeStorePort used to mutate rows/edges + commit. Sharing the
   * same port ensures every resolver write goes through adapter invariants
   * (CITATION_TARGET_EXISTS_AT_WRITE, EDGE_TYPE_MATCHES_CITED_ENTRY_TYPE).
   */
  store: KnowledgeStorePort;
}

export class DoltgresEdoResolverAdapter implements EdoResolverPort {
  private readonly sql: Sql;
  private readonly store: KnowledgeStorePort;

  constructor(config: DoltgresEdoResolverConfig) {
    this.sql = config.sql;
    this.store = config.store;
  }

  async pendingResolutions(
    now: Date,
    opts?: PendingResolutionsOptions,
  ): Promise<Knowledge[]> {
    const limit = opts?.limit ?? 100;
    const strategyFilter =
      opts?.strategy !== undefined
        ? opts.strategy.endsWith(":")
          ? `AND k.resolution_strategy LIKE ${escapeValue(`${opts.strategy}%`)}`
          : `AND k.resolution_strategy = ${escapeValue(opts.strategy)}`
        : "";
    // Exclude hypotheses that already have a validates/invalidates citation.
    const rows = await this.sql.unsafe(
      `SELECT k.* FROM knowledge k
       WHERE k.entry_type = 'hypothesis'
         AND k.resolution_strategy IS NOT NULL
         AND k.evaluate_at IS NOT NULL
         AND k.evaluate_at <= ${escapeValue(now)}
         ${strategyFilter}
         AND NOT EXISTS (
           SELECT 1 FROM citations c
           WHERE c.cited_id = k.id
             AND c.citation_type IN ('validates', 'invalidates')
         )
       ORDER BY k.evaluate_at
       LIMIT ${limit}`,
    );
    return rows.map((r) => rowToKnowledgeForResolver(r as Record<string, unknown>));
  }

  async resolveHypothesis(input: ResolutionInput): Promise<ResolutionResult> {
    // RESOLVER_IDEMPOTENT: if a validates/invalidates already exists, no-op.
    const existing = await this.sql.unsafe(
      `SELECT id, citing_id, citation_type FROM citations
       WHERE cited_id = ${escapeValue(input.hypothesisId)}
         AND citation_type IN ('validates', 'invalidates')
       LIMIT 1`,
    );
    if (existing.length > 0) {
      const row = existing[0] as Record<string, unknown>;
      const confidence = await this.recomputeConfidence(input.hypothesisId);
      return {
        // Return the EXISTING outcome row's id (the citing_id of the
        // resolving citation). Idempotency is keyed on the hypothesis.
        outcomeId: row.citing_id as string,
        citationId: row.id as string,
        resolvedConfidence: confidence,
        alreadyResolved: true,
      };
    }

    // 1. Write the outcome row.
    const outcome = await this.store.addKnowledge({
      id: input.outcomeId,
      domain: input.domain,
      title: input.outcomeTitle,
      content: input.outcomeContent,
      entryType: "outcome",
      sourceType: input.sourceType,
      sourceRef: input.sourceRef ?? null,
    });

    // 2. Write the validates/invalidates citation.
    //    Adapter enforces CITATION_TARGET_EXISTS_AT_WRITE +
    //    EDGE_TYPE_MATCHES_CITED_ENTRY_TYPE.
    const citation = await this.store.addCitation({
      citingId: outcome.id,
      citedId: input.hypothesisId,
      citationType: input.edge,
      context: `resolved by ${input.sourceType}`,
    });

    // 3. Recompute confidence on the hypothesis (1-hop, pure).
    const resolvedConfidence = await this.recomputeConfidence(
      input.hypothesisId,
    );

    // 4. One Dolt commit per resolution.
    await this.store.commit(
      `edo: resolve hypothesis ${input.hypothesisId} (${input.edge}, conf: ${resolvedConfidence}%)`,
    );

    return {
      outcomeId: outcome.id,
      citationId: citation.id,
      resolvedConfidence,
      alreadyResolved: false,
    };
  }

  async recomputeConfidence(entryId: string): Promise<number> {
    // RECOMPUTE_IS_PURE_FROM_CITATIONS — read all incoming edges + the row,
    // compute from scratch, write. Order-independent under concurrency.
    const entry = await this.store.getKnowledge(entryId);
    if (!entry) {
      throw new Error(`recomputeConfidence: entry '${entryId}' not found`);
    }

    const incoming: Citation[] = await this.store.listCitationsByCitedId(
      entryId,
    );

    const initial = initialConfidenceForSource(entry.sourceType);
    let supportCount = 0;
    let contradictCount = 0;
    for (const c of incoming) {
      if (isSupporting(c.citationType)) supportCount++;
      else if (isContradicting(c.citationType)) contradictCount++;
    }

    const supportBump = Math.min(SUPPORT_CAP, SUPPORT_BUMP * supportCount);
    const contradictPenalty = CONTRADICT_PENALTY * contradictCount;
    const next = clamp(initial + supportBump - contradictPenalty);

    // Persist (idempotent — writing the same value is a no-op semantically).
    await this.store.updateKnowledge(entryId, { confidencePct: next });

    return next;
  }
}

function rowToKnowledgeForResolver(row: Record<string, unknown>): Knowledge {
  return {
    id: row.id as string,
    domain: row.domain as string,
    entityId: (row.entity_id as string) ?? null,
    title: row.title as string,
    content: row.content as string,
    entryType: row.entry_type as string,
    confidencePct:
      row.confidence_pct != null ? Number(row.confidence_pct) : null,
    sourceType: row.source_type as Knowledge["sourceType"],
    sourceRef: (row.source_ref as string) ?? null,
    tags: row.tags as string[] | null,
    evaluateAt: row.evaluate_at ? new Date(row.evaluate_at as string) : null,
    resolutionStrategy: (row.resolution_strategy as string) ?? null,
    createdAt: row.created_at ? new Date(row.created_at as string) : undefined,
  };
}
