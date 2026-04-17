// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket/clob`
 * Purpose: Polymarket CLOB Run-phase adapter — place / cancel / status orders via `@polymarket/clob-client`.
 * Scope: Trade-only adapter. Constructor injects a `ClobSigner` (viem WalletClient) + L2 API creds + host + chainId + funder EOA. Does not list markets (use the Gamma `PolymarketAdapter` for reads). Does not load env, does not create the signer, does not know about Privy.
 * Invariants:
 *   - PACKAGES_NO_ENV — all config via constructor.
 *   - SIGNER_VIA_LOCAL_ACCOUNT — caller passes a viem `LocalAccount` wrapped in a `WalletClient`. No custom signer port.
 *   - EOA_PATH_ONLY — signatureType defaults to `SignatureType.EOA`. Safe-proxy accounts are out of scope (see task.0315 Phase 1 "Custody model").
 * Side-effects: IO (HTTPS to the Polymarket CLOB).
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP3.2)
 * @public
 */

import {
  type ApiKeyCreds,
  Chain,
  ClobClient,
  type ClobSigner,
  OrderType,
  Side,
  SignatureType,
} from "@polymarket/clob-client";

import type { OrderIntent, OrderReceipt } from "../../domain/order.js";
import type {
  ListMarketsParams,
  NormalizedMarket,
} from "../../domain/schemas.js";
import type { MarketProviderPort } from "../../port/market-provider.port.js";

/** Default Polymarket CLOB host. */
const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

export interface PolymarketClobAdapterConfig {
  /** viem `WalletClient` (or ethers v5 `Signer`) — holds the Polymarket EOA. */
  signer: ClobSigner;
  /** L2 API creds from `createOrDeriveApiKey` (task.0315 CP2.5). */
  creds: ApiKeyCreds;
  /** Funder EOA — for EOA-path accounts this equals the signer address. */
  funderAddress: `0x${string}`;
  /** Override CLOB host (default: https://clob.polymarket.com). */
  host?: string;
  /** Chain id — defaults to Polygon mainnet (137). */
  chainId?: Chain;
  /** Signature type — defaults to EOA. Safe-proxy path is out of scope for P1. */
  signatureType?: SignatureType;
}

/**
 * Polymarket CLOB Run-phase adapter.
 *
 * Conversions:
 *   - OrderIntent.size_usdc (USDC dollars) → CLOB `size` (outcome shares): `size_usdc / limit_price`.
 *   - OrderIntent.attributes.token_id (Polymarket ERC-1155 asset id) → CLOB `tokenID`. Required.
 *   - Polymarket CLOB `OrderResponse.status` → canonical `OrderStatus` via small mapping.
 *
 * NOT wired:
 *   - `listMarkets` — throws; use the Gamma `PolymarketAdapter` for reads.
 *   - Server-side `client_order_id` dedupe — Polymarket's CLOB does not accept a
 *     caller-supplied idempotency key, so the receipt's `client_order_id` echoes
 *     the intent verbatim and the caller's PK (`poly_copy_trade_fills`) is the
 *     sole dedupe gate. See task.0315 `IDEMPOTENT_BY_CLIENT_ID`.
 */
export class PolymarketClobAdapter implements MarketProviderPort {
  readonly provider = "polymarket" as const;
  private readonly client: ClobClient;
  private readonly funderAddress: `0x${string}`;

  constructor(config: PolymarketClobAdapterConfig) {
    this.funderAddress = config.funderAddress;
    this.client = new ClobClient(
      config.host ?? DEFAULT_CLOB_HOST,
      config.chainId ?? Chain.POLYGON,
      config.signer,
      config.creds,
      config.signatureType ?? SignatureType.EOA,
      config.funderAddress
    );
  }

  listMarkets(_params?: ListMarketsParams): Promise<NormalizedMarket[]> {
    return Promise.reject(
      new Error(
        "PolymarketClobAdapter does not implement listMarkets — use the Gamma PolymarketAdapter for reads."
      )
    );
  }

  async placeOrder(intent: OrderIntent): Promise<OrderReceipt> {
    const tokenId = readStringAttribute(intent, "token_id");
    if (!tokenId) {
      throw new Error(
        "PolymarketClobAdapter.placeOrder requires intent.attributes.token_id (ERC-1155 asset id)."
      );
    }

    const shareSize = intent.size_usdc / intent.limit_price;
    const side = intent.side === "BUY" ? Side.BUY : Side.SELL;

    // B1 — fetch per-market tickSize + negRisk rather than hardcoding. Polymarket has
    // markets with 0.001 / 0.0001 tick sizes, and neg-risk markets route through a
    // different Exchange contract; a stale hardcode silently produces bad signatures.
    const [tickSize, negRisk] = await Promise.all([
      this.client.getTickSize(tokenId),
      this.client.getNegRisk(tokenId),
    ]);

    const postOnly = intent.attributes?.post_only === true;

    const response: unknown = await this.client.createAndPostOrder(
      {
        tokenID: tokenId,
        price: intent.limit_price,
        size: shareSize,
        side,
        feeRateBps: 0,
      },
      { tickSize, negRisk },
      OrderType.GTC,
      /* deferExec */ undefined,
      /* postOnly */ postOnly || undefined
    );

    return mapOrderResponseToReceipt(response, intent);
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.client.cancelOrder({ orderID: orderId });
  }

  async getOrder(orderId: string): Promise<OrderReceipt> {
    const open = await this.client.getOrder(orderId);
    return mapOpenOrderToReceipt(open);
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers (exported for unit tests)
// ---------------------------------------------------------------------------

function readStringAttribute(
  intent: OrderIntent,
  key: string
): string | undefined {
  const value = intent.attributes?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Normalize a Polymarket CLOB status string to the canonical `OrderStatus`.
 * Polymarket's live statuses include: `live`, `unmatched`, `matched`, `canceled`,
 * `error`, etc. Unknown values collapse to `pending`; the raw string is preserved
 * on the receipt under `attributes.rawStatus` for debugging.
 */
export function normalizePolymarketStatus(raw: string): OrderReceipt["status"] {
  const lowered = raw.toLowerCase();
  if (lowered === "filled" || lowered === "matched") return "filled";
  if (lowered === "live" || lowered === "placed" || lowered === "unmatched")
    return "open";
  if (lowered === "canceled" || lowered === "cancelled") return "canceled";
  if (lowered === "error" || lowered === "failed") return "error";
  if (lowered.includes("partial")) return "partial";
  return "pending";
}

interface ClobOrderResponseLike {
  orderID?: string;
  status?: string;
  success?: boolean;
  errorMsg?: string;
  makingAmount?: string;
  takingAmount?: string;
  transactionsHashes?: string[];
}

export function mapOrderResponseToReceipt(
  response: unknown,
  intent: OrderIntent
): OrderReceipt {
  const r = response as ClobOrderResponseLike;
  // B2 — Polymarket returns `{success: false, errorMsg, orderID: "..."}` for
  // rejections (orderID can be populated even when the order was not accepted).
  // Treat an explicit `success === false` as a hard failure regardless of orderID.
  if (r.success === false || !r.orderID) {
    throw new Error(
      `PolymarketClobAdapter.placeOrder: CLOB rejected order (success=${String(r.success)}, orderID=${r.orderID ?? "<missing>"}, errorMsg="${r.errorMsg ?? ""}")`
    );
  }

  const rawStatus = r.status ?? "pending";
  const status = normalizePolymarketStatus(rawStatus);

  // For BUY, makingAmount is USDC paid; for SELL it's shares delivered (takingAmount is USDC).
  const filledUsdcAtomic =
    intent.side === "BUY" ? r.makingAmount : r.takingAmount;
  const filled_size_usdc = filledUsdcAtomic
    ? Number(filledUsdcAtomic) / 1_000_000
    : 0;

  return {
    order_id: r.orderID,
    client_order_id: intent.client_order_id,
    status,
    filled_size_usdc,
    submitted_at: new Date().toISOString(),
    attributes: {
      rawStatus,
      success: r.success,
      transactionsHashes: r.transactionsHashes ?? [],
    },
  };
}

interface ClobOpenOrderLike {
  id: string;
  status: string;
  side: string;
  original_size: string;
  size_matched: string;
  price: string;
}

export function mapOpenOrderToReceipt(open: ClobOpenOrderLike): OrderReceipt {
  const status = normalizePolymarketStatus(open.status);
  // size_matched is in outcome shares; convert back to USDC notional.
  const priceNum = Number(open.price);
  const matchedShares = Number(open.size_matched);
  const filled_size_usdc = Number.isFinite(priceNum * matchedShares)
    ? priceNum * matchedShares
    : 0;

  return {
    order_id: open.id,
    client_order_id: open.id, // no separate client_order_id on the platform receipt
    status,
    filled_size_usdc,
    submitted_at: new Date().toISOString(),
    attributes: {
      rawStatus: open.status,
      side: open.side,
      originalSize: open.original_size,
      sizeMatched: open.size_matched,
      price: open.price,
    },
  };
}
