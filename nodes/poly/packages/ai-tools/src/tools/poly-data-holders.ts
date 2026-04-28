// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools/tools/poly-data-holders`
 * Purpose: AI tool — list shareholders on a Polymarket market via `GET /holders`.
 * Scope: Read-only. Core hidden-gem wallet-discovery primitive. Does not place trades, does not load env.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_READ_ONLY, NO_LANGCHAIN_IMPORT.
 * Side-effects: IO (capability)
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @public
 */

import { z } from "zod";

import type { PolyDataCapability } from "../capabilities/poly-data";
import type { BoundTool, ToolContract, ToolImplementation } from "@cogni/ai-tools";

export const PolyDataHoldersInputSchema = z.object({
  market: z
    .string()
    .min(1)
    .describe("Market conditionId (hex) — NOT the slug or CTF tokenId."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max holders to return (1-100, default 20)."),
});
export type PolyDataHoldersInput = z.infer<typeof PolyDataHoldersInputSchema>;

const HolderEntrySchema = z.object({
  proxyWallet: z.string(),
  outcome: z.string(),
  outcomeIndex: z.number(),
  amount: z.number(),
  userName: z.string().nullable(),
});

export const PolyDataHoldersOutputSchema = z.object({
  market: z.string(),
  holders: z.array(HolderEntrySchema),
  count: z.number().int().nonnegative(),
});
export type PolyDataHoldersOutput = z.infer<typeof PolyDataHoldersOutputSchema>;
export type PolyDataHoldersRedacted = PolyDataHoldersOutput;

export const POLY_DATA_HOLDERS_NAME = "core__poly_data_holders" as const;

export const polyDataHoldersContract: ToolContract<
  typeof POLY_DATA_HOLDERS_NAME,
  PolyDataHoldersInput,
  PolyDataHoldersOutput,
  PolyDataHoldersRedacted
> = {
  name: POLY_DATA_HOLDERS_NAME,
  description:
    "List current shareholders (wallets with open positions) on a Polymarket market. " +
    "Primary hidden-gem discovery tool — harvest holders across many markets in a category, " +
    "count cross-market appearances, and surface wallets the global leaderboard misses. " +
    "`market` is the conditionId (hex), NOT the slug.",
  effect: "read_only",
  inputSchema: PolyDataHoldersInputSchema,
  outputSchema: PolyDataHoldersOutputSchema,
  redact: (out) => out,
  allowlist: ["market", "holders", "count"] as const,
};

export interface PolyDataHoldersDeps {
  polyDataCapability: PolyDataCapability;
}

export function createPolyDataHoldersImplementation(
  deps: PolyDataHoldersDeps
): ToolImplementation<PolyDataHoldersInput, PolyDataHoldersOutput> {
  return {
    execute: async (input) =>
      deps.polyDataCapability.getHolders({
        market: input.market,
        limit: input.limit ?? 20,
      }),
  };
}

export const polyDataHoldersStubImplementation: ToolImplementation<
  PolyDataHoldersInput,
  PolyDataHoldersOutput
> = {
  execute: async (input) => ({
    market: input.market,
    holders: [],
    count: 0,
  }),
};

export const polyDataHoldersBoundTool: BoundTool<
  typeof POLY_DATA_HOLDERS_NAME,
  PolyDataHoldersInput,
  PolyDataHoldersOutput,
  PolyDataHoldersRedacted
> = {
  contract: polyDataHoldersContract,
  implementation: polyDataHoldersStubImplementation,
};
