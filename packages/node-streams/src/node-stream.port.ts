// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-streams/node-stream.port`
 * Purpose: Port interface for continuous node-level data streams.
 * Scope: Defines publish/subscribe contract for MAXLEN-trimmed streams with cursor replay. Does not contain implementations.
 * Invariants:
 *   - REDIS_MAXLEN_ENFORCED: All writes include MAXLEN
 *   - SSE_RESUME_SAFE: Subscribe supports cursor-based replay
 *   - NODE_STREAM_NOT_RUN_STREAM: Continuous (never terminates), unlike RunStreamPort
 * Side-effects: none
 * Links: node-event, data-streams-spec, run-stream.port
 * @public
 */

import type { NodeEventBase } from "./node-event.js";

/** Default MAXLEN for node streams (approximate trim). ~16h at 30s intervals. */
export const NODE_STREAM_MAXLEN = 2_000;

/** Default block timeout in ms for XREAD. */
export const NODE_STREAM_BLOCK_MS = 5_000;

/** A single entry in a node stream. */
export interface NodeStreamEntry<T extends NodeEventBase = NodeEventBase> {
  /** Redis stream entry ID (e.g. "1710000000000-0"). */
  id: string;
  /** The event payload. */
  event: T;
}

/**
 * Port for continuous node-level data streams.
 *
 * Unlike RunStreamPort (per-run, terminal events), node streams are:
 * - Continuous: never terminate (trimmed by MAXLEN)
 * - Multi-source: single stream per node aggregates health, CI, deploy events
 * - Resumable: cursor-based replay via subscribe(fromId)
 */
export interface NodeStreamPort<T extends NodeEventBase = NodeEventBase> {
  /** Publish a single event to a named stream. MAXLEN-trimmed. */
  publish(streamKey: string, event: T): Promise<void>;

  /**
   * Subscribe to a named stream from a cursor position.
   * Replays from cursor via XRANGE, then switches to live XREAD BLOCK.
   * Never terminates — caller must abort via signal.
   */
  subscribe(
    streamKey: string,
    signal: AbortSignal,
    fromId?: string
  ): AsyncIterable<NodeStreamEntry<T>>;

  /** Returns the number of entries in a stream (0 if key doesn't exist). */
  streamLength(streamKey: string): Promise<number>;
}
