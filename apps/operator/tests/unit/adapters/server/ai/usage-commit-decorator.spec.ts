// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/server/ai/usage-commit-decorator.spec`
 * Purpose: Unit tests for UsageCommitDecorator: validation, stream wrapping, and BYO receipt commit.
 * Scope: Tests Zod validation (strict for inproc/sandbox, hints for external), usage_report consumption, BYO commit dispatch, and error propagation.
 * Invariants: CALLBACK_WRITES_PLATFORM_RECEIPTS, USAGE_FACT_VALIDATED, BILLING_INDEPENDENT_OF_CLIENT, ONE_LEDGER_WRITER
 * Side-effects: none
 * Links: src/adapters/server/ai/usage-commit.decorator.ts
 * @internal
 */

import {
  buildByoUsageFact,
  buildExternalUsageFact,
  buildInprocUsageFact,
  buildSandboxUsageFact,
} from "@tests/_fakes";
import { describe, expect, it, vi } from "vitest";

import {
  type CommitUsageFactFn,
  UsageCommitDecorator,
} from "@/adapters/server/ai/usage-commit.decorator";
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
  modelRef: { providerKey: "platform", modelId: "test-model" },
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

function noopCommit(): CommitUsageFactFn {
  return vi.fn().mockResolvedValue(undefined);
}

// ============================================================================
// UsageCommitDecorator: Stream Wrapping
// ============================================================================

describe("UsageCommitDecorator stream wrapping", () => {
  it("passes through non-billing events and consumes usage_report", async () => {
    const fact = buildInprocUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "text_delta", delta: "Hello" } satisfies TextDeltaEvent,
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new UsageCommitDecorator(
      inner,
      makeNoopLogger(),
      noopCommit()
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
    const decorator = new UsageCommitDecorator(
      inner,
      makeNoopLogger(),
      noopCommit()
    );

    const result = decorator.runGraph(fakeRequest);
    await collectStream(result.stream);
    const final = await result.final;

    expect(final.ok).toBe(true);
    expect(final.runId).toBe("run-123");
  });
});

// ============================================================================
// UsageCommitDecorator: Billing Validation
// ============================================================================

describe("UsageCommitDecorator billing validation", () => {
  it("valid inproc fact → passes validation without error", async () => {
    const fact = buildInprocUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new UsageCommitDecorator(
      inner,
      makeNoopLogger(),
      noopCommit()
    );

    const result = decorator.runGraph(fakeRequest);
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
    const decorator = new UsageCommitDecorator(
      inner,
      makeNoopLogger(),
      noopCommit()
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
    const decorator = new UsageCommitDecorator(
      inner,
      makeNoopLogger(),
      noopCommit()
    );

    const result = decorator.runGraph(fakeRequest);
    await expect(collectStream(result.stream)).rejects.toThrow(
      "Billing validation failed"
    );
  });

  it("valid external fact (no usageUnitId) → passes validation (hints schema)", async () => {
    const externalFact = buildExternalUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "text_delta", delta: "Response" } satisfies TextDeltaEvent,
      { type: "usage_report", fact: externalFact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new UsageCommitDecorator(
      inner,
      makeNoopLogger(),
      noopCommit()
    );

    const result = decorator.runGraph(fakeRequest);
    const collected = await collectStream(result.stream);
    expect(collected.map((e) => e.type)).toEqual(["text_delta", "done"]);
  });
});

// ============================================================================
// UsageCommitDecorator: BYO Receipt Commit
// ============================================================================

describe("UsageCommitDecorator BYO receipt commit", () => {
  it("calls commitByo for non-litellm (codex) usage facts", async () => {
    const commitFn = vi.fn().mockResolvedValue(undefined);
    const fact = buildByoUsageFact({ source: "codex" });
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new UsageCommitDecorator(
      inner,
      makeNoopLogger(),
      commitFn
    );

    await collectStream(decorator.runGraph(fakeRequest).stream);

    expect(commitFn).toHaveBeenCalledOnce();
    expect(commitFn).toHaveBeenCalledWith(fact, expect.anything());
  });

  it("calls commitByo for non-litellm (ollama) usage facts", async () => {
    const commitFn = vi.fn().mockResolvedValue(undefined);
    const fact = buildByoUsageFact({ source: "ollama" });
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new UsageCommitDecorator(
      inner,
      makeNoopLogger(),
      commitFn
    );

    await collectStream(decorator.runGraph(fakeRequest).stream);

    expect(commitFn).toHaveBeenCalledOnce();
    expect(commitFn).toHaveBeenCalledWith(fact, expect.anything());
  });

  it("does NOT call commitByo for litellm usage facts (defers to callback)", async () => {
    const commitFn = vi.fn().mockResolvedValue(undefined);
    const fact = buildInprocUsageFact({ source: "litellm" });
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new UsageCommitDecorator(
      inner,
      makeNoopLogger(),
      commitFn
    );

    await collectStream(decorator.runGraph(fakeRequest).stream);

    // CALLBACK_WRITES_PLATFORM_RECEIPTS: litellm receipts deferred to callback
    expect(commitFn).not.toHaveBeenCalled();
  });

  it("BYO fact with costUsd: 0 passes strict validation", async () => {
    const commitFn = vi.fn().mockResolvedValue(undefined);
    const fact = buildByoUsageFact({ costUsd: 0 });
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" } satisfies DoneEvent,
    ];

    const inner = createFakeInnerExecutor(innerEvents);
    const decorator = new UsageCommitDecorator(
      inner,
      makeNoopLogger(),
      commitFn
    );

    // Should not throw — costUsd: 0 is valid
    const collected = await collectStream(
      decorator.runGraph(fakeRequest).stream
    );
    expect(collected.map((e) => e.type)).toEqual(["done"]);
    expect(commitFn).toHaveBeenCalledOnce();
  });
});
