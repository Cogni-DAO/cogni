// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/graph-execution-host/tests/namespace-graph-router.spec`
 * Purpose: Unit tests for NamespaceGraphRouter namespace-based dispatch.
 * Scope: Tests routing to correct providers and error handling for missing namespaces. Does not test actual graph execution.
 * Invariants: Tests use in-memory mock providers only.
 * Side-effects: none
 * Links: src/routing/namespace-graph-router.ts
 * @internal
 */

import type { AiEvent } from "@cogni/ai-core";
import type {
  GraphExecutorPort,
  GraphRunRequest,
} from "@cogni/graph-execution-core";
import { describe, expect, it, vi } from "vitest";

import { NamespaceGraphRouter } from "../src/routing/namespace-graph-router";
import { createMockLogger } from "./_helpers/mock-logger";

function makeRequest(overrides?: Partial<GraphRunRequest>): GraphRunRequest {
  return {
    runId: "run-1",
    graphId: "langgraph:poet",
    messages: [],
    modelRef: { providerKey: "platform", modelId: "gpt-4o" },
    ...overrides,
  };
}

function makeProvider(events: AiEvent[]): GraphExecutorPort {
  return {
    runGraph: vi.fn(() => ({
      stream: (async function* () {
        for (const e of events) yield e;
      })(),
      final: Promise.resolve({ ok: true, runId: "run-1", requestId: "run-1" }),
    })),
  };
}

describe("NamespaceGraphRouter", () => {
  it("routes to correct provider by namespace", async () => {
    const langGraphProvider = makeProvider([
      { type: "text_delta", delta: "poem" },
      { type: "done" },
    ]);

    const router = new NamespaceGraphRouter(
      new Map([["langgraph", langGraphProvider]]),
      createMockLogger()
    );

    const result = router.runGraph(makeRequest());
    const events: AiEvent[] = [];
    for await (const e of result.stream) events.push(e);

    expect(langGraphProvider.runGraph).toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["text_delta", "done"]);
  });

  it("returns error for missing namespace separator", async () => {
    const router = new NamespaceGraphRouter(new Map(), createMockLogger());

    const result = router.runGraph(makeRequest({ graphId: "no-colon" }));
    const final = await result.final;

    expect(final.ok).toBe(false);
    if (!final.ok) expect(final.error).toBe("internal");
  });

  it("returns error for unknown namespace", async () => {
    const router = new NamespaceGraphRouter(new Map(), createMockLogger());

    const result = router.runGraph(makeRequest({ graphId: "unknown:graph" }));
    const final = await result.final;

    expect(final.ok).toBe(false);
    if (!final.ok) expect(final.error).toBe("internal");
  });
});
