// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/langgraph-graphs/runtime/with-structured-output`
 * Purpose: Unit tests for CogniCompletionAdapter.withStructuredOutput().
 * Scope: Tests JSON extraction, code fence stripping, Zod validation, error handling. Does NOT make real LLM calls.
 * Invariants: withStructuredOutput returns a Runnable that parses JSON from the LLM response.
 * Side-effects: none (all mocked via ALS)
 * Links: completion-adapter.ts
 * @internal
 */

import type { AiEvent } from "@cogni/ai-core";
import { HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CogniCompletionAdapter } from "../../src/runtime/cogni/completion-adapter";
import { runWithCogniExecContext } from "../../src/runtime/cogni/exec-context";

const TestSchema = z.object({
  score: z.number().min(0).max(1),
  label: z.string(),
});

/**
 * Create a fake ALS context with a completionFn that returns the given content.
 */
function withFakeCompletion(
  content: string,
  fn: () => Promise<void>
): Promise<void> {
  return runWithCogniExecContext(
    {
      completionFn: () => ({
        stream: (async function* (): AsyncIterable<AiEvent> {
          yield { type: "text_delta", delta: content };
        })(),
        final: Promise.resolve({
          ok: true as const,
          content,
          usage: { promptTokens: 10, completionTokens: 5 },
          finishReason: "stop",
        }),
      }),
      tokenSink: { push: () => {} },
      toolExecFn: async () => ({ ok: true, value: {} }),
    },
    fn
  );
}

describe("CogniCompletionAdapter.withStructuredOutput", () => {
  const adapter = new CogniCompletionAdapter();
  const config = { configurable: { model: "test-model" } };
  const messages = [new HumanMessage("test")];

  it("parses clean JSON response", async () => {
    const runnable = adapter.withStructuredOutput(TestSchema);
    await withFakeCompletion('{"score": 0.85, "label": "good"}', async () => {
      const result = await runnable.invoke(messages, config);
      expect(result).toEqual({ score: 0.85, label: "good" });
    });
  });

  it("strips markdown code fences", async () => {
    const runnable = adapter.withStructuredOutput(TestSchema);
    const fenced = '```json\n{"score": 0.5, "label": "ok"}\n```';
    await withFakeCompletion(fenced, async () => {
      const result = await runnable.invoke(messages, config);
      expect(result).toEqual({ score: 0.5, label: "ok" });
    });
  });

  it("strips fences with leading/trailing whitespace", async () => {
    const runnable = adapter.withStructuredOutput(TestSchema);
    const fenced = '  \n```json\n{"score": 0.7, "label": "trimmed"}\n```\n  ';
    await withFakeCompletion(fenced, async () => {
      const result = await runnable.invoke(messages, config);
      expect(result).toEqual({ score: 0.7, label: "trimmed" });
    });
  });

  it("throws on invalid JSON", async () => {
    const runnable = adapter.withStructuredOutput(TestSchema);
    await withFakeCompletion("not valid json {", async () => {
      await expect(runnable.invoke(messages, config)).rejects.toThrow(
        "LLM returned invalid JSON"
      );
    });
  });

  it("validates with Zod and rejects invalid values", async () => {
    const runnable = adapter.withStructuredOutput(TestSchema);
    // score > 1 should fail Zod validation
    await withFakeCompletion('{"score": 1.5, "label": "bad"}', async () => {
      await expect(runnable.invoke(messages, config)).rejects.toThrow();
    });
  });

  it("works with plain JSON Schema (no Zod .parse)", async () => {
    const jsonSchema = {
      type: "object",
      properties: { x: { type: "number" } },
    };
    const runnable = adapter.withStructuredOutput(jsonSchema);
    await withFakeCompletion('{"x": 42}', async () => {
      const result = await runnable.invoke(messages, config);
      expect(result).toEqual({ x: 42 });
    });
  });
});
