// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools/tools/poly-place-trade`
 * Purpose: AI tool that places ONE Polymarket CLOB BUY order through a PolyTradeCapability. Any registered agent with poly-brain tools can invoke it; the capability uses the hardcoded operator EOA on the server side. Prototype scope — no per-user auth, no per-target routing.
 * Scope: Tool contract + capability interface + factory + stub. Pure package. Does not read env, does not load `@polymarket/clob-client`, does not know the operator wallet address. Returns the CLOB `order_id` + a Polymarket-profile URL the caller can surface to the user.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: id is `core__poly_place_trade`
 *   - EFFECT_TYPED: effect is `external_side_effect` — real money moves on success
 *   - REDACTION_REQUIRED: allowlist limited to fields safe for agent surfacing; no client secrets
 *   - NO_LANGCHAIN: no LangChain imports
 *   - PLACE_TRADE_IS_BUY_ONLY: `placeTrade` on the capability rejects SELL (agent-safety). The coordinator/reconciler use `closePosition` which lifts this restriction for autonomous exit.
 *   - CAPABILITY_NOT_ADAPTER: the tool talks to `PolyTradeCapability`, never `PolymarketClobAdapter` directly
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.25), work/items/task.0323.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "@cogni/ai-tools";

// ─────────────────────────────────────────────────────────────────────────────
// Capability interface (injected at runtime)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Placement request handed to the capability. The tool populates every field
 * from validated user input; the capability is responsible for the
 * `client_order_id` idempotency key (generated via the pinned
 * `clientOrderIdFor` helper from `@cogni/market-provider` so that any future
 * caller — this tool, CP4.3's autonomous poll, a P4 WS ingester — produces
 * compatible keys for the `poly_copy_trade_fills` PK) as well as orderbook
 * lookups (tickSize / negRisk / feeRateBps), signing, and CLOB submission.
 */
export interface PolyPlaceTradeRequest {
  /** Polymarket conditionId (binary-market id), 0x-prefixed 64 hex. */
  conditionId: string;
  /** ERC-1155 asset id of the outcome token to buy (the YES or NO side). */
  tokenId: string;
  /** Human outcome label for the receipt (e.g. "Yes", "Ann Li"). */
  outcome: string;
  /** `BUY` only; the capability rejects `SELL` until CTF approval is wired. */
  side: "BUY";
  /** Notional USDC to spend (shares are derived as `size_usdc / limit_price`). */
  size_usdc: number;
  /** Limit price on the outcome share, strictly in (0, 1). */
  limit_price: number;
}

/**
 * Receipt surfaced back to the agent. Shape is a strict subset of the
 * market-provider `OrderReceipt` so poly-brain's LLM can narrate it cleanly.
 */
export interface PolyPlaceTradeReceipt {
  order_id: string;
  client_order_id: string;
  status: "pending" | "open" | "filled" | "partial" | "canceled" | "error";
  filled_size_usdc: number;
  submitted_at: string;
  /** Polymarket profile URL for the Cogni operator EOA — agents link the user here. */
  profile_url: string;
}

/**
 * One open order surfaced to the agent. Narrow subset of the market-provider
 * `OrderReceipt` plus the market/token ids so the LLM can cross-reference.
 */
export interface PolyOpenOrder {
  order_id: string;
  status: "pending" | "open" | "filled" | "partial" | "canceled" | "error";
  side: "BUY" | "SELL";
  market: string;
  token_id: string;
  outcome: string;
  price: number;
  original_size_shares: number;
  filled_size_shares: number;
  created_at: number;
}

/**
 * Optional server-side filter for `listOpenOrders`. When omitted, returns
 * every open order on the operator EOA.
 */
export interface PolyListOpenOrdersRequest {
  token_id?: string;
  market?: string;
}

/**
 * Request to close an open position. Coordinator/reconciler use this path;
 * agents use the dedicated `core__poly_close_position` tool which calls here.
 */
export interface PolyClosePositionRequest {
  /** ERC-1155 asset id (token) whose position to close. */
  tokenId: string;
  /** Notional USDC cap. Actual size = min(cap, position market value). */
  max_size_usdc: number;
  /** Limit price; defaults to aggressive take-bid pricing if omitted. */
  limit_price?: number;
}

/**
 * Minimal capability the poly-app container wires. The real implementation
 * (in `bootstrap/capabilities/poly-trade.ts`) injects the Privy signer + CLOB
 * adapter; the tool layer never sees those.
 */
export interface PolyTradeCapability {
  placeTrade(request: PolyPlaceTradeRequest): Promise<PolyPlaceTradeReceipt>;
  listOpenOrders(request?: PolyListOpenOrdersRequest): Promise<PolyOpenOrder[]>;
  cancelOrder(orderId: string): Promise<void>;
  /** Close an open position via SELL. Routes through `bundle.closePosition`. */
  closePosition(
    request: PolyClosePositionRequest
  ): Promise<PolyPlaceTradeReceipt>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input / output schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agents supply market + side + size + price. The tool generates the
 * `client_order_id` deterministically per invocation (not LLM-supplied — avoids
 * hallucinated collisions) and hands the full request to the capability.
 */
export const PolyPlaceTradeInputSchema = z.object({
  conditionId: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .describe(
      "Polymarket conditionId — 0x-prefixed 64 hex chars. Use core__market_list or " +
        "core__wallet_top_traders output to find it."
    ),
  tokenId: z
    .string()
    .min(1)
    .describe(
      "ERC-1155 asset id (decimal string) for the outcome token you want to BUY. " +
        "For binary markets this is the YES or NO token — pick the one matching your thesis."
    ),
  outcome: z
    .string()
    .min(1)
    .describe(
      "Human outcome label for the token (e.g., 'Yes', 'Ann Li'). Surfaced on the receipt."
    ),
  size_usdc: z
    .number()
    .positive()
    .max(25)
    .describe(
      "Notional USDC to spend, capped at 25 USDC per trade in this prototype. " +
        "Polymarket standard markets enforce a ~$1 min; neg-risk markets ~$5."
    ),
  limit_price: z
    .number()
    .gt(0)
    .lt(1)
    .describe(
      "Limit price on the outcome share, strictly between 0 and 1. " +
        "To take immediately against the book, use best_ask; to rest, use a price below best_bid."
    ),
});
export type PolyPlaceTradeInput = z.infer<typeof PolyPlaceTradeInputSchema>;

export const PolyPlaceTradeOrderStatusSchema = z.enum([
  "pending",
  "open",
  "filled",
  "partial",
  "canceled",
  "error",
]);

export const PolyPlaceTradeOutputSchema = z.object({
  order_id: z
    .string()
    .min(1)
    .describe("Platform-assigned CLOB order id (0x-prefixed hex)."),
  client_order_id: z
    .string()
    .min(1)
    .describe("Echoes the idempotency key the tool generated."),
  status: PolyPlaceTradeOrderStatusSchema.describe(
    "Canonical status. 'open' = resting on book; 'filled' = fully matched; 'error' = rejected."
  ),
  filled_size_usdc: z
    .number()
    .min(0)
    .describe("Cumulative filled notional in USDC at receipt time."),
  submitted_at: z.string().describe("ISO-8601 timestamp."),
  profile_url: z
    .string()
    .url()
    .describe(
      "Polymarket profile URL for the Cogni operator wallet — share with the user to view the live position."
    ),
});
export type PolyPlaceTradeOutput = z.infer<typeof PolyPlaceTradeOutputSchema>;

export type PolyPlaceTradeRedacted = PolyPlaceTradeOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const POLY_PLACE_TRADE_NAME = "core__poly_place_trade" as const;

export const polyPlaceTradeContract: ToolContract<
  typeof POLY_PLACE_TRADE_NAME,
  PolyPlaceTradeInput,
  PolyPlaceTradeOutput,
  PolyPlaceTradeRedacted
> = {
  name: POLY_PLACE_TRADE_NAME,
  description:
    "Place ONE BUY order on Polymarket through the Cogni operator wallet. " +
    "Input: conditionId + tokenId (ERC-1155 asset) + outcome label + size_usdc (≤25) + limit_price (0,1). " +
    "Returns the real CLOB order_id + a Polymarket profile URL to track the position. " +
    "This spends real USDC — only call when the user has explicitly asked to place a trade with specific parameters. " +
    "Use core__wallet_top_traders or external sources to gather the conditionId and tokenId beforehand.",
  effect: "external_side_effect",
  inputSchema: PolyPlaceTradeInputSchema,
  outputSchema: PolyPlaceTradeOutputSchema,
  redact: (output: PolyPlaceTradeOutput): PolyPlaceTradeRedacted => output,
  allowlist: [
    "order_id",
    "client_order_id",
    "status",
    "filled_size_usdc",
    "submitted_at",
    "profile_url",
  ] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation factory (capability-injected)
// ─────────────────────────────────────────────────────────────────────────────

export interface PolyPlaceTradeDeps {
  polyTradeCapability: PolyTradeCapability;
}

/**
 * The tool does not generate `client_order_id` — that's the capability's job,
 * using the pinned `clientOrderIdFor` helper from `@cogni/market-provider`.
 * Keeping the key generation at the capability layer ensures the tool, CP4.3's
 * autonomous poll, and any future WS ingester all write compatible keys into
 * `poly_copy_trade_fills` (composite PK dedupe depends on it).
 */
export function createPolyPlaceTradeImplementation(
  deps: PolyPlaceTradeDeps
): ToolImplementation<PolyPlaceTradeInput, PolyPlaceTradeOutput> {
  return {
    execute: async (
      input: PolyPlaceTradeInput
    ): Promise<PolyPlaceTradeOutput> => {
      return await deps.polyTradeCapability.placeTrade({
        conditionId: input.conditionId,
        tokenId: input.tokenId,
        outcome: input.outcome,
        side: "BUY",
        size_usdc: input.size_usdc,
        limit_price: input.limit_price,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub (catalog registration — replaced at runtime by the real impl)
// ─────────────────────────────────────────────────────────────────────────────

export const polyPlaceTradeStubImplementation: ToolImplementation<
  PolyPlaceTradeInput,
  PolyPlaceTradeOutput
> = {
  execute: async (): Promise<PolyPlaceTradeOutput> => {
    throw new Error(
      "core__poly_place_trade stub invoked — container did not inject PolyTradeCapability. " +
        "Verify POLY_CLOB_* + POLY_PROTO_* are configured on this pod."
    );
  },
};

export const polyPlaceTradeBoundTool: BoundTool<
  typeof POLY_PLACE_TRADE_NAME,
  PolyPlaceTradeInput,
  PolyPlaceTradeOutput,
  PolyPlaceTradeRedacted
> = {
  contract: polyPlaceTradeContract,
  implementation: polyPlaceTradeStubImplementation,
};
