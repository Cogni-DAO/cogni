// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/node-activate-payments`
 * Purpose: Provision operator wallet via Privy and write operator_wallet.address to repo-spec.
 * Scope: CLI entrypoint for Privy wallet provisioning only. Does not deploy Split contracts (use /setup/dao/payments UI for that).
 * Invariants: CHILD_OWNS_OPERATOR_WALLET — wallet owned by child node's Privy app credentials.
 * Side-effects: IO (Privy API, filesystem write to .cogni/repo-spec.yaml)
 * Links: docs/spec/node-formation.md, docs/guides/operator-wallet-setup.md
 * @public
 */

import { readFileSync, writeFileSync } from "node:fs";

import { PrivyClient } from "@privy-io/node";
import { getAddress } from "viem";

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════════════");
  console.log(" Provision Operator Wallet");
  console.log("═══════════════════════════════════════════════════\n");

  // --- Step 1: Verify Privy env ---
  console.log("Step 1: Checking Privy credentials...");
  const appId = requireEnv("PRIVY_APP_ID");
  const appSecret = requireEnv("PRIVY_APP_SECRET");
  requireEnv("PRIVY_SIGNING_KEY"); // Validated but not used directly
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

  // --- Step 3: Write operator_wallet to repo-spec ---
  console.log("Step 3: Writing operator_wallet to repo-spec...");

  const repoSpecPath = ".cogni/repo-spec.yaml";
  let repoSpec: string;
  try {
    repoSpec = readFileSync(repoSpecPath, "utf-8");
  } catch {
    console.error(`  Cannot read ${repoSpecPath}. Run node formation first.`);
    process.exit(1);
  }

  if (repoSpec.includes("operator_wallet:")) {
    repoSpec = repoSpec.replace(
      /operator_wallet:\s*\n\s*address:\s*"[^"]*"/,
      `operator_wallet:\n  address: "${operatorAddress}"`
    );
  } else {
    // Insert before cogni_dao
    repoSpec = repoSpec.replace(
      /cogni_dao:/,
      `operator_wallet:\n  address: "${operatorAddress}"\n\ncogni_dao:`
    );
  }

  writeFileSync(repoSpecPath, repoSpec);
  console.log(`  ✓ operator_wallet.address: ${operatorAddress}\n`);

  // --- Done ---
  console.log("═══════════════════════════════════════════════════");
  console.log(" OPERATOR WALLET PROVISIONED");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Address: ${operatorAddress}`);
  console.log();
  console.log("Next steps:");
  console.log(
    "  1. Go to /setup/dao/payments in your app to deploy the Split contract"
  );
  console.log("  2. Fund operator wallet with ~$0.02 ETH on Base for gas");
  console.log("  3. Commit .cogni/repo-spec.yaml");
}

main().catch((err) => {
  console.error("Failed to provision operator wallet:", err);
  process.exit(1);
});
