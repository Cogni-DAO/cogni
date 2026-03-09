// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/observability/metrics`
 * Purpose: Prometheus metrics for Temporal worker health and activity performance.
 * Scope: Define and export worker-specific metrics + shared registry. Does not serve HTTP.
 * Invariants: All metrics use `temporal_` or `ledger_` prefix for namespace isolation.
 * Side-effects: Registers default Node.js metrics (heap, RSS, GC) on import.
 * Links: docs/spec/observability.md, src/health.ts (/metrics endpoint)
 * @public
 */

import client from "prom-client";

// Shared registry — collectDefaultMetrics populates process/heap/GC metrics
export const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry });

/**
 * Histogram: Activity execution duration in milliseconds.
 * Labels: activity (name), status (success|error)
 */
export const activityDurationMs = new client.Histogram({
  name: "temporal_activity_duration_ms",
  help: "Duration of Temporal activity executions in milliseconds",
  labelNames: ["activity", "status"] as const,
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  registers: [metricsRegistry],
});

/**
 * Counter: Total activity errors.
 * Labels: activity (name), error_type (retryable|non_retryable|unknown)
 */
export const activityErrorsTotal = new client.Counter({
  name: "temporal_activity_errors_total",
  help: "Total number of Temporal activity errors",
  labelNames: ["activity", "error_type"] as const,
  registers: [metricsRegistry],
});

/**
 * Gauge: Worker info (always 1 when worker is running).
 * Labels: task_queue
 * Scrape failure = worker down (deadman pattern).
 */
export const workerInfo = new client.Gauge({
  name: "temporal_worker_info",
  help: "Temporal worker info gauge (1 = running)",
  labelNames: ["task_queue"] as const,
  registers: [metricsRegistry],
});
