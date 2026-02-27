// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/activities/enrichment`
 * Purpose: Temporal Activities for epoch enrichment — draft artifact creation and final artifact building.
 * Scope: Echo enricher (cogni.echo.v0) as plumbing proof. Future enrichers follow the same factory pattern.
 * Invariants:
 * - ENRICHER_IDEMPOTENT: Same events → same hashes → same artifact.
 * - ENRICHER_DRAFT_ONLY: enrichEpochDraft writes status='draft' only; buildFinalArtifacts returns data without writing.
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
import type { ActivityLedgerStore } from "../ports/index.js";

/** Namespaced artifact ref for the echo enricher. */
export const ECHO_ARTIFACT_REF = "cogni.echo.v0";

/** Algorithm ref for the echo enricher. */
export const ECHO_ALGO_REF = "echo-v0";

/**
 * Dependencies injected into enrichment activities.
 */
export interface EnrichmentActivityDeps {
  readonly ledgerStore: ActivityLedgerStore;
  readonly nodeId: string;
  readonly logger: Logger;
}

/**
 * Input for enrichEpochDraft activity.
 */
export interface EnrichEpochDraftInput {
  readonly epochId: string; // bigint serialized as string for Temporal
}

/**
 * Output from enrichEpochDraft activity.
 */
export interface EnrichEpochDraftOutput {
  readonly artifactRef: string;
  readonly eventCount: number;
}

/**
 * Input for buildFinalArtifacts activity.
 */
export interface BuildFinalArtifactsInput {
  readonly epochId: string; // bigint serialized as string for Temporal
}

/**
 * Artifact params serialized for Temporal wire format.
 * All bigint fields represented as decimal strings — Temporal serializes
 * activity args/returns as JSON, and JSON.stringify(bigint) throws.
 * Inside activities, convert back: BigInt(epochId).
 */
export interface UpsertArtifactParamsWire {
  readonly nodeId: string;
  readonly epochId: string; // bigint as decimal string
  readonly artifactRef: string;
  readonly status: "draft" | "locked";
  readonly algoRef: string;
  readonly inputsHash: string;
  readonly payloadHash: string;
  readonly payloadJson: Record<string, unknown>;
}

/**
 * Output from buildFinalArtifacts activity.
 */
export interface BuildFinalArtifactsOutput {
  readonly artifacts: UpsertArtifactParamsWire[];
  readonly artifactsHash: string;
}

/**
 * Creates enrichment activity functions with injected dependencies.
 */
export function createEnrichmentActivities(deps: EnrichmentActivityDeps) {
  const { ledgerStore, nodeId, logger } = deps;

  /**
   * Build the echo payload from curated events.
   * Pure computation — same events always produce same payload.
   */
  function buildEchoPayload(
    events: ReadonlyArray<{
      eventId: string;
      eventType: string;
      userId: string;
    }>
  ): Record<string, unknown> {
    const byEventType: Record<string, number> = {};
    const byUserId: Record<string, number> = {};

    for (const e of events) {
      byEventType[e.eventType] = (byEventType[e.eventType] ?? 0) + 1;
      byUserId[e.userId] = (byUserId[e.userId] ?? 0) + 1;
    }

    return {
      totalEvents: events.length,
      byEventType,
      byUserId,
    };
  }

  /**
   * Enrich epoch with draft echo artifact.
   * Writes status='draft' via upsertDraftArtifact (overwrites on each pass).
   */
  async function enrichEpochDraft(
    input: EnrichEpochDraftInput
  ): Promise<EnrichEpochDraftOutput> {
    const epochId = BigInt(input.epochId);

    logger.info({ epochId: input.epochId }, "Enriching epoch draft (echo)");

    const events = await ledgerStore.getCuratedEventsWithMetadata(epochId);

    const payload = buildEchoPayload(events);
    const payloadHash = await sha256OfCanonicalJson(payload);
    const inputsHash = await computeEnricherInputsHash({
      epochId,
      events: events.map((e) => ({
        eventId: e.eventId,
        eventPayloadHash: e.payloadHash,
      })),
    });

    await ledgerStore.upsertDraftArtifact({
      nodeId,
      epochId,
      artifactRef: ECHO_ARTIFACT_REF,
      status: "draft",
      algoRef: ECHO_ALGO_REF,
      inputsHash,
      payloadHash,
      payloadJson: payload,
    });

    logger.info(
      {
        epochId: input.epochId,
        artifactRef: ECHO_ARTIFACT_REF,
        eventCount: events.length,
      },
      "Echo draft artifact written"
    );

    return {
      artifactRef: ECHO_ARTIFACT_REF,
      eventCount: events.length,
    };
  }

  /**
   * Build final (locked) artifacts for epoch close.
   * Returns artifact params and artifactsHash — does NOT write to store.
   * The caller (autoCloseIngestion) writes via closeIngestionWithArtifacts atomically.
   */
  async function buildFinalArtifacts(
    input: BuildFinalArtifactsInput
  ): Promise<BuildFinalArtifactsOutput> {
    const epochId = BigInt(input.epochId);

    logger.info({ epochId: input.epochId }, "Building final artifacts");

    const events = await ledgerStore.getCuratedEventsWithMetadata(epochId);

    const payload = buildEchoPayload(events);
    const payloadHash = await sha256OfCanonicalJson(payload);
    const inputsHash = await computeEnricherInputsHash({
      epochId,
      events: events.map((e) => ({
        eventId: e.eventId,
        eventPayloadHash: e.payloadHash,
      })),
    });

    const artifact: UpsertArtifactParamsWire = {
      nodeId,
      epochId: input.epochId, // keep as string for Temporal wire format
      artifactRef: ECHO_ARTIFACT_REF,
      status: "locked",
      algoRef: ECHO_ALGO_REF,
      inputsHash,
      payloadHash,
      payloadJson: payload,
    };

    const artifactsHash = await computeArtifactsHash([artifact]);

    logger.info(
      {
        epochId: input.epochId,
        artifactCount: 1,
        artifactsHash: `${artifactsHash.slice(0, 12)}...`,
      },
      "Final artifacts built"
    );

    return {
      artifacts: [artifact],
      artifactsHash,
    };
  }

  return {
    enrichEpochDraft,
    buildFinalArtifacts,
  };
}

/** Type alias for workflow proxy usage */
export type EnrichmentActivities = ReturnType<
  typeof createEnrichmentActivities
>;
