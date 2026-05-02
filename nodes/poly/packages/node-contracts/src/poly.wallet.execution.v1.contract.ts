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
 *   - live_positions contains open/redeemable rows only; closed_positions contains closed rows only.
 *   - lifecycleState (optional) reflects the redeem-pipeline classification (task.0388). Drives Open vs History tab membership and the Redeem-button gate; absent / null when the pipeline has not yet classified the position.
 * Side-effects: none
 * Links: docs/design/poly-dashboard-balance-and-positions.md, docs/design/wallet-analysis-components.md
 * @public
 */

import { z } from "zod";
import { PolyWalletDataFreshnessSchema } from "./poly.wallet.overview.v1.contract";
import { PolyAddressSchema } from "./poly.wallet-analysis.v1.contract";

export const WalletExecutionPositionStatusSchema = z.enum([
  "open",
  "closed",
  "redeemable",
]);
export type WalletExecutionPositionStatus = z.infer<
  typeof WalletExecutionPositionStatusSchema
>;

/**
 * Lifecycle state from the redeem pipeline (`poly_redeem_jobs`). Drives the
 * dashboard's Open vs History tab membership and the Redeem-button gate.
 * `null` when the pipeline has not classified the position yet.
 */
export const WalletExecutionLifecycleStateSchema = z.enum([
  "unresolved",
  "open",
  "closing",
  "closed",
  "resolving",
  "winner",
  "redeem_pending",
  "redeemed",
  "loser",
  "dust",
  "abandoned",
]);
export type WalletExecutionLifecycleState = z.infer<
  typeof WalletExecutionLifecycleStateSchema
>;
export const WALLET_EXECUTION_TERMINAL_LIFECYCLE_STATES: ReadonlySet<WalletExecutionLifecycleState> =
  new Set<WalletExecutionLifecycleState>([
    "closed",
    "redeemed",
    "loser",
    "dust",
    "abandoned",
  ]);

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
  eventTitle: z.string().nullable().optional(),
  marketSlug: z.string().nullable(),
  eventSlug: z.string().nullable(),
  marketUrl: z.string().url().nullable(),
  outcome: z.string(),
  status: WalletExecutionPositionStatusSchema,
  lifecycleState: WalletExecutionLifecycleStateSchema.nullable().optional(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  resolvesAt: z.string().nullable(),
  gameStartTime: z.string().nullable().optional(),
  heldMinutes: z.number().int().nonnegative(),
  entryPrice: z.number().min(0),
  currentPrice: z.number().min(0),
  size: z.number().nonnegative(),
  currentValue: z.number().nonnegative(),
  pnlUsd: z.number(),
  pnlPct: z.number(),
  syncedAt: z.string().nullable().optional(),
  syncAgeMs: z.number().int().nonnegative().nullable().optional(),
  syncStale: z.boolean().optional(),
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
  freshness: PolyWalletDataFreshnessSchema,
  capturedAt: z.string(),
  dailyTradeCounts: z.array(WalletExecutionDailyCountSchema),
  /** Currently held positions (status open or redeemable). Powers the Open tab. */
  live_positions: z.array(WalletExecutionPositionSchema),
  /** Trade-derived closed position history. Powers the Position History tab. */
  closed_positions: z.array(WalletExecutionPositionSchema),
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
    "Returns the signed-in user's DB-backed daily trade counts, open positions (live_positions), and closed position history (closed_positions) for the trading-wallet dashboard.",
  input: z.object({
    freshness: PolyWalletDataFreshnessSchema.optional().default("live"),
  }),
  output: PolyWalletExecutionOutputSchema,
} as const;
