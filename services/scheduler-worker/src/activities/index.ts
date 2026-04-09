// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/activities`
 * Purpose: Temporal Activities for graph execution and run lifecycle.
 * Scope: Plain async functions that perform I/O (DB, HTTP). Called by Workflow.
 * Invariants:
 *   - Per ACTIVITY_IDEMPOTENCY: All activities must be idempotent or rely on downstream idempotency
 *   - Per EXECUTION_VIA_SERVICE_API: executeGraphActivity calls internal API, never imports graph code
 *   - Per GRANT_VALIDATED_TWICE: Worker validates grant before calling API (fail-fast, scheduled runs only)
 *   - Per SINGLE_RUN_LEDGER: all run records written to graph_runs table
 *   - SCHEDULER_API_TOKEN treated as secret (never logged)
 * Side-effects: IO (database, HTTP to internal API)
 * Links: docs/spec/scheduler.md, docs/spec/temporal-patterns.md, docs/spec/unified-graph-launch.md
 * @internal
 */

import { SYSTEM_ACTOR } from "@cogni/ids/system";
import type { GraphRunKind } from "@cogni/scheduler-core";
import { ApplicationFailure, activityInfo } from "@temporalio/activity";
import {
  activityDurationMs,
  activityErrorsTotal,
  logWorkerEvent,
  WORKER_EVENT_NAMES,
} from "../observability/index.js";
import type { Logger } from "../observability/logger.js";
import type {
  ExecutionGrantWorkerPort,
  GraphRunRepository,
} from "../ports/index.js";

/**
 * Dependencies injected into activities at worker creation.
 * Activities are created as closures over these deps.
 */
export interface ActivityDeps {
  grantAdapter: ExecutionGrantWorkerPort;
  runAdapter: GraphRunRepository;
  config: {
    nodeEndpoints: Map<string, string>;
    schedulerApiToken: string;
  };
  logger: Logger;
}

/**
 * Input for validateGrantActivity.
 */
export interface ValidateGrantInput {
  grantId: string;
  graphId: string;
}

/**
 * Input for createGraphRunActivity.
 * Per SINGLE_RUN_LEDGER: supports both scheduled and non-scheduled runs.
 */
export interface CreateGraphRunInput {
  runId: string;
  graphId?: string;
  runKind?: GraphRunKind;
  triggerSource?: string;
  triggerRef?: string;
  requestedBy?: string;
  /** Only for scheduled runs */
  dbScheduleId?: string;
  /** Only for scheduled runs (ISO string) */
  scheduledFor?: string;
  /** Thread state key for conversation correlation */
  stateKey?: string;
}

/**
 * Input for executeGraphActivity.
 */
export interface ExecuteGraphInput {
  nodeId: string;
  temporalScheduleId?: string;
  graphId: string;
  executionGrantId: string | null;
  input: Record<string, unknown>;
  scheduledFor: string; // ISO string - used for idempotency key
  runId: string; // Canonical runId shared with graph_runs and charge_receipts
}

/**
 * Output from executeGraphActivity.
 * Per WORKFLOW_TOP_LEVEL_VISIBILITY: small typed terminal artifact only.
 * Redis/SSE remain the observability transport — this is parent-child control data.
 */
export interface ExecuteGraphOutput {
  ok: boolean;
  runId: string;
  traceId: string | null;
  errorCode?: string;
  /** Structured output from graph (when responseFormat was provided). Typed by caller. */
  structuredOutput?: unknown;
}

/**
 * Input for updateGraphRunActivity.
 */
export interface UpdateGraphRunInput {
  runId: string;
  status: "running" | "success" | "error" | "skipped" | "cancelled";
  traceId?: string | null;
  errorMessage?: string;
  errorCode?: string;
}

/**
 * Gets workflow correlation bindings for structured logging.
 * Per OBSERVABILITY_ALIGNMENT: every activity logs workflowId and temporalRunId.
 */
function getWorkflowCorrelation(): {
  workflowId: string;
  temporalRunId: string;
} {
  const info = activityInfo();
  return {
    workflowId: info.workflowExecution.workflowId,
    temporalRunId: info.workflowExecution.runId,
  };
}

/**
 * Creates activity functions with injected dependencies.
 * Per Temporal patterns: activities are plain async functions.
 */
export function createActivities(deps: ActivityDeps) {
  const { grantAdapter, runAdapter, config, logger } = deps;

  /**
   * Validates grant before execution (fail-fast).
   * Per GRANT_VALIDATED_TWICE: Defense-in-depth, API re-validates.
   * @throws Error if grant invalid/expired/revoked/scope mismatch
   */
  async function validateGrantActivity(
    input: ValidateGrantInput
  ): Promise<void> {
    const { grantId, graphId } = input;
    const correlation = getWorkflowCorrelation();
    const start = performance.now();

    logWorkerEvent(logger, WORKER_EVENT_NAMES.ACTIVITY_GRANT_VALIDATED, {
      ...correlation,
      grantId,
      graphId,
      phase: "start",
    });

    try {
      await grantAdapter.validateGrantForGraph(SYSTEM_ACTOR, grantId, graphId);

      const durationMs = performance.now() - start;
      activityDurationMs
        .labels({ activity: "validateGrant", status: "success" })
        .observe(durationMs);

      logWorkerEvent(logger, WORKER_EVENT_NAMES.ACTIVITY_GRANT_VALIDATED, {
        ...correlation,
        grantId,
        graphId,
        durationMs,
      });
    } catch (err) {
      const durationMs = performance.now() - start;
      activityDurationMs
        .labels({ activity: "validateGrant", status: "error" })
        .observe(durationMs);
      activityErrorsTotal
        .labels({ activity: "validateGrant", error_type: "unknown" })
        .inc();
      throw err;
    }
  }

  /**
   * Creates graph_runs record (ledger entry).
   * Per SINGLE_RUN_LEDGER: handles both scheduled and non-scheduled runs.
   * For scheduled runs: idempotent via UNIQUE(schedule_id, scheduled_for) WHERE schedule_id IS NOT NULL.
   */
  async function createGraphRunActivity(
    input: CreateGraphRunInput
  ): Promise<void> {
    const { runId, dbScheduleId, scheduledFor } = input;
    const correlation = getWorkflowCorrelation();
    const start = performance.now();

    logWorkerEvent(logger, WORKER_EVENT_NAMES.ACTIVITY_RUN_CREATED, {
      ...correlation,
      dbScheduleId,
      runId,
      scheduledFor,
      phase: "start",
    });

    try {
      await runAdapter.createRun(SYSTEM_ACTOR, {
        runId,
        graphId: input.graphId,
        runKind: input.runKind,
        triggerSource: input.triggerSource,
        triggerRef: input.triggerRef,
        requestedBy: input.requestedBy,
        scheduleId: dbScheduleId,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
        stateKey: input.stateKey,
      });

      const durationMs = performance.now() - start;
      activityDurationMs
        .labels({ activity: "createGraphRun", status: "success" })
        .observe(durationMs);

      logWorkerEvent(logger, WORKER_EVENT_NAMES.ACTIVITY_RUN_CREATED, {
        ...correlation,
        runId,
        durationMs,
      });
    } catch (err) {
      const durationMs = performance.now() - start;
      activityDurationMs
        .labels({ activity: "createGraphRun", status: "error" })
        .observe(durationMs);
      activityErrorsTotal
        .labels({ activity: "createGraphRun", error_type: "unknown" })
        .inc();
      throw err;
    }
  }

  /**
   * Calls internal API to execute graph.
   * Per EXECUTION_VIA_SERVICE_API: Worker NEVER imports graph execution code.
   * Per SLOT_IDEMPOTENCY_VIA_EXECUTION_REQUESTS: scheduled runs use temporalScheduleId:scheduledFor.
   * API runs use api:{runId}.
   */
  async function executeGraphActivity(
    input: ExecuteGraphInput
  ): Promise<ExecuteGraphOutput> {
    const {
      nodeId,
      temporalScheduleId,
      graphId,
      executionGrantId,
      input: graphInput,
      scheduledFor,
      runId,
    } = input;
    const correlation = getWorkflowCorrelation();
    const start = performance.now();

    const idempotencyKey = temporalScheduleId
      ? `${temporalScheduleId}:${scheduledFor}`
      : `api:${runId}`;

    const nodeUrl = config.nodeEndpoints.get(nodeId);
    if (!nodeUrl) {
      throw ApplicationFailure.nonRetryable(
        `Unknown nodeId "${nodeId}" — not in COGNI_NODE_ENDPOINTS`,
        "UNKNOWN_NODE"
      );
    }
    const url = `${nodeUrl}/api/internal/graphs/${graphId}/runs`;

    logWorkerEvent(logger, WORKER_EVENT_NAMES.ACTIVITY_GRAPH_EXECUTING, {
      ...correlation,
      temporalScheduleId,
      graphId,
      runId,
      idempotencyKey,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.schedulerApiToken}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        executionGrantId,
        input: graphInput,
        runId, // Pass canonical runId to internal API
      }),
    });

    if (!response.ok) {
      // Handle HTTP errors
      const errorText = await response.text();
      const durationMs = performance.now() - start;
      const errorType =
        response.status >= 400 && response.status < 500
          ? "non_retryable"
          : "retryable";

      activityDurationMs
        .labels({ activity: "executeGraph", status: "error" })
        .observe(durationMs);
      activityErrorsTotal
        .labels({ activity: "executeGraph", error_type: errorType })
        .inc();

      logger.error(
        {
          event: WORKER_EVENT_NAMES.ACTIVITY_GRAPH_ERROR,
          ...correlation,
          status: response.status,
          temporalScheduleId,
          graphId,
          runId,
          errorText,
          durationMs,
        },
        WORKER_EVENT_NAMES.ACTIVITY_GRAPH_ERROR
      );

      // 4xx errors are non-retryable (auth, validation, business logic failures)
      // 5xx errors and network errors should be retried
      if (response.status >= 400 && response.status < 500) {
        throw ApplicationFailure.nonRetryable(
          `Internal API client error: ${response.status} - ${errorText}`,
          "InternalApiClientError",
          { status: response.status, temporalScheduleId, graphId, runId }
        );
      }

      // 5xx errors - let Temporal retry
      throw new Error(
        `Internal API server error: ${response.status} - ${errorText}`
      );
    }

    const result = (await response.json()) as ExecuteGraphOutput;
    const durationMs = performance.now() - start;

    if (result.ok) {
      activityDurationMs
        .labels({ activity: "executeGraph", status: "success" })
        .observe(durationMs);

      logWorkerEvent(logger, WORKER_EVENT_NAMES.ACTIVITY_GRAPH_COMPLETED, {
        ...correlation,
        temporalScheduleId,
        graphId,
        runId: result.runId,
        durationMs,
      });
    } else {
      activityDurationMs
        .labels({ activity: "executeGraph", status: "error" })
        .observe(durationMs);

      logger.warn(
        {
          event: WORKER_EVENT_NAMES.ACTIVITY_GRAPH_ERROR,
          ...correlation,
          temporalScheduleId,
          graphId,
          runId: result.runId,
          errorCode: result.errorCode,
          durationMs,
        },
        WORKER_EVENT_NAMES.ACTIVITY_GRAPH_ERROR
      );
    }

    return result;
  }

  /**
   * Updates graph_runs record status.
   * Per ACTIVITY_IDEMPOTENCY: Uses monotonic status updates (pending->running->success/error).
   */
  async function updateGraphRunActivity(
    input: UpdateGraphRunInput
  ): Promise<void> {
    const { runId, status, traceId, errorMessage, errorCode } = input;
    const correlation = getWorkflowCorrelation();
    const start = performance.now();

    logWorkerEvent(logger, WORKER_EVENT_NAMES.ACTIVITY_RUN_UPDATED, {
      ...correlation,
      runId,
      status,
      phase: "start",
    });

    try {
      if (status === "running") {
        await runAdapter.markRunStarted(
          SYSTEM_ACTOR,
          runId,
          traceId ?? undefined
        );
      } else {
        await runAdapter.markRunCompleted(
          SYSTEM_ACTOR,
          runId,
          status,
          errorMessage,
          errorCode
        );
      }

      const durationMs = performance.now() - start;
      activityDurationMs
        .labels({ activity: "updateGraphRun", status: "success" })
        .observe(durationMs);

      logWorkerEvent(logger, WORKER_EVENT_NAMES.ACTIVITY_RUN_UPDATED, {
        ...correlation,
        runId,
        status,
        durationMs,
      });
    } catch (err) {
      const durationMs = performance.now() - start;
      activityDurationMs
        .labels({ activity: "updateGraphRun", status: "error" })
        .observe(durationMs);
      activityErrorsTotal
        .labels({ activity: "updateGraphRun", error_type: "unknown" })
        .inc();
      throw err;
    }
  }

  return {
    validateGrantActivity,
    createGraphRunActivity,
    executeGraphActivity,
    updateGraphRunActivity,
  };
}

// Export types for workflow to use
export type Activities = ReturnType<typeof createActivities>;
