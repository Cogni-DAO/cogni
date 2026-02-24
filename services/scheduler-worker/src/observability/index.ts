// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/observability`
 * Purpose: Barrel export for observability modules.
 * @public
 */

export { WORKER_EVENT_NAMES, type WorkerEventName } from "./events.js";
export { logWorkerEvent } from "./logEvent.js";
export { flushLogger, type Logger, makeLogger } from "./logger.js";
export {
  activityDurationMs,
  activityErrorsTotal,
  metricsRegistry,
  workerInfo,
} from "./metrics.js";
export { REDACT_PATHS } from "./redact.js";
