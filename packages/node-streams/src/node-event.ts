// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-streams/node-event`
 * Purpose: Event types for continuous node-level data streams.
 * Scope: Type definitions only. Does not contain logic or runtime code.
 * Invariants:
 *   - SOURCE_REF_ALWAYS: Every event includes a source pointer for drill-back
 * Side-effects: none
 * Links: node-stream.port, data-streams-spec
 * @public
 */

/** Base fields present on every node stream event. */
export interface NodeEventBase {
  /** Event type discriminator. */
  type: string;
  /** ISO timestamp of when the event was produced. */
  timestamp: string;
  /** Source identifier for drill-back (e.g., "github-actions", "health-probe", "loki"). */
  source: string;
}

/** Health probe result for a deployment endpoint. */
export interface HealthEvent extends NodeEventBase {
  type: "health";
  environment: string;
  status: "healthy" | "degraded" | "down";
  httpStatus: number | null;
  latencyMs: number | null;
  url: string;
}

/** CI/CD workflow run status. */
export interface CiStatusEvent extends NodeEventBase {
  type: "ci_status";
  branch: string;
  conclusion: string | null;
  workflowName: string;
  runUrl: string;
  commitSha: string;
  commitMessage: string;
}

/** Deployment lifecycle event (from Loki or webhook). */
export interface DeployEvent extends NodeEventBase {
  type: "deploy";
  environment: string;
  status: "started" | "success" | "failed";
  actor: string;
  commitSha: string;
}

/** Node-local process metrics (heap, RSS, event loop delay). Bootstrap-only exception — not for external sources. */
export interface ProcessHealthEvent extends NodeEventBase {
  type: "process_health";
  /** V8 heap used in MB. */
  heapUsedMb: number;
  /** Resident Set Size in MB. */
  rssMb: number;
  /** Process uptime in seconds. */
  uptimeSeconds: number;
  /** Event loop delay p99 in ms (via node:perf_hooks monitorEventLoopDelay). */
  eventLoopDelayMs: number;
  /** Deployment environment (local/preview/production). */
  environment: string;
}

/** Convenience union of common node event types. Nodes define their own unions for domain events. */
export type NodeEvent =
  | HealthEvent
  | CiStatusEvent
  | DeployEvent
  | ProcessHealthEvent;
