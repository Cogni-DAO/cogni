// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.wallet-analysis.v1.contract`
 * Purpose: Contract for the wallet-analysis HTTP route — single route, slice-scoped via `include`, covers any 0x Polymarket wallet.
 * Scope: GET /api/v1/poly/wallets/:addr?include=snapshot|trades|balance|pnl. Read-only; does not place orders, does not mutate state. Each request returns the subset of slices named in `include`. Never throws on partial-failure of one slice — surfaces it via `warnings`.
 * NOTE: This file's location violates the `@cogni/node-contracts` boundary —
 *   per-node contracts do not belong in the cross-node shared package. Tracked
 *   as bug.0386 (`@cogni/node-contracts` leaks node-specific contracts). Do not
 *   add new node-specific contracts here; relocate when bug.0386 ships.
 * Invariants:
 *   - Any 0x address accepted; `addr` lowercased before handler logic.
 *   - Snapshot metric fields are `null` until the resolved-position count meets the minimum (research doc threshold, default 5).
 *   - `balance` for the operator wallet includes `available` + `locked`; for any other addr those are `undefined` and `positions` is the only populated field.
 *   - Molecules render from `{ data, isLoading, error }`; partial failure is never silent.
 * Side-effects: none
 * Notes: Route handler enforces auth explicitly via getServerSessionUser(); Zod validation runs before any client call.
 * Links: docs/design/wallet-analysis-components.md, work/items/task.0329.wallet-analysis-component-extraction.md
 * @public
 */

import { z } from "zod";
import {
  PolyWalletOverviewIntervalSchema,
  PolyWalletOverviewPnlPointSchema,
} from "./poly.wallet.overview.v1.contract";

/** Lowercased 0x address. Contract lowercases before any handler logic runs. */
export const PolyAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 40-hex address")
  .transform((s) => s.toLowerCase());
export type PolyAddress = z.infer<typeof PolyAddressSchema>;

/** The independently-requestable slices. */
export const WalletAnalysisSliceSchema = z.enum([
  "snapshot",
  "trades",
  "balance",
  "pnl",
]);
export type WalletAnalysisSlice = z.infer<typeof WalletAnalysisSliceSchema>;

/**
 * Deterministic trade-derived metrics (winrate, duration, activity counts).
 * Nullable numerics when sample is insufficient.
 *
 * PnL is **not** in this slice. PnL of any flavour (realized, ROI, drawdown,
 * peak equity) is sourced exclusively from the `pnl` slice — Polymarket's
 * `user-pnl-api`. See task.0389: rendering both a bespoke realized-PnL number
 * and Polymarket's series side-by-side guaranteed they would disagree.
 */
export const WalletAnalysisSnapshotSchema = z.object({
  resolvedPositions: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  trueWinRatePct: z.number().nullable(),
  medianDurationHours: z.number().nullable(),
  openPositions: z.number().int().nonnegative(),
  openNetCostUsdc: z.number(),
  uniqueMarkets: z.number().int().nonnegative(),
  tradesPerDay30d: z.number().nonnegative(),
  daysSinceLastTrade: z.number(),
  topMarkets: z.array(z.string()),
  dailyCounts: z.array(
    z.object({
      day: z.string(),
      n: z.number().int().nonnegative(),
    })
  ),
  /** ISO8601 timestamp the slice was computed at — drives the "fresh/stale" UI affordance. */
  computedAt: z.string(),
  /**
   * Hand-authored edge hypothesis for this wallet. Today this is a hardcoded
   * fallback for BeefSlayer only; task.0333 replaces this with a read from the
   * Dolt `poly_wallet_analyses` table with no contract change.
   */
  hypothesisMd: z.string().nullable(),
});
export type WalletAnalysisSnapshot = z.infer<
  typeof WalletAnalysisSnapshotSchema
>;

/** One trade in the "recent N" table. */
export const WalletAnalysisTradeSchema = z.object({
  timestampSec: z.number().int().nonnegative(),
  side: z.enum(["BUY", "SELL"]),
  conditionId: z.string(),
  asset: z.string(),
  size: z.number(),
  price: z.number(),
  marketTitle: z.string().nullable(),
});
export type WalletAnalysisTrade = z.infer<typeof WalletAnalysisTradeSchema>;

export const WalletAnalysisTradesSchema = z.object({
  recent: z.array(WalletAnalysisTradeSchema),
  dailyCounts: z.array(
    z.object({ day: z.string(), n: z.number().int().nonnegative() })
  ),
  topMarkets: z.array(z.string()),
  computedAt: z.string(),
});
export type WalletAnalysisTrades = z.infer<typeof WalletAnalysisTradesSchema>;

/**
 * Balance slice.
 * - Any wallet: `positions` + `total` are populated from the public Data-API `/positions` endpoint.
 * - Operator wallet only: `available` + `locked` are populated via CLOB API; also `available` contributes to `total`.
 */
export const WalletAnalysisBalanceSchema = z.object({
  available: z.number().nonnegative().optional(),
  locked: z.number().nonnegative().optional(),
  positions: z.number().nonnegative(),
  total: z.number().nonnegative(),
  /** True when this wallet is the pod's operator wallet (full USDC breakdown surfaced). */
  isOperator: z.boolean(),
  computedAt: z.string(),
});
export type WalletAnalysisBalance = z.infer<typeof WalletAnalysisBalanceSchema>;

export const WalletAnalysisPnlSchema = z.object({
  interval: PolyWalletOverviewIntervalSchema,
  history: z.array(PolyWalletOverviewPnlPointSchema),
  computedAt: z.string(),
});
export type WalletAnalysisPnl = z.infer<typeof WalletAnalysisPnlSchema>;

/** Surfaced when a slice fetch fails but others succeeded — UI shows "trades unavailable, retrying". */
export const WalletAnalysisWarningSchema = z.object({
  slice: WalletAnalysisSliceSchema,
  code: z.string(),
  message: z.string(),
});
export type WalletAnalysisWarning = z.infer<typeof WalletAnalysisWarningSchema>;

export const WalletAnalysisResponseSchema = z.object({
  address: PolyAddressSchema,
  snapshot: WalletAnalysisSnapshotSchema.optional(),
  trades: WalletAnalysisTradesSchema.optional(),
  balance: WalletAnalysisBalanceSchema.optional(),
  pnl: WalletAnalysisPnlSchema.optional(),
  warnings: z.array(WalletAnalysisWarningSchema),
});
export type WalletAnalysisResponse = z.infer<
  typeof WalletAnalysisResponseSchema
>;

/**
 * Query-input parser.
 * Accepts `?include=snapshot&include=trades` (repeated). Next.js route handlers
 * surface repeated params via `URLSearchParams.getAll('include')`.
 * Default (no `include`): `["snapshot"]`.
 */
export const WalletAnalysisQuerySchema = z.object({
  include: z.array(WalletAnalysisSliceSchema).nonempty().default(["snapshot"]),
  interval: PolyWalletOverviewIntervalSchema.optional().default("ALL"),
});
export type WalletAnalysisQuery = z.infer<typeof WalletAnalysisQuerySchema>;

export const polyWalletAnalysisOperation = {
  id: "poly.wallet-analysis.v1",
  summary: "Wallet analysis — deterministic metrics, trades, and balance",
  description:
    "Single route covering any 0x Polymarket wallet. Slice-scoped via `include` (snapshot, trades, balance, pnl). Numbers computed on demand from public Polymarket Data-API + CLOB resolutions plus Polymarket's public user-pnl service; no storage layer. Balance is positions-only for non-operator wallets. Each slice is independently optional in the response; partial failure surfaces via `warnings`.",
  input: z.object({
    addr: PolyAddressSchema,
    query: WalletAnalysisQuerySchema,
  }),
  output: WalletAnalysisResponseSchema,
} as const;
