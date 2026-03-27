/**
 * Reusable x402 client for AiMo Network.
 *
 * Creates a viem wallet from the operator private key,
 * registers the ExactEvmScheme for Base mainnet,
 * and returns a payment-wrapped fetch function.
 */
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { ExactEvmSchemeV1 } from "@x402/evm/v1";
import { OPERATOR_PRIVATE_KEY } from "./env.js";

// Provider x402 endpoints (no API key needed — payment is the auth)
export const PROVIDERS = {
  // Hyperbolic x402 — open-source models, confirmed working
  hyperbolic: "https://hyperbolic-x402.vercel.app/v1",
  // AiMo Network — currently unreachable (devnet down as of 2026-03-27)
  aimo: "https://devnet.aimo.network/api/alpha",
} as const;

// Default to Hyperbolic (working); override via X402_PROVIDER env var
export const X402_PROVIDER = (process.env.X402_PROVIDER || "hyperbolic") as keyof typeof PROVIDERS;
export const X402_BASE_URL = PROVIDERS[X402_PROVIDER];

export function createX402Fetch() {
  const account = privateKeyToAccount(OPERATOR_PRIVATE_KEY);

  // Public client for on-chain reads (Permit2 allowance checks, nonce, gas)
  const publicClient = createPublicClient({
    chain: base,
    transport: http(),
  });

  // Compose a ClientEvmSigner from account + publicClient
  const signer = toClientEvmSigner(account, publicClient);

  // Register EVM scheme for both x402 protocol versions:
  // v2: CAIP-2 network IDs (eip155:8453) — used by AiMo, newer providers
  // v1: plain network names ("base") — used by Hyperbolic
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(signer));
  client.registerV1("base", new ExactEvmSchemeV1(signer));
  client.registerV1("base-sepolia", new ExactEvmSchemeV1(signer));

  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  console.log(`[x402] Wallet: ${account.address}`);
  console.log(`[x402] Chain: Base (8453)`);
  console.log(`[x402] Provider: AiMo Network (${X402_BASE_URL})`);

  return { fetchWithPay, walletAddress: account.address };
}

/**
 * Make an OpenAI-compatible chat completion via AiMo x402.
 * The fetch wrapper handles the 402→sign→retry cycle automatically.
 */
export async function aimoCompletion(
  fetchWithPay: typeof fetch,
  params: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
  },
) {
  const url = `${X402_BASE_URL}/chat/completions`;

  console.log(`\n[x402] POST ${url}`);
  console.log(`[x402] Model: ${params.model}`);
  console.log(`[x402] Messages: ${params.messages.length}`);

  const start = performance.now();

  const response = await fetchWithPay(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Request-ID": crypto.randomUUID(),
    },
    body: JSON.stringify(params),
  });

  const elapsed = Math.round(performance.now() - start);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AiMo returned ${response.status}: ${body}`);
  }

  // Log x402 payment response header if present
  const paymentResponse = response.headers.get("payment-response");
  if (paymentResponse) {
    try {
      const decoded = JSON.parse(atob(paymentResponse));
      console.log(`[x402] Payment settled:`, JSON.stringify(decoded, null, 2));
    } catch {
      console.log(`[x402] Payment response header present (not base64 JSON)`);
    }
  }

  const data = await response.json();
  console.log(`[x402] Completed in ${elapsed}ms`);

  return data;
}
