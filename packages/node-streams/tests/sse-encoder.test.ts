// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-streams/tests/sse-encoder`
 * Purpose: Unit tests for encodeSSE — SSE wire format, abort handling, error propagation.
 * Scope: Pure function tests. Does not use Redis or perform I/O.
 * Invariants:
 *   - SSE_RESUME_SAFE: Every frame includes id: field
 * Side-effects: none
 * Links: src/sse-encoder.ts
 * @internal
 */

import { describe, expect, it } from "vitest";
import type { NodeStreamEntry } from "../src/node-stream.port.js";
import { encodeSSE } from "../src/sse-encoder.js";

interface TestEvent {
  type: string;
  timestamp: string;
  source: string;
  value?: number;
}

function makeEntry(
  id: string,
  type: string,
  extra?: Record<string, unknown>
): NodeStreamEntry<TestEvent> {
  return {
    id,
    event: {
      type,
      timestamp: "2026-04-05T00:00:00.000Z",
      source: "test",
      ...extra,
    } as TestEvent,
  };
}

async function* yieldEntries(
  ...entries: NodeStreamEntry<TestEvent>[]
): AsyncIterable<NodeStreamEntry<TestEvent>> {
  for (const entry of entries) {
    yield entry;
  }
}

async function drainStream(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks.join("");
}

describe("encodeSSE", () => {
  it("emits correct SSE wire format", async () => {
    const entry = makeEntry("1710000000000-0", "health");
    const stream = encodeSSE(yieldEntries(entry), new AbortController().signal);
    const output = await drainStream(stream);

    expect(output).toContain("id: 1710000000000-0\n");
    expect(output).toContain("event: health\n");
    expect(output).toContain("data: {");
    expect(output).toContain('"type":"health"');
    // SSE frames end with double newline
    expect(output).toMatch(/\n\n$/);
  });

  it("emits multiple frames in order", async () => {
    const entries = [
      makeEntry("1-0", "health"),
      makeEntry("2-0", "ci_status"),
      makeEntry("3-0", "deploy"),
    ];
    const stream = encodeSSE(
      yieldEntries(...entries),
      new AbortController().signal
    );
    const output = await drainStream(stream);

    const ids = [...output.matchAll(/^id: (.+)$/gm)].map((m) => m[1]);
    expect(ids).toEqual(["1-0", "2-0", "3-0"]);
  });

  it("stops cleanly on abort", async () => {
    const controller = new AbortController();
    async function* infinite(): AsyncIterable<NodeStreamEntry<TestEvent>> {
      let i = 0;
      while (true) {
        yield makeEntry(`${++i}-0`, "health");
      }
    }

    const stream = encodeSSE(infinite(), controller.signal);
    const reader = stream.getReader();

    // Read first frame
    const first = await reader.read();
    expect(first.done).toBe(false);

    // Abort
    controller.abort();

    // Stream should close without error
    const next = await reader.read();
    expect(next.done).toBe(true);
  });

  it("propagates non-AbortError via controller.error()", async () => {
    async function* failing(): AsyncIterable<NodeStreamEntry<TestEvent>> {
      yield makeEntry("1-0", "health");
      throw new Error("Redis connection lost");
    }

    const stream = encodeSSE(failing(), new AbortController().signal);
    const reader = stream.getReader();

    // First chunk succeeds
    const first = await reader.read();
    expect(first.done).toBe(false);

    // Second read should reject with the error
    await expect(reader.read()).rejects.toThrow("Redis connection lost");
  });

  it("produces a closed stream from empty source", async () => {
    const stream = encodeSSE(yieldEntries(), new AbortController().signal);
    const output = await drainStream(stream);
    expect(output).toBe("");
  });
});
