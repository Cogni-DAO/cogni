// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/copy-top-wallet-rehearsal`
 * Purpose: task.0315 Phase 1 CP3.2 dress rehearsal — discover a recent BUY from a top-leaderboard wallet, then mirror it with the minimum-legal size as a post-only GTC BUY at tick_size (cannot match). Produces a real order_id from the prod Polymarket CLOB as evidence, at minimal economic exposure.
 * Scope: Reads env + Polymarket Data API, inspects the orderbook, signs via Privy-backed viem WalletClient, places one post-only order, asserts filled=0, cancels. Does not write to the DB, does not invoke decide(), does not leave an open position.
 * Invariants: Polygon chainId 137; post-only enforced; filled_size_usdc must be 0 at receipt time (hard assert); --yes-real-money required.
 * Side-effects: IO (reads .env.local; HTTPS to Polymarket Data API + CLOB; Privy HSM sign; one real post-only order placement + one cancel).
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (CP3.2 dress rehearsal)
 * @internal — experiment code, not shipped to production
 */

import path from "node:path";
import {
  type ApiKeyCreds,
  PolymarketClobAdapter,
  PolymarketDataApiClient,
  type PolymarketUserTrade,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { ClobClient, type OrderBookSummary } from "@polymarket/clob-client";
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
    console.error(`[rehearsal] Missing env: ${key}`);
    process.exit(1);
  }
  return v;
}

const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

interface PickedTrade {
  wallet: string;
  userName: string;
  trade: PolymarketUserTrade;
}

/** Walk top-VOL wallets (this week) and find the most recent BUY across all of them. */
async function findRecentBuyFromTopWallet(
  data: PolymarketDataApiClient,
  walletsToScan: number
): Promise<PickedTrade> {
  const leaderboard = await data.listTopTraders({
    timePeriod: "WEEK",
    orderBy: "VOL",
    limit: walletsToScan,
  });
  console.log(`[rehearsal] Leaderboard (WEEK/VOL, top ${leaderboard.length}):`);
  for (const row of leaderboard) {
    console.log(
      `  #${row.rank.padStart(2, " ")}  ${row.proxyWallet}  vol=$${Math.round(row.vol).toLocaleString()}  pnl=$${Math.round(row.pnl).toLocaleString()}  ${row.userName || "(no handle)"}`
    );
  }

  let best: PickedTrade | null = null;
  for (const row of leaderboard) {
    let trades: PolymarketUserTrade[];
    try {
      trades = await data.listUserActivity(row.proxyWallet, { limit: 50 });
    } catch (err) {
      console.warn(
        `[rehearsal] listUserActivity failed for ${row.proxyWallet}: ${String(err)}`
      );
      continue;
    }

    // Most recent BUY (SELL requires CTF setApprovalForAll on our EOA; out of scope).
    const buy = trades
      .filter((t) => t.side === "BUY" && t.price > 0.02 && t.price < 0.98)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!buy) continue;
    if (!best || buy.timestamp > best.trade.timestamp) {
      best = {
        wallet: row.proxyWallet,
        userName: row.userName ?? "",
        trade: buy,
      };
    }
  }

  if (!best) {
    throw new Error(
      "[rehearsal] Could not find any recent BUY in the top wallets' activity. Try raising walletsToScan."
    );
  }
  return best;
}

function parseNumericString(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`[rehearsal] invalid ${label}: "${raw}"`);
  }
  return n;
}

interface PlacementPlan {
  limit_price: number;
  size_usdc: number;
  sharesEquivalent: number;
  minOrderSize: number;
  tickSize: number;
  negRisk: boolean;
  bestBid: number | null;
  bestAsk: number | null;
}

function planMinimumPostOnlyBuy(book: OrderBookSummary): PlacementPlan {
  const tickSize = parseNumericString(book.tick_size, "tick_size");
  const minOrderSize = parseNumericString(
    book.min_order_size,
    "min_order_size"
  );

  const bids = book.bids
    .map((b) => parseNumericString(b.price, "bid.price"))
    .sort((a, b) => b - a);
  const asks = book.asks
    .map((a) => parseNumericString(a.price, "ask.price"))
    .sort((a, b) => a - b);
  const bestBid = bids[0] ?? null;
  const bestAsk = asks[0] ?? null;

  // Post-only BUY must price STRICTLY below best ask (otherwise it would take).
  // Pricing at tick_size (e.g. 0.01 or 0.001) is far below any realistic active
  // market's ask, so post-only will always allow rest and the order cannot fill.
  // We use exactly tick_size (the smallest valid price) to minimize notional.
  const limit_price = tickSize;

  // Polymarket enforces BOTH a min_order_size (shares, from orderbook) AND a
  // per-exchange min notional (standard = $1, neg-risk = $5, per Polymarket
  // docs). `min_order_size` × `tick_size` = ~$0.005 which is well under $1 and
  // gets rejected with "order size below minimum". Apply a floor:
  const notionalFloorUsdc = book.neg_risk ? 5.0 : 1.0;
  const shareFloor = Math.ceil((notionalFloorUsdc / limit_price) * 1.02);
  const sharesEquivalent = Math.max(Math.ceil(minOrderSize * 1.1), shareFloor);
  const size_usdc = Number((sharesEquivalent * limit_price).toFixed(6));

  return {
    limit_price,
    size_usdc,
    sharesEquivalent,
    minOrderSize,
    tickSize,
    negRisk: book.neg_risk,
    bestBid,
    bestAsk,
  };
}

async function main(): Promise<void> {
  const confirmed = process.argv.includes("--yes-real-money");
  if (!confirmed) {
    console.error(
      "[rehearsal] Refusing to run without --yes-real-money. This places a REAL order on Polymarket mainnet."
    );
    console.error(
      "            Usage: pnpm tsx scripts/experiments/copy-top-wallet-rehearsal.ts --yes-real-money"
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
  const host = process.env.POLY_CLOB_HOST ?? DEFAULT_CLOB_HOST;

  // Step 1 — discover a trade to copy.
  const data = new PolymarketDataApiClient();
  const picked = await findRecentBuyFromTopWallet(data, 25);
  const { trade, wallet, userName } = picked;

  const ageSeconds = Math.floor(Date.now() / 1000) - trade.timestamp;
  console.log("");
  console.log("[rehearsal] Target trade found:");
  console.log(`  top wallet: ${wallet} (${userName || "no handle"})`);
  console.log(`  market:     ${trade.title || "<no title>"}`);
  console.log(`  outcome:    ${trade.outcome}`);
  console.log(`  side:       ${trade.side}`);
  console.log(
    `  their fill: size=${trade.size} @ price=${trade.price} (${ageSeconds}s ago)`
  );
  console.log(`  asset:      ${trade.asset}`);
  console.log(`  conditionId:${trade.conditionId}`);

  // Step 2 — inspect the orderbook for limits.
  const clobRead = new ClobClient(host, 137);
  const book = await clobRead.getOrderBook(trade.asset);
  const plan = planMinimumPostOnlyBuy(book);
  console.log("");
  console.log("[rehearsal] Market microstructure:");
  console.log(
    `  tick_size=${plan.tickSize}  min_order_size=${plan.minOrderSize} shares  neg_risk=${plan.negRisk}`
  );
  console.log(
    `  best_bid=${plan.bestBid ?? "(empty)"}  best_ask=${plan.bestAsk ?? "(empty)"}`
  );
  console.log(
    `  planned order: BUY ${plan.sharesEquivalent} shares @ ${plan.limit_price} = $${plan.size_usdc.toFixed(6)} USDC (post-only, cannot take)`
  );

  if (plan.negRisk) {
    console.warn(
      "[rehearsal] NOTE: neg-risk market — verifyingContract routes through the neg-risk Exchange. " +
        "Allowances approved in CP3.1 cover this contract too."
    );
  }

  // Step 3 — construct wallet + adapter.
  console.log("");
  console.log(`[rehearsal] Resolving Privy wallet for ${expectedAddress}...`);
  const privy = new PrivyClient({
    appId: privyAppId,
    appSecret: privyAppSecret,
  });
  let walletId: string | undefined;
  for await (const w of privy.wallets().list()) {
    if (w.address.toLowerCase() === expectedAddress.toLowerCase()) {
      walletId = w.id;
      break;
    }
  }
  if (!walletId) {
    console.error(
      `[rehearsal] FAIL: no Privy wallet matches ${expectedAddress}`
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
    stringToHex(`rehearsal:${wallet}:${trade.asset}:${Date.now()}`)
  );

  // Step 4 — place the post-only mirror.
  console.log("");
  console.log("[rehearsal] Placing order...");
  const receipt = await adapter.placeOrder({
    provider: "polymarket",
    market_id: `prediction-market:polymarket:${trade.conditionId}`,
    outcome: trade.outcome || "YES",
    side: "BUY",
    size_usdc: plan.size_usdc,
    limit_price: plan.limit_price,
    client_order_id,
    attributes: { token_id: trade.asset, post_only: true },
  });

  console.log(
    `[rehearsal] PLACED order_id=${receipt.order_id} status=${receipt.status} filled=${receipt.filled_size_usdc}`
  );
  console.log(`[rehearsal] receipt: ${JSON.stringify(receipt, null, 2)}`);

  if (receipt.filled_size_usdc > 0) {
    console.error(
      `[rehearsal] FATAL: post-only order reported a fill (filled_size_usdc=${receipt.filled_size_usdc}). Aborting — cancel manually if needed.`
    );
    process.exit(2);
  }

  // Step 5 — cancel (belt-and-suspenders; post-only orders that rest can still sit on the book).
  console.log("[rehearsal] Cancelling the resting post-only order...");
  try {
    await adapter.cancelOrder(receipt.order_id);
    console.log("[rehearsal] Cancel submitted.");
  } catch (err) {
    console.warn(
      `[rehearsal] Cancel RPC failed (order may already be dead): ${String(err)}`
    );
  }

  console.log("");
  console.log("[rehearsal] --- PR evidence ---");
  console.log(
    JSON.stringify(
      {
        target_wallet: wallet,
        target_trade: {
          asset: trade.asset,
          conditionId: trade.conditionId,
          title: trade.title,
          side: trade.side,
          outcome: trade.outcome,
          their_price: trade.price,
          their_size: trade.size,
          age_seconds: ageSeconds,
          transactionHash: trade.transactionHash,
        },
        market_microstructure: {
          tick_size: plan.tickSize,
          min_order_size: plan.minOrderSize,
          neg_risk: plan.negRisk,
          best_bid: plan.bestBid,
          best_ask: plan.bestAsk,
        },
        our_order: {
          order_id: receipt.order_id,
          client_order_id,
          side: "BUY",
          limit_price: plan.limit_price,
          size_usdc: plan.size_usdc,
          shares: plan.sharesEquivalent,
          post_only: true,
        },
        our_receipt: {
          status: receipt.status,
          filled_size_usdc: receipt.filled_size_usdc,
          rawStatus: receipt.attributes?.rawStatus,
        },
      },
      null,
      2
    )
  );
}

main().catch((err: unknown) => {
  console.error("[rehearsal] unhandled error:", err);
  process.exit(1);
});
