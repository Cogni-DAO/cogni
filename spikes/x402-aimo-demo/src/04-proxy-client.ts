#!/usr/bin/env tsx
/**
 * Demo 4: Client calling the Cogni Node proxy
 *
 * This script acts as a user/agent paying the Cogni node via x402.
 * It demonstrates:
 *   1. First request → gets 402 from the node
 *   2. Signs payment with wallet
 *   3. Retries with payment → gets completion (which node fetched from AiMo via x402)
 *
 * For a full demo, run the proxy server first: npm run demo:proxy
 *
 * Usage: npm run demo:proxy-client
 */
import "./env.js";
import { createX402Fetch } from "./x402-client.js";

const PROXY_URL = "http://localhost:4020";

async function main() {
  console.log("=== Cogni Node Proxy Client Demo ===\n");

  // Step 1: Hit the proxy without payment to see the 402 challenge
  console.log("--- Step 1: Probe 402 challenge from Cogni node ---");
  const probeResponse = await fetch(`${PROXY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: "test" }],
    }),
  });

  console.log(`  Status: ${probeResponse.status}`);
  if (probeResponse.status === 402) {
    const paymentHeader = probeResponse.headers.get("x-payment-required");
    if (paymentHeader) {
      const decoded = JSON.parse(atob(paymentHeader));
      console.log(`  Payment required:`, JSON.stringify(decoded, null, 2));
    }
    const body = await probeResponse.json();
    console.log(`  Body:`, JSON.stringify(body.details?.paymentRequirements?.[0], null, 2));
  }

  // Step 2: Send request WITH payment header (simulated for demo)
  // In a full integration, @x402/fetch would handle this automatically
  // by recognizing the 402 and signing. Here we send a dummy header
  // to demonstrate the proxy's forwarding behavior.
  console.log("\n--- Step 2: Request with payment → proxy forwards to AiMo ---");

  const paidResponse = await fetch(`${PROXY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // In production: this would be a real signed x402 payment
      // For demo: presence of header triggers proxy to forward to AiMo
      "X-Payment": "demo-payment-token",
    },
    body: JSON.stringify({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [
        { role: "system", content: "You are a helpful assistant. Be very concise." },
        { role: "user", content: "Explain x402 payments for AI in 2 sentences." },
      ],
      max_tokens: 100,
    }),
  });

  if (paidResponse.ok) {
    const result = await paidResponse.json();
    console.log("\n  [Completion]");
    console.log(`    Model: ${result.model}`);
    console.log(`    Response: ${result.choices?.[0]?.message?.content}`);
    console.log(`    Usage: ${JSON.stringify(result.usage)}`);
    console.log(`\n  [Proxy metadata]`);
    console.log(`    Node: ${result._proxy?.node}`);
    console.log(`    Provider: ${result._proxy?.provider}`);
    console.log(`    Latency: ${result._proxy?.totalLatencyMs}ms`);
    console.log(`    Margin: ${result._proxy?.margin}x`);
    console.log(`    Payment: ${result._proxy?.paymentMethod}`);
  } else {
    console.error(`  Error: ${paidResponse.status}`, await paidResponse.text());
  }

  console.log("\n=== Demo complete ===");
}

main().catch(console.error);
