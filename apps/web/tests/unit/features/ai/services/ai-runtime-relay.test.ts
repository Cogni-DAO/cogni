// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/ai/services/ai-runtime-relay.test`
 * Purpose: Unit tests for RunEventRelay race conditions, protocol termination, and usage_report filtering.
 * Scope: Tests protocol termination and terminal guard. Does not test billing validation (see billing-executor-decorator.spec.ts).
 * Invariants: PUMP_TO_COMPLETION, PROTOCOL_TERMINATION, AI_RUNTIME_EMITS_AIEVENTS
 * Side-effects: none
 * Links: Tests RunEventRelay in ai_runtime.ts, GRAPH_EXECUTION.md
 * @internal
 */

import {
  createDelayedReturnGraphExecutor,
  createImmediateGraphExecutor,
  createUserMessage,
  FakeClock,
  TEST_MODEL_ID,
} from "@tests/_fakes";
import { describe, expect, it } from "vitest";

import { createAiRuntime } from "@/features/ai/services/ai_runtime";
import type {
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@/ports";
import type { RequestContext } from "@/shared/observability";
import { makeNoopLogger } from "@/shared/observability";
import type {
  AiEvent,
  DoneEvent,
  ErrorEvent,
  TextDeltaEvent,
} from "@/types/ai-events";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const createTestCtx = (): RequestContext => ({
  log: makeNoopLogger(),
  reqId: "test-req-123",
  traceId: "00000000000000000000000000000000",
  routeId: "test.route",
  clock: new FakeClock("2025-01-01T12:00:00.000Z"),
});

const defaultInput = (ctx: RequestContext) => ({
  messages: [createUserMessage("Test")],
  model: TEST_MODEL_ID,
  graphName: "langgraph:poet",
  caller: {
    billingAccountId: "billing-123",
    virtualKeyId: "vk-123",
    requestId: ctx.reqId,
    traceId: ctx.traceId,
  },
});

/** Collect all events from stream with a timeout to detect hangs. */
async function consumeWithTimeout(
  stream: AsyncIterable<AiEvent>,
  timeoutMs = 1000
): Promise<{ result: "completed" | "timeout"; events: AiEvent[] }> {
  const events: AiEvent[] = [];
  const consumePromise = (async () => {
    for await (const event of stream) {
      events.push(event);
    }
    return "completed" as const;
  })();
  const timeoutPromise = new Promise<"timeout">((r) =>
    setTimeout(() => r("timeout"), timeoutMs)
  );
  const result = await Promise.race([consumePromise, timeoutPromise]);
  return { result, events };
}

// ============================================================================
// RunEventRelay: Race Conditions
// ============================================================================

describe("RunEventRelay race conditions", () => {
  it("uiStream terminates on done event BEFORE pumpDone is set", async () => {
    // CRITICAL: This test verifies that uiStream terminates on the done event
    // itself, NOT by waiting for pumpDone to flip. The upstream continues
    // for 500ms after yielding done, so if uiStream waits for pumpDone, it hangs.

    const events: AiEvent[] = [
      { type: "text_delta", delta: "Hello" } satisfies TextDeltaEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    // Upstream delays 500ms after done before returning (pumpDone not set yet)
    const graphExecutor = createDelayedReturnGraphExecutor(events, 500);

    const runtime = createAiRuntime({ graphExecutor });
    const ctx = createTestCtx();

    const { stream } = runtime.runChatStream(defaultInput(ctx), ctx);

    const TIMEOUT_MS = 200;
    const startMs = performance.now();
    const { result, events: collectedEvents } = await consumeWithTimeout(
      stream,
      TIMEOUT_MS
    );
    const elapsedMs = performance.now() - startMs;

    // Assert: completed (didn't timeout waiting for pumpDone)
    expect(result).toBe("completed");
    // Assert: completed quickly (< 200ms, not waiting for 500ms delay)
    expect(elapsedMs).toBeLessThan(TIMEOUT_MS);
    // Assert: received all events
    expect(collectedEvents).toHaveLength(2);
    expect(collectedEvents[1]).toEqual({ type: "done" });
  });

  it("uiStream terminates on error event", async () => {
    // Error events are also terminal - uiStream should return immediately

    const events: AiEvent[] = [
      { type: "text_delta", delta: "Partial" } satisfies TextDeltaEvent,
      { type: "error", error: "internal" } satisfies ErrorEvent,
    ];

    const graphExecutor = createImmediateGraphExecutor(events);

    const runtime = createAiRuntime({ graphExecutor });
    const ctx = createTestCtx();

    const { stream } = runtime.runChatStream(defaultInput(ctx), ctx);

    const collectedEvents: AiEvent[] = [];
    for await (const event of stream) {
      collectedEvents.push(event);
    }

    // Assert: terminated on error
    expect(collectedEvents).toHaveLength(2);
    expect(collectedEvents[0]).toEqual({
      type: "text_delta",
      delta: "Partial",
    });
    expect(collectedEvents[1]).toEqual({
      type: "error",
      error: "internal",
    });
  });

  it("uiStream does not hang when pump finishes immediately after done event", async () => {
    const events: AiEvent[] = [
      { type: "text_delta", delta: "Hello" } satisfies TextDeltaEvent,
      { type: "text_delta", delta: " world" } satisfies TextDeltaEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const graphExecutor = createImmediateGraphExecutor(events);

    const runtime = createAiRuntime({ graphExecutor });
    const ctx = createTestCtx();

    const { stream, final } = runtime.runChatStream(defaultInput(ctx), ctx);

    const { result, events: collectedEvents } =
      await consumeWithTimeout(stream);

    expect(result).toBe("completed");
    expect(collectedEvents).toHaveLength(3);
    expect(collectedEvents[0]).toEqual({ type: "text_delta", delta: "Hello" });
    expect(collectedEvents[1]).toEqual({
      type: "text_delta",
      delta: " world",
    });
    expect(collectedEvents[2]).toEqual({ type: "done" });

    const finalResult = await final;
    expect(finalResult.ok).toBe(true);
  });

  it("uiStream filters out usage_report events", async () => {
    // usage_report events are consumed by BillingGraphExecutorDecorator
    // but if any leak through, relay defensively filters them

    const events: AiEvent[] = [
      { type: "text_delta", delta: "Response" } satisfies TextDeltaEvent,
      {
        type: "usage_report",
        fact: {
          runId: "run-123",
          attempt: 0,
          source: "litellm",
          billingAccountId: "billing-123",
          virtualKeyId: "vk-123",
          inputTokens: 10,
          outputTokens: 5,
        },
      },
      { type: "done" } satisfies DoneEvent,
    ];

    const graphExecutor = createImmediateGraphExecutor(events);

    const runtime = createAiRuntime({ graphExecutor });
    const ctx = createTestCtx();

    const { stream } = runtime.runChatStream(defaultInput(ctx), ctx);

    const collectedEvents: AiEvent[] = [];
    for await (const event of stream) {
      collectedEvents.push(event);
    }

    // Assert: usage_report was filtered out
    expect(collectedEvents).toHaveLength(2);
    expect(collectedEvents.map((e) => e.type)).toEqual(["text_delta", "done"]);
  });

  it("uiStream completes when pump finishes with empty queue", async () => {
    const events: AiEvent[] = [{ type: "done" } satisfies DoneEvent];

    const graphExecutor = createImmediateGraphExecutor(events);

    const runtime = createAiRuntime({ graphExecutor });
    const ctx = createTestCtx();

    const { stream } = runtime.runChatStream(defaultInput(ctx), ctx);

    const { result, events: collectedEvents } = await consumeWithTimeout(
      stream,
      500
    );

    expect(result).toBe("completed");
    expect(collectedEvents).toEqual([{ type: "done" }]);
  });
});

// ============================================================================
// RunEventRelay: Terminal Guard (Protocol Violation Handling)
// ============================================================================

describe("RunEventRelay terminal guard", () => {
  it("ignores events after terminal done (protocol violation)", async () => {
    const events: AiEvent[] = [
      { type: "text_delta", delta: "Hello" } satisfies TextDeltaEvent,
      { type: "done" } satisfies DoneEvent,
      // Protocol violation: events after done should be ignored
      {
        type: "text_delta",
        delta: "SHOULD BE IGNORED",
      } satisfies TextDeltaEvent,
    ];

    const graphExecutor: GraphExecutorPort = {
      runGraph(_req: GraphRunRequest): GraphRunResult {
        async function* stream(): AsyncIterable<AiEvent> {
          for (const event of events) {
            yield event;
          }
        }
        return {
          stream: stream(),
          final: Promise.resolve({
            ok: true as const,
            runId: "run-123",
            requestId: "req-123",
          }),
        };
      },
    };

    const runtime = createAiRuntime({ graphExecutor });
    const ctx = createTestCtx();

    const { stream } = runtime.runChatStream(defaultInput(ctx), ctx);

    const collectedEvents: AiEvent[] = [];
    for await (const event of stream) {
      collectedEvents.push(event);
    }

    // Only "Hello" and "done" should be collected — "SHOULD BE IGNORED" is dropped
    expect(collectedEvents).toHaveLength(2);
    expect(collectedEvents[0]).toEqual({ type: "text_delta", delta: "Hello" });
    expect(collectedEvents[1]).toEqual({ type: "done" });
  });

  it("ignores usage_report after terminal done", async () => {
    // usage_report after done should be ignored by terminal guard
    const events: AiEvent[] = [
      { type: "done" } satisfies DoneEvent,
      // Protocol violation: usage_report after done
      {
        type: "usage_report",
        fact: {
          runId: "run-123",
          attempt: 0,
          source: "litellm",
          billingAccountId: "billing-123",
          virtualKeyId: "vk-123",
        },
      },
    ];

    const graphExecutor: GraphExecutorPort = {
      runGraph(_req: GraphRunRequest): GraphRunResult {
        async function* stream(): AsyncIterable<AiEvent> {
          for (const event of events) {
            yield event;
          }
        }
        return {
          stream: stream(),
          final: Promise.resolve({
            ok: true as const,
            runId: "run-123",
            requestId: "req-123",
          }),
        };
      },
    };

    const runtime = createAiRuntime({ graphExecutor });
    const ctx = createTestCtx();

    const { stream } = runtime.runChatStream(defaultInput(ctx), ctx);

    const collectedEvents: AiEvent[] = [];
    for await (const event of stream) {
      collectedEvents.push(event);
    }

    // Wait for pump to finish
    await new Promise((r) => setTimeout(r, 50));

    // Only done should be collected
    expect(collectedEvents).toEqual([{ type: "done" }]);
  });
});
