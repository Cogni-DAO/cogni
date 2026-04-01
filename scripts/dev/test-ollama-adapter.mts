#!/usr/bin/env tsx
/**
 * Integration test: run OpenAiCompatibleLlmAdapter against local Ollama.
 * Validates the actual LlmService interface contract.
 *
 * Usage: npx tsx scripts/dev/test-ollama-adapter.mts
 * Requires: Ollama running on localhost:11434 with a model pulled
 */

// Use dynamic import to resolve path aliases via tsconfig
const { OpenAiCompatibleLlmAdapter } = await import(
  "../../apps/operator/src/adapters/server/ai/openai-compatible/openai-compatible-llm.adapter.js"
);

const endpoint = { baseUrl: "http://localhost:11434" };

// Discover model first
const modelsRes = await fetch("http://localhost:11434/v1/models");
const modelsData = (await modelsRes.json()) as { data?: Array<{ id: string }> };
const modelId = modelsData.data?.[0]?.id;
if (!modelId) {
  console.error("No models found. Run: ollama pull tinyllama");
  process.exit(1);
}
console.log(`Using model: ${modelId}\n`);

const adapter = new OpenAiCompatibleLlmAdapter(endpoint);

// Test 1: Non-streaming completion
console.log("1. Testing completion()...");
const result = await adapter.completion({
  messages: [{ role: "user", content: "Say hello in 3 words." }],
  model: modelId,
  caller: {
    billingAccountId: "test",
    virtualKeyId: "test",
    requestId: "test-req-1",
    traceId: "test-trace-1",
  },
});
console.log(`   Response: "${result.message.content}"`);
console.log(
  `   Usage: ${result.usage.promptTokens}p + ${result.usage.completionTokens}c`
);
console.log(
  `   Provider: ${result.resolvedProvider}, Model: ${result.resolvedModel}`
);

// Test 2: Streaming completion
console.log("\n2. Testing completionStream()...");
const { stream, final } = await adapter.completionStream({
  messages: [{ role: "user", content: "Count 1 to 3." }],
  model: modelId,
  caller: {
    billingAccountId: "test",
    virtualKeyId: "test",
    requestId: "test-req-2",
    traceId: "test-trace-2",
  },
});

let chunks = 0;
let text = "";
for await (const event of stream) {
  if (event.type === "text_delta") {
    text += event.delta;
    chunks++;
  }
}
const finalResult = await final;
console.log(`   Chunks: ${chunks}`);
console.log(`   Text: "${text.trim()}"`);
console.log(
  `   Final usage: ${finalResult.usage.promptTokens}p + ${finalResult.usage.completionTokens}c`
);
console.log(`   Finish: ${finalResult.finishReason}`);

console.log("\n✅ LlmService adapter works against Ollama.\n");
