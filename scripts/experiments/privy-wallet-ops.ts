// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/privy-wallet-ops`
 * Purpose: Operator-only utility for inspecting and unwinding a Privy-backed Polymarket wallet.
 * Scope: Lists Data-API positions, lists CLOB open orders, sweeps redeemable positions, and closes a specific live position through the CLOB; does not provision wallets, derive new creds, or modify repo config.
 * Invariants: Polygon chainId 137; EOA path only; any write subcommand requires
 *   `--yes-real-money`.
 * Side-effects: IO, process.env
 * Links: scripts/experiments/probe-polymarket-account.ts,
 *        scripts/experiments/privy-polymarket-order.ts
 * @internal
 */

import path from "node:path";
import {
  type ApiKeyCreds,
  BINARY_REDEEM_INDEX_SETS,
  normalizePolygonConditionId,
  PARENT_COLLECTION_ID_ZERO,
  POLYGON_CONDITIONAL_TOKENS,
  POLYGON_USDC_E,
  PolymarketClobAdapter,
  PolymarketDataApiClient,
  type PolymarketUserPosition,
  polymarketCtfRedeemAbi,
} from "@cogni/market-provider/adapters/polymarket";
import { PrivyClient } from "@privy-io/node";
import { createViemAccount } from "@privy-io/node/viem";
import { config } from "dotenv";
import {
  createPublicClient,
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
  const value = process.env[key];
  if (!value) {
    console.error(`[wallet-ops] Missing env: ${key}`);
    process.exit(1);
  }
  return value;
}

function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function requireWriteAck(): void {
  if (!argFlag("yes-real-money")) {
    console.error("[wallet-ops] Refusing write without --yes-real-money.");
    process.exit(1);
  }
}

async function buildContext() {
  const appId = requireEnv("PRIVY_APP_ID");
  const appSecret = requireEnv("PRIVY_APP_SECRET");
  const signingKey = requireEnv("PRIVY_SIGNING_KEY");
  const expectedAddress = requireEnv("OPERATOR_WALLET_ADDRESS") as Hex;
  const creds: ApiKeyCreds = {
    key: requireEnv("POLY_CLOB_API_KEY"),
    secret: requireEnv("POLY_CLOB_API_SECRET"),
    passphrase: requireEnv("POLY_CLOB_PASSPHRASE"),
  };

  const privy = new PrivyClient({ appId, appSecret });
  let walletId: string | undefined;
  for await (const wallet of privy.wallets().list()) {
    if (wallet.address.toLowerCase() === expectedAddress.toLowerCase()) {
      walletId = wallet.id;
      break;
    }
  }
  if (!walletId) {
    console.error(
      `[wallet-ops] FAIL: no Privy wallet matches ${expectedAddress}`
    );
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
    transport: http(process.env.POLYGON_RPC_URL),
  });
  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(process.env.POLYGON_RPC_URL),
  });

  return {
    account,
    adapter: new PolymarketClobAdapter({
      signer: walletClient,
      creds,
      funderAddress: expectedAddress,
      host: process.env.POLY_CLOB_HOST ?? DEFAULT_CLOB_HOST,
    }),
    address: expectedAddress,
    dataApi: new PolymarketDataApiClient(),
    publicClient,
    walletClient,
  };
}

async function cmdPositions(): Promise<void> {
  const { address, dataApi } = await buildContext();
  const positions = await dataApi.listUserPositions(address);
  console.log(
    JSON.stringify(
      {
        wallet: address,
        count: positions.length,
        positions: positions.map((p) => ({
          title: p.title,
          conditionId: p.conditionId,
          tokenId: p.asset,
          outcome: p.outcome,
          size: p.size,
          curPrice: p.curPrice,
          redeemable: p.redeemable,
          negativeRisk: p.negativeRisk,
        })),
      },
      null,
      2
    )
  );
}

async function cmdOpenOrders(): Promise<void> {
  const { adapter, address } = await buildContext();
  const orders = await adapter.listOpenOrders();
  console.log(
    JSON.stringify({ wallet: address, count: orders.length, orders }, null, 2)
  );
}

async function cmdRedeemAll(): Promise<void> {
  requireWriteAck();
  const { account, address, dataApi, publicClient, walletClient } =
    await buildContext();
  const positions = await dataApi.listUserPositions(address);
  const redeemable = Array.from(
    new Map(
      positions
        .filter((position) => position.redeemable && position.conditionId)
        .map((position) => [position.conditionId, position])
    ).values()
  );

  console.log(
    `[wallet-ops] redeem sweep wallet=${address} conditions=${redeemable.length}`
  );

  const results: Array<{
    title: string | null;
    condition_id: string;
    tx_hash: `0x${string}`;
    status: string;
  }> = [];

  for (const position of redeemable) {
    const normalized = normalizePolygonConditionId(position.conditionId);
    console.log(
      `[wallet-ops] redeeming ${position.title ?? "(untitled)"} :: ${position.conditionId}`
    );
    const hash = await walletClient.writeContract({
      address: POLYGON_CONDITIONAL_TOKENS,
      abi: polymarketCtfRedeemAbi,
      functionName: "redeemPositions",
      args: [
        POLYGON_USDC_E,
        PARENT_COLLECTION_ID_ZERO,
        normalized,
        [...BINARY_REDEEM_INDEX_SETS],
      ],
      chain: polygon,
      account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    results.push({
      title: position.title ?? null,
      condition_id: position.conditionId,
      tx_hash: hash,
      status: receipt.status,
    });
    console.log(
      `[wallet-ops]   tx=${hash} status=${receipt.status} block=${receipt.blockNumber}`
    );
    if (receipt.status !== "success") {
      console.error(
        `[wallet-ops] redeem failed for condition ${position.conditionId}`
      );
      process.exit(1);
    }
  }

  console.log(`REDEEM_RESULTS=${JSON.stringify(results, null, 2)}`);
}

function findPositionOrExit(
  positions: readonly PolymarketUserPosition[],
  tokenId: string
): PolymarketUserPosition {
  const match = positions.find((position) => position.asset === tokenId);
  if (!match || match.size <= 0) {
    console.error(`[wallet-ops] No open position for token ${tokenId}`);
    process.exit(1);
  }
  return match;
}

async function cmdClosePosition(): Promise<void> {
  requireWriteAck();
  const tokenId = argValue("token-id");
  if (!tokenId) {
    console.error(
      "[wallet-ops] close-position requires --token-id <polymarket-token-id>"
    );
    process.exit(1);
  }

  const { adapter, address, dataApi } = await buildContext();
  const positions = await dataApi.listUserPositions(address);
  const position = findPositionOrExit(positions, tokenId);
  const positionValueUsdc = position.size * position.curPrice;
  const maxSizeUsdc = Number(
    argValue("max-size-usdc") ?? String(positionValueUsdc)
  );
  const limitPrice = Number(
    argValue("limit-price") ?? String(Math.max(0.001, position.curPrice - 0.01))
  );

  if (!Number.isFinite(maxSizeUsdc) || maxSizeUsdc <= 0) {
    console.error(`[wallet-ops] Invalid max size: ${maxSizeUsdc}`);
    process.exit(1);
  }
  if (!Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice >= 1) {
    console.error(`[wallet-ops] Invalid limit price: ${limitPrice}`);
    process.exit(1);
  }

  const clientOrderId = keccak256(
    stringToHex(`wallet-ops:close:${Date.now()}:${tokenId}`)
  );

  console.log(
    `[wallet-ops] closing token=${tokenId} outcome=${position.outcome ?? "?"} max_usdc=${maxSizeUsdc} limit=${limitPrice}`
  );

  const receipt = await adapter.placeOrder({
    provider: "polymarket",
    market_id: `prediction-market:polymarket:${position.conditionId}`,
    outcome: position.outcome ?? "",
    side: "SELL",
    size_usdc: Math.min(maxSizeUsdc, positionValueUsdc),
    limit_price: limitPrice,
    client_order_id: clientOrderId,
    attributes: { token_id: tokenId },
  });

  console.log(JSON.stringify(receipt, null, 2));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case "positions":
      await cmdPositions();
      return;
    case "open-orders":
      await cmdOpenOrders();
      return;
    case "redeem-all":
      await cmdRedeemAll();
      return;
    case "close-position":
      await cmdClosePosition();
      return;
    default:
      console.error(
        "Usage:\n" +
          "  pnpm tsx scripts/experiments/privy-wallet-ops.ts positions\n" +
          "  pnpm tsx scripts/experiments/privy-wallet-ops.ts open-orders\n" +
          "  pnpm tsx scripts/experiments/privy-wallet-ops.ts redeem-all --yes-real-money\n" +
          "  pnpm tsx scripts/experiments/privy-wallet-ops.ts close-position --token-id <id> [--max-size-usdc <n>] [--limit-price <n>] --yes-real-money"
      );
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("[wallet-ops] unhandled:", err);
  process.exit(1);
});
