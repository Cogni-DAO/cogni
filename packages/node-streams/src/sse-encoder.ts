// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-streams/sse-encoder`
 * Purpose: Converts AsyncIterable<NodeStreamEntry> to a ReadableStream<Uint8Array> in SSE format.
 * Scope: Pure transform. Does not perform I/O, framework coupling, or compression.
 * Invariants:
 *   - SSE_RESUME_SAFE: Every SSE message includes `id:` for Last-Event-ID reconnection
 * Side-effects: none
 * Links: NodeStreamEntry, node-stream.port
 * @public
 */

import type { NodeEventBase } from "./node-event.js";
import type { NodeStreamEntry } from "./node-stream.port.js";

const encoder = new TextEncoder();

/**
 * Encode a stream of node events as SSE (Server-Sent Events).
 *
 * Output format per event:
 * ```
 * id: <redis-stream-id>
 * event: <event.type>
 * data: <json>
 *
 * ```
 */
export function encodeSSE<T extends NodeEventBase = NodeEventBase>(
  source: AsyncIterable<NodeStreamEntry<T>>,
  signal: AbortSignal
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      let closed = false;
      function safeClose() {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }

      try {
        for await (const entry of source) {
          if (signal.aborted) break;

          const message =
            `id: ${entry.id}\n` +
            `event: ${entry.event.type}\n` +
            `data: ${JSON.stringify(entry.event)}\n\n`;

          controller.enqueue(encoder.encode(message));
        }
        safeClose();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          // Client disconnected — normal
          safeClose();
        } else if (!closed) {
          closed = true;
          controller.error(error);
        }
      }
    },
  });
}
