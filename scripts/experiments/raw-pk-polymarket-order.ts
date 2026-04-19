// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/raw-pk-polymarket-order`
 * Purpose: Reusable place/cancel against Polymarket CLOB signed by a raw-private-key EOA (loads `TEST_WALLET_*` + `TEST_WALLET_POLY_CLOB_*` from `.env.test`). Raw-PK sibling of the Privy-based `place-polymarket-order.ts`.
 * Scope: Two subcommands — `place` (BUY GTC post-only; prints order_id) and `cancel --order-id <id>`. Requires `--yes-real-money` for `place`. Does not onboard the wallet (use `onboard-raw-pk-wallet.ts`).
 * Invariants: Polygon chainId 137; EOA path; post-only GTC (CLOB rejects if would match).
 * Side-effects: reads .env.test; HTTPS to Polymarket CLOB; ONE real placement OR cancel per invocation.
 * Links: docs/guides/polymarket-account-setup.md
 * @internal — experiment code, not shipped to production
 */

import path from "node:path";
import { PolymarketClobAdapter } from "@cogni/market-provider/adapters/polymarket";
import { config } from "dotenv";
import {
  createWalletClient,
  type Hex,
  http,
  keccak256,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

config({ path: path.resolve(__dirname, "../../.env.test") });
config({ path: path.resolve(__dirname, "../../.env.local") });

const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";
const DEFAULT_RPC = "https://polygon-bor-rpc.publicnode.com";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`[raw-pk] Missing env: ${key}`);
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

function buildAdapter() {
  const pkRaw = requireEnv("TEST_WALLET_PRIVATE_KEY");
  const pk: Hex = pkRaw.startsWith("0x")
    ? (pkRaw as Hex)
    : (`0x${pkRaw}` as Hex);
  const account = privateKeyToAccount(pk);
  const rpcUrl = process.env.POLYGON_RPC_URL ?? DEFAULT_RPC;
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(rpcUrl),
  });
  const creds = {
    key: requireEnv("TEST_WALLET_POLY_CLOB_API_KEY"),
    secret: requireEnv("TEST_WALLET_POLY_CLOB_API_SECRET"),
    passphrase: requireEnv("TEST_WALLET_POLY_CLOB_PASSPHRASE"),
  };
  const host = process.env.POLY_CLOB_HOST ?? DEFAULT_CLOB_HOST;
  const adapter = new PolymarketClobAdapter({
    signer: walletClient,
    creds,
    funderAddress: account.address,
    host,
  });
  return { adapter, address: account.address, host };
}

async function cmdPlace(): Promise<void> {
  if (!argFlag("yes-real-money")) {
    console.error(
      "[raw-pk] Refusing to place without --yes-real-money. This places a REAL order on mainnet."
    );
    process.exit(1);
  }
  const tokenId = argValue("token-id") ?? requireEnv("POLY_TOKEN_ID");
  const limitPrice = Number(argValue("price") ?? "0.01");
  const sizeUsdc = Number(argValue("size") ?? "5");
  const side = (argValue("side") ?? "BUY").toUpperCase() as "BUY" | "SELL";
  const outcome = (argValue("outcome") ?? "YES").toUpperCase() as "YES" | "NO";

  if (!Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice >= 1) {
    console.error(`[raw-pk] --price must be in (0, 1); got "${limitPrice}"`);
    process.exit(1);
  }
  if (!Number.isFinite(sizeUsdc) || sizeUsdc <= 0) {
    console.error(`[raw-pk] --size must be > 0; got "${sizeUsdc}"`);
    process.exit(1);
  }

  const { adapter, address, host } = buildAdapter();

  const client_order_id = keccak256(
    stringToHex(`raw-pk:${Date.now()}:${tokenId}`)
  );

  console.log(
    `[raw-pk] Placing ${side} ${sizeUsdc} USDC ${outcome} @ ${limitPrice} on token ${tokenId.slice(0, 14)}...`
  );
  console.log(`[raw-pk] funder=${address} host=${host}`);

  const receipt = await adapter.placeOrder({
    provider: "polymarket",
    market_id: `prediction-market:polymarket:raw-pk-${tokenId}`,
    outcome,
    side,
    size_usdc: sizeUsdc,
    limit_price: limitPrice,
    client_order_id,
    attributes: { token_id: tokenId, post_only: argFlag("post-only") },
  });

  console.log(
    `[raw-pk] PLACED order_id=${receipt.order_id} status=${receipt.status}`
  );
  console.log(JSON.stringify(receipt, null, 2));
}

async function cmdCancel(): Promise<void> {
  const orderId = argValue("order-id") ?? requireEnv("POLY_ORDER_ID");
  const { adapter } = buildAdapter();
  console.log(`[raw-pk] Cancelling ${orderId}...`);
  await adapter.cancelOrder(orderId);
  console.log("[raw-pk] CANCELLED ✓");
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
        "  pnpm tsx scripts/experiments/raw-pk-polymarket-order.ts place --token-id <id> [--price 0.01] [--size 5] [--side BUY|SELL] [--outcome YES|NO] [--post-only] --yes-real-money\n" +
        "  pnpm tsx scripts/experiments/raw-pk-polymarket-order.ts cancel --order-id <id>"
    );
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("[raw-pk] unhandled error:", err);
  process.exit(1);
});
