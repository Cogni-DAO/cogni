// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/observability/logEvent`
 * Purpose: Type-safe event logger that enforces event name registry.
 * Scope: Single function for logging structured events. Does not create loggers.
 * Invariants: Event name MUST be from WORKER_EVENT_NAMES registry; `event` field always present.
 * Side-effects: IO (logging)
 * Notes: Unlike the main app's logEvent(), no reqId enforcement — worker has two calling contexts:
 *   activity-scoped (has workflowId/temporalRunId) and lifecycle-scoped (no request context).
 * Links: Uses WORKER_EVENT_NAMES registry from events.ts; called by all worker modules.
 * @public
 */

import type { Logger } from "pino";
import type { WorkerEventName } from "./events.js";

/**
 * Type-safe event logger for the scheduler worker.
 * Logs at info level with structured `event` field for LogQL filtering.
 *
 * For error/warn/fatal levels, use the logger directly with the event name:
 *   logger.error({ event: WORKER_EVENT_NAMES.X, ...fields }, message)
 *
 * @param logger - Pino logger instance
 * @param eventName - Event name from WORKER_EVENT_NAMES registry
 * @param fields - Event-specific fields (workflowId, temporalRunId, etc.)
 * @param message - Human-readable message (defaults to event name)
 */
export function logWorkerEvent(
  logger: Logger,
  eventName: WorkerEventName,
  fields: Record<string, unknown>,
  message?: string
): void {
  logger.info({ event: eventName, ...fields }, message ?? eventName);
}
