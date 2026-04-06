// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-streams/redis-node-stream.adapter`
 * Purpose: Redis Streams implementation of NodeStreamPort for continuous node-level events.
 * Scope: XADD with MAXLEN for publish, XRANGE+XREAD for subscribe. Does not manage Redis connections or TTL policies.
 * Invariants:
 *   - REDIS_MAXLEN_ENFORCED: Every XADD includes MAXLEN ~2000
 *   - NODE_STREAM_NOT_RUN_STREAM: No terminal events — streams are continuous
 * Side-effects: IO (Redis commands via ioredis)
 * Links: NodeStreamPort, node-stream.port, ioredis
 * @public
 */

import type Redis from "ioredis";
import type { NodeEventBase } from "./node-event.js";
import {
  NODE_STREAM_BLOCK_MS,
  NODE_STREAM_MAXLEN,
  type NodeStreamEntry,
  type NodeStreamPort,
} from "./node-stream.port.js";

function parseEntry<T extends NodeEventBase>(
  raw: [string, string[]]
): NodeStreamEntry<T> {
  const [id, fields] = raw;
  let data: string | undefined;
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i] === "data") {
      data = fields[i + 1];
      break;
    }
  }
  if (!data) throw new Error(`Stream entry ${id} missing 'data' field`);
  return { id, event: JSON.parse(data) as T };
}

export class RedisNodeStreamAdapter<T extends NodeEventBase = NodeEventBase>
  implements NodeStreamPort<T>
{
  private readonly maxlen: number;

  constructor(
    private readonly redis: Redis,
    opts?: { maxlen?: number }
  ) {
    this.maxlen = opts?.maxlen ?? NODE_STREAM_MAXLEN;
  }

  async publish(streamKey: string, event: T): Promise<void> {
    const data = JSON.stringify(event);
    await this.redis.xadd(
      streamKey,
      "MAXLEN",
      "~",
      String(this.maxlen),
      "*",
      "data",
      data
    );
  }

  async *subscribe(
    streamKey: string,
    signal: AbortSignal,
    fromId?: string
  ): AsyncIterable<NodeStreamEntry<T>> {
    // Phase 1: Replay from cursor via XRANGE
    let cursor = fromId ?? "0-0";

    if (fromId) {
      const replayEntries = await this.redis.xrange(streamKey, fromId, "+");
      for (const raw of replayEntries) {
        if (signal.aborted) return;
        if (raw[0] === fromId) continue; // XRANGE is inclusive, skip cursor entry
        const entry = parseEntry<T>(raw);
        cursor = entry.id;
        yield entry;
      }
    }

    // Phase 2: Live reads via XREAD BLOCK (dedicated client to avoid blocking shared pool)
    const blockClient = this.redis.duplicate();
    try {
      while (!signal.aborted) {
        const result = await blockClient.xread(
          "COUNT",
          100,
          "BLOCK",
          NODE_STREAM_BLOCK_MS,
          "STREAMS",
          streamKey,
          cursor
        );

        if (signal.aborted) return;
        if (!result) continue;

        for (const [, entries] of result) {
          for (const raw of entries) {
            if (signal.aborted) return;
            const entry = parseEntry<T>(raw);
            cursor = entry.id;
            yield entry;
          }
        }
      }
    } finally {
      blockClient.disconnect();
    }
  }

  async streamLength(streamKey: string): Promise<number> {
    return this.redis.xlen(streamKey);
  }
}
