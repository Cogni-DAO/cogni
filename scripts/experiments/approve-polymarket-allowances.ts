// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/approve-polymarket-allowances`
 * Purpose: task.0315 Phase 1 CP3.1 + task.0323 §0 — grant USDC.e approvals from the operator EOA to Polymarket's three CLOB exchange contracts, and CTF ERC-1155 setApprovalForAll to the two exchange operators (required for SELL), all on Polygon, signed by Privy HSM. One-time per wallet; idempotent (skips MaxUint256 allowances and already-set CTF approvals).
 * Scope: Reads current `allowance(owner, spender)` for each USDC.e target, calls `approve(spender, MaxUint256)`; then reads `isApprovedForAll(owner, operator)` for each CTF operator, calls `setApprovalForAll(operator, true)` if needed. All via Privy-backed viem WalletClient, waits for receipts. Prints final state. Does not place orders, deposit, or derive creds.
 * Invariants: Polygon chainId 137; EOA path only (no Safe proxy); MaxUint256 allowance.
 * Side-effects: IO (reads .env.local; Polygon RPC reads + writes; up to 3 signed txs costing ≈0.02 POL total gas).
 * Links: docs/guides/polymarket-account-setup.md step 4; work/items/task.0315.poly-copy-trade-prototype.md CP3
 * @internal — experiment code, not shipped to production
 */

import path from "node:path";
import { PrivyClient } from "@privy-io/node";
import { createViemAccount } from "@privy-io/node/viem";
import { config } from "dotenv";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  type Hex,
  http,
  maxUint256,
} from "viem";
import { polygon } from "viem/chains";

config({ path: path.resolve(__dirname, "../../.env.local") });

// ---------------------------------------------------------------------------
// Polygon-mainnet CLOB contract config — source: @polymarket/clob-client config.js
// ---------------------------------------------------------------------------

const USDC_E_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as Address;
const CTF_POLYGON = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as Address;
const SPENDERS: Array<{ name: string; address: Address }> = [
  { name: "Exchange", address: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" },
  {
    name: "Neg-Risk Exchange",
    address: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  },
  {
    name: "Neg-Risk Adapter",
    address: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  },
];
// CTF (ERC-1155) operators — required for SELL.
const CTF_OPERATORS: Array<{ name: string; address: Address }> = [
  { name: "Exchange", address: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" },
  {
    name: "Neg-Risk Exchange",
    address: "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  },
];
const ERC1155_APPROVAL_ABI = [
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

const DEFAULT_POLYGON_RPC = "https://polygon-bor-rpc.publicnode.com";

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`[approve] Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

async function main(): Promise<void> {
  const appId = requireEnv("PRIVY_APP_ID");
  const appSecret = requireEnv("PRIVY_APP_SECRET");
  const signingKey = requireEnv("PRIVY_SIGNING_KEY");
  const expectedAddress = requireEnv("OPERATOR_WALLET_ADDRESS") as Address;
  const rpcUrl = process.env.POLYGON_RPC_URL ?? DEFAULT_POLYGON_RPC;

  console.log(`[approve] EOA:    ${expectedAddress}`);
  console.log(`[approve] Token:  USDC.e (${USDC_E_POLYGON})`);
  console.log(`[approve] RPC:    ${rpcUrl}`);

  // --- Resolve Privy walletId ---
  const privy = new PrivyClient({ appId, appSecret });
  let walletId: string | undefined;
  for await (const w of privy.wallets().list()) {
    if (w.address.toLowerCase() === expectedAddress.toLowerCase()) {
      walletId = w.id;
      break;
    }
  }
  if (!walletId) {
    console.error(`[approve] FAIL: no Privy wallet matches ${expectedAddress}`);
    process.exit(1);
  }

  const account = createViemAccount(privy, {
    walletId,
    address: expectedAddress,
    authorizationContext: { authorization_private_keys: [signingKey] },
  });
  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(rpcUrl),
  });

  // --- Per-spender: read allowance, approve if needed ---
  for (const spender of SPENDERS) {
    console.log(`\n[approve] --- ${spender.name} (${spender.address}) ---`);

    const current = await publicClient.readContract({
      address: USDC_E_POLYGON,
      abi: erc20Abi,
      functionName: "allowance",
      args: [expectedAddress, spender.address],
    });
    console.log(`[approve]   current allowance: ${current.toString()}`);

    if (current === maxUint256) {
      console.log("[approve]   already max — skipping");
      continue;
    }

    console.log("[approve]   submitting approve(spender, MaxUint256)...");
    const hash: Hex = await walletClient.writeContract({
      address: USDC_E_POLYGON,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender.address, maxUint256],
    });
    console.log(`[approve]   tx:      ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });
    if (receipt.status !== "success") {
      console.error(`[approve]   tx reverted: ${hash}`);
      process.exit(1);
    }
    console.log(`[approve]   block:   ${receipt.blockNumber}`);
    console.log(`[approve]   gas:    ${receipt.gasUsed}`);

    // Pin the read to the receipt's block — publicnode RPCs round-robin and a
    // fresh read may hit a node that hasn't synced the mined block yet.
    const after = await publicClient.readContract({
      address: USDC_E_POLYGON,
      abi: erc20Abi,
      functionName: "allowance",
      args: [expectedAddress, spender.address],
      blockNumber: receipt.blockNumber,
    });
    if (after !== maxUint256) {
      console.error(
        `[approve]   FAIL: allowance is ${after.toString()}, expected max`
      );
      process.exit(1);
    }
    console.log("[approve]   allowance now max ✓");
  }

  console.log("\n[approve] PASS — all three spenders approved for max USDC.e");

  for (const op of CTF_OPERATORS) {
    console.log(`\n[approve] --- CTF operator ${op.name} (${op.address}) ---`);
    const approved = await publicClient.readContract({
      address: CTF_POLYGON,
      abi: ERC1155_APPROVAL_ABI,
      functionName: "isApprovedForAll",
      args: [expectedAddress, op.address],
    });
    console.log(`[approve]   current isApprovedForAll: ${approved}`);
    if (approved) {
      console.log("[approve]   already approved — skipping");
      continue;
    }
    console.log("[approve]   submitting setApprovalForAll(operator, true)...");
    const hash: Hex = await walletClient.writeContract({
      address: CTF_POLYGON,
      abi: ERC1155_APPROVAL_ABI,
      functionName: "setApprovalForAll",
      args: [op.address, true],
    });
    console.log(`[approve]   tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });
    if (receipt.status !== "success") {
      console.error(`[approve]   tx reverted: ${hash}`);
      process.exit(1);
    }
    console.log("[approve]   CTF approval set ✓");
  }

  console.log("\n[approve] PASS — CTF operators approved (SELL path enabled)");
}

main().catch((err: unknown) => {
  console.error("[approve] unhandled error:", err);
  process.exit(1);
});
