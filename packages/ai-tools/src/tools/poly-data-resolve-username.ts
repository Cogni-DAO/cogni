// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/poly-data-resolve-username`
 * Purpose: AI tool — Polymarket handle → proxyWallet resolver via Gamma `/public-search`.
 * Scope: Read-only. Different host (gamma-api.polymarket.com) vs the Data API. Does not place trades, does not load env.
 * Invariants: TOOL_ID_NAMESPACED, EFFECT_READ_ONLY, NO_LANGCHAIN_IMPORT.
 * Side-effects: IO (capability)
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @public
 */

import { z } from "zod";

import type { PolyDataCapability } from "../capabilities/poly-data";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

export const PolyDataResolveUsernameInputSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe("Search string for the Polymarket handle (min 2 chars)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max profile matches to return (1-20, default 5)."),
});
export type PolyDataResolveUsernameInput = z.infer<
  typeof PolyDataResolveUsernameInputSchema
>;

const ProfileEntrySchema = z.object({
  userName: z.string(),
  proxyWallet: z.string(),
  verified: z.boolean(),
});

export const PolyDataResolveUsernameOutputSchema = z.object({
  profiles: z.array(ProfileEntrySchema),
  count: z.number().int().nonnegative(),
});
export type PolyDataResolveUsernameOutput = z.infer<
  typeof PolyDataResolveUsernameOutputSchema
>;
export type PolyDataResolveUsernameRedacted = PolyDataResolveUsernameOutput;

export const POLY_DATA_RESOLVE_USERNAME_NAME =
  "core__poly_data_resolve_username" as const;

export const polyDataResolveUsernameContract: ToolContract<
  typeof POLY_DATA_RESOLVE_USERNAME_NAME,
  PolyDataResolveUsernameInput,
  PolyDataResolveUsernameOutput,
  PolyDataResolveUsernameRedacted
> = {
  name: POLY_DATA_RESOLVE_USERNAME_NAME,
  description:
    "Resolve a Polymarket username/handle to a proxyWallet (Safe) address. " +
    "Hits the Gamma `/public-search` endpoint. Use this whenever a user mentions a wallet " +
    "by handle — all other Data-API tools require the proxy-wallet address, not the handle.",
  effect: "read_only",
  inputSchema: PolyDataResolveUsernameInputSchema,
  outputSchema: PolyDataResolveUsernameOutputSchema,
  redact: (out) => out,
  allowlist: ["profiles", "count"] as const,
};

export interface PolyDataResolveUsernameDeps {
  polyDataCapability: PolyDataCapability;
}

export function createPolyDataResolveUsernameImplementation(
  deps: PolyDataResolveUsernameDeps
): ToolImplementation<
  PolyDataResolveUsernameInput,
  PolyDataResolveUsernameOutput
> {
  return {
    execute: async (input) =>
      deps.polyDataCapability.resolveUsername({
        query: input.query,
        limit: input.limit ?? 5,
      }),
  };
}

export const polyDataResolveUsernameStubImplementation: ToolImplementation<
  PolyDataResolveUsernameInput,
  PolyDataResolveUsernameOutput
> = {
  execute: async () => ({
    profiles: [],
    count: 0,
  }),
};

export const polyDataResolveUsernameBoundTool: BoundTool<
  typeof POLY_DATA_RESOLVE_USERNAME_NAME,
  PolyDataResolveUsernameInput,
  PolyDataResolveUsernameOutput,
  PolyDataResolveUsernameRedacted
> = {
  contract: polyDataResolveUsernameContract,
  implementation: polyDataResolveUsernameStubImplementation,
};
