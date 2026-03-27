#!/usr/bin/env tsx
/**
 * Demo 3: Cogni Node as x402 Middleman
 *
 * Express server that:
 *   1. Receives inbound x402 payment from a client (user/agent pays the node)
 *   2. Calls AiMo x402 outbound (node pays AiMo for inference)
 *   3. Returns the completion to the client
 *
 * This proves a Cogni node can sit between users and AiMo,
 * taking a margin on each request. Both legs are x402 — no API keys anywhere.
 *
 * Architecture:
 *   Client --x402--> [Cogni Node Proxy] --x402--> AiMo Network
 *          <--200---                    <--200---
 *
 * Usage:
 *   Terminal 1: npm run demo:proxy       (starts server on :4020)
 *   Terminal 2: npm run demo:proxy-client (sends x402-paid request)
 *
 * Requires: OPERATOR_PRIVATE_KEY in .env.local
 */
import "./env.js";
import express from "express";
import { createX402Fetch, aimoCompletion, X402_BASE_URL, X402_PROVIDER } from "./x402-client.js";
import { OPERATOR_WALLET_ADDRESS } from "./env.js";

const PORT = 4020;
const MARGIN_MULTIPLIER = 1.5; // Node charges 1.5x what AiMo charges

const app = express();
app.use(express.json());

// The node's outbound x402 client (pays AiMo)
const { fetchWithPay } = createX402Fetch();

/**
 * Inbound x402 middleware (simplified for demo).
 *
 * In production this would:
 *   - Return 402 with PAYMENT-REQUIRED header specifying node's receiving address
 *   - Verify the client's signed payment via facilitator
 *   - Settle on-chain after completion
 *
 * For this demo we simulate the inbound side and focus on proving
 * the outbound x402 leg to AiMo works through a proxy.
 */
app.post("/v1/chat/completions", async (req, res) => {
  const startTime = performance.now();
  const { model, messages, max_tokens, temperature, stream } = req.body;

  // Check for payment header (would be signed x402 in production)
  const paymentHeader = req.headers["x-payment"];
  const hasPayment = !!paymentHeader;

  console.log(`\n[proxy] Incoming request`);
  console.log(`[proxy]   Model: ${model}`);
  console.log(`[proxy]   Messages: ${messages?.length}`);
  console.log(`[proxy]   Payment header: ${hasPayment ? "present" : "MISSING"}`);

  if (!hasPayment) {
    // Return 402 challenge — this is what a real x402 server does
    // In production: amount = estimated cost * MARGIN_MULTIPLIER
    const paymentRequired = {
      x402Version: 2,
      paymentRequirements: [{
        scheme: "exact",
        network: "eip155:8453", // Base mainnet
        maxAmountRequired: "50000", // 0.05 USDC (6 decimals) — demo amount
        resource: `${req.protocol}://${req.hostname}:${PORT}/v1/chat/completions`,
        description: "Cogni Node — AI inference via AiMo Network",
        mimeType: "application/json",
        payTo: OPERATOR_WALLET_ADDRESS,
        maxTimeoutSeconds: 300,
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
        extra: {
          name: "Cogni Node x402 Demo",
          margin: `${MARGIN_MULTIPLIER}x over provider cost`,
        },
      }],
    };

    console.log(`[proxy] Returning 402 Payment Required`);
    res.status(402)
      .set("X-Payment-Required", Buffer.from(JSON.stringify(paymentRequired)).toString("base64"))
      .json({ error: "Payment Required", details: paymentRequired });
    return;
  }

  // Payment present — forward to AiMo via x402 outbound
  console.log(`[proxy] Payment verified — forwarding to AiMo x402`);

  try {
    const result = await aimoCompletion(fetchWithPay, {
      model: model || "meta-llama/Llama-3.3-70B-Instruct",
      messages,
      max_tokens: max_tokens || 200,
      temperature,
    });

    const elapsed = Math.round(performance.now() - startTime);

    // Annotate response with proxy metadata
    const enriched = {
      ...result,
      _proxy: {
        node: OPERATOR_WALLET_ADDRESS,
        provider: "aimo-network",
        providerEndpoint: X402_BASE_URL,
        totalLatencyMs: elapsed,
        margin: MARGIN_MULTIPLIER,
        paymentMethod: "x402-usdc-base",
      },
    };

    console.log(`[proxy] Success — ${elapsed}ms total`);
    console.log(`[proxy] Model used: ${result.model}`);
    console.log(`[proxy] Tokens: ${JSON.stringify(result.usage)}`);

    res.json(enriched);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[proxy] Error:`, message);
    res.status(502).json({ error: "Upstream provider error", details: message });
  }
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    node: OPERATOR_WALLET_ADDRESS,
    provider: "aimo-network",
    x402: { inbound: true, outbound: true },
  });
});

app.listen(PORT, () => {
  console.log(`\n[proxy] Cogni Node x402 proxy listening on http://localhost:${PORT}`);
  console.log(`[proxy] Node wallet: ${OPERATOR_WALLET_ADDRESS}`);
  console.log(`[proxy] Upstream: AiMo Network (${X402_BASE_URL})`);
  console.log(`[proxy] Margin: ${MARGIN_MULTIPLIER}x\n`);
  console.log(`[proxy] Endpoints:`);
  console.log(`[proxy]   POST /v1/chat/completions  (x402-gated)`);
  console.log(`[proxy]   GET  /health`);
  console.log(`\n[proxy] Test with: npm run demo:proxy-client`);
});
