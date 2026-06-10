// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-sync-service/logger`
 * Purpose: Pino logger factory — JSON-only stdout emission.
 * Scope: Create configured pino loggers. Does not handle request-scoped logging.
 * Invariants: Always emits JSON to stdout; no worker transports; env label added by Alloy.
 * Side-effects: none
 * Notes: Duplicated from services/scheduler-worker/src/observability/logger.ts until @cogni/logging exists.
 * @internal
 */

import type { DestinationStream, Logger } from "pino";
import pino from "pino";

import { REDACT_PATHS } from "./redact.js";

export type { Logger } from "pino";

let destination: DestinationStream | null = null;

export function makeLogger(bindings?: Record<string, unknown>): Logger {
  const logLevel = process.env.LOG_LEVEL ?? "info";
  const serviceName = process.env.SERVICE_NAME ?? "knowledge-sync";

  const config = {
    level: logLevel,
    base: { ...bindings, app: "cogni-template", service: serviceName },
    messageKey: "msg",
    timestamp: pino.stdTimeFunctions.isoTime, // RFC3339
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };

  // Always emit JSON to stdout (fd 1), sync + zero buffering.
  destination = pino.destination({ dest: 1, sync: true, minLength: 0 });

  return pino(config, destination);
}

/** Flush logger destination before exit to prevent log loss. */
export function flushLogger(): void {
  if (destination && "flushSync" in destination) {
    (destination as { flushSync: () => void }).flushSync();
  }
}
