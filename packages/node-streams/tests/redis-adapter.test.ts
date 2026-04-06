// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-streams/tests/redis-adapter`
 * Purpose: Unit tests for RedisNodeStreamAdapter — publish args, parseEntry, subscribe replay.
 * Scope: Mocked ioredis. Does not connect to real Redis.
 * Invariants:
 *   - REDIS_MAXLEN_ENFORCED: Every XADD includes MAXLEN
 * Side-effects: none (mocked Redis)
 * Links: src/redis-node-stream.adapter.ts
 * @internal
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeEventBase } from "../src/node-event.js";
import { NODE_STREAM_MAXLEN } from "../src/node-stream.port.js";
import { RedisNodeStreamAdapter } from "../src/redis-node-stream.adapter.js";

// -- Mock helpers (pattern from redis-run-stream.adapter.spec.ts) --

function createMockRedis() {
  const mock = {
    xadd: vi.fn().mockResolvedValue("1-0"),
    xrange: vi.fn().mockResolvedValue([]),
    xread: vi.fn().mockResolvedValue(null),
    xlen: vi.fn().mockResolvedValue(0),
    duplicate: vi.fn(),
    disconnect: vi.fn(),
  };
  const blockMock = {
    xread: vi.fn().mockResolvedValue(null),
    disconnect: vi.fn(),
  };
  mock.duplicate.mockReturnValue(blockMock);
  return { mock, blockMock };
}

function makeEvent(type: string): NodeEventBase {
  return { type, timestamp: "2026-04-05T00:00:00.000Z", source: "test" };
}

function encodeEntry(id: string, event: NodeEventBase): [string, string[]] {
  return [id, ["data", JSON.stringify(event)]];
}

async function collectAsync<T>(
  iter: AsyncIterable<T>,
  max = 100
): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iter) {
    items.push(item);
    if (items.length >= max) break;
  }
  return items;
}

// -- Tests --

describe("RedisNodeStreamAdapter", () => {
  const streamKey = "node:test-node:events";
  let redisMock: ReturnType<typeof createMockRedis>["mock"];
  let blockMock: ReturnType<typeof createMockRedis>["blockMock"];
  let adapter: RedisNodeStreamAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    const mocks = createMockRedis();
    redisMock = mocks.mock;
    blockMock = mocks.blockMock;
    adapter = new RedisNodeStreamAdapter(redisMock as never);
  });

  describe("publish", () => {
    it("calls xadd with MAXLEN and serialized event", async () => {
      const event = makeEvent("health");
      await adapter.publish(streamKey, event);

      expect(redisMock.xadd).toHaveBeenCalledWith(
        streamKey,
        "MAXLEN",
        "~",
        String(NODE_STREAM_MAXLEN),
        "*",
        "data",
        JSON.stringify(event)
      );
    });

    it("respects custom maxlen option", async () => {
      const customAdapter = new RedisNodeStreamAdapter(redisMock as never, {
        maxlen: 500,
      });
      await customAdapter.publish(streamKey, makeEvent("health"));

      expect(redisMock.xadd).toHaveBeenCalledWith(
        streamKey,
        "MAXLEN",
        "~",
        "500",
        "*",
        "data",
        expect.any(String)
      );
    });
  });

  describe("subscribe", () => {
    it("replays entries from cursor via XRANGE", async () => {
      const event1 = makeEvent("health");
      const event2 = makeEvent("ci_status");
      redisMock.xrange.mockResolvedValue([
        encodeEntry("100-0", event1), // cursor entry — should be skipped
        encodeEntry("101-0", event2),
      ]);

      const controller = new AbortController();
      // After replay, abort to stop live reads
      blockMock.xread.mockImplementation(async () => {
        controller.abort();
        return null;
      });

      const items = await collectAsync(
        adapter.subscribe(streamKey, controller.signal, "100-0")
      );

      // Should skip the cursor entry (100-0) and yield only 101-0
      expect(items).toHaveLength(1);
      expect(items[0]?.id).toBe("101-0");
      expect(items[0]?.event.type).toBe("ci_status");
    });

    it("throws on missing data field", async () => {
      redisMock.xrange.mockResolvedValue([
        ["200-0", ["other_field", "value"]], // no "data" field
      ]);

      const controller = new AbortController();

      await expect(
        collectAsync(adapter.subscribe(streamKey, controller.signal, "199-0"))
      ).rejects.toThrow("missing 'data' field");
    });

    it("disconnects blockClient on abort", async () => {
      const controller = new AbortController();
      blockMock.xread.mockImplementation(async () => {
        controller.abort();
        return null;
      });

      await collectAsync(adapter.subscribe(streamKey, controller.signal));

      expect(blockMock.disconnect).toHaveBeenCalled();
    });
  });

  describe("streamLength", () => {
    it("returns xlen result", async () => {
      redisMock.xlen.mockResolvedValue(42);
      const len = await adapter.streamLength(streamKey);
      expect(len).toBe(42);
    });
  });
});
