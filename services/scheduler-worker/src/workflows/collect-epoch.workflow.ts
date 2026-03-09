// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/collect-epoch`
 * Purpose: Temporal Workflow orchestrator for epoch ingestion — delegates to child workflows for collection, enrichment, and allocation.
 * Scope: Deterministic orchestration only. All I/O happens in Activities (via child workflows). Steps: compute window → ensure epoch → CollectSourcesWorkflow → EnrichAndAllocateWorkflow → ensure pool → auto-close check. Does not handle finalization (see FinalizeEpochWorkflow).
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O, network calls, or direct imports of adapters
 *   - Per WRITES_VIA_TEMPORAL: All writes execute in Temporal activities
 *   - Per CHILD_WORKFLOW_COMPOSITION: Collection and enrichment stages delegate to typed child workflows via executeChild()
 *   - Per ACTIVITY_IDEMPOTENT: All activities idempotent via PK constraints or upsert
 *   - Per WEIGHT_PINNING: Epoch weightConfig is pinned at creation; subsequent runs use pinned value
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/attribution-ledger.md, docs/spec/temporal-patterns.md
 * @internal
 */

import { computeEpochWindowV1 } from "@cogni/attribution-ledger/epoch-window";
import {
  ApplicationFailure,
  executeChild,
  ParentClosePolicy,
  proxyActivities,
  workflowInfo,
} from "@temporalio/workflow";

import type { EnrichmentActivities } from "../activities/enrichment.js";
import type { LedgerActivities } from "../activities/ledger.js";
import { STANDARD_ACTIVITY_OPTIONS } from "./activity-profiles.js";
import { CollectSourcesWorkflow } from "./stages/collect-sources.workflow.js";
import { EnrichAndAllocateWorkflow } from "./stages/enrich-and-allocate.workflow.js";

// Proxy ledger activities with standard timeout/retry profile.
// Only activities that remain inline in this parent workflow (setup + pool/close).
const { ensureEpochForWindow, ensurePoolComponents, autoCloseIngestion } =
  proxyActivities<LedgerActivities>(STANDARD_ACTIVITY_OPTIONS);

const { deriveWeightConfig, buildLockedEvaluations } =
  proxyActivities<EnrichmentActivities>(STANDARD_ACTIVITY_OPTIONS);

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
 * CollectEpochWorkflow — thin orchestrator for one epoch collection pass.
 *
 * 1-4. Setup: compute window, derive weights, ensure epoch
 * 5.   Delegate source collection to CollectSourcesWorkflow (child)
 * 6-8. Delegate enrichment + allocation to EnrichAndAllocateWorkflow (child)
 * 9-10. Pool + auto-close (inline, conditional)
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

  // 5. Collect from all sources (child workflow — independently retryable/visible)
  await executeChild(CollectSourcesWorkflow, {
    args: [
      {
        epochId: epoch.epochId,
        sources: config.activitySources,
        periodStart: periodStartIso,
        periodEnd: periodEndIso,
      },
    ],
    workflowId: `collect-sources-${epoch.epochId}`,
    parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
  });

  // 6-8. Enrich and allocate (child workflow — selection → enrichment → allocation)
  await executeChild(EnrichAndAllocateWorkflow, {
    args: [
      {
        epochId: epoch.epochId,
        attributionPipeline,
        weightConfig: epoch.weightConfig,
      },
    ],
    workflowId: `enrich-allocate-${epoch.epochId}`,
    parentClosePolicy: ParentClosePolicy.PARENT_CLOSE_POLICY_TERMINATE,
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
