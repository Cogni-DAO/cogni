// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/server/ai/billing-executor-decorator.spec`
 * Purpose: Unit tests for BillingGraphExecutorDecorator billing validation and stream wrapping.
 * Scope: Tests Zod validation (strict for inproc/sandbox, hints for external), usage_report consumption, and error propagation. Does not test receipt writes (CALLBACK_IS_SOLE_WRITER).
 * Invariants: CALLBACK_IS_SOLE_WRITER, USAGE_FACT_VALIDATED, BILLING_INDEPENDENT_OF_CLIENT
 * Side-effects: none
 * Links: src/adapters/server/ai/billing-executor.decorator.ts, GRAPH_EXECUTION.md
 * @internal
 */

import {
  buildExternalUsageFact,
  buildInprocUsageFact,
  buildSandboxUsageFact,
} from "@tests/_fakes";
import { describe, expect, it } from "vitest";

import { BillingGraphExecutorDecorator } from "@/adapters/server/ai/billing-executor.decorator";
import type {
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@/ports";
import { makeNoopLogger } from "@/shared/observability";
import type {
  AiEvent,
  DoneEvent,
  TextDeltaEvent,
  UsageReportEvent,
} from "@/types/ai-events";
import type { UsageFact } from "@/types/usage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeInnerExecutor(events: AiEvent[]): GraphExecutorPort {
  return {
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
}

const fakeRequest: GraphRunRequest = {
  runId: "run-123",
  ingressRequestId: "req-123",
  messages: [{ role: "user", content: "test" }],
  model: "test-model",
  caller: {
    billingAccountId: "billing-123",
    virtualKeyId: "vk-123",
    requestId: "req-123",
    traceId: "00000000000000000000000000000000",
  },
  graphId: "langgraph:poet",
};

async function collectStream(
  stream: AsyncIterable<AiEvent>
): Promise<AiEvent[]> {
  const events: AiEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

// ============================================================================
// BillingGraphExecutorDecorator: Stream Wrapping
// ============================================================================

describe("BillingGraphExecutorDecorator stream wrapping", () => {
  it("passes through non-billing events and consumes usage_report", async () => {
    const fact = buildInprocUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "text_delta", delta: "Hello" } satisfies TextDeltaEvent,
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    const collected = await collectStream(result.stream);

    // usage_report consumed — not yielded to downstream
    expect(collected).toHaveLength(2);
    expect(collected.map((e) => e.type)).toEqual(["text_delta", "done"]);
  });

  it("delegates final promise from inner executor", async () => {
    const inner = createFakeInnerExecutor([
      { type: "done" } satisfies DoneEvent,
    ]);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    // Drain stream first
    await collectStream(result.stream);
    const final = await result.final;

    expect(final.ok).toBe(true);
    expect(final.runId).toBe("run-123");
  });
});

// ============================================================================
// BillingGraphExecutorDecorator: Billing Validation
// ============================================================================

describe("BillingGraphExecutorDecorator billing validation", () => {
  it("valid inproc fact → passes validation without error", async () => {
    const fact = buildInprocUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    // Should not throw — valid fact passes validation
    const collected = await collectStream(result.stream);
    expect(collected.map((e) => e.type)).toEqual(["done"]);
  });

  it("valid sandbox fact → passes validation without error", async () => {
    const fact = buildSandboxUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      makeNoopLogger()
    );

    const collected = await collectStream(
      decorator.runGraph(fakeRequest).stream
    );
    expect(collected.map((e) => e.type)).toEqual(["done"]);
  });

  it("inproc executor missing usageUnitId → throws validation failure", async () => {
    const { usageUnitId: _, ...factWithoutId } = buildInprocUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "text_delta", delta: "Hello" } satisfies TextDeltaEvent,
      {
        type: "usage_report",
        fact: factWithoutId as unknown as UsageFact,
      } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);

    // Stream iteration should throw because of billing-authoritative hard failure
    await expect(collectStream(result.stream)).rejects.toThrow(
      "Billing validation failed"
    );
  });

  it("sandbox executor missing usageUnitId → throws validation failure", async () => {
    const { usageUnitId: _, ...factWithoutId } = buildSandboxUsageFact();
    const innerEvents: AiEvent[] = [
      {
        type: "usage_report",
        fact: factWithoutId as unknown as UsageFact,
      } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      makeNoopLogger()
    );

    await expect(
      collectStream(decorator.runGraph(fakeRequest).stream)
    ).rejects.toThrow("Billing validation failed");
  });

  it("valid external fact (no usageUnitId) → passes validation (hints schema)", async () => {
    const externalFact = buildExternalUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "text_delta", delta: "Response" } satisfies TextDeltaEvent,
      { type: "usage_report", fact: externalFact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    const collected = await collectStream(result.stream);

    // Hints schema passes (usageUnitId optional for external) — no error
    expect(collected.map((e) => e.type)).toEqual(["text_delta", "done"]);
  });

  it("external executor with malformed data → soft skip (no throw)", async () => {
    // Remove runId to fail hints validation (runId is required even in hints schema)
    const { runId: _, ...factWithoutRunId } = buildExternalUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "text_delta", delta: "Response" } satisfies TextDeltaEvent,
      {
        type: "usage_report",
        fact: factWithoutRunId as unknown as UsageFact,
      } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      makeNoopLogger()
    );

    const result = decorator.runGraph(fakeRequest);
    const collected = await collectStream(result.stream);

    // No error — soft skip for malformed hints (non-authoritative)
    expect(collected.map((e) => e.type)).toEqual(["text_delta", "done"]);
  });

  it("multiple usage_report events → all consumed, none yielded", async () => {
    const fact1 = buildInprocUsageFact({ usageUnitId: "call-1" });
    const fact2 = buildInprocUsageFact({ usageUnitId: "call-2" });
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact: fact1 } satisfies UsageReportEvent,
      { type: "usage_report", fact: fact2 } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new BillingGraphExecutorDecorator(
      inner,
      makeNoopLogger()
    );

    const collected = await collectStream(
      decorator.runGraph(fakeRequest).stream
    );

    // Both usage_report events consumed, only done yielded
    expect(collected.map((e) => e.type)).toEqual(["done"]);
  });
});
