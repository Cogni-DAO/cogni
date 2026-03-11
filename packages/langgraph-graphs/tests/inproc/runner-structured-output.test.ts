// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/langgraph-graphs/inproc/runner-structured-output`
 * Purpose: Integration test proving structuredOutput flows through runner + real pr-review graph.
 * Scope: Exercises createInProcGraphRunner with responseFormat and mock completionFn. Does NOT make real LLM calls.
 * Invariants: structuredOutput present when responseFormat is set, absent when not.
 * Side-effects: none (all mocked via ALS)
 * Links: runner.ts, pr-review/graph.ts
 * @internal
 */

import type { AiEvent } from "@cogni/ai-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPrReviewGraph } from "../../src/graphs/pr-review/graph";
import { createInProcGraphRunner } from "../../src/inproc/runner";
import type {
  CompletionFn,
  InProcGraphRequest,
  ToolExecFn,
} from "../../src/inproc/types";

const TestEvalSchema = z.object({
  metrics: z.array(
    z.object({
      metric: z.string(),
      value: z.number().min(0).max(1),
      observations: z.array(z.string()),
    })
  ),
  summary: z.string(),
});

const VALID_JSON_RESPONSE = JSON.stringify({
  metrics: [
    { metric: "coherent-change", value: 0.9, observations: ["looks good"] },
  ],
  summary: "Solid PR",
});

describe("runner + pr-review graph with responseFormat", () => {
  it("returns structuredOutput when responseFormat is provided", async () => {
    const completionFn: CompletionFn = () => ({
      stream: (async function* (): AsyncIterable<AiEvent> {
        yield { type: "text_delta", delta: VALID_JSON_RESPONSE };
      })(),
      final: Promise.resolve({
        ok: true as const,
        content: VALID_JSON_RESPONSE,
        usage: { promptTokens: 10, completionTokens: 5 },
        finishReason: "stop",
      }),
    });

    const request: InProcGraphRequest = {
      runId: "test-structured",
      messages: [{ role: "user", content: "Evaluate this PR" }],
      configurable: { model: "test-model" },
    };

    const { stream, final } = createInProcGraphRunner({
      createGraph: (opts) => createPrReviewGraph(opts),
      completionFn,
      createToolExecFn: (): ToolExecFn => async () => ({ ok: true, value: {} }),
      toolContracts: [],
      request,
      responseFormat: {
        prompt: "Return JSON with metrics array and summary string.",
        schema: TestEvalSchema,
      },
    });

    for await (const _event of stream) {
      // drain
    }

    const result = await final;
    expect(result.ok).toBe(true);
    expect(result.structuredOutput).toBeDefined();
    expect(result.structuredOutput).toHaveProperty("metrics");
    expect(result.structuredOutput).toHaveProperty("summary");
  });

  it("returns NO structuredOutput when responseFormat is absent", async () => {
    const completionFn: CompletionFn = () => ({
      stream: (async function* (): AsyncIterable<AiEvent> {
        yield { type: "text_delta", delta: "plain text" };
      })(),
      final: Promise.resolve({
        ok: true as const,
        content: "plain text",
        usage: { promptTokens: 10, completionTokens: 5 },
        finishReason: "stop",
      }),
    });

    const request: InProcGraphRequest = {
      runId: "test-no-format",
      messages: [{ role: "user", content: "Evaluate this PR" }],
      configurable: { model: "test-model" },
    };

    const { stream, final } = createInProcGraphRunner({
      createGraph: (opts) => createPrReviewGraph(opts),
      completionFn,
      createToolExecFn: (): ToolExecFn => async () => ({ ok: true, value: {} }),
      toolContracts: [],
      request,
    });

    for await (const _event of stream) {
      // drain
    }

    const result = await final;
    expect(result.ok).toBe(true);
    expect(result.structuredOutput).toBeUndefined();
  });
});
