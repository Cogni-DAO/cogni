// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/activities/enrichment`
 * Purpose: Temporal Activities for epoch enrichment — draft evaluation creation and final evaluation building.
 * Scope: Echo enricher (cogni.echo.v0) as plumbing proof. Future enrichers follow the same factory pattern.
 * Invariants:
 * - ENRICHER_IDEMPOTENT: Same receipts → same hashes → same evaluation.
 * - ENRICHER_DRAFT_ONLY: evaluateEpochDraft writes status='draft' only; buildLockedEvaluations returns data without writing.
 * Side-effects: IO (database via ledgerStore)
 * Links: work/items/task.0113.epoch-artifact-pipeline.md
 * @internal
 */

import {
  computeArtifactsHash,
  computeEnricherInputsHash,
  sha256OfCanonicalJson,
} from "@cogni/ledger-core";

import type { Logger } from "../observability/logger.js";
import type { EpochLedgerStore } from "../ports/index.js";

/** Namespaced evaluation ref for the echo enricher. */
export const ECHO_EVALUATION_REF = "cogni.echo.v0";

/** Algorithm ref for the echo enricher. */
export const ECHO_ALGO_REF = "echo-v0";

/**
 * Dependencies injected into enrichment activities.
 */
export interface EnrichmentActivityDeps {
  readonly ledgerStore: EpochLedgerStore;
  readonly nodeId: string;
  readonly logger: Logger;
}

/**
 * Input for evaluateEpochDraft activity.
 */
export interface EvaluateEpochDraftInput {
  readonly epochId: string; // bigint serialized as string for Temporal
}

/**
 * Output from evaluateEpochDraft activity.
 */
export interface EvaluateEpochDraftOutput {
  readonly evaluationRef: string;
  readonly receiptCount: number;
}

/**
 * Input for buildLockedEvaluations activity.
 */
export interface BuildLockedEvaluationsInput {
  readonly epochId: string; // bigint serialized as string for Temporal
}

/**
 * Evaluation params serialized for Temporal wire format.
 * All bigint fields represented as decimal strings — Temporal serializes
 * activity args/returns as JSON, and JSON.stringify(bigint) throws.
 * Inside activities, convert back: BigInt(epochId).
 */
export interface UpsertEvaluationParamsWire {
  readonly nodeId: string;
  readonly epochId: string; // bigint as decimal string
  readonly evaluationRef: string;
  readonly status: "draft" | "locked";
  readonly algoRef: string;
  readonly inputsHash: string;
  readonly payloadHash: string;
  readonly payloadJson: Record<string, unknown>;
}

/**
 * Output from buildLockedEvaluations activity.
 */
export interface BuildLockedEvaluationsOutput {
  readonly evaluations: UpsertEvaluationParamsWire[];
  readonly artifactsHash: string;
}

/**
 * Creates enrichment activity functions with injected dependencies.
 */
export function createEnrichmentActivities(deps: EnrichmentActivityDeps) {
  const { ledgerStore, nodeId, logger } = deps;

  /**
   * Build the echo payload from selected receipts.
   * Pure computation — same receipts always produce same payload.
   */
  function buildEchoPayload(
    receipts: ReadonlyArray<{
      receiptId: string;
      eventType: string;
      userId: string;
    }>
  ): Record<string, unknown> {
    const byEventType: Record<string, number> = {};
    const byUserId: Record<string, number> = {};

    for (const r of receipts) {
      byEventType[r.eventType] = (byEventType[r.eventType] ?? 0) + 1;
      byUserId[r.userId] = (byUserId[r.userId] ?? 0) + 1;
    }

    return {
      totalEvents: receipts.length,
      byEventType,
      byUserId,
    };
  }

  /**
   * Evaluate epoch with draft echo evaluation.
   * Writes status='draft' via upsertDraftEvaluation (overwrites on each pass).
   */
  async function evaluateEpochDraft(
    input: EvaluateEpochDraftInput
  ): Promise<EvaluateEpochDraftOutput> {
    const epochId = BigInt(input.epochId);

    logger.info({ epochId: input.epochId }, "Evaluating epoch draft (echo)");

    const receipts = await ledgerStore.getSelectedReceiptsWithMetadata(epochId);

    const payload = buildEchoPayload(receipts);
    const payloadHash = await sha256OfCanonicalJson(payload);
    const inputsHash = await computeEnricherInputsHash({
      epochId,
      receipts: receipts.map((r) => ({
        receiptId: r.receiptId,
        receiptPayloadHash: r.payloadHash,
      })),
    });

    await ledgerStore.upsertDraftEvaluation({
      nodeId,
      epochId,
      evaluationRef: ECHO_EVALUATION_REF,
      status: "draft",
      algoRef: ECHO_ALGO_REF,
      inputsHash,
      payloadHash,
      payloadJson: payload,
    });

    logger.info(
      {
        epochId: input.epochId,
        evaluationRef: ECHO_EVALUATION_REF,
        receiptCount: receipts.length,
      },
      "Echo draft evaluation written"
    );

    return {
      evaluationRef: ECHO_EVALUATION_REF,
      receiptCount: receipts.length,
    };
  }

  /**
   * Build final (locked) evaluations for epoch close.
   * Returns evaluation params and artifactsHash — does NOT write to store.
   * The caller (autoCloseIngestion) writes via closeIngestionWithEvaluations atomically.
   */
  async function buildLockedEvaluations(
    input: BuildLockedEvaluationsInput
  ): Promise<BuildLockedEvaluationsOutput> {
    const epochId = BigInt(input.epochId);

    logger.info({ epochId: input.epochId }, "Building locked evaluations");

    const receipts = await ledgerStore.getSelectedReceiptsWithMetadata(epochId);

    const payload = buildEchoPayload(receipts);
    const payloadHash = await sha256OfCanonicalJson(payload);
    const inputsHash = await computeEnricherInputsHash({
      epochId,
      receipts: receipts.map((r) => ({
        receiptId: r.receiptId,
        receiptPayloadHash: r.payloadHash,
      })),
    });

    const evaluation: UpsertEvaluationParamsWire = {
      nodeId,
      epochId: input.epochId, // keep as string for Temporal wire format
      evaluationRef: ECHO_EVALUATION_REF,
      status: "locked",
      algoRef: ECHO_ALGO_REF,
      inputsHash,
      payloadHash,
      payloadJson: payload,
    };

    const artifactsHash = await computeArtifactsHash([evaluation]);

    logger.info(
      {
        epochId: input.epochId,
        evaluationCount: 1,
        artifactsHash: `${artifactsHash.slice(0, 12)}...`,
      },
      "Locked evaluations built"
    );

    return {
      evaluations: [evaluation],
      artifactsHash,
    };
  }

  return {
    evaluateEpochDraft,
    buildLockedEvaluations,
  };
}

/** Type alias for workflow proxy usage. */
export type EnrichmentActivities = ReturnType<
  typeof createEnrichmentActivities
>;
