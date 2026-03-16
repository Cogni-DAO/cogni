// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/node-activate-payments`
 * Purpose: Activate payment rails for a child node — provision operator wallet, deploy Split, write repo-spec.
 * Scope: CLI entrypoint that provisions Privy wallet, deploys Split, validates on-chain, and writes repo-spec. Does not modify app runtime code or deployment infrastructure.
 * Invariants: CHILD_OWNS_OPERATOR_WALLET, SPLIT_CONTROLLER_IS_ADMIN, PAYMENTS_ACTIVE_REQUIRES_ALL.
 * Side-effects: IO (Privy API, Base RPC, filesystem write to .cogni/repo-spec.yaml)
 * Links: docs/spec/node-formation.md, docs/guides/operator-wallet-setup.md
 * @public
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import { PUSH_SPLIT_V2o2_FACTORY_ADDRESS } from "@0xsplits/splits-sdk/constants";
import {
  splitV2ABI,
  splitV2o2FactoryAbi,
} from "@0xsplits/splits-sdk/constants/abi";
import {
  calculateSplitAllocations,
  numberToPpm,
  OPENROUTER_CRYPTO_FEE_PPM,
  SPLIT_TOTAL_ALLOCATION,
} from "@cogni/operator-wallet";
import { PrivyClient } from "@privy-io/node";
import type { Address } from "viem";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

function loadRepoSpecRaw(): string {
  const path = ".cogni/repo-spec.yaml";
  try {
    return readFileSync(path, "utf-8");
  } catch {
    console.error(`Cannot read ${path}. Run node formation first.`);
    process.exit(1);
  }
}

function extractDaoContract(yaml: string): string {
  const match = yaml.match(/dao_contract:\s*"(0x[a-fA-F0-9]{40})"/);
  if (!match?.[1]) {
    console.error(
      "Cannot find cogni_dao.dao_contract in .cogni/repo-spec.yaml. Run node formation first."
    );
    process.exit(1);
  }
  return match[1];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("═══════════════════════════════════════════════════");
  console.log(" Activate Payment Rails");
  console.log("═══════════════════════════════════════════════════\n");

  // --- Step 1: Verify Privy env ---
  console.log("Step 1: Checking Privy credentials...");
  const appId = requireEnv("PRIVY_APP_ID");
  const appSecret = requireEnv("PRIVY_APP_SECRET");
  requireEnv("PRIVY_SIGNING_KEY"); // Validated but not used directly (Privy SDK reads from env)
  console.log("  ✓ PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNING_KEY set\n");

  // --- Step 2: Resolve operator wallet ---
  console.log("Step 2: Operator wallet...");
  const client = new PrivyClient({ appId, appSecret });

  const wallets: { id: string; address: string }[] = [];
  for await (const w of client.wallets().list()) {
    wallets.push({ id: w.id, address: w.address });
  }

  let operatorAddress: string;
  const explicitAddress = process.env.OPERATOR_WALLET_ADDRESS;

  if (explicitAddress) {
    operatorAddress = getAddress(explicitAddress);
    console.log(
      `  Using explicit OPERATOR_WALLET_ADDRESS: ${operatorAddress}\n`
    );
  } else if (wallets.length === 0) {
    console.log("  No wallets found in Privy app. Creating one...");
    const wallet = await client.wallets().create({ chain_type: "ethereum" });
    operatorAddress = getAddress(wallet.address);
    console.log(`  ✓ Created wallet: ${operatorAddress}\n`);
  } else if (wallets.length === 1) {
    operatorAddress = getAddress(wallets[0].address);
    console.log(`  ✓ Found wallet: ${operatorAddress}\n`);
  } else {
    console.error(
      `  ERROR: ${wallets.length} wallets found in Privy app. Set OPERATOR_WALLET_ADDRESS to disambiguate.`
    );
    for (const w of wallets) {
      console.error(`    - ${w.address} (${w.id})`);
    }
    process.exit(1);
  }

  // --- Step 3: Read DAO treasury from repo-spec ---
  const repoSpecRaw = loadRepoSpecRaw();
  const treasuryAddress = getAddress(extractDaoContract(repoSpecRaw));
  console.log(`Step 3: DAO treasury from repo-spec: ${treasuryAddress}`);

  // --- Step 4: Derive allocations ---
  const markupPpm = numberToPpm(
    Number(process.env.USER_PRICE_MARKUP_FACTOR ?? "2.0")
  );
  const revenueSharePpm = numberToPpm(
    Number(process.env.SYSTEM_TENANT_REVENUE_SHARE ?? "0.75")
  );
  const { operatorAllocation, treasuryAllocation } = calculateSplitAllocations(
    markupPpm,
    revenueSharePpm,
    OPENROUTER_CRYPTO_FEE_PPM
  );

  // --- Step 5: Split controller ---
  const rawKey = requireEnv("DEPLOYER_PRIVATE_KEY");
  const privateKey = (
    rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`
  ) as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  const splitController = process.env.SPLIT_CONTROLLER_ADDRESS
    ? getAddress(process.env.SPLIT_CONTROLLER_ADDRESS)
    : account.address;

  if (!process.env.SPLIT_CONTROLLER_ADDRESS) {
    console.log(
      "\n  ⚠ WARNING: SPLIT_CONTROLLER_ADDRESS not set. Using deployer as Split controller."
    );
    console.log(
      "  For production, set SPLIT_CONTROLLER_ADDRESS to a multisig or governance admin.\n"
    );
  }

  // --- Step 6: Confirm ---
  const rpcUrl = process.env.EVM_RPC_URL ?? "https://mainnet.base.org";

  console.log("\n  Configuration:");
  console.log(
    `    Operator (${Number(operatorAllocation) / 1e4}%): ${operatorAddress}`
  );
  console.log(
    `    Treasury (${Number(treasuryAllocation) / 1e4}%): ${treasuryAddress}`
  );
  console.log(`    Split controller: ${splitController}`);
  console.log(`    Deployer: ${account.address}`);
  console.log(`    RPC: ${rpcUrl}\n`);

  const answer = await rl.question("  Deploy Split to Base mainnet? [y/N] ");
  if (answer.toLowerCase() !== "y") {
    console.log("Aborted.");
    rl.close();
    return;
  }

  // --- Step 7: Deploy Split ---
  console.log("\n  Deploying Split contract...");

  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  });

  // Sort recipients ascending (0xSplits requirement)
  const entries = [
    {
      address: getAddress(operatorAddress) as Address,
      allocation: operatorAllocation,
    },
    {
      address: getAddress(treasuryAddress) as Address,
      allocation: treasuryAllocation,
    },
  ].sort((a, b) =>
    a.address.toLowerCase().localeCompare(b.address.toLowerCase())
  );

  const splitParams = {
    recipients: entries.map((e) => e.address) as readonly Address[],
    allocations: entries.map((e) => e.allocation) as readonly bigint[],
    totalAllocation: SPLIT_TOTAL_ALLOCATION,
    distributionIncentive: 0,
  };

  const factoryAddress = getAddress(PUSH_SPLIT_V2o2_FACTORY_ADDRESS) as Address;

  const deployHash = await walletClient.writeContract({
    address: factoryAddress,
    abi: splitV2o2FactoryAbi,
    functionName: "createSplit",
    args: [splitParams, splitController as Address, splitController as Address],
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deployHash,
  });

  // Extract Split address from SplitCreated event
  let splitAddress: string | undefined;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: splitV2o2FactoryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "SplitCreated") {
        splitAddress = (decoded.args as { split: Address }).split;
        break;
      }
    } catch {
      // Not our event
    }
  }

  if (!splitAddress) {
    console.error(
      "  ERROR: Could not extract Split address from SplitCreated event"
    );
    process.exit(1);
  }

  console.log(`  ✓ Split deployed: ${splitAddress}`);
  console.log(`    Tx: ${receipt.transactionHash}`);
  console.log(`    Gas: ${receipt.gasUsed}`);

  // --- Step 8: Validate on-chain ---
  console.log("\n  Validating deployed Split...");

  const onChainHash = await publicClient.readContract({
    address: splitAddress as Address,
    abi: splitV2ABI,
    functionName: "splitHash",
  });

  if (!onChainHash) {
    console.error("  ERROR: Could not read splitHash from deployed contract");
    process.exit(1);
  }
  console.log(
    `  ✓ Split contract verified on-chain (splitHash: ${(onChainHash as string).substring(0, 18)}...)`
  );

  // --- Step 9: Write repo-spec ---
  console.log("\n  Writing repo-spec...");

  let updatedSpec = repoSpecRaw;

  // Add or update operator_wallet
  if (updatedSpec.includes("operator_wallet:")) {
    updatedSpec = updatedSpec.replace(
      /operator_wallet:\s*\n\s*address:\s*"[^"]*"/,
      `operator_wallet:\n  address: "${operatorAddress}"`
    );
  } else {
    // Insert before cogni_dao
    updatedSpec = updatedSpec.replace(
      /cogni_dao:/,
      `operator_wallet:\n  address: "${operatorAddress}"\n\ncogni_dao:`
    );
  }

  // Add or update payments_in
  if (updatedSpec.includes("payments_in:")) {
    updatedSpec = updatedSpec.replace(
      /payments_in:\s*\n\s*credits_topup:\s*\n\s*provider:[^\n]*\n\s*receiving_address:[^\n]*/,
      `payments_in:\n  credits_topup:\n    provider: cogni-usdc-backend-v1\n    receiving_address: "${splitAddress}"`
    );
  } else {
    updatedSpec += `\npayments_in:\n  credits_topup:\n    provider: cogni-usdc-backend-v1\n    receiving_address: "${splitAddress}"\n    allowed_chains:\n      - Base\n    allowed_tokens:\n      - USDC\n`;
  }

  // Add or update payments.status — written last, only after validation succeeded
  if (updatedSpec.includes("payments:")) {
    updatedSpec = updatedSpec.replace(
      /payments:\s*\n\s*status:\s*\S+/,
      "payments:\n  status: active"
    );
  } else {
    updatedSpec += `\npayments:\n  status: active\n`;
  }

  writeFileSync(".cogni/repo-spec.yaml", updatedSpec);
  console.log("  ✓ .cogni/repo-spec.yaml updated");

  // --- Done ---
  console.log("\n═══════════════════════════════════════════════════");
  console.log(" PAYMENT RAILS ACTIVATED");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Operator wallet: ${operatorAddress}`);
  console.log(`  Split contract:  ${splitAddress}`);
  console.log(`  Split controller: ${splitController}`);
  console.log(`  payments.status: active`);
  console.log();
  console.log("Next steps:");
  console.log(`  1. Fund operator wallet with ~$0.02 ETH on Base for gas`);
  console.log(`  2. Commit .cogni/repo-spec.yaml`);
  console.log(`  3. Deploy your node`);

  rl.close();
}

main().catch((err) => {
  console.error("Failed to activate payments:", err);
  process.exit(1);
});
