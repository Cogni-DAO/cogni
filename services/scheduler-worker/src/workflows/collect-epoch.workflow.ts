// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/collect-epoch`
 * Purpose: Temporal Workflow for epoch activity collection, curation, allocation, pool estimation, and auto-close.
 * Scope: Deterministic orchestration only. All I/O happens in Activities. Steps: compute window → ensure epoch → collect per source → curate → compute allocations → ensure pool → auto-close check. Does not handle finalization (see FinalizeEpochWorkflow).
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O, network calls, or direct imports of adapters
 *   - Per WRITES_VIA_TEMPORAL: All writes execute in Temporal activities
 *   - Per CURSOR_STATE_PERSISTED: Cursors saved after each adapter collect() call
 *   - Per ACTIVITY_IDEMPOTENT: All activities idempotent via PK constraints or upsert
 *   - Per WEIGHT_PINNING: Epoch weightConfig is pinned at creation; subsequent runs use pinned value
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/epoch-ledger.md, docs/spec/temporal-patterns.md
 * @internal
 */

import {
  computeEpochWindowV1,
  deriveAllocationAlgoRef,
} from "@cogni/ledger-core";
import {
  ApplicationFailure,
  proxyActivities,
  workflowInfo,
} from "@temporalio/workflow";

import type { LedgerActivities } from "../activities/ledger.js";

// Proxy ledger activities with reasonable timeouts.
// collectFromSource may hit GitHub API pagination — allow up to 5 minutes.
const {
  ensureEpochForWindow,
  loadCursor,
  saveCursor,
  insertEvents,
  curateAndResolve,
  computeAllocations,
  ensurePoolComponents,
  autoCloseIngestion,
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

/** Schedule adapter wrapper (infra — extract .input immediately) */
interface ScheduleActionPayload {
  scheduleId?: string;
  temporalScheduleId?: string;
  graphId?: string;
  executionGrantId?: string;
  input: LedgerIngestRunV1;
}

/** Versioned domain envelope — sole contract for this workflow. */
export interface LedgerIngestRunV1 {
  readonly version: 1;
  readonly scopeId: string;
  readonly scopeKey: string;
  readonly epochLengthDays: number;
  /** Map of source → { creditEstimateAlgo, sourceRefs, streams } */
  readonly activitySources: Record<
    string,
    {
      creditEstimateAlgo: string;
      sourceRefs: string[];
      streams: string[];
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
 * 2. Ensure epoch exists (any status) — pin weights on first create
 * 3. For each source, sourceRef, stream: load cursor → collect → insert → save cursor
 *
 * Receives ScheduleActionPayload from the schedule adapter; extracts .input immediately.
 * Deterministic workflow ID: ledger-collect-{scopeKey}-{periodStart}-{periodEnd}
 * (set by the schedule action, not by this workflow)
 */
export async function CollectEpochWorkflow(
  raw: ScheduleActionPayload
): Promise<void> {
  const config = raw.input;

  // 1. Derive epoch window — pure helper from @cogni/ledger-core (safe in workflow code)
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

  // 2. Derive weight config from activitySources (V0: hardcoded mapping)
  const weightConfig = deriveWeightConfigV0(config.activitySources);

  // 3. Ensure epoch (any status — pin weights on first create)
  const epoch = await ensureEpochForWindow({
    periodStart: periodStartIso,
    periodEnd: periodEndIso,
    weightConfig,
  });

  // If epoch already closed/finalized, skip collection
  if (epoch.status !== "open") return;

  // 4. Collect from each source, each sourceRef (external namespace), each stream
  for (const [source, sourceConfig] of Object.entries(config.activitySources)) {
    for (const sourceRef of sourceConfig.sourceRefs) {
      for (const stream of sourceConfig.streams) {
        const cursorValue = await loadCursor({ source, stream, sourceRef });
        const result = await collectFromSource({
          source,
          streams: [stream],
          cursorValue,
          periodStart: periodStartIso,
          periodEnd: periodEndIso,
        });
        if (result.events.length > 0) {
          await insertEvents({
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

  // 5. Curate events and resolve identities (CURATION_AUTO_POPULATE)
  await curateAndResolve({ epochId: epoch.epochId });

  // 6. Compute allocations (periodic — runs every collection pass)
  const creditEstimateAlgo =
    Object.values(config.activitySources)[0]?.creditEstimateAlgo ??
    "cogni-v0.0";
  await computeAllocations({
    epochId: epoch.epochId,
    algorithmId: deriveAllocationAlgoRef(creditEstimateAlgo),
    weightConfig: epoch.weightConfig,
  });

  // 7. Ensure pool components (base_issuance from config, idempotent)
  if (config.baseIssuanceCredits) {
    await ensurePoolComponents({
      epochId: epoch.epochId,
      baseIssuanceCredits: config.baseIssuanceCredits,
    });
  }

  // 8. Auto-close check: if now > periodEnd + gracePeriod → closeIngestion
  if (config.approvers && config.approvers.length > 0) {
    const gracePeriodMs = config.autoCloseGracePeriodMs ?? 24 * 60 * 60 * 1000; // default 24h
    await autoCloseIngestion({
      epochId: epoch.epochId,
      periodEnd: periodEndIso,
      gracePeriodMs,
      weightConfig: epoch.weightConfig,
      creditEstimateAlgo,
      approvers: config.approvers,
    });
  }
}

/** V0 weight config derivation — pure, deterministic. */
function deriveWeightConfigV0(
  sources: Record<string, { creditEstimateAlgo: string }>
): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const source of Object.keys(sources)) {
    if (source === "github") {
      weights["github:pr_merged"] = 1000;
      weights["github:review_submitted"] = 500;
      weights["github:issue_closed"] = 300;
    }
  }
  return weights;
}
