// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/privy-polymarket-order`
 * Purpose: Reusable place/cancel against Polymarket CLOB signed by a Privy HSM wallet (defaults to POLY_PROTO operator via `.env.local`). Privy sibling of `raw-pk-polymarket-order.ts` + generalized variant of the scope-specific `place-polymarket-order.ts` dress-rehearsal script.
 * Scope: Two subcommands — `place` (GTC; configurable `--side`, `--outcome`, `--size`, `--price`, optional `--post-only`) and `cancel --order-id <id>`. Requires `--yes-real-money` for `place`. Does not onboard.
 * Invariants: Polygon chainId 137; EOA path only; GTC (caller owns onboarding — USDC.e + CTF approvals + CLOB creds must already be in place).
 * Side-effects: IO (reads .env.local; HTTPS to Polymarket CLOB; one real placement or cancel per invocation).
 * Links: docs/guides/polymarket-account-setup.md, work/items/task.0323.poly-copy-trade-v1-hardening.md
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

const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`[privy] Missing env: ${key}`);
    process.exit(1);
  }
  return v;
}

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function buildAdapter() {
  const appId = requireEnv("PRIVY_APP_ID");
  const appSecret = requireEnv("PRIVY_APP_SECRET");
  const signingKey = requireEnv("PRIVY_SIGNING_KEY");
  const expectedAddress = requireEnv("OPERATOR_WALLET_ADDRESS") as Hex;
  const creds: ApiKeyCreds = {
    key: requireEnv("POLY_CLOB_API_KEY"),
    secret: requireEnv("POLY_CLOB_API_SECRET"),
    passphrase: requireEnv("POLY_CLOB_PASSPHRASE"),
  };
  const host = process.env.POLY_CLOB_HOST ?? DEFAULT_CLOB_HOST;

  const privy = new PrivyClient({ appId, appSecret });
  let walletId: string | undefined;
  for await (const w of privy.wallets().list()) {
    if (w.address.toLowerCase() === expectedAddress.toLowerCase()) {
      walletId = w.id;
      break;
    }
  }
  if (!walletId) {
    console.error(`[privy] FAIL: no Privy wallet matches ${expectedAddress}`);
    process.exit(1);
  }
  const account = createViemAccount(privy, {
    walletId,
    address: expectedAddress,
    authorizationContext: { authorization_private_keys: [signingKey] },
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
  return { adapter, address: expectedAddress, host };
}

async function cmdPlace(): Promise<void> {
  if (!argFlag("yes-real-money")) {
    console.error("[privy] Refusing without --yes-real-money.");
    process.exit(1);
  }
  const tokenId = argValue("token-id") ?? requireEnv("POLY_TOKEN_ID");
  const limitPrice = Number(argValue("price") ?? "0.01");
  const sizeUsdc = Number(argValue("size") ?? "1");
  const side = (argValue("side") ?? "BUY").toUpperCase() as "BUY" | "SELL";
  const outcome = (argValue("outcome") ?? "YES").toUpperCase() as "YES" | "NO";

  if (!Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice >= 1) {
    console.error(`[privy] --price must be in (0, 1); got "${limitPrice}"`);
    process.exit(1);
  }
  if (!Number.isFinite(sizeUsdc) || sizeUsdc <= 0) {
    console.error(`[privy] --size must be > 0; got "${sizeUsdc}"`);
    process.exit(1);
  }

  const { adapter, address, host } = await buildAdapter();
  const client_order_id = keccak256(
    stringToHex(`privy:${Date.now()}:${tokenId}`)
  );

  console.log(
    `[privy] Placing ${side} ${sizeUsdc} USDC ${outcome} @ ${limitPrice} on token ${tokenId.slice(0, 14)}...`
  );
  console.log(`[privy] funder=${address} host=${host}`);

  const receipt = await adapter.placeOrder({
    provider: "polymarket",
    market_id: `prediction-market:polymarket:privy-${tokenId}`,
    outcome,
    side,
    size_usdc: sizeUsdc,
    limit_price: limitPrice,
    client_order_id,
    attributes: { token_id: tokenId, post_only: argFlag("post-only") },
  });

  console.log(
    `[privy] PLACED order_id=${receipt.order_id} status=${receipt.status}`
  );
  console.log(JSON.stringify(receipt, null, 2));
}

async function cmdCancel(): Promise<void> {
  const orderId = argValue("order-id") ?? requireEnv("POLY_ORDER_ID");
  const { adapter } = await buildAdapter();
  console.log(`[privy] Cancelling ${orderId}...`);
  await adapter.cancelOrder(orderId);
  console.log("[privy] CANCELLED ✓");
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === "place") {
    await cmdPlace();
  } else if (cmd === "cancel") {
    await cmdCancel();
  } else {
    console.error(
      "Usage:\n" +
        "  pnpm tsx scripts/experiments/privy-polymarket-order.ts place --token-id <id> [--price 0.50] [--size 1] [--side BUY|SELL] [--outcome YES|NO] [--post-only] --yes-real-money\n" +
        "  pnpm tsx scripts/experiments/privy-polymarket-order.ts cancel --order-id <id>"
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("[privy] unhandled error:", err);
  process.exit(1);
});
