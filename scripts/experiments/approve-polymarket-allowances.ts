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
import { getContractConfig } from "@polymarket/clob-client-v2";
import { PrivyClient } from "@privy-io/node";
import { createViemAccount } from "@privy-io/node/viem";
import { config } from "dotenv";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  type Hex,
  http,
  maxUint256,
  parseAbi,
} from "viem";
import { polygon } from "viem/chains";

config({ path: path.resolve(__dirname, "../../.env.local") });

const POLYMARKET = getContractConfig(polygon.id);
const USDC_E_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as Address;
const PUSD_POLYGON = POLYMARKET.collateral as Address;
const CTF_POLYGON = POLYMARKET.conditionalTokens as Address;
const COLLATERAL_ONRAMP_POLYGON =
  "0x93070a847efEf7F70739046A929D47a521F5B8ee" as Address;

const USDC_E_SPENDERS: Array<{ name: string; address: Address }> = [
  { name: "Onramp", address: COLLATERAL_ONRAMP_POLYGON },
];
const PUSD_SPENDERS: Array<{ name: string; address: Address }> = [
  { name: "Exchange (V2)", address: POLYMARKET.exchangeV2 as Address },
  {
    name: "Neg-Risk Exchange (V2)",
    address: POLYMARKET.negRiskExchangeV2 as Address,
  },
  { name: "Neg-Risk Adapter", address: POLYMARKET.negRiskAdapter as Address },
];
const CTF_OPERATORS: Array<{ name: string; address: Address }> = [
  { name: "Exchange (V2)", address: POLYMARKET.exchangeV2 as Address },
  {
    name: "Neg-Risk Exchange (V2)",
    address: POLYMARKET.negRiskExchangeV2 as Address,
  },
  { name: "Neg-Risk Adapter", address: POLYMARKET.negRiskAdapter as Address },
];

const COLLATERAL_ONRAMP_WRAP_ABI = parseAbi([
  "function wrap(address asset, address to, uint256 amount)",
]);
const ERC20_BALANCEOF_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);
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

  async function approveErc20(
    token: Address,
    tokenLabel: string,
    spender: { name: string; address: Address }
  ): Promise<void> {
    console.log(
      `\n[approve] --- ${tokenLabel} → ${spender.name} (${spender.address}) ---`
    );
    const current = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [expectedAddress, spender.address],
    });
    console.log(`[approve]   current allowance: ${current.toString()}`);
    if (current === maxUint256) {
      console.log("[approve]   already max — skipping");
      return;
    }
    console.log("[approve]   submitting approve(spender, MaxUint256)...");
    const hash: Hex = await walletClient.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender.address, maxUint256],
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
    const after = await publicClient.readContract({
      address: token,
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

  for (const sp of USDC_E_SPENDERS)
    await approveErc20(USDC_E_POLYGON, "USDC.e", sp);

  console.log("\n[approve] --- Wrap USDC.e → pUSD ---");
  const usdcEBalance = await publicClient.readContract({
    address: USDC_E_POLYGON,
    abi: ERC20_BALANCEOF_ABI,
    functionName: "balanceOf",
    args: [expectedAddress],
  });
  console.log(`[approve]   USDC.e balance: ${formatUnits(usdcEBalance, 6)}`);
  if (usdcEBalance === 0n) {
    console.log("[approve]   nothing to wrap — skipping");
  } else {
    console.log(`[approve]   submitting wrap(${usdcEBalance.toString()})...`);
    const wrapHash: Hex = await walletClient.writeContract({
      address: COLLATERAL_ONRAMP_POLYGON,
      abi: COLLATERAL_ONRAMP_WRAP_ABI,
      functionName: "wrap",
      args: [USDC_E_POLYGON, expectedAddress, usdcEBalance],
    });
    console.log(`[approve]   tx: ${wrapHash}`);
    const wrapReceipt = await publicClient.waitForTransactionReceipt({
      hash: wrapHash,
      confirmations: 1,
    });
    if (wrapReceipt.status !== "success") {
      console.error(`[approve]   wrap tx reverted: ${wrapHash}`);
      process.exit(1);
    }
    console.log("[approve]   wrap confirmed ✓");
  }

  for (const sp of PUSD_SPENDERS) await approveErc20(PUSD_POLYGON, "pUSD", sp);

  console.log(
    "\n[approve] PASS — all spenders approved for max (USDC.e + pUSD)"
  );

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
