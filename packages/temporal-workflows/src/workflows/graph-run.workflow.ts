// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/temporal-workflows/workflows/graph-run`
 * Purpose: Unified Temporal Workflow for all graph execution (scheduled, API, webhook).
 * Scope: Deterministic orchestration only. Does not perform I/O — all external calls happen in Activities.
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O, network calls, or LLM calls in workflow code
 *   - Per SINGLE_RUN_LEDGER: always creates graph_runs record (no dbScheduleId gate)
 *   - Per EXECUTION_VIA_SERVICE_API: executeGraphActivity calls internal API, not GraphExecutorPort
 *   - Per IDEMPOTENT_RUN_START: Workflow ID = graph-run:{billingAccountId}:{idempotencyKey}
 *   - CALLER_PROVIDED_RUN_ID: accepts optional runId from caller for cross-system correlation (falls back to uuid4)
 *   - CONDITIONAL_GRANT_VALIDATION: skips validateGrantActivity when executionGrantId is null (API-triggered runs)
 *   - CONVERGED_FINALIZE: all terminal paths go through updateGraphRunActivity
 *   - TYPED_TERMINAL_ARTIFACT: returns small typed result {ok, runId, structuredOutput} for parent workflow composition
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/unified-graph-launch.md, docs/spec/temporal-patterns.md
 * @public
 */

import { proxyActivities, uuid4, workflowInfo } from "@temporalio/workflow";
import { GRAPH_EXECUTION_ACTIVITY_OPTIONS } from "../activity-profiles.js";
import type { SchedulerActivities } from "../activity-types.js";

/**
 * Terminal artifact returned by GraphRunWorkflow.
 * Small typed result for parent workflow composition — NOT raw stream/transcript data.
 * Redis/SSE remain the observability transport.
 */
export interface GraphRunResult {
  ok: boolean;
  runId: string;
  /** Structured output from graph (when responseFormat was provided). */
  structuredOutput?: unknown;
}

// Short timeout for metadata activities (grant validation, run record CRUD).
const {
  validateGrantActivity,
  createGraphRunActivity,
  updateGraphRunActivity,
} = proxyActivities<SchedulerActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

// Graph execution: 15-min timeout, no retry (idempotency collision risk).
const { executeGraphActivity } = proxyActivities<SchedulerActivities>(
  GRAPH_EXECUTION_ACTIVITY_OPTIONS
);

/**
 * Input for GraphRunWorkflow.
 * Supports all trigger types via trigger provenance fields.
 */
export interface GraphRunWorkflowInput {
  /** Originating node ID from repo-spec. Routes execution to correct node. */
  nodeId: string;
  /** Graph ID to execute (format: provider:name, e.g. "langgraph:poet") */
  graphId: string;
  /** Execution grant ID for authorization (scheduled/webhook). Null for API-triggered runs. */
  executionGrantId?: string | null;
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
  /** Optional caller-provided run ID for cross-system correlation */
  runId?: string;
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
): Promise<GraphRunResult> {
  const {
    nodeId,
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
    runId: providedRunId,
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

  // Generate run ID if caller did not provide one.
  const runId = providedRunId ?? uuid4();

  // Extract stateKey from graph input for thread↔run correlation.
  // Per STATEKEY_NULLABLE: may be absent for headless/webhook runs.
  const stateKey: string | undefined =
    typeof graphInput?.stateKey === "string" && graphInput.stateKey.length > 0
      ? graphInput.stateKey
      : undefined;

  // Note: idempotency key is derived inside executeGraphActivity as
  // `${temporalScheduleId}:${scheduledFor}` per SLOT_IDEMPOTENCY_VIA_EXECUTION_REQUESTS.

  // 1. Validate grant for non-API runs (fail-fast).
  // API-triggered runs skip grant validation; billing/preflight decorators enforce auth/credits.
  if (executionGrantId) {
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
        dbScheduleId: dbScheduleId ?? undefined,
        scheduledFor,
        stateKey,
      });
      await updateGraphRunActivity({
        runId,
        status: "skipped",
        errorMessage: "Grant validation failed",
      });
      return { ok: false, runId };
    }
  }

  // 2. Create graph_runs record — ALWAYS (per SINGLE_RUN_LEDGER, no dbScheduleId gate)
  await createGraphRunActivity({
    runId,
    graphId,
    runKind,
    triggerSource,
    triggerRef,
    requestedBy,
    dbScheduleId: dbScheduleId ?? undefined,
    scheduledFor,
    stateKey,
  });

  // 3. Mark run as started
  await updateGraphRunActivity({ runId, status: "running" });

  // 4. Execute graph via internal API
  try {
    const result = await executeGraphActivity({
      nodeId,
      temporalScheduleId,
      graphId,
      executionGrantId: executionGrantId ?? null,
      input: graphInput,
      scheduledFor: scheduledFor ?? workflowInfo().startTime.toISOString(),
      runId,
    });

    // 5. CONVERGED_FINALIZE: mark success or error
    if (result.ok) {
      await updateGraphRunActivity({
        runId,
        status: "success",
        traceId: result.traceId,
      });
      return {
        ok: true,
        runId,
        ...(result.structuredOutput !== undefined && {
          structuredOutput: result.structuredOutput,
        }),
      };
    } else {
      await updateGraphRunActivity({
        runId,
        status: "error",
        traceId: result.traceId,
        errorMessage: result.errorCode ?? "Graph execution failed",
        errorCode: result.errorCode,
      });
      return { ok: false, runId };
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
