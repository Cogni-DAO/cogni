// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/scheduled-run`
 * Purpose: Temporal Workflow for scheduled graph execution.
 * Scope: Deterministic orchestration only. All I/O happens in Activities.
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O, network calls, or LLM invocations in workflow code
 *   - Per WORKER_NEVER_CONTROLS_SCHEDULES: Does NOT create/modify/delete schedules
 *   - Per SCHEDULED_TIMESTAMP_FROM_TEMPORAL: scheduledFor comes from workflow input (set by Schedule)
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/scheduler.md, docs/spec/temporal-patterns.md
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

// Intentionally shorter timeout (1 min) — grant validation is fast-fail.
const {
  validateGrantActivity,
  createScheduleRunActivity,
  updateScheduleRunActivity,
} = proxyActivities<Activities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

// Proxy executeGraphActivity with timeout exceeding the gateway agent limit.
// maxRuntimeSec defaults to 600s (10m); add buffer for queue + jitter.
// maximumAttempts: 1 because retrying while the first attempt is still
// running causes a 409 idempotency collision — the run will succeed or
// timeout on its own, and the idempotency key prevents duplicate work.
const { executeGraphActivity } = proxyActivities<Activities>(
  GRAPH_EXECUTION_ACTIVITY_OPTIONS
);

/**
 * Input for GovernanceScheduledRunWorkflow.
 * Per SCHEDULED_TIMESTAMP_FROM_TEMPORAL: scheduledFor derived from search attribute, not input.
 */
export interface ScheduledRunWorkflowInput {
  /** Temporal schedule ID (always present on new schedules) */
  temporalScheduleId?: string;
  /** Optional DB schedule UUID for DB-backed schedules */
  dbScheduleId?: string | null;
  /** Legacy field from older schedule payloads */
  scheduleId?: string;
  /** Graph ID to execute */
  graphId: string;
  /** Execution grant ID for authorization */
  executionGrantId: string;
  /** Graph input payload */
  input: Record<string, unknown>;
}

/**
 * GovernanceScheduledRunWorkflow - Orchestrates scheduled graph execution.
 *
 * Per SCHEDULER_SPEC.md execution flow:
 * 1. Validate grant (fail-fast)
 * 2. Create schedule_runs record (ledger entry)
 * 3. Mark run as started
 * 4. Execute graph via internal API
 * 5. Mark run as success/error
 *
 * Per TEMPORAL_PATTERNS.md: This workflow is deterministic.
 * All I/O happens in Activities.
 */
export async function GovernanceScheduledRunWorkflow(
  input: ScheduledRunWorkflowInput
): Promise<void> {
  const {
    temporalScheduleId: providedTemporalScheduleId,
    dbScheduleId,
    scheduleId: legacyScheduleId,
    graphId,
    executionGrantId,
    input: graphInput,
  } = input;
  const temporalScheduleId = providedTemporalScheduleId ?? legacyScheduleId;
  if (!temporalScheduleId) {
    throw ApplicationFailure.nonRetryable(
      "temporalScheduleId is required in workflow input"
    );
  }

  // Per SCHEDULED_TIMESTAMP_FROM_TEMPORAL: Get scheduledFor from Temporal search attribute
  // When workflow is started by a Schedule, TemporalScheduledStartTime is automatically set
  const info = workflowInfo();
  const scheduledStartTime = info.searchAttributes
    ?.TemporalScheduledStartTime as Date[] | undefined;
  if (!scheduledStartTime?.[0]) {
    throw ApplicationFailure.nonRetryable(
      `TemporalScheduledStartTime search attribute missing - workflow must be started by Schedule. ` +
        `temporalScheduleId=${temporalScheduleId}, workflowId=${info.workflowId}, runId=${info.runId}`
    );
  }
  const scheduledFor = scheduledStartTime[0].toISOString();

  // Generate run ID (deterministic via Temporal's uuid4)
  const runId = uuid4();

  // 1. Validate grant (fail-fast)
  // Throws if grant invalid/expired/revoked/scope mismatch
  try {
    await validateGrantActivity({ grantId: executionGrantId, graphId });
  } catch {
    // Grant validation failed - only DB-backed schedules have ledger rows.
    if (dbScheduleId) {
      await createScheduleRunActivity({ dbScheduleId, runId, scheduledFor });
      await updateScheduleRunActivity({
        runId,
        status: "skipped",
        errorMessage: "Grant validation failed",
      });
    }
    return;
  }

  // 2. Create schedule_runs record for DB-backed schedules only.
  if (dbScheduleId) {
    await createScheduleRunActivity({ dbScheduleId, runId, scheduledFor });
    // 3. Mark run as started
    await updateScheduleRunActivity({ runId, status: "running" });
  }

  // 4. Execute graph via internal API
  // Pass canonical runId to internal API for correlation/idempotency.
  try {
    const result = await executeGraphActivity({
      temporalScheduleId,
      graphId,
      executionGrantId,
      input: graphInput,
      scheduledFor,
      runId,
    });

    // 5. Mark run as success/error based on result
    if (dbScheduleId) {
      if (result.ok) {
        await updateScheduleRunActivity({
          runId,
          status: "success",
          traceId: result.traceId,
        });
      } else {
        await updateScheduleRunActivity({
          runId,
          status: "error",
          traceId: result.traceId,
          errorMessage: result.errorCode ?? "Graph execution failed",
        });
      }
    }
  } catch (error) {
    // Activity threw - mark as error
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error during execution";
    if (dbScheduleId) {
      await updateScheduleRunActivity({
        runId,
        status: "error",
        errorMessage,
      });
    }
    throw error; // Re-throw so Temporal marks workflow as failed
  }
}
