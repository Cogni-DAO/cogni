// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/graph-execution-host/tests/preflight-credit-check.decorator.spec`
 * Purpose: Unit tests for PreflightCreditCheckDecorator credit validation.
 * Scope: Tests credit check pass-through, BYO skip, and insufficient-credits rejection. Does not test actual credit balance queries.
 * Invariants: Tests use in-memory mock checkers only.
 * Side-effects: none
 * Links: src/decorators/preflight-credit-check.decorator.ts
 * @internal
 */

import type { AiEvent } from "@cogni/ai-core";
import type {
  GraphExecutorPort,
  GraphRunRequest,
} from "@cogni/graph-execution-core";
import { describe, expect, it, vi } from "vitest";

import { PreflightCreditCheckDecorator } from "../src/decorators/preflight-credit-check.decorator";
import { createMockLogger } from "./_helpers/mock-logger";

function makeRequest(overrides?: Partial<GraphRunRequest>): GraphRunRequest {
  return {
    runId: "run-1",
    graphId: "langgraph:test",
    messages: [{ role: "user", content: "hello" }],
    modelRef: { providerKey: "platform", modelId: "gpt-4o" },
    ...overrides,
  };
}

function makeInnerExecutor(events: AiEvent[]): GraphExecutorPort {
  return {
    runGraph: () => ({
      stream: (async function* () {
        for (const e of events) yield e;
      })(),
      final: Promise.resolve({ ok: true, runId: "run-1", requestId: "run-1" }),
    }),
  };
}

describe("PreflightCreditCheckDecorator", () => {
  const makeChecker = (requiresCredits: boolean) => ({
    resolve: () => ({
      requiresPlatformCredits: vi.fn().mockResolvedValue(requiresCredits),
    }),
  });

  it("passes through when credits are sufficient", async () => {
    const checkFn = vi.fn().mockResolvedValue(undefined);
    const inner = makeInnerExecutor([
      { type: "text_delta", delta: "hi" },
      { type: "done" },
    ]);

    const decorator = new PreflightCreditCheckDecorator(
      inner,
      checkFn,
      "ba-1",
      makeChecker(true),
      createMockLogger()
    );

    const result = decorator.runGraph(makeRequest());
    const events: AiEvent[] = [];
    for await (const e of result.stream) events.push(e);

    expect(events.map((e) => e.type)).toEqual(["text_delta", "done"]);
    expect(checkFn).toHaveBeenCalledWith("ba-1", "gpt-4o", expect.anything());
  });

  it("skips credit check for BYO providers", async () => {
    const checkFn = vi.fn().mockResolvedValue(undefined);
    const inner = makeInnerExecutor([{ type: "done" }]);

    const decorator = new PreflightCreditCheckDecorator(
      inner,
      checkFn,
      "ba-1",
      makeChecker(false),
      createMockLogger()
    );

    const result = decorator.runGraph(
      makeRequest({ modelRef: { providerKey: "codex", modelId: "codex-mini" } })
    );
    const events: AiEvent[] = [];
    for await (const e of result.stream) events.push(e);

    expect(checkFn).not.toHaveBeenCalled();
  });

  it("rejects run when credits insufficient", async () => {
    const checkFn = vi
      .fn()
      .mockRejectedValue(new Error("Insufficient credits"));
    const inner = makeInnerExecutor([{ type: "done" }]);

    const decorator = new PreflightCreditCheckDecorator(
      inner,
      checkFn,
      "ba-1",
      makeChecker(true),
      createMockLogger()
    );

    const result = decorator.runGraph(makeRequest());

    await expect(async () => {
      for await (const _ of result.stream) {
        /* drain */
      }
    }).rejects.toThrow("Insufficient credits");

    // Also catch the final promise to avoid unhandled rejection
    await expect(result.final).rejects.toThrow("Insufficient credits");
  });
});
