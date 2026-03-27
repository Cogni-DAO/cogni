#!/usr/bin/env tsx
/**
 * Probe: Capture the raw 402 challenge from the x402 provider.
 * No wallet needed — just see what the server sends back.
 */
import "./env.js";
import { X402_BASE_URL, X402_PROVIDER } from "./x402-client.js";

async function main() {
  console.log(`=== 402 Challenge Probe (${X402_PROVIDER}) ===\n`);
  console.log(`URL: ${X402_BASE_URL}/chat/completions\n`);

  const response = await fetch(`${X402_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Request-ID": crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 10,
    }),
  });

  console.log(`Status: ${response.status} ${response.statusText}`);
  console.log(`\nAll headers:`);
  for (const [key, value] of response.headers.entries()) {
    // Decode base64 headers for readability
    if (key.toLowerCase().includes("payment")) {
      try {
        const decoded = JSON.parse(atob(value));
        console.log(`  ${key}:`);
        console.log(JSON.stringify(decoded, null, 4));
      } catch {
        // Might not be base64
        console.log(`  ${key}: ${value.substring(0, 500)}`);
      }
    } else {
      console.log(`  ${key}: ${value.substring(0, 200)}`);
    }
  }

  const body = await response.text();
  console.log(`\nBody:`);
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body.substring(0, 1000));
  }
}

main().catch(console.error);
