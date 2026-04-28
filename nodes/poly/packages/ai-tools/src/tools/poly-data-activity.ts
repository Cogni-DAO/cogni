// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools/tools/poly-data-activity`
 * Purpose: AI tool — list wallet lifecycle events (TRADE/SPLIT/MERGE/REDEEM/...) via `GET /activity`.
 * Scope: Read-only Data-API wrapper via PolyDataCapability. Distinct from `/trades`. Does not place trades, does not load env.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_READ_ONLY, USER_PARAM_IS_PROXY_WALLET, PAGINATION_CONSISTENT, NO_LANGCHAIN_IMPORT.
 * Side-effects: IO (capability)
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @public
 */

import { z } from "zod";

import type { PolyDataCapability } from "../capabilities/poly-data";
import type { BoundTool, ToolContract, ToolImplementation } from "@cogni/ai-tools";

const PolyAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be 0x-prefixed 40-hex proxy-wallet");

export const PolyDataActivityTypeSchema = z.enum([
  "TRADE",
  "SPLIT",
  "MERGE",
  "REDEEM",
  "REWARD",
  "CONVERSION",
]);

export const PolyDataActivityInputSchema = z.object({
  user: PolyAddressSchema.describe(
    "Polymarket proxy-wallet (Safe) address, NOT the signing EOA."
  ),
  type: PolyDataActivityTypeSchema.optional().describe(
    "Filter by event type (TRADE/SPLIT/MERGE/REDEEM/REWARD/CONVERSION)."
  ),
  side: z.enum(["BUY", "SELL"]).optional().describe("Filter TRADEs by side."),
  start: z.number().int().optional().describe("Unix-seconds lower bound."),
  end: z.number().int().optional().describe("Unix-seconds upper bound."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Rows per page (1-500, default 100)."),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Pagination offset."),
});
export type PolyDataActivityInput = z.infer<typeof PolyDataActivityInputSchema>;

const ActivityEntrySchema = z.object({
  type: z.string(),
  timestamp: z.number(),
  conditionId: z.string(),
  side: z.string(),
  size: z.number(),
  price: z.number(),
  title: z.string(),
  eventSlug: z.string(),
  transactionHash: z.string(),
});

export const PolyDataActivityOutputSchema = z.object({
  user: z.string(),
  events: z.array(ActivityEntrySchema),
  count: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type PolyDataActivityOutput = z.infer<
  typeof PolyDataActivityOutputSchema
>;
export type PolyDataActivityRedacted = PolyDataActivityOutput;

export const POLY_DATA_ACTIVITY_NAME = "core__poly_data_activity" as const;

export const polyDataActivityContract: ToolContract<
  typeof POLY_DATA_ACTIVITY_NAME,
  PolyDataActivityInput,
  PolyDataActivityOutput,
  PolyDataActivityRedacted
> = {
  name: POLY_DATA_ACTIVITY_NAME,
  description:
    "List lifecycle events for a Polymarket wallet (TRADE/SPLIT/MERGE/REDEEM/REWARD/CONVERSION). " +
    "Distinct from raw trades — use this for realized-PnL reconstruction and redemption history. " +
    "`user` MUST be the proxy-wallet (Safe), not the signing EOA.",
  effect: "read_only",
  inputSchema: PolyDataActivityInputSchema,
  outputSchema: PolyDataActivityOutputSchema,
  redact: (out) => out,
  allowlist: ["user", "events", "count", "hasMore"] as const,
};

export interface PolyDataActivityDeps {
  polyDataCapability: PolyDataCapability;
}

export function createPolyDataActivityImplementation(
  deps: PolyDataActivityDeps
): ToolImplementation<PolyDataActivityInput, PolyDataActivityOutput> {
  return {
    execute: async (input) =>
      deps.polyDataCapability.listActivity({
        user: input.user,
        ...(input.type !== undefined && { type: input.type }),
        ...(input.side !== undefined && { side: input.side }),
        ...(input.start !== undefined && { start: input.start }),
        ...(input.end !== undefined && { end: input.end }),
        limit: input.limit ?? 100,
        offset: input.offset ?? 0,
      }),
  };
}

export const polyDataActivityStubImplementation: ToolImplementation<
  PolyDataActivityInput,
  PolyDataActivityOutput
> = {
  execute: async (input) => ({
    user: input.user,
    events: [],
    count: 0,
    hasMore: false,
  }),
};

export const polyDataActivityBoundTool: BoundTool<
  typeof POLY_DATA_ACTIVITY_NAME,
  PolyDataActivityInput,
  PolyDataActivityOutput,
  PolyDataActivityRedacted
> = {
  contract: polyDataActivityContract,
  implementation: polyDataActivityStubImplementation,
};
