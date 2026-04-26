// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/poly-data-value`
 * Purpose: AI tool — cheap wallet-value probe via `GET /value`.
 * Scope: Read-only. Used as a pre-filter before heavier /positions + /activity calls. Does not place trades, does not load env.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_READ_ONLY, USER_PARAM_IS_PROXY_WALLET, NO_LANGCHAIN_IMPORT.
 * Side-effects: IO (capability)
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @public
 */

import { z } from "zod";

import type { PolyDataCapability } from "../capabilities/poly-data";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

const PolyAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be 0x-prefixed 40-hex proxy-wallet");

export const PolyDataValueInputSchema = z.object({
  user: PolyAddressSchema.describe(
    "Polymarket proxy-wallet (Safe) address, NOT the signing EOA."
  ),
  market: z
    .string()
    .optional()
    .describe("Optional conditionId to restrict to one market."),
});
export type PolyDataValueInput = z.infer<typeof PolyDataValueInputSchema>;

export const PolyDataValueOutputSchema = z.object({
  user: z.string(),
  valueUsdc: z.number(),
  computedAt: z.string(),
});
export type PolyDataValueOutput = z.infer<typeof PolyDataValueOutputSchema>;
export type PolyDataValueRedacted = PolyDataValueOutput;

export const POLY_DATA_VALUE_NAME = "core__poly_data_value" as const;

export const polyDataValueContract: ToolContract<
  typeof POLY_DATA_VALUE_NAME,
  PolyDataValueInput,
  PolyDataValueOutput,
  PolyDataValueRedacted
> = {
  name: POLY_DATA_VALUE_NAME,
  description:
    "Get the current total USDC value of a Polymarket wallet's open positions. " +
    "CHEAP pre-filter before calling `core__poly_data_positions` / `core__poly_data_activity` — " +
    "use this to drop sub-$1k wallets before heavier profile calls. " +
    "Excludes realized PnL. `user` MUST be the proxy-wallet, not the signing EOA.",
  effect: "read_only",
  inputSchema: PolyDataValueInputSchema,
  outputSchema: PolyDataValueOutputSchema,
  redact: (out) => out,
  allowlist: ["user", "valueUsdc", "computedAt"] as const,
};

export interface PolyDataValueDeps {
  polyDataCapability: PolyDataCapability;
}

export function createPolyDataValueImplementation(
  deps: PolyDataValueDeps
): ToolImplementation<PolyDataValueInput, PolyDataValueOutput> {
  return {
    execute: async (input) =>
      deps.polyDataCapability.getValue({
        user: input.user,
        ...(input.market !== undefined && { market: input.market }),
      }),
  };
}

export const polyDataValueStubImplementation: ToolImplementation<
  PolyDataValueInput,
  PolyDataValueOutput
> = {
  execute: async (input) => ({
    user: input.user,
    valueUsdc: 0,
    computedAt: new Date(0).toISOString(),
  }),
};

export const polyDataValueBoundTool: BoundTool<
  typeof POLY_DATA_VALUE_NAME,
  PolyDataValueInput,
  PolyDataValueOutput,
  PolyDataValueRedacted
> = {
  contract: polyDataValueContract,
  implementation: polyDataValueStubImplementation,
};
