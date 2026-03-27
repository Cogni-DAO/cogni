// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/_fixtures/x402/x402-client-helpers`
 * Purpose: Reusable x402 client helpers for external money tests.
 * Scope: Creates x402 payment-wrapped fetch, probes 402 challenges, and makes paid requests.
 *   Designed for reuse across multiple x402 test scenarios (chat completions, future endpoints).
 * Invariants: Uses real USDC on Base mainnet. Requires funded test wallet.
 * Side-effects: Real on-chain USDC transfers via x402 facilitator.
 * Links: @x402/fetch, @x402/evm, docs/spec/x402-e2e.md
 * @internal
 */

import {
  createPublicClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { ExactEvmSchemeV1 } from "@x402/evm/v1";
import { toClientEvmSigner } from "@x402/evm";

// ── Types ───────────────────────────────────────────────────────────────

export interface X402TestClient {
  /** Payment-wrapped fetch — automatically handles 402→sign→retry */
  readonly fetchWithPay: typeof globalThis.fetch;
  /** The wallet address used for payments */
  readonly walletAddress: string;
}

export interface X402ChallengeInfo {
  /** HTTP status (should be 402) */
  readonly status: number;
  /** Parsed 402 challenge body */
  readonly challenge: {
    x402Version: number;
    accepts: Array<{
      scheme: string;
      network: string;
      maxAmountRequired: string;
      payTo: string;
      asset: string;
    }>;
  } | null;
  /** Raw response headers */
  readonly headers: Record<string, string>;
}

export interface X402PaidResponse<T = unknown> {
  /** HTTP status */
  readonly status: number;
  /** Parsed response body */
  readonly body: T;
  /** x402 settlement metadata (if present in response) */
  readonly x402Metadata: {
    payerAddress?: string;
    receivingAddress?: string;
    chain?: string;
    asset?: string;
    settlementTx?: string;
  } | null;
  /** PAYMENT-RESPONSE header (base64 settlement receipt) */
  readonly paymentResponseHeader: string | null;
}

// ── Client Factory ──────────────────────────────────────────────────────

/**
 * Create an x402 test client from a private key.
 * Registers both v1 (Hyperbolic-style) and v2 (CAIP-2) EVM schemes.
 *
 * @param privateKey - Funded wallet private key (hex with or without 0x prefix)
 * @param rpcUrl - Optional Base RPC URL (defaults to public RPC)
 */
export function createX402TestClient(
  privateKey: string,
  rpcUrl?: string
): X402TestClient {
  const key = (
    privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`
  ) as `0x${string}`;
  const account = privateKeyToAccount(key);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  const signer = toClientEvmSigner(account, publicClient);

  // Register both v1 (plain network names) and v2 (CAIP-2) for broad compatibility
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(signer));
  client.registerV1("base", new ExactEvmSchemeV1(signer));
  client.registerV1("base-sepolia", new ExactEvmSchemeV1(signer));

  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  return {
    fetchWithPay,
    walletAddress: account.address,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Probe an x402-gated endpoint WITHOUT payment to capture the 402 challenge.
 * Does NOT spend any USDC — just reads the challenge response.
 */
export async function probeX402Challenge(
  url: string,
  body: Record<string, unknown>
): Promise<X402ChallengeInfo> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });

  const headers: Record<string, string> = {};
  for (const [key, value] of response.headers.entries()) {
    headers[key] = value;
  }

  let challenge = null;
  try {
    challenge = await response.json();
  } catch {
    // Non-JSON response
  }

  return { status: response.status, challenge, headers };
}

/**
 * Make a paid x402 request using the test client.
 * The fetchWithPay wrapper handles the 402→sign→retry cycle automatically.
 */
export async function makeX402PaidRequest<T = unknown>(
  client: X402TestClient,
  url: string,
  body: Record<string, unknown>
): Promise<X402PaidResponse<T>> {
  const response = await client.fetchWithPay(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });

  const parsed = (await response.json()) as T & {
    x402?: {
      payerAddress?: string;
      receivingAddress?: string;
      chain?: string;
      asset?: string;
      settlementTx?: string;
    };
  };

  const x402Metadata = (parsed as Record<string, unknown>).x402
    ? ((parsed as Record<string, unknown>).x402 as X402PaidResponse["x402Metadata"])
    : null;

  return {
    status: response.status,
    body: parsed,
    x402Metadata,
    paymentResponseHeader: response.headers.get("payment-response"),
  };
}
