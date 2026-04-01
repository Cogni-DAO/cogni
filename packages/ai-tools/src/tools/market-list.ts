// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/market-list`
 * Purpose: AI tool for listing prediction markets from Polymarket and Kalshi.
 * Scope: Read-only market listing via MarketProviderPort. Does not place trades or load env.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__market_list`
 *   - EFFECT_TYPED: effect is `read_only`
 *   - REDACTION_REQUIRED: Allowlist in contract
 *   - NO LangChain imports
 * Side-effects: IO (HTTP to prediction market APIs via capability)
 * Links: packages/market-provider/, work/items/task.0230.market-data-package.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Capability interface (injected at runtime)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Market capability — thin interface over MarketProviderPort.
 * Resolved at runtime from the container; tools never import adapters directly.
 */
export interface MarketCapability {
  listMarkets(params: {
    provider?: string;
    category?: string;
    search?: string;
    limit?: number;
  }): Promise<MarketListOutput>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const MarketListInputSchema = z.object({
  provider: z
    .enum(["polymarket", "kalshi", "all"])
    .optional()
    .describe(
      "Which market provider to query: polymarket, kalshi, or all (default: all)"
    ),
  category: z
    .string()
    .optional()
    .describe("Filter by market category (e.g. Economics, Politics)"),
  search: z
    .string()
    .max(200)
    .optional()
    .describe("Search query to filter markets by title"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum markets per provider (1-50, default 20)"),
});
export type MarketListInput = z.infer<typeof MarketListInputSchema>;

export const MarketItemSchema = z.object({
  id: z.string(),
  provider: z.string(),
  title: z.string(),
  category: z.string(),
  probabilityPct: z.number(),
  spreadBps: z.number(),
  volume: z.number(),
  active: z.boolean(),
  resolvesAt: z.string(),
});
export type MarketItem = z.infer<typeof MarketItemSchema>;

export const MarketListOutputSchema = z.object({
  markets: z.array(MarketItemSchema),
  totalCount: z.number(),
  providers: z.array(z.string()),
});
export type MarketListOutput = z.infer<typeof MarketListOutputSchema>;

export type MarketListRedacted = MarketListOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const MARKET_LIST_NAME = "core__market_list" as const;

export const marketListContract: ToolContract<
  typeof MARKET_LIST_NAME,
  MarketListInput,
  MarketListOutput,
  MarketListRedacted
> = {
  name: MARKET_LIST_NAME,
  description:
    "List active prediction markets from Polymarket and/or Kalshi. " +
    "Returns market titles, current probability, spread, volume, and resolution date. " +
    "Use this to find markets related to a topic or see what people are betting on.",
  effect: "read_only",
  inputSchema: MarketListInputSchema,
  outputSchema: MarketListOutputSchema,
  redact: (output: MarketListOutput): MarketListRedacted => output,
  allowlist: ["markets", "totalCount", "providers"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation factory (capability-injected)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketListDeps {
  marketCapability: MarketCapability;
}

export function createMarketListImplementation(
  deps: MarketListDeps
): ToolImplementation<MarketListInput, MarketListOutput> {
  return {
    execute: async (input: MarketListInput): Promise<MarketListOutput> => {
      return deps.marketCapability.listMarkets({
        provider: input.provider,
        category: input.category,
        search: input.search,
        limit: input.limit ?? 20,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub implementation (for catalog registration — replaced at runtime)
// ─────────────────────────────────────────────────────────────────────────────

export const marketListStubImplementation: ToolImplementation<
  MarketListInput,
  MarketListOutput
> = {
  execute: async (): Promise<MarketListOutput> => ({
    markets: [],
    totalCount: 0,
    providers: [],
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool (contract + stub)
// ─────────────────────────────────────────────────────────────────────────────

export const marketListBoundTool: BoundTool<
  typeof MARKET_LIST_NAME,
  MarketListInput,
  MarketListOutput,
  MarketListRedacted
> = {
  contract: marketListContract,
  implementation: marketListStubImplementation,
};
