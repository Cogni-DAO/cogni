// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/collect-epoch`
 * Purpose: Temporal Workflow for epoch ingestion, selection, allocation, pool estimation, and auto-close.
 * Scope: Deterministic orchestration only. All I/O happens in Activities. Steps: compute window → ensure epoch → collect per source → materialize selection → compute allocations → ensure pool → auto-close check. Does not handle finalization (see FinalizeEpochWorkflow).
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O, network calls, or direct imports of adapters
 *   - Per WRITES_VIA_TEMPORAL: All writes execute in Temporal activities
 *   - Per CURSOR_STATE_PERSISTED: Cursors saved after each adapter collect() call
 *   - Per ACTIVITY_IDEMPOTENT: All activities idempotent via PK constraints or upsert
 *   - Per WEIGHT_PINNING: Epoch weightConfig is pinned at creation; subsequent runs use pinned value
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/attribution-ledger.md, docs/spec/temporal-patterns.md
 * @internal
 */

import { deriveAllocationAlgoRef } from "@cogni/attribution-ledger/allocation";
import { computeEpochWindowV1 } from "@cogni/attribution-ledger/epoch-window";
import {
  ApplicationFailure,
  proxyActivities,
  workflowInfo,
} from "@temporalio/workflow";

import type { EnrichmentActivities } from "../activities/enrichment.js";
import type { LedgerActivities } from "../activities/ledger.js";

// Proxy ledger activities with reasonable timeouts.
// collectFromSource may hit GitHub API pagination — allow up to 5 minutes.
const {
  ensureEpochForWindow,
  loadCursor,
  saveCursor,
  insertReceipts,
  materializeSelection,
  computeAllocations,
  ensurePoolComponents,
  autoCloseIngestion,
  resolveStreams,
} = proxyActivities<LedgerActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "2 seconds",
    maximumInterval: "1 minute",
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

const { collectFromSource } = proxyActivities<LedgerActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "2 minutes",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

const { deriveWeightConfig, evaluateEpochDraft, buildLockedEvaluations } =
  proxyActivities<EnrichmentActivities>({
    startToCloseTimeout: "2 minutes",
    retry: {
      initialInterval: "2 seconds",
      maximumInterval: "1 minute",
      backoffCoefficient: 2,
      maximumAttempts: 5,
    },
  });

/** Schedule adapter wrapper (infra — extract .input immediately) */
interface ScheduleActionPayload {
  scheduleId?: string;
  temporalScheduleId?: string;
  graphId?: string;
  executionGrantId?: string;
  input: AttributionIngestRunV1;
}

/** Versioned domain envelope — sole contract for this workflow. */
export interface AttributionIngestRunV1 {
  readonly version: 1;
  readonly scopeId: string;
  readonly scopeKey: string;
  readonly epochLengthDays: number;
  /** Map of source → { attributionPipeline, sourceRefs } */
  readonly activitySources: Record<
    string,
    {
      attributionPipeline: string;
      sourceRefs: string[];
    }
  >;
  /** Pool budget config — base_issuance_credits as string (bigint serialized). Optional for backward compat. */
  readonly baseIssuanceCredits?: string;
  /** EVM approver addresses for epoch close. Optional for backward compat. */
  readonly approvers?: string[];
  /** Grace period in ms after periodEnd before auto-close (default: 24h). */
  readonly autoCloseGracePeriodMs?: number;
}

/**
 * CollectEpochWorkflow — orchestrates one epoch collection pass.
 *
 * 1. Compute epoch window from TemporalScheduledStartTime
 * 2. Derive weight config from pipeline profile
 * 3. Ensure epoch exists (any status) — pin weights on first create
 * 4. For each source, resolve streams from adapter, then per sourceRef/stream: collect → insert → save cursor
 *
 * Receives ScheduleActionPayload from the schedule adapter; extracts .input immediately.
 * Deterministic workflow ID: ledger-collect-{scopeKey}-{periodStart}-{periodEnd}
 * (set by the schedule action, not by this workflow)
 */
export async function CollectEpochWorkflow(
  raw: ScheduleActionPayload
): Promise<void> {
  const config = raw.input;

  // 1. Derive epoch window — pure helper from @cogni/attribution-ledger (safe in workflow code)
  const info = workflowInfo();
  const scheduledStartTime = (
    info.searchAttributes?.TemporalScheduledStartTime as Date[] | undefined
  )?.[0];
  if (!scheduledStartTime) {
    throw ApplicationFailure.nonRetryable(
      "TemporalScheduledStartTime missing — workflow must be triggered by a schedule"
    );
  }
  const { periodStartIso, periodEndIso } = computeEpochWindowV1({
    asOfIso: scheduledStartTime.toISOString(),
    epochLengthDays: config.epochLengthDays,
    timezone: "UTC",
    weekStart: "monday",
  });

  // 2. Extract attributionPipeline from activity sources (required — no fallback)
  const firstSource = Object.values(config.activitySources)[0];
  if (!firstSource?.attributionPipeline) {
    throw ApplicationFailure.nonRetryable(
      "attributionPipeline missing from activitySources — check repo-spec.yaml"
    );
  }
  const attributionPipeline = firstSource.attributionPipeline;

  // 3. Derive weight config from the pipeline profile (profile owns weights)
  const { weightConfig } = await deriveWeightConfig({ attributionPipeline });

  // 4. Ensure epoch (any status — pin weights on first create)
  const epoch = await ensureEpochForWindow({
    periodStart: periodStartIso,
    periodEnd: periodEndIso,
    weightConfig,
  });

  // If epoch already closed/finalized, skip collection
  if (epoch.status !== "open") return;

  // 5. Collect from each source, each sourceRef — streams resolved from adapter
  for (const [source, sourceConfig] of Object.entries(config.activitySources)) {
    const { streams } = await resolveStreams({ source });
    for (const sourceRef of sourceConfig.sourceRefs) {
      for (const stream of streams) {
        const cursorValue = await loadCursor({ source, stream, sourceRef });
        const result = await collectFromSource({
          source,
          streams: [stream],
          cursorValue,
          periodStart: periodStartIso,
          periodEnd: periodEndIso,
        });
        if (result.events.length > 0) {
          await insertReceipts({
            events: result.events,
            producerVersion: result.producerVersion,
          });
        }
        await saveCursor({
          source,
          stream,
          sourceRef,
          cursorValue: result.nextCursorValue,
        });
      }
    }
  }

  // 6. Materialize selection and resolve identities (SELECTION_AUTO_POPULATE)
  await materializeSelection({ epochId: epoch.epochId });

  // 7. Evaluate epoch with draft evaluations (profile-driven enricher dispatch)
  await evaluateEpochDraft({ epochId: epoch.epochId, attributionPipeline });

  // 8. Compute allocations
  await computeAllocations({
    epochId: epoch.epochId,
    algorithmId: deriveAllocationAlgoRef(attributionPipeline),
    weightConfig: epoch.weightConfig,
  });

  // 9. Ensure pool components (base_issuance from config, idempotent)
  if (config.baseIssuanceCredits) {
    await ensurePoolComponents({
      epochId: epoch.epochId,
      baseIssuanceCredits: config.baseIssuanceCredits,
    });
  }

  // 10. Auto-close check: if now > periodEnd + gracePeriod → closeIngestion with evaluations
  if (config.approvers && config.approvers.length > 0) {
    const gracePeriodMs = config.autoCloseGracePeriodMs ?? 24 * 60 * 60 * 1000; // default 24h
    const { evaluations, artifactsHash } = await buildLockedEvaluations({
      epochId: epoch.epochId,
      attributionPipeline,
    });
    await autoCloseIngestion({
      epochId: epoch.epochId,
      periodEnd: periodEndIso,
      gracePeriodMs,
      weightConfig: epoch.weightConfig,
      attributionPipeline,
      approvers: config.approvers,
      evaluations,
      artifactsHash,
    });
  }
}
