// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/graph-run`
 * Purpose: Unified Temporal Workflow for all graph execution (scheduled, API, webhook).
 * Scope: Deterministic orchestration only. All I/O happens in Activities.
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O, network calls, or LLM calls in workflow code
 *   - Per SINGLE_RUN_LEDGER: always creates graph_runs record (no dbScheduleId gate)
 *   - Per EXECUTION_VIA_SERVICE_API: executeGraphActivity calls internal API, not GraphExecutorPort
 *   - Per IDEMPOTENT_RUN_START: Workflow ID = graph-run:{billingAccountId}:{idempotencyKey}
 *   - CONVERGED_FINALIZE: all terminal paths go through updateGraphRunActivity
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/unified-graph-launch.md, docs/spec/temporal-patterns.md
 * @internal
 */

import {
  ApplicationFailure,
  proxyActivities,
  uuid4,
  workflowInfo,
} from "@temporalio/workflow";

import type { Activities } from "../activities/index.js";
import { GRAPH_EXECUTION_ACTIVITY_OPTIONS } from "./activity-profiles.js";

// Short timeout for metadata activities (grant validation, run record CRUD).
const {
  validateGrantActivity,
  createGraphRunActivity,
  updateGraphRunActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

// Graph execution: 15-min timeout, no retry (idempotency collision risk).
const { executeGraphActivity } = proxyActivities<Activities>(
  GRAPH_EXECUTION_ACTIVITY_OPTIONS
);

/**
 * Input for GraphRunWorkflow.
 * Supports all trigger types via trigger provenance fields.
 */
export interface GraphRunWorkflowInput {
  /** Graph ID to execute (format: provider:name, e.g. "langgraph:poet") */
  graphId: string;
  /** Execution grant ID for authorization */
  executionGrantId: string;
  /** Graph input payload */
  input: Record<string, unknown>;
  /** How the run was triggered */
  runKind: "user_immediate" | "system_scheduled" | "system_webhook";
  /** Trigger source identifier (api, temporal_schedule, webhook:{type}) */
  triggerSource: string;
  /** Upstream delivery/schedule ID for provenance */
  triggerRef: string;
  /** User ID or 'cogni_system' who requested the run */
  requestedBy: string;
  /** DB schedule UUID — only for scheduled runs */
  dbScheduleId?: string | null;
  /** Temporal schedule ID — only for scheduled runs */
  temporalScheduleId?: string;
  /** Intended execution time — only for scheduled runs (ISO string) */
  scheduledFor?: string;
}

/**
 * GraphRunWorkflow — Unified orchestration for all graph execution.
 *
 * Flow:
 * 1. Validate grant (fail-fast → skipped)
 * 2. Create graph_runs record (ALWAYS — per SINGLE_RUN_LEDGER)
 * 3. Mark run as started
 * 4. Execute graph via internal API
 * 5. CONVERGED_FINALIZE: mark run as success/error
 *
 * All terminal paths converge through updateGraphRunActivity.
 */
export async function GraphRunWorkflow(
  input: GraphRunWorkflowInput
): Promise<void> {
  const {
    graphId,
    executionGrantId,
    input: graphInput,
    runKind,
    triggerSource,
    triggerRef,
    requestedBy,
    dbScheduleId,
    temporalScheduleId,
    scheduledFor: inputScheduledFor,
  } = input;

  // For scheduled runs, derive scheduledFor from Temporal search attribute.
  // For non-scheduled runs, use input value or skip.
  let scheduledFor = inputScheduledFor;
  if (runKind === "system_scheduled" && !scheduledFor) {
    const info = workflowInfo();
    const scheduledStartTime = info.searchAttributes
      ?.TemporalScheduledStartTime as Date[] | undefined;
    if (scheduledStartTime?.[0]) {
      scheduledFor = scheduledStartTime[0].toISOString();
    }
  }

  // Generate run ID (deterministic via Temporal's uuid4)
  const runId = uuid4();

  // Note: idempotency key is derived inside executeGraphActivity as
  // `${temporalScheduleId}:${scheduledFor}` per SLOT_IDEMPOTENCY_VIA_EXECUTION_REQUESTS.

  // 1. Validate grant (fail-fast)
  try {
    await validateGrantActivity({ grantId: executionGrantId, graphId });
  } catch {
    // Grant invalid — create record and mark skipped (CONVERGED_FINALIZE)
    await createGraphRunActivity({
      runId,
      graphId,
      runKind,
      triggerSource,
      triggerRef,
      requestedBy,
      dbScheduleId,
      scheduledFor,
    });
    await updateGraphRunActivity({
      runId,
      status: "skipped",
      errorMessage: "Grant validation failed",
    });
    return;
  }

  // 2. Create graph_runs record — ALWAYS (per SINGLE_RUN_LEDGER, no dbScheduleId gate)
  await createGraphRunActivity({
    runId,
    graphId,
    runKind,
    triggerSource,
    triggerRef,
    requestedBy,
    dbScheduleId,
    scheduledFor,
  });

  // 3. Mark run as started
  await updateGraphRunActivity({ runId, status: "running" });

  // 4. Execute graph via internal API
  try {
    if (!temporalScheduleId) {
      // Non-scheduled runs: temporalScheduleId is required by executeGraphActivity.
      // Use a synthetic value derived from runId for the idempotency key.
      throw ApplicationFailure.nonRetryable(
        "Non-scheduled GraphRunWorkflow execution not yet supported (task.0177)",
        "NotImplemented"
      );
    }

    const result = await executeGraphActivity({
      temporalScheduleId,
      graphId,
      executionGrantId,
      input: graphInput,
      scheduledFor: scheduledFor ?? new Date().toISOString(),
      runId,
    });

    // 5. CONVERGED_FINALIZE: mark success or error
    if (result.ok) {
      await updateGraphRunActivity({
        runId,
        status: "success",
        traceId: result.traceId,
      });
    } else {
      await updateGraphRunActivity({
        runId,
        status: "error",
        traceId: result.traceId,
        errorMessage: result.errorCode ?? "Graph execution failed",
        errorCode: result.errorCode,
      });
    }
  } catch (error) {
    // Activity threw — CONVERGED_FINALIZE: mark as error
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error during execution";
    await updateGraphRunActivity({
      runId,
      status: "error",
      errorMessage,
    });
    throw error; // Re-throw so Temporal marks workflow as failed
  }
}
