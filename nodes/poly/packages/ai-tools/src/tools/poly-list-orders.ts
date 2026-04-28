// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools/tools/poly-list-orders`
 * Purpose: AI tool that lists currently-open Polymarket CLOB orders on the operator wallet via PolyTradeCapability.listOpenOrders. Companion to core__poly_place_trade — lets an agent confirm the state of orders it just placed without waiting for fills.
 * Scope: Tool contract + factory + stub. Pure package. Does not read env, does not import `@polymarket/clob-client`, does not access any adapter directly.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_READ, REDACTION_REQUIRED, NO_LANGCHAIN, CAPABILITY_NOT_ADAPTER.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "@cogni/ai-tools";
import type {
  PolyListOpenOrdersRequest,
  PolyOpenOrder,
  PolyTradeCapability,
} from "./poly-place-trade";

export const PolyListOrdersInputSchema = z.object({
  token_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional: filter to open orders on a single outcome token (ERC-1155 asset id)."
    ),
  market: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional()
    .describe(
      "Optional: filter to open orders on a single conditionId (0x-prefixed 64 hex)."
    ),
});
export type PolyListOrdersInput = z.infer<typeof PolyListOrdersInputSchema>;

const PolyOpenOrderSchema = z.object({
  order_id: z.string().min(1),
  status: z.enum(["pending", "open", "filled", "partial", "canceled", "error"]),
  side: z.enum(["BUY", "SELL"]),
  market: z.string().min(1),
  token_id: z.string().min(1),
  outcome: z.string(),
  price: z.number().min(0).max(1),
  original_size_shares: z.number().min(0),
  filled_size_shares: z.number().min(0),
  created_at: z.number().int().nonnegative(),
});

export const PolyListOrdersOutputSchema = z.object({
  orders: z.array(PolyOpenOrderSchema),
  count: z.number().int().nonnegative(),
});
export type PolyListOrdersOutput = z.infer<typeof PolyListOrdersOutputSchema>;

export type PolyListOrdersRedacted = PolyListOrdersOutput;

export const POLY_LIST_ORDERS_NAME = "core__poly_list_orders" as const;

export const polyListOrdersContract: ToolContract<
  typeof POLY_LIST_ORDERS_NAME,
  PolyListOrdersInput,
  PolyListOrdersOutput,
  PolyListOrdersRedacted
> = {
  name: POLY_LIST_ORDERS_NAME,
  description:
    "List currently-open Polymarket CLOB orders on the Cogni operator wallet. " +
    "Optional filters: token_id (single outcome asset) or market (conditionId). " +
    "Returns order_id, status, side, price, original/filled shares, market + token ids. " +
    "Use this to confirm the state of an order you just placed, or to enumerate resting orders before placing another.",
  effect: "read_only",
  inputSchema: PolyListOrdersInputSchema,
  outputSchema: PolyListOrdersOutputSchema,
  redact: (output: PolyListOrdersOutput): PolyListOrdersRedacted => output,
  allowlist: ["orders", "count"] as const,
};

export interface PolyListOrdersDeps {
  polyTradeCapability: PolyTradeCapability;
}

export function createPolyListOrdersImplementation(
  deps: PolyListOrdersDeps
): ToolImplementation<PolyListOrdersInput, PolyListOrdersOutput> {
  return {
    execute: async (
      input: PolyListOrdersInput
    ): Promise<PolyListOrdersOutput> => {
      const req: PolyListOpenOrdersRequest = {};
      if (input.token_id) req.token_id = input.token_id;
      if (input.market) req.market = input.market;
      const orders: PolyOpenOrder[] =
        await deps.polyTradeCapability.listOpenOrders(
          Object.keys(req).length > 0 ? req : undefined
        );
      return { orders, count: orders.length };
    },
  };
}

export const polyListOrdersStubImplementation: ToolImplementation<
  PolyListOrdersInput,
  PolyListOrdersOutput
> = {
  execute: async (): Promise<PolyListOrdersOutput> => {
    throw new Error(
      "core__poly_list_orders stub invoked — container did not inject PolyTradeCapability. " +
        "Verify POLY_CLOB_* + POLY_PROTO_* are configured on this pod."
    );
  },
};

export const polyListOrdersBoundTool: BoundTool<
  typeof POLY_LIST_ORDERS_NAME,
  PolyListOrdersInput,
  PolyListOrdersOutput,
  PolyListOrdersRedacted
> = {
  contract: polyListOrdersContract,
  implementation: polyListOrdersStubImplementation,
};
