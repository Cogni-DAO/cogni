#!/usr/bin/env tsx
import "./env.js";
import { createX402Fetch, aimoCompletion } from "./x402-client.js";

async function main() {
  const { fetchWithPay } = createX402Fetch();
  const result = await aimoCompletion(fetchWithPay, {
    model: "meta-llama/Llama-3.3-70B-Instruct",
    messages: [
      { role: "user", content: "Write a haiku about paying for AI with cryptocurrency. Just the haiku, nothing else." },
    ],
    max_tokens: 50,
    temperature: 0.9,
  });
  console.log("\n" + result.choices?.[0]?.message?.content);
}

main().catch(console.error);
