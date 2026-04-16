#!/usr/bin/env tsx
/**
 * Prototype: test connection to any OpenAI-compatible endpoint.
 * Validates the three operations an OpenAiCompatibleLlmAdapter needs:
 *   1. GET /v1/models — discover available models
 *   2. POST /v1/chat/completions — non-streaming completion
 *   3. POST /v1/chat/completions (stream: true) — streaming completion
 *
 * Usage:
 *   npx tsx scripts/dev/test-openai-compatible-endpoint.mts [baseUrl] [apiKey]
 *   npx tsx scripts/dev/test-openai-compatible-endpoint.mts http://localhost:11434
 *   npx tsx scripts/dev/test-openai-compatible-endpoint.mts https://my-vllm.example.com sk-my-key
 */

const baseUrl = process.argv[2] ?? "http://localhost:11434";
const apiKey = process.argv[3] ?? "not-needed"; // Ollama accepts any key

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey}`,
};

console.log(`\n🔌 Testing OpenAI-compatible endpoint: ${baseUrl}\n`);

// ── Step 1: Discover models ────────────────────────────────────────────────

async function discoverModels(): Promise<string[]> {
  console.log("1️⃣  GET /v1/models ...");
  const res = await fetch(`${baseUrl}/v1/models`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    console.error(`   ❌ ${res.status} ${res.statusText}`);
    // Fallback: try Ollama-native /api/tags
    console.log("   Trying Ollama-native /api/tags ...");
    const fallback = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!fallback.ok) throw new Error(`Both /v1/models and /api/tags failed`);
    const data = (await fallback.json()) as {
      models?: Array<{ name: string }>;
    };
    const models = data.models?.map((m) => m.name) ?? [];
    console.log(
      `   ✅ Found ${models.length} models (via /api/tags): ${models.join(", ")}`
    );
    return models;
  }

  const data = (await res.json()) as { data?: Array<{ id: string }> };
  const models = data.data?.map((m) => m.id) ?? [];
  console.log(`   ✅ Found ${models.length} models: ${models.join(", ")}`);
  return models;
}

// ── Step 2: Non-streaming completion ───────────────────────────────────────

async function testCompletion(model: string): Promise<void> {
  console.log(
    `\n2️⃣  POST /v1/chat/completions (non-streaming, model: ${model}) ...`
  );
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Say hello in exactly 5 words." }],
      max_tokens: 50,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`   ❌ ${res.status}: ${body.slice(0, 200)}`);
    return;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content ?? "(empty)";
  const usage = data.usage;
  console.log(`   ✅ Response: "${content}"`);
  console.log(
    `   📊 Usage: ${usage?.prompt_tokens ?? "?"} prompt + ${usage?.completion_tokens ?? "?"} completion tokens`
  );
}

// ── Step 3: Streaming completion ───────────────────────────────────────────

async function testStreaming(model: string): Promise<void> {
  console.log(
    `\n3️⃣  POST /v1/chat/completions (streaming, model: ${model}) ...`
  );
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model,
      messages: [
        { role: "user", content: "Count from 1 to 5, one number per line." },
      ],
      max_tokens: 50,
      stream: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`   ❌ ${res.status}: ${body.slice(0, 200)}`);
    return;
  }

  if (!res.body) {
    console.error("   ❌ No response body (streaming not supported?)");
    return;
  }

  let chunks = 0;
  let text = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;

      try {
        const event = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          chunks++;
        }
      } catch {
        // Malformed SSE chunk — skip
      }
    }
  }

  console.log(`   ✅ Received ${chunks} chunks`);
  console.log(`   📝 Full text: "${text.trim()}"`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  try {
    const models = await discoverModels();
    if (models.length === 0) {
      console.log(
        "\n⚠️  No models found. Pull a model first: ollama pull llama3.2:1b"
      );
      process.exit(1);
    }

    const model = models[0];
    if (!model) {
      console.log("\n⚠️  No models found after discovery.");
      process.exit(1);
    }
    await testCompletion(model);
    await testStreaming(model);

    console.log("\n✅ All checks passed. This endpoint is compatible.\n");
  } catch (err) {
    console.error(
      `\n❌ Connection failed: ${err instanceof Error ? err.message : err}`
    );
    process.exit(1);
  }
}

main();
