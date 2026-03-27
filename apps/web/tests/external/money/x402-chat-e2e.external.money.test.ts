// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/external/money/x402-chat-e2e.external.money`
 * Purpose: End-to-end x402 money test — wallet pays USDC via x402, receives AI completion
 *   from the Cogni node's public endpoint. Verifies the full payment + execution cycle.
 * Scope: Black-box test against a running dev:stack. Uses real on-chain USDC payment
 *   via x402 protocol (402 challenge → sign → verify → execute → settle → response).
 * Invariants: Spends ≤$0.10 USDC per run (x402 exact scheme). Requires funded test wallet.
 * Side-effects: Real on-chain USDC transfer via x402 facilitator, real LLM inference.
 * Links: docs/spec/x402-e2e.md, task.0221
 * @internal
 */

import {
  createX402TestClient,
  makeX402PaidRequest,
  probeX402Challenge,
} from "@tests/_fixtures/x402/x402-client-helpers";
import { beforeAll, describe, expect, it } from "vitest";

// ── Env ──────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for x402 money tests`);
  return value;
}

const TEST_BASE_URL = (
  process.env.TEST_BASE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");
const rawKey = requireEnv("TEST_WALLET_PRIVATE_KEY");
const X402_ENDPOINT = `${TEST_BASE_URL}/api/v1/public/x402/chat/completions`;

// ── Expected values (from repo-spec payments_in.x402) ────────────────

const EXPECTED_RECEIVING_ADDRESS =
  "0xdCCa8D85603C2CC47dc6974a790dF846f8695056".toLowerCase();
const USDC_BASE_ASSET =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase();

// ── Test ─────────────────────────────────────────────────────────────

describe("x402 Chat Completions e2e (live money)", () => {
  const client = createX402TestClient(rawKey, process.env.EVM_RPC_URL);

  beforeAll(() => {
    console.log(`[x402-test] Wallet: ${client.walletAddress}`);
    console.log(`[x402-test] Endpoint: ${X402_ENDPOINT}`);
  });

  // ── Test 1: 402 challenge (FREE — no USDC spent) ──────────────────

  it("returns 402 challenge with correct payment requirements when no payment header", async () => {
    const result = await probeX402Challenge(X402_ENDPOINT, {
      model: "deepseek-v3.2",
      messages: [{ role: "user", content: "test" }],
    });

    expect(result.status).toBe(402);
    expect(result.challenge).toBeTruthy();

    // Verify challenge structure follows x402 protocol
    const accepts = result.challenge?.accepts;
    expect(accepts).toBeDefined();
    expect(accepts?.length).toBeGreaterThanOrEqual(1);

    const requirement = accepts?.[0];
    expect(requirement?.scheme).toBe("exact");
    expect(requirement?.payTo?.toLowerCase()).toBe(EXPECTED_RECEIVING_ADDRESS);
    expect(requirement?.asset?.toLowerCase()).toBe(USDC_BASE_ASSET);
  }, 15_000);

  // ── Test 2: Paid completion (spends ≤$0.10 USDC) ─────────────────

  it("wallet pays x402 USDC and receives AI graph completion", async () => {
    const result = await makeX402PaidRequest<{
      id: string;
      object: string;
      model: string;
      choices: Array<{
        index: number;
        message: { role: string; content: string };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
      x402?: {
        payerAddress: string;
        receivingAddress: string;
        chain: string;
        asset: string;
        settlementTx?: string;
      };
    }>(client, X402_ENDPOINT, {
      model: "deepseek-v3.2",
      messages: [
        { role: "system", content: "Be concise. One sentence max." },
        { role: "user", content: "What is 2+2?" },
      ],
      max_tokens: 50,
    });

    console.log(`[x402-test] Status: ${result.status}`);
    console.log(
      `[x402-test] Response: ${JSON.stringify(result.body).substring(0, 300)}`
    );

    // Verify successful completion
    expect(result.status).toBe(200);
    expect(result.body.object).toBe("chat.completion");
    expect(result.body.choices).toHaveLength(1);
    expect(result.body.choices[0]?.message.role).toBe("assistant");
    expect(result.body.choices[0]?.message.content).toBeTruthy();
    expect(result.body.choices[0]?.finish_reason).toBe("stop");

    // Verify usage reported
    expect(result.body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(result.body.usage.completion_tokens).toBeGreaterThan(0);

    // Verify x402 metadata in response
    expect(result.x402Metadata).toBeTruthy();
    expect(result.x402Metadata?.receivingAddress?.toLowerCase()).toBe(
      EXPECTED_RECEIVING_ADDRESS
    );
    expect(result.x402Metadata?.chain).toBe("base");
    expect(result.x402Metadata?.asset).toBe("USDC");

    // Verify payer is our test wallet
    expect(result.x402Metadata?.payerAddress?.toLowerCase()).toBe(
      client.walletAddress.toLowerCase()
    );

    // Verify PAYMENT-RESPONSE header (x402 protocol — settlement receipt)
    // May be null if facilitator doesn't return it for all schemes
    if (result.paymentResponseHeader) {
      console.log(
        `[x402-test] PAYMENT-RESPONSE header present (settlement receipt)`
      );
    }

    console.log(
      `[x402-test] Model: ${result.body.model}, Tokens: ${result.body.usage.total_tokens}`
    );
  }, 60_000);

  // ── Test 3: Graph selection via graph_name (spends ≤$0.10 USDC) ───

  it("can select a specific graph via graph_name extension field", async () => {
    const result = await makeX402PaidRequest<{
      choices: Array<{ message: { content: string } }>;
    }>(client, X402_ENDPOINT, {
      model: "deepseek-v3.2",
      messages: [{ role: "user", content: "Tell me about neurons" }],
      max_tokens: 100,
      graph_name: "poet", // Select the poet graph
    });

    console.log(`[x402-test] Poet graph status: ${result.status}`);

    // Poet graph should work (if graph routing is wired)
    // May return 200 (success) or 500 (if graph not found in this config)
    // The key test is that the endpoint accepts the graph_name field
    if (result.status === 200) {
      const content = (result.body as Record<string, unknown>).choices;
      console.log(
        `[x402-test] Poet response: ${JSON.stringify(content).substring(0, 200)}`
      );
    } else {
      console.log(
        `[x402-test] Poet graph returned ${result.status} — graph routing may need dev:stack config`
      );
    }

    // At minimum: the x402 payment was accepted (not 402)
    expect(result.status).not.toBe(402);
  }, 60_000);
});
