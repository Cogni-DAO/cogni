// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools/tools/wallet-top-traders`
 * Purpose: AI tool for listing top Polymarket wallets by PnL for a rolling time window.
 * Scope: Read-only wallet scoreboard via WalletCapability. Does not place trades, does not load env.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__wallet_top_traders`
 *   - EFFECT_TYPED: effect is `read_only`
 *   - REDACTION_REQUIRED: Allowlist in contract
 *   - NO LangChain imports
 * Side-effects: IO (HTTP to Polymarket Data API via capability)
 * Links: work/items/task.0315.poly-copy-trade-prototype.md
 * @public
 */

import { z } from "zod";

import type { BoundTool, ToolContract, ToolImplementation } from "@cogni/ai-tools";

// ─────────────────────────────────────────────────────────────────────────────
// Capability interface (injected at runtime)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wallet capability — thin interface over the Polymarket Data API.
 * Resolved at runtime from the container; tools never import adapters directly.
 */
export interface WalletCapability {
  listTopTraders(params: {
    timePeriod: "DAY" | "WEEK" | "MONTH" | "ALL";
    orderBy?: "PNL" | "VOL";
    limit?: number;
  }): Promise<WalletTopTradersOutput>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const WalletTimePeriodSchema = z.enum(["DAY", "WEEK", "MONTH", "ALL"]);
export type WalletTimePeriod = z.infer<typeof WalletTimePeriodSchema>;

export const WalletOrderBySchema = z.enum(["PNL", "VOL"]);
export type WalletOrderBy = z.infer<typeof WalletOrderBySchema>;

export const WalletTopTradersInputSchema = z.object({
  timePeriod: WalletTimePeriodSchema.optional().describe(
    "Time window: DAY, WEEK, MONTH, or ALL-time (default: WEEK)"
  ),
  orderBy: WalletOrderBySchema.optional().describe(
    "Sort metric: PNL (profit) or VOL (volume) (default: PNL)"
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max wallets to return (1-50, default 10)"),
});
export type WalletTopTradersInput = z.infer<typeof WalletTopTradersInputSchema>;

export const WalletTopTraderItemSchema = z.object({
  /** Rank from the leaderboard (1-indexed). */
  rank: z.number().int(),
  /** On-chain Polygon proxy-wallet address (0x…40 hex). */
  proxyWallet: z.string(),
  /** Human-readable username; may be the address when unset. */
  userName: z.string(),
  /** Trading volume in USDC for the window. */
  volumeUsdc: z.number(),
  /** Profit and loss in USDC for the window (can be negative). */
  pnlUsdc: z.number(),
  /** Derived: pnl/volume * 100. `null` when volume is 0 (redemption-only rows). */
  roiPct: z.number().nullable(),
  /** Cap: 500+ when the /trades pagination was saturated. */
  numTrades: z.number().int(),
  /** True when the /trades pagination cap was hit — actual count is ≥ numTrades. */
  numTradesCapped: z.boolean(),
  /** Polymarket verified-badge flag. */
  verified: z.boolean(),
});
export type WalletTopTraderItem = z.infer<typeof WalletTopTraderItemSchema>;

export const WalletTopTradersOutputSchema = z.object({
  traders: z.array(WalletTopTraderItemSchema),
  timePeriod: WalletTimePeriodSchema,
  orderBy: WalletOrderBySchema,
  totalCount: z.number().int(),
});
export type WalletTopTradersOutput = z.infer<
  typeof WalletTopTradersOutputSchema
>;

export type WalletTopTradersRedacted = WalletTopTradersOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const WALLET_TOP_TRADERS_NAME = "core__wallet_top_traders" as const;

export const walletTopTradersContract: ToolContract<
  typeof WALLET_TOP_TRADERS_NAME,
  WalletTopTradersInput,
  WalletTopTradersOutput,
  WalletTopTradersRedacted
> = {
  name: WALLET_TOP_TRADERS_NAME,
  description:
    "List top Polymarket wallets by profit for a rolling time window (day/week/month/all-time). " +
    "Returns rank, username, proxy-wallet address, volume, PnL, ROI, and trade count. " +
    "Use this to find which wallets are most profitable right now — candidates to study or follow.",
  effect: "read_only",
  inputSchema: WalletTopTradersInputSchema,
  outputSchema: WalletTopTradersOutputSchema,
  redact: (output: WalletTopTradersOutput): WalletTopTradersRedacted => output,
  allowlist: ["traders", "timePeriod", "orderBy", "totalCount"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation factory (capability-injected)
// ─────────────────────────────────────────────────────────────────────────────

export interface WalletTopTradersDeps {
  walletCapability: WalletCapability;
}

export function createWalletTopTradersImplementation(
  deps: WalletTopTradersDeps
): ToolImplementation<WalletTopTradersInput, WalletTopTradersOutput> {
  return {
    execute: async (
      input: WalletTopTradersInput
    ): Promise<WalletTopTradersOutput> => {
      return deps.walletCapability.listTopTraders({
        timePeriod: input.timePeriod ?? "WEEK",
        orderBy: input.orderBy ?? "PNL",
        limit: input.limit ?? 10,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stub implementation (for catalog registration — replaced at runtime)
// ─────────────────────────────────────────────────────────────────────────────

export const walletTopTradersStubImplementation: ToolImplementation<
  WalletTopTradersInput,
  WalletTopTradersOutput
> = {
  execute: async (input): Promise<WalletTopTradersOutput> => ({
    traders: [],
    timePeriod: input.timePeriod ?? "WEEK",
    orderBy: input.orderBy ?? "PNL",
    totalCount: 0,
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool (contract + stub)
// ─────────────────────────────────────────────────────────────────────────────

export const walletTopTradersBoundTool: BoundTool<
  typeof WALLET_TOP_TRADERS_NAME,
  WalletTopTradersInput,
  WalletTopTradersOutput,
  WalletTopTradersRedacted
> = {
  contract: walletTopTradersContract,
  implementation: walletTopTradersStubImplementation,
};
