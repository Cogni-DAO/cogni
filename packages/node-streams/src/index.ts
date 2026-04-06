// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-streams`
 * Purpose: Shared streaming infrastructure for continuous node-level data streams.
 * Scope: Port interface, Redis adapter, SSE encoder, event types. Does not implement routes or DI wiring.
 * Invariants:
 *   - NODE_STREAM_NOT_RUN_STREAM: Continuous lifecycle, distinct from RunStreamPort
 * Side-effects: none
 * Links: node-stream.port, node-event, redis-node-stream.adapter, sse-encoder
 * @public
 */

// Event types
export type {
  CiStatusEvent,
  DeployEvent,
  HealthEvent,
  NodeEvent,
  NodeEventBase,
  ProcessHealthEvent,
  VcsActivityEvent,
} from "./node-event.js";

// Port interface + constants
export {
  NODE_STREAM_BLOCK_MS,
  NODE_STREAM_MAXLEN,
  type NodeStreamEntry,
  type NodeStreamPort,
} from "./node-stream.port.js";

// Redis adapter
export { RedisNodeStreamAdapter } from "./redis-node-stream.adapter.js";

// SSE encoder
export { encodeSSE } from "./sse-encoder.js";
