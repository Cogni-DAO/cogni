// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/server/ai/openai-compatible/openai-compatible-llm.adapter.spec`
 * Purpose: Integration test for OpenAiCompatibleLlmAdapter against local Ollama.
 * Scope: Validates LlmService contract (completion + streaming) against a real OpenAI-compatible endpoint. Does not test error paths or SSRF.
 * Invariants: Requires Ollama running on localhost:11434 with a model pulled.
 * Side-effects: IO (HTTP to local Ollama)
 * Links: openai-compatible-llm.adapter.ts
 * @internal
 */

import { describe, expect, it } from "vitest";
import { OpenAiCompatibleLlmAdapter } from "@/adapters/server/ai/openai-compatible/openai-compatible-llm.adapter";

const OLLAMA_URL = "http://localhost:11434";

// Skip if Ollama not running
const ollamaAvailable = await fetch(`${OLLAMA_URL}/`)
  .then(() => true)
  .catch(() => false);

const caller = {
  billingAccountId: "test-ba",
  virtualKeyId: "test-vk",
  requestId: "test-req",
  traceId: "test-trace",
};

describe.skipIf(!ollamaAvailable)(
  "OpenAiCompatibleLlmAdapter (local Ollama)",
  () => {
    let modelId: string;

    // Discover first available model
    it("discovers models via /v1/models", async () => {
      const res = await fetch(`${OLLAMA_URL}/v1/models`);
      expect(res.ok).toBe(true);
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      expect(data.data).toBeDefined();
      expect(data.data!.length).toBeGreaterThan(0);
      modelId = data.data![0]!.id;
    });

    it("completion() returns valid LlmCompletionResult", async () => {
      const adapter = new OpenAiCompatibleLlmAdapter({ baseUrl: OLLAMA_URL });
      const result = await adapter.completion({
        messages: [{ role: "user", content: "Say hello." }],
        model: modelId,
        caller,
      });

      expect(result.message.role).toBe("assistant");
      expect(result.message.content.length).toBeGreaterThan(0);
      expect(result.usage.promptTokens).toBeGreaterThan(0);
      expect(result.resolvedProvider).toBe("openai-compatible");
      expect(result.resolvedModel).toBeTruthy();
    }, 60_000);

    it("completionStream() yields text_delta events and resolves final", async () => {
      const adapter = new OpenAiCompatibleLlmAdapter({ baseUrl: OLLAMA_URL });
      const { stream, final } = await adapter.completionStream({
        messages: [{ role: "user", content: "Count 1 2 3." }],
        model: modelId,
        caller,
      });

      let chunks = 0;
      let text = "";
      for await (const event of stream) {
        if (event.type === "text_delta") {
          text += event.delta;
          chunks++;
        }
      }

      expect(chunks).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(0);

      const finalResult = await final;
      expect(finalResult.message.role).toBe("assistant");
      expect(finalResult.message.content).toBe(text);
      // Usage may be 0 if server doesn't support stream_options.include_usage
      expect(finalResult.usage).toBeDefined();
      expect(finalResult.finishReason).toBeTruthy();
    }, 60_000);
  }
);
