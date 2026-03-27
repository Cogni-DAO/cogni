#!/usr/bin/env tsx
/**
 * Demo 1: Direct x402 completion
 *
 * Proves the end-to-end flow:
 *   1. Client sends chat completion request to x402 provider endpoint
 *   2. Provider returns 402 Payment Required with payment challenge
 *   3. @x402/fetch auto-signs USDC payment on Base
 *   4. Request retries with payment header → gets AI completion
 *
 * Usage: npm run demo:direct
 * Requires: OPERATOR_PRIVATE_KEY in .env.local (wallet with USDC on Base)
 */
import "./env.js";
import { createX402Fetch, aimoCompletion, X402_BASE_URL, X402_PROVIDER } from "./x402-client.js";

async function main() {
  console.log(`=== x402 Direct Completion Demo (${X402_PROVIDER}) ===\n`);

  const { fetchWithPay, walletAddress } = createX402Fetch();

  // Use model IDs appropriate for the provider
  const model = X402_PROVIDER === "hyperbolic"
    ? "meta-llama/Llama-3.3-70B-Instruct"
    : "deepseek/deepseek-chat";

  // Step 1: Simple completion — prove the 402 flow works
  console.log("\n--- Test 1: Simple chat completion ---");
  try {
    const result = await aimoCompletion(fetchWithPay, {
      model,
      messages: [
        { role: "system", content: "You are a helpful assistant. Be concise." },
        { role: "user", content: "What is x402 in one sentence?" },
      ],
      max_tokens: 100,
      temperature: 0.7,
    });

    console.log("\n[Result]");
    console.log("  Model:", result.model);
    console.log("  Choice:", result.choices?.[0]?.message?.content);
    console.log("  Usage:", JSON.stringify(result.usage));
    console.log("  Cost info:", result.usage?.cost ?? "not reported in usage");
  } catch (err) {
    console.error("[ERROR] Test 1 failed:", err);
  }

  // Step 2: Multi-turn conversation
  console.log("\n\n--- Test 2: Multi-turn conversation ---");
  try {
    const result = await aimoCompletion(fetchWithPay, {
      model,
      messages: [
        { role: "system", content: "You are a crypto payments expert." },
        { role: "user", content: "How does x402 compare to L402?" },
        { role: "assistant", content: "x402 uses HTTP 402 + ERC-20 tokens on EVM chains, while L402 uses Lightning Network invoices." },
        { role: "user", content: "Which is better for AI inference micropayments?" },
      ],
      max_tokens: 150,
    });

    console.log("\n[Result]");
    console.log("  Choice:", result.choices?.[0]?.message?.content);
    console.log("  Usage:", JSON.stringify(result.usage));
  } catch (err) {
    console.error("[ERROR] Test 2 failed:", err);
  }

  // Step 3: Probe the 402 response manually (for research doc)
  console.log("\n\n--- Test 3: Raw 402 challenge capture ---");
  try {
    const rawResponse = await fetch(`${X402_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Request-ID": crypto.randomUUID(),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      }),
    });

    console.log(`  Status: ${rawResponse.status}`);
    console.log(`  Headers:`);
    for (const [key, value] of rawResponse.headers.entries()) {
      if (key.toLowerCase().includes("payment") || key.toLowerCase() === "x-payment") {
        // Try to decode base64 for readability
        try {
          const decoded = JSON.parse(atob(value));
          console.log(`    ${key}: ${JSON.stringify(decoded, null, 4)}`);
        } catch {
          console.log(`    ${key}: ${value.substring(0, 300)}...`);
        }
      }
    }

    const body = await rawResponse.text();
    console.log(`  Body: ${body.substring(0, 500)}`);
  } catch (err) {
    console.error("[ERROR] Test 3 failed:", err);
  }

  console.log("\n=== Demo complete ===");
}

main().catch(console.error);
