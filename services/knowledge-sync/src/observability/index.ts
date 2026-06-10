// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-sync-service/observability`
 * Purpose: Barrel for logger + metrics + structured event names.
 * Scope: Re-exports only + the canonical event-name constants.
 * Invariants: Event names are stable Loki query keys — change with care.
 * Side-effects: none
 * @internal
 */

export { flushLogger, type Logger, makeLogger } from "./logger.js";
export {
  lastPushSuccessTimestamp,
  metricsRegistry,
  mirrorEnabled,
  pushDurationMs,
  pushTotal,
} from "./metrics.js";

/** Stable structured-log event names (Loki query keys). */
export const EVENT = {
  LIFECYCLE_STARTING: "knowledge-sync.lifecycle.starting",
  LIFECYCLE_READY: "knowledge-sync.lifecycle.ready",
  LIFECYCLE_SHUTDOWN: "knowledge-sync.lifecycle.shutdown",
  LIFECYCLE_FATAL: "knowledge-sync.lifecycle.fatal",
  TICK: "knowledge-sync.reconcile.tick",
  DISABLED: "knowledge-sync.reconcile.disabled",
  PUSH_START: "knowledge-sync.push.start",
  PUSH_OK: "knowledge-sync.push.ok",
  PUSH_ERROR: "knowledge-sync.push.error",
} as const;
