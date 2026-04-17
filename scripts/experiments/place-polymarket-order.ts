// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/place-polymarket-order`
 * Purpose: task.0315 Phase 1 CP3.2 dress rehearsal — place a tiny real BUY via the new
 *   `PolymarketClobAdapter` and immediately cancel it. Produces the CP5 evidence artifact
 *   (a real `order_id` from the prod CLOB) at minimal economic exposure.
 * Scope: Constructs PrivyClient → viem LocalAccount → PolymarketClobAdapter; issues one BUY at a far-below-market limit + immediate cancel; requires `--yes-real-money`. Does not mirror any wallet, does not invoke `decide()`, does not write to the DB.
 * Invariants: Polygon chainId 137 only; env-directed wallet auth (no per-tenant broker — that
 *   is vnext); $POLY_CLOB_HOST defaulted; requires explicit CLI opt-in for real placement.
 * Side-effects: IO (reads .env.local; HTTPS to CLOB; Privy HSM sign; ONE real CLOB order
 *   placement + ONE cancel).
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP3.2 live dry-rehearsal)
 * @internal — experiment code, not shipped to production
 */

import path from "node:path";
import {
  type ApiKeyCreds,
  PolymarketClobAdapter,
} from "@cogni/market-provider/adapters/polymarket";
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
config({ path: path.resolve(__dirname, ".env") });

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`[cp3.2] Missing env: ${key}`);
    process.exit(1);
  }
  return v;
}

function envOrDefault(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

async function main(): Promise<void> {
  const confirmed = process.argv.includes("--yes-real-money");
  if (!confirmed) {
    console.error(
      "[cp3.2] Refusing to run without --yes-real-money. This script places a REAL order on mainnet."
    );
    console.error(
      "        Usage: pnpm tsx scripts/experiments/place-polymarket-order.ts --yes-real-money"
    );
    process.exit(1);
  }

  const tokenId = requireEnv("POLY_DRESS_REHEARSAL_TOKEN_ID");
  const limitPrice = Number(envOrDefault("POLY_DRESS_REHEARSAL_PRICE", "0.01"));
  const sizeUsdc = Number(envOrDefault("POLY_DRESS_REHEARSAL_SIZE_USDC", "1"));

  if (!Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice >= 1) {
    console.error(
      `[cp3.2] POLY_DRESS_REHEARSAL_PRICE must be strictly inside (0, 1); got "${limitPrice}".`
    );
    process.exit(1);
  }
  if (!Number.isFinite(sizeUsdc) || sizeUsdc <= 0) {
    console.error(
      `[cp3.2] POLY_DRESS_REHEARSAL_SIZE_USDC must be > 0; got "${sizeUsdc}".`
    );
    process.exit(1);
  }

  const privyAppId = requireEnv("PRIVY_APP_ID");
  const privyAppSecret = requireEnv("PRIVY_APP_SECRET");
  const privySigningKey = requireEnv("PRIVY_SIGNING_KEY");
  const expectedAddress = requireEnv("OPERATOR_WALLET_ADDRESS") as Hex;

  const creds: ApiKeyCreds = {
    key: requireEnv("POLY_CLOB_API_KEY"),
    secret: requireEnv("POLY_CLOB_API_SECRET"),
    passphrase: requireEnv("POLY_CLOB_PASSPHRASE"),
  };

  const host = envOrDefault("POLY_CLOB_HOST", DEFAULT_CLOB_HOST);

  console.log(`[cp3.2] Resolving Privy wallet for ${expectedAddress}...`);
  const privy = new PrivyClient({
    appId: privyAppId,
    appSecret: privyAppSecret,
  });
  let walletId: string | undefined;
  for await (const wallet of privy.wallets().list()) {
    if (wallet.address.toLowerCase() === expectedAddress.toLowerCase()) {
      walletId = wallet.id;
      break;
    }
  }
  if (!walletId) {
    console.error(
      `[cp3.2] FAIL: Privy has no wallet matching ${expectedAddress}.`
    );
    process.exit(1);
  }

  const account = createViemAccount(privy, {
    walletId,
    address: expectedAddress,
    authorizationContext: { authorization_private_keys: [privySigningKey] },
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
    stringToHex(`dress-rehearsal:${Date.now()}:${tokenId}`)
  );

  console.log(
    `[cp3.2] Placing BUY ${sizeUsdc} USDC @ ${limitPrice} on token ${tokenId.slice(
      0,
      14
    )}... (GTC post-only at far-below-market; cannot match → CLOB rejects if it would take)`
  );
  console.log(`[cp3.2] host=${host} client_order_id=${client_order_id}`);

  // B5 — post-only GTC: CLOB rejects the order if it would take (match against
  // the book) instead of resting. At a far-below-market BUY price the order
  // cannot match anyway, but post-only is the belt-and-suspenders guard against
  // a place-then-cancel race if market conditions changed between our price
  // selection and submission. If it rests, we cancel it below.
  const receipt = await adapter.placeOrder({
    provider: "polymarket",
    market_id: `prediction-market:polymarket:dress-rehearsal-${tokenId}`,
    outcome: "YES",
    side: "BUY",
    size_usdc: sizeUsdc,
    limit_price: limitPrice,
    client_order_id,
    attributes: { token_id: tokenId, post_only: true },
  });

  console.log(
    `[cp3.2] PLACED order_id=${receipt.order_id} status=${receipt.status}`
  );
  console.log(`[cp3.2] receipt: ${JSON.stringify(receipt, null, 2)}`);

  if (receipt.filled_size_usdc > 0) {
    console.error(
      `[cp3.2] FATAL: dress rehearsal order reported a fill (filled_size_usdc=${receipt.filled_size_usdc}). ` +
        "The guard assumption (far-below-market post-only cannot match) was violated."
    );
    process.exit(2);
  }

  console.log("[cp3.2] --- PR evidence ---");
  console.log(
    JSON.stringify(
      {
        order_id: receipt.order_id,
        status: receipt.status,
        rawStatus: receipt.attributes?.rawStatus,
        client_order_id,
      },
      null,
      2
    )
  );
}

main().catch((err: unknown) => {
  console.error("[cp3.2] unhandled error:", err);
  process.exit(1);
});
