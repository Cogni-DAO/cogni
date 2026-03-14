// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/graph-execution-core/execution-context`
 * Purpose: Per-run cross-cutting metadata for graph execution.
 * Scope: Typed context passed alongside GraphRunRequest. Does not include billing credentials or tracing IDs.
 * Invariants:
 *   - NO_BILLING_LEAKAGE: No billingAccountId, virtualKeyId, or billing types
 *   - NO_TRACING_LEAKAGE: No traceId — flows via OTel context propagation
 * Side-effects: none (type only)
 * Links: docs/spec/unified-graph-launch.md
 * @public
 */

/**
 * Per-run cross-cutting metadata.
 *
 * Passed as the second argument to `GraphExecutorPort.runGraph()`.
 * Contains only what downstream code legitimately needs beyond the
 * pure business input on GraphRunRequest.
 *
 * Billing credentials (billingAccountId, virtualKeyId) are resolved
 * by injected resolvers in the app layer, not carried here.
 *
 * Tracing (traceId) flows via OTel context propagation, not this interface.
 */
export interface ExecutionContext {
  /** Actor who initiated this run (user ID for user-initiated, undefined for system) */
  readonly actorUserId?: string;
  /** Session ID for observability grouping (e.g., Langfuse sessions) */
  readonly sessionId?: string;
  /** Privacy flag — when true, content is scrubbed before telemetry */
  readonly maskContent?: boolean;
  /** Request correlation ID for observability (distinct from runId which is durable execution identity) */
  readonly requestId?: string;
  /** Abort signal for delivery-layer cancellation (HTTP disconnect, etc.) */
  readonly abortSignal?: AbortSignal;
}
