// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/poly-data-positions`
 * Purpose: AI tool — list open Polymarket positions for a wallet (proxy-wallet, not EOA).
 * Scope: Read-only `GET /positions` wrapper via PolyDataCapability. Does not place trades, does not load env.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_READ_ONLY, REDACTION_ALLOWLIST, USER_PARAM_IS_PROXY_WALLET, PAGINATION_CONSISTENT, NO_LANGCHAIN_IMPORT.
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

export const PolyDataPositionsInputSchema = z.object({
  user: PolyAddressSchema.describe(
    "Polymarket proxy-wallet (Safe) address, NOT the signing EOA. Wrong address type silently returns []."
  ),
  market: z
    .string()
    .optional()
    .describe("Optional conditionId (hex) to restrict to a single market."),
  sizeThreshold: z
    .number()
    .nonnegative()
    .optional()
    .describe("Optional minimum position size (USDC)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Rows per page (1-200, default 50)."),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Pagination offset (default 0)."),
});
export type PolyDataPositionsInput = z.infer<
  typeof PolyDataPositionsInputSchema
>;

const PositionEntrySchema = z.object({
  proxyWallet: z.string(),
  asset: z.string(),
  conditionId: z.string(),
  size: z.number(),
  avgPrice: z.number(),
  currentValue: z.number(),
  cashPnl: z.number(),
  percentPnl: z.number(),
  realizedPnl: z.number(),
  title: z.string(),
  eventSlug: z.string(),
  outcome: z.string(),
});

export const PolyDataPositionsOutputSchema = z.object({
  user: z.string(),
  positions: z.array(PositionEntrySchema),
  count: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type PolyDataPositionsOutput = z.infer<
  typeof PolyDataPositionsOutputSchema
>;
export type PolyDataPositionsRedacted = PolyDataPositionsOutput;

export const POLY_DATA_POSITIONS_NAME = "core__poly_data_positions" as const;

export const polyDataPositionsContract: ToolContract<
  typeof POLY_DATA_POSITIONS_NAME,
  PolyDataPositionsInput,
  PolyDataPositionsOutput,
  PolyDataPositionsRedacted
> = {
  name: POLY_DATA_POSITIONS_NAME,
  description:
    "List currently-open Polymarket positions for a wallet. " +
    "IMPORTANT: `user` MUST be the proxy-wallet (Safe) address, not the signing EOA — " +
    "passing an EOA silently returns []. Use `core__poly_data_resolve_username` or the " +
    "leaderboard to get proxy addresses. Paginated; returns current value + unrealized PnL.",
  effect: "read_only",
  inputSchema: PolyDataPositionsInputSchema,
  outputSchema: PolyDataPositionsOutputSchema,
  redact: (out) => out,
  allowlist: ["user", "positions", "count", "hasMore"] as const,
};

export interface PolyDataPositionsDeps {
  polyDataCapability: PolyDataCapability;
}

export function createPolyDataPositionsImplementation(
  deps: PolyDataPositionsDeps
): ToolImplementation<PolyDataPositionsInput, PolyDataPositionsOutput> {
  return {
    execute: async (input) =>
      deps.polyDataCapability.getPositions({
        user: input.user,
        ...(input.market !== undefined && { market: input.market }),
        ...(input.sizeThreshold !== undefined && {
          sizeThreshold: input.sizeThreshold,
        }),
        limit: input.limit ?? 50,
        offset: input.offset ?? 0,
      }),
  };
}

export const polyDataPositionsStubImplementation: ToolImplementation<
  PolyDataPositionsInput,
  PolyDataPositionsOutput
> = {
  execute: async (input) => ({
    user: input.user,
    positions: [],
    count: 0,
    hasMore: false,
  }),
};

export const polyDataPositionsBoundTool: BoundTool<
  typeof POLY_DATA_POSITIONS_NAME,
  PolyDataPositionsInput,
  PolyDataPositionsOutput,
  PolyDataPositionsRedacted
> = {
  contract: polyDataPositionsContract,
  implementation: polyDataPositionsStubImplementation,
};
