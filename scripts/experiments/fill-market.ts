// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/fill-market`
 * Purpose: task.0315 — place a single taking Polymarket CLOB BUY against explicit --token-id / --side / --size-usdc / --limit-price flags gated behind --yes-real-money. Unlike `copy-top-wallet-rehearsal.ts` this is NOT post-only and does not cancel; the resulting position is held to resolution.
 * Scope: Reads env + CLI flags, signs via Privy-backed viem WalletClient, places one order through `PolymarketClobAdapter`, prints receipt + evidence block. Does not auto-discover targets, does not implement decide() logic, does not cancel.
 * Invariants: Polygon chainId 137; BUY-only (SELL requires CTF setApprovalForAll); --yes-real-money required.
 * Side-effects: IO (reads .env.local; HTTPS to Polymarket CLOB; Privy HSM sign; one real signed order that matches against the book and settles on-chain).
 * Links: work/items/task.0315.poly-copy-trade-prototype.md
 * @internal — experiment code, not shipped to production
 */

import path from "node:path";
import {
  type ApiKeyCreds,
  PolymarketClobAdapter,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { PrivyClient } from "@privy-io/node";
import { createViemAccount } from "@privy-io/node/viem";
import { config } from "dotenv";
import {
  createWalletClient,
  type Hex,
  http,
  keccak256,
  stringToHex,
} from "viem";
import { polygon } from "viem/chains";

config({ path: path.resolve(__dirname, "../../.env.local") });

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`[fill] Missing env: ${key}`);
    process.exit(1);
  }
  return v;
}

function requireArg(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx === process.argv.length - 1) {
    console.error(`[fill] Missing required flag: ${flag}`);
    process.exit(1);
  }
  return process.argv[idx + 1];
}

const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

async function main(): Promise<void> {
  if (!process.argv.includes("--yes-real-money")) {
    console.error(
      "[fill] Refusing without --yes-real-money. This places a REAL taking order."
    );
    process.exit(1);
  }

  const tokenId = requireArg("--token-id");
  const rawSide = requireArg("--side").toUpperCase();
  if (rawSide !== "BUY") {
    console.error(
      "[fill] Only --side BUY is supported (SELL needs CTF approval)."
    );
    process.exit(1);
  }
  const sizeUsdc = Number(requireArg("--size-usdc"));
  const limitPrice = Number(requireArg("--limit-price"));
  const label = process.argv.includes("--label")
    ? requireArg("--label")
    : "cogni-live-fill";

  if (!Number.isFinite(sizeUsdc) || sizeUsdc <= 0) {
    console.error("[fill] --size-usdc must be > 0");
    process.exit(1);
  }
  if (!Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice >= 1) {
    console.error("[fill] --limit-price must be strictly inside (0, 1)");
    process.exit(1);
  }

  const expectedAddress = requireEnv("OPERATOR_WALLET_ADDRESS") as Hex;
  const creds: ApiKeyCreds = {
    key: requireEnv("POLY_CLOB_API_KEY"),
    secret: requireEnv("POLY_CLOB_API_SECRET"),
    passphrase: requireEnv("POLY_CLOB_PASSPHRASE"),
  };
  const host = process.env.POLY_CLOB_HOST ?? DEFAULT_CLOB_HOST;

  console.log("[fill] plan:");
  console.log(`  token_id:     ${tokenId}`);
  console.log(`  side:         ${rawSide}`);
  console.log(`  size_usdc:    ${sizeUsdc}`);
  console.log(
    `  limit_price:  ${limitPrice}  (taking — will match against the book)`
  );
  console.log(`  operator EOA: ${expectedAddress}`);
  console.log(`  label:        ${label}`);

  const privy = new PrivyClient({
    appId: requireEnv("PRIVY_APP_ID"),
    appSecret: requireEnv("PRIVY_APP_SECRET"),
  });
  let walletId: string | undefined;
  for await (const w of privy.wallets().list()) {
    if (w.address.toLowerCase() === expectedAddress.toLowerCase()) {
      walletId = w.id;
      break;
    }
  }
  if (!walletId) {
    console.error(`[fill] FAIL: no Privy wallet matches ${expectedAddress}`);
    process.exit(1);
  }

  const account = createViemAccount(privy, {
    walletId,
    address: expectedAddress,
    authorizationContext: {
      authorization_private_keys: [requireEnv("PRIVY_SIGNING_KEY")],
    },
  });
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });
  const adapter = new PolymarketClobAdapter({
    signer: walletClient,
    creds,
    funderAddress: expectedAddress,
    host,
  });

  const client_order_id = keccak256(
    stringToHex(`${label}:${tokenId}:${Date.now()}`)
  );

  console.log("[fill] placing...");
  const receipt = await adapter.placeOrder({
    provider: "polymarket",
    market_id: `prediction-market:polymarket:${tokenId}`,
    outcome: "YES",
    side: "BUY",
    size_usdc: sizeUsdc,
    limit_price: limitPrice,
    client_order_id,
    attributes: { token_id: tokenId /* post_only intentionally absent */ },
  });

  console.log("[fill] receipt:");
  console.log(JSON.stringify(receipt, null, 2));

  console.log("");
  console.log("[fill] --- PR evidence ---");
  console.log(
    JSON.stringify(
      {
        token_id: tokenId,
        our_order: {
          order_id: receipt.order_id,
          client_order_id,
          side: "BUY",
          limit_price: limitPrice,
          size_usdc: sizeUsdc,
          label,
        },
        receipt: {
          status: receipt.status,
          filled_size_usdc: receipt.filled_size_usdc,
          rawStatus: receipt.attributes?.rawStatus,
          success: receipt.attributes?.success,
          transactionsHashes: receipt.attributes?.transactionsHashes,
        },
        operator_profile: `https://polymarket.com/profile/${expectedAddress.toLowerCase()}`,
      },
      null,
      2
    )
  );
}

main().catch((err: unknown) => {
  console.error("[fill] unhandled error:", err);
  process.exit(1);
});
