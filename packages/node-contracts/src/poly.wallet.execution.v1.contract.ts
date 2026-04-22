// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet.execution.v1.contract`
 * Purpose: Defines the trading-wallet execution route contract for the dashboard trade-cadence chart and positions view.
 * Scope: GET /api/v1/poly/wallet/execution. Read-only; session-authenticated; does not mutate wallet state or infer wallet totals.
 * Invariants:
 *   - Address is always the configured tenant wallet (or zero-address when unconfigured).
 *   - Position timelines are price-series traces, not fabricated balance curves.
 *   - Market links must come from upstream slugs, never title guessing.
 * Side-effects: none
 * Links: docs/design/poly-dashboard-balance-and-positions.md, docs/design/wallet-analysis-components.md
 * @public
 */

import { z } from "zod";
import { PolyAddressSchema } from "./poly.wallet-analysis.v1.contract";

export const WalletExecutionPositionStatusSchema = z.enum([
  "open",
  "closed",
  "redeemable",
]);
export type WalletExecutionPositionStatus = z.infer<
  typeof WalletExecutionPositionStatusSchema
>;

export const WalletExecutionTimelinePointSchema = z.object({
  ts: z.string(),
  price: z.number().min(0),
  size: z.number().nonnegative(),
});
export type WalletExecutionTimelinePoint = z.infer<
  typeof WalletExecutionTimelinePointSchema
>;

export const WalletExecutionEventKindSchema = z.enum([
  "entry",
  "add",
  "reduce",
  "close",
  "redeemable",
]);
export type WalletExecutionEventKind = z.infer<
  typeof WalletExecutionEventKindSchema
>;

export const WalletExecutionEventSchema = z.object({
  ts: z.string(),
  kind: WalletExecutionEventKindSchema,
  price: z.number().min(0),
  shares: z.number().nonnegative(),
});
export type WalletExecutionEvent = z.infer<typeof WalletExecutionEventSchema>;

export const WalletExecutionPositionSchema = z.object({
  positionId: z.string(),
  conditionId: z.string(),
  asset: z.string(),
  marketTitle: z.string(),
  marketSlug: z.string().nullable(),
  eventSlug: z.string().nullable(),
  marketUrl: z.string().url().nullable(),
  outcome: z.string(),
  status: WalletExecutionPositionStatusSchema,
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  heldMinutes: z.number().int().nonnegative(),
  entryPrice: z.number().min(0),
  currentPrice: z.number().min(0),
  size: z.number().nonnegative(),
  currentValue: z.number().nonnegative(),
  pnlUsd: z.number(),
  pnlPct: z.number(),
  timeline: z.array(WalletExecutionTimelinePointSchema),
  events: z.array(WalletExecutionEventSchema),
});
export type WalletExecutionPosition = z.infer<
  typeof WalletExecutionPositionSchema
>;

export const WalletExecutionWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type WalletExecutionWarning = z.infer<
  typeof WalletExecutionWarningSchema
>;

export const WalletExecutionDailyCountSchema = z.object({
  day: z.string(),
  n: z.number().int().nonnegative(),
});
export type WalletExecutionDailyCount = z.infer<
  typeof WalletExecutionDailyCountSchema
>;

export const PolyWalletExecutionOutputSchema = z.object({
  address: PolyAddressSchema,
  capturedAt: z.string(),
  dailyTradeCounts: z.array(WalletExecutionDailyCountSchema),
  positions: z.array(WalletExecutionPositionSchema),
  warnings: z.array(WalletExecutionWarningSchema),
});
export type PolyWalletExecutionOutput = z.infer<
  typeof PolyWalletExecutionOutputSchema
>;

export const polyWalletExecutionOperation = {
  id: "poly.wallet.execution.v1",
  summary:
    "Trading-wallet execution positions and trades-per-day with traceable price timelines",
  description:
    "Returns the signed-in user's live daily trade counts and execution positions derived from Polymarket Data API trades and positions plus public CLOB price history.",
  input: z.object({}),
  output: PolyWalletExecutionOutputSchema,
} as const;
