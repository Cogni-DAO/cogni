// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools/tools/poly-cancel-order`
 * Purpose: AI tool that cancels ONE open Polymarket CLOB order by id via PolyTradeCapability.cancelOrder. Companion to place_trade + list_orders; closes the prototype's C/R/D loop (Polymarket has no update op — cancel-and-replace only).
 * Scope: Tool contract + factory + stub. Pure package. Does not read env, does not import `@polymarket/clob-client`, does not access any adapter directly.
 * Invariants: TOOL_ID_NAMESPACED (core__poly_cancel_order), EFFECT_TYPED (state_change), REDACTION_REQUIRED, NO_LANGCHAIN, CAPABILITY_NOT_ADAPTER.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "@cogni/ai-tools";
import type { PolyTradeCapability } from "./poly-place-trade";

export const PolyCancelOrderInputSchema = z.object({
  order_id: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .describe(
      "Polymarket CLOB order id to cancel — 0x-prefixed 64 hex chars. Get from core__poly_list_orders or a prior place receipt."
    ),
});
export type PolyCancelOrderInput = z.infer<typeof PolyCancelOrderInputSchema>;

export const PolyCancelOrderOutputSchema = z.object({
  order_id: z.string().min(1),
  canceled: z.literal(true),
});
export type PolyCancelOrderOutput = z.infer<typeof PolyCancelOrderOutputSchema>;

export type PolyCancelOrderRedacted = PolyCancelOrderOutput;

export const POLY_CANCEL_ORDER_NAME = "core__poly_cancel_order" as const;

export const polyCancelOrderContract: ToolContract<
  typeof POLY_CANCEL_ORDER_NAME,
  PolyCancelOrderInput,
  PolyCancelOrderOutput,
  PolyCancelOrderRedacted
> = {
  name: POLY_CANCEL_ORDER_NAME,
  description:
    "Cancel ONE open Polymarket CLOB order on the Cogni operator wallet by its order_id. " +
    "Idempotent: Polymarket's CLOB treats an already-canceled / already-filled id as a no-op success. " +
    "Use this before placing a replacement order (Polymarket has no price/size update primitive).",
  effect: "state_change",
  inputSchema: PolyCancelOrderInputSchema,
  outputSchema: PolyCancelOrderOutputSchema,
  redact: (output: PolyCancelOrderOutput): PolyCancelOrderRedacted => output,
  allowlist: ["order_id", "canceled"] as const,
};

export interface PolyCancelOrderDeps {
  polyTradeCapability: PolyTradeCapability;
}

export function createPolyCancelOrderImplementation(
  deps: PolyCancelOrderDeps
): ToolImplementation<PolyCancelOrderInput, PolyCancelOrderOutput> {
  return {
    execute: async (
      input: PolyCancelOrderInput
    ): Promise<PolyCancelOrderOutput> => {
      await deps.polyTradeCapability.cancelOrder(input.order_id);
      return { order_id: input.order_id, canceled: true };
    },
  };
}

export const polyCancelOrderStubImplementation: ToolImplementation<
  PolyCancelOrderInput,
  PolyCancelOrderOutput
> = {
  execute: async (): Promise<PolyCancelOrderOutput> => {
    throw new Error(
      "core__poly_cancel_order stub invoked — container did not inject PolyTradeCapability. " +
        "Verify POLY_CLOB_* + POLY_PROTO_* are configured on this pod."
    );
  },
};

export const polyCancelOrderBoundTool: BoundTool<
  typeof POLY_CANCEL_ORDER_NAME,
  PolyCancelOrderInput,
  PolyCancelOrderOutput,
  PolyCancelOrderRedacted
> = {
  contract: polyCancelOrderContract,
  implementation: polyCancelOrderStubImplementation,
};
