// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-node-contracts/poly.research-trader-comparison.v1.contract`
 * Purpose: Contract for the research trader-comparison board over saved trader observations plus Polymarket-native P/L history.
 * Scope: GET /api/v1/poly/research/trader-comparison. Read-only, session-authenticated, and capped to three wallets per request.
 * Invariants:
 *   - COMPARISON_SIZE_CAPPED: max three wallets so the research header remains scannable.
 *   - PNL_SINGLE_SOURCE: P/L comes from the same Polymarket-native user-pnl slice as wallet analysis.
 *   - TRADE_FLOW_FROM_OBSERVATIONS: trade counts/notional come from `poly_trader_fills`, not ad hoc Data-API fetches.
 * Side-effects: none
 * Links: docs/design/poly-copy-target-performance-benchmark.md, work/items/task.5005
 * @public
 */

import { z } from "zod";
import {
  PolyWalletOverviewIntervalSchema,
  PolyWalletOverviewPnlPointSchema,
} from "./poly.wallet.overview.v1.contract";
import { PolyAddressSchema } from "./poly.wallet-analysis.v1.contract";

export const PolyResearchTraderComparisonQuerySchema = z.object({
  wallet: z.array(PolyAddressSchema).min(1).max(3),
  label: z.array(z.string().trim().min(1).max(32)).max(3).default([]),
  interval: PolyWalletOverviewIntervalSchema.optional().default("1W"),
});
export type PolyResearchTraderComparisonQuery = z.infer<
  typeof PolyResearchTraderComparisonQuerySchema
>;

export const PolyResearchTraderComparisonWarningSchema = z.object({
  wallet: PolyAddressSchema.optional(),
  code: z.string(),
  message: z.string(),
});
export type PolyResearchTraderComparisonWarning = z.infer<
  typeof PolyResearchTraderComparisonWarningSchema
>;

export const PolyResearchTraderSizePnlBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  loPercentile: z.number().int().min(0).max(100),
  hiPercentile: z.number().int().min(0).max(100),
  minSizeUsdc: z.number().nonnegative(),
  maxSizeUsdc: z.number().nonnegative(),
  avgSizeUsdc: z.number().nonnegative(),
  buyCount: z.number().int().nonnegative(),
  resolvedCount: z.number().int().nonnegative(),
  winCount: z.number().int().nonnegative(),
  lossCount: z.number().int().nonnegative(),
  flatCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1).nullable(),
  pnlUsdc: z.number(),
  buyUsdc: z.number().nonnegative(),
  hedgeBuyCount: z.number().int().nonnegative(),
  hedgeBuyUsdc: z.number().nonnegative(),
});
export type PolyResearchTraderSizePnlBucket = z.infer<
  typeof PolyResearchTraderSizePnlBucketSchema
>;

export const PolyResearchTraderSizePnlSchema = z.object({
  bucketStep: z.literal(5),
  sampleBuyCount: z.number().int().nonnegative(),
  resolvedCount: z.number().int().nonnegative(),
  winCount: z.number().int().nonnegative(),
  lossCount: z.number().int().nonnegative(),
  flatCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1).nullable(),
  pnlUsdc: z.number(),
  buyUsdc: z.number().nonnegative(),
  hedgeBuyCount: z.number().int().nonnegative(),
  hedgeBuyUsdc: z.number().nonnegative(),
  buckets: z.array(PolyResearchTraderSizePnlBucketSchema).length(20),
});
export type PolyResearchTraderSizePnl = z.infer<
  typeof PolyResearchTraderSizePnlSchema
>;

export const PolyResearchTraderComparisonTraderSchema = z.object({
  address: PolyAddressSchema,
  label: z.string(),
  isObserved: z.boolean(),
  traderKind: z.enum(["copy_target", "cogni_wallet"]).nullable(),
  interval: PolyWalletOverviewIntervalSchema,
  observedSince: z.string().nullable(),
  lastObservedAt: z.string().nullable(),
  observationStatus: z.string().nullable(),
  pnl: z.object({
    usdc: z.number().nullable(),
    history: z.array(PolyWalletOverviewPnlPointSchema),
  }),
  trades: z.object({
    count: z.number().int().nonnegative(),
    buyCount: z.number().int().nonnegative(),
    sellCount: z.number().int().nonnegative(),
    notionalUsdc: z.number().nonnegative(),
    buyUsdc: z.number().nonnegative(),
    sellUsdc: z.number().nonnegative(),
    marketCount: z.number().int().nonnegative(),
  }),
  tradeSizePnl: PolyResearchTraderSizePnlSchema,
});
export type PolyResearchTraderComparisonTrader = z.infer<
  typeof PolyResearchTraderComparisonTraderSchema
>;

export const PolyResearchTraderComparisonResponseSchema = z.object({
  interval: PolyWalletOverviewIntervalSchema,
  capturedAt: z.string(),
  traders: z.array(PolyResearchTraderComparisonTraderSchema).max(3),
  warnings: z.array(PolyResearchTraderComparisonWarningSchema),
});
export type PolyResearchTraderComparisonResponse = z.infer<
  typeof PolyResearchTraderComparisonResponseSchema
>;

export const polyResearchTraderComparisonOperation = {
  id: "poly.research-trader-comparison.v1",
  summary: "Compare up to three Polymarket traders by P/L, fills, and USDC flow",
  description:
    "Research header comparison for up to three wallets. P/L uses Polymarket-native user-pnl history; fill counts and notional use saved trader observations from poly_trader_fills.",
  input: PolyResearchTraderComparisonQuerySchema,
  output: PolyResearchTraderComparisonResponseSchema,
} as const;
