// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/provision-operator-wallet`
 * Purpose: Programmatic operator wallet creation via Privy server wallet API.
 * Scope: CLI script that creates a new Privy-managed wallet and prints the checksummed address. Does not modify repo-spec — operator must update .cogni/repo-spec.yaml manually.
 * Invariants: KEY_NEVER_IN_APP — no private key material emitted or stored. PRIVY_SIGNED_REQUESTS — uses signed requests.
 * Side-effects: IO (creates wallet via Privy API); stdout (prints address).
 * Links: docs/spec/operator-wallet.md
 * @public
 */

import { PrivyClient } from "@privy-io/server-auth";

async function main(): Promise<void> {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const signingKey = process.env.PRIVY_SIGNING_KEY;

  if (!appId || !appSecret || !signingKey) {
    console.error(
      "Missing required env vars: PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNING_KEY"
    );
    console.error("Set these in your environment before running this script.");
    process.exit(1);
  }

  const client = new PrivyClient(appId, appSecret, {
    walletApi: {
      authorizationPrivateKey: signingKey,
    },
  });

  console.log("Creating operator wallet via Privy API...");

  const wallet = await client.walletApi.createWallet({
    chainType: "ethereum",
  });

  console.log(`Operator wallet created successfully.`);
  console.log(`Address: ${wallet.address}`);
  console.log(`Wallet ID: ${wallet.id}`);
  console.log();
  console.log(`Next steps:`);
  console.log(
    `  1. Update .cogni/repo-spec.yaml → operator_wallet.address = "${wallet.address}"`
  );
  console.log(`  2. Deploy Splits contract with this address as recipient`);
  console.log(
    `  3. Update .cogni/repo-spec.yaml → operator_wallet.split_address = <split address>`
  );
  console.log(`  4. Fund wallet with small ETH balance on Base for gas`);
}

main().catch((err) => {
  console.error("Failed to provision operator wallet:", err);
  process.exit(1);
});
