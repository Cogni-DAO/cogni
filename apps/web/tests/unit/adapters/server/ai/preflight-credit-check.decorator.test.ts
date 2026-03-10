// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/server/ai/preflight-credit-check.decorator.test`
 * Purpose: Tests PreflightCreditCheckDecorator credit gating behavior.
 * Scope: Unit tests for decorator stream wrapping and credit check enforcement. Does NOT test actual billing or LLM calls.
 * Invariants:
 *   - Credit check runs before any upstream event consumption
 *   - InsufficientCreditsPortError propagates through both stream and final
 *   - Inner executor is called synchronously regardless of check outcome
 * Side-effects: none
 * Links: preflight-credit-check.decorator.ts
 * @public
 */

import { describe, expect, it, vi } from "vitest";
import { PreflightCreditCheckDecorator } from "@/adapters/server/ai/preflight-credit-check.decorator";
import type {
  GraphExecutorPort,
  GraphFinal,
  GraphRunRequest,
  PreflightCreditCheckFn,
} from "@/ports";
import { InsufficientCreditsPortError } from "@/ports";
import type { AiEvent } from "@/types/ai-events";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides?: Partial<GraphRunRequest>): GraphRunRequest {
  return {
    runId: "run-1",
    ingressRequestId: "req-1",
    messages: [{ role: "user", content: "hello" }],
    model: "gpt-4o",
    caller: {
      billingAccountId: "ba-1",
      virtualKeyId: "vk-1",
      requestId: "req-1",
      traceId: "00000000000000000000000000000001",
    },
    graphId: "langgraph:test" as GraphRunRequest["graphId"],
    ...overrides,
  };
}

function makeInner(events: AiEvent[]): GraphExecutorPort {
  return {
    runGraph: () => ({
      stream: (async function* () {
        for (const e of events) yield e;
      })(),
      final: Promise.resolve({
        ok: true,
        runId: "run-1",
        requestId: "req-1",
      } as GraphFinal),
    }),
  };
}

const log = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Parameters<
  typeof PreflightCreditCheckDecorator.prototype.runGraph
>[0] extends never
  ? never
  : ConstructorParameters<typeof PreflightCreditCheckDecorator>[2];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PreflightCreditCheckDecorator", () => {
  it("passes through all events when credit check succeeds", async () => {
    const events: AiEvent[] = [
      { type: "text_delta", delta: "hi" },
      { type: "done" },
    ];
    const checkFn: PreflightCreditCheckFn = vi
      .fn()
      .mockResolvedValue(undefined);
    const decorator = new PreflightCreditCheckDecorator(
      makeInner(events),
      checkFn,
      log
    );

    const result = decorator.runGraph(makeRequest());
    const collected: AiEvent[] = [];
    for await (const event of result.stream) {
      collected.push(event);
    }

    expect(collected).toEqual(events);
    expect(checkFn).toHaveBeenCalledWith("ba-1", "gpt-4o", [
      { role: "user", content: "hello" },
    ]);
    const final = await result.final;
    expect(final.ok).toBe(true);
  });

  it("throws InsufficientCreditsPortError before any upstream events", async () => {
    const innerRunGraph = vi.fn();
    const inner: GraphExecutorPort = {
      runGraph: (req) => {
        innerRunGraph();
        return makeInner([
          { type: "text_delta", delta: "should not see" },
          { type: "done" },
        ]).runGraph(req);
      },
    };

    const checkFn: PreflightCreditCheckFn = vi
      .fn()
      .mockRejectedValue(new InsufficientCreditsPortError("ba-1", 100, 0));

    const decorator = new PreflightCreditCheckDecorator(inner, checkFn, log);
    const result = decorator.runGraph(makeRequest());

    // Stream should throw on first iteration
    const collected: AiEvent[] = [];
    await expect(async () => {
      for await (const event of result.stream) {
        collected.push(event);
      }
    }).rejects.toThrow(InsufficientCreditsPortError);

    // No upstream events consumed
    expect(collected).toEqual([]);

    // Final also rejects
    await expect(result.final).rejects.toThrow(InsufficientCreditsPortError);
  });

  it("calls inner.runGraph synchronously (before check resolves)", () => {
    const innerRunGraph = vi.fn().mockReturnValue({
      stream: (async function* () {})(),
      final: Promise.resolve({ ok: true, runId: "run-1", requestId: "req-1" }),
    });
    const inner: GraphExecutorPort = { runGraph: innerRunGraph };

    // Check that never resolves (simulates slow network)
    const checkFn: PreflightCreditCheckFn = () => new Promise(() => {});
    const decorator = new PreflightCreditCheckDecorator(inner, checkFn, log);

    decorator.runGraph(makeRequest());

    // inner.runGraph was called synchronously even though check hasn't resolved
    expect(innerRunGraph).toHaveBeenCalledTimes(1);
  });
});
