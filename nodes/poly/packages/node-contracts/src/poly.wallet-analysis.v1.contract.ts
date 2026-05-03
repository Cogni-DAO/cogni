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
  "distributions",
  "benchmark",
]);
export type WalletAnalysisSlice = z.infer<typeof WalletAnalysisSliceSchema>;

/** Win/loss/pending outcome status for a single fill. */
export const OutcomeStatusSchema = z.enum(["won", "lost", "pending"]);
export type OutcomeStatus = z.infer<typeof OutcomeStatusSchema>;

const OutcomeCountsSchema = z.object({
  won: z.number().nonnegative(),
  lost: z.number().nonnegative(),
  pending: z.number().nonnegative(),
});

const OutcomeBucketsSchema = z.object({
  count: OutcomeCountsSchema,
  usdc: OutcomeCountsSchema,
});

/** Histogram bucket carrying outcome-split count + USDC sums. */
export const HistogramBucketSchema = z.object({
  lo: z.number(),
  hi: z.number(),
  label: z.string(),
  values: OutcomeBucketsSchema,
});
export type HistogramBucket = z.infer<typeof HistogramBucketSchema>;

export const HistogramSchema = z.object({
  buckets: z.array(HistogramBucketSchema),
});
export type Histogram = z.infer<typeof HistogramSchema>;

/** Flat histogram bucket (no outcome split — used for event clustering). */
export const FlatBucketSchema = z.object({
  lo: z.number(),
  hi: z.number(),
  label: z.string(),
  count: z.number().nonnegative(),
  usdc: z.number().nonnegative(),
});
export type FlatBucket = z.infer<typeof FlatBucketSchema>;

export const FlatHistogramSchema = z.object({
  buckets: z.array(FlatBucketSchema),
});
export type FlatHistogram = z.infer<typeof FlatHistogramSchema>;

const QuantilesSchema = z.object({
  p50: z.number(),
  p90: z.number(),
  max: z.number(),
});
export type Quantiles = z.infer<typeof QuantilesSchema>;

const TopEventSchema = z.object({
  slug: z.string(),
  title: z.string(),
  tradeCount: z.number().int().nonnegative(),
  usdcNotional: z.number().nonnegative(),
});
export type TopEvent = z.infer<typeof TopEventSchema>;

/**
 * Order-flow distributions slice.
 *
 * Per-fill bucket charts (DCA depth, trade size, entry price, DCA window,
 * hour-of-day) carry won/lost/pending outcome bands and USDC-weighted sums.
 * Event clustering is flat — events span sub-markets that resolve
 * independently, so the outcome split is meaningless at that aggregation.
 */
export const WalletAnalysisDistributionsSchema = z.object({
  /** Live (24-48h on-demand) vs historical (Doltgres-backed) source. */
  mode: z.enum(["live", "historical"]),
  range: z.object({
    fromTs: z.number().int().nonnegative(),
    toTs: z.number().int().nonnegative(),
    n: z.number().int().nonnegative(),
  }),
  dcaDepth: HistogramSchema,
  tradeSize: HistogramSchema,
  entryPrice: HistogramSchema,
  dcaWindow: HistogramSchema,
  hourOfDay: HistogramSchema,
  eventClustering: FlatHistogramSchema,
  topEvents: z.array(TopEventSchema),
  pendingShare: z.object({
    byCount: z.number().min(0).max(1),
    byUsdc: z.number().min(0).max(1),
  }),
  quantiles: z.object({
    dcaDepth: QuantilesSchema,
    tradeSize: QuantilesSchema,
    dcaWindowMin: QuantilesSchema,
  }),
  computedAt: z.string(),
});
export type WalletAnalysisDistributions = z.infer<
  typeof WalletAnalysisDistributionsSchema
>;

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

export const WalletAnalysisBenchmarkSchema = z.object({
  isObserved: z.boolean(),
  traderKind: z.enum(["copy_target", "cogni_wallet"]).nullable(),
  label: z.string().nullable(),
  window: PolyWalletOverviewIntervalSchema,
  coverage: z.object({
    observedSince: z.string().nullable(),
    lastSuccessAt: z.string().nullable(),
    status: z.string().nullable(),
    targetTrades: z.number().int().nonnegative(),
    cogniTrades: z.number().int().nonnegative(),
  }),
  summary: z.object({
    targetSizeUsdc: z.number(),
    cogniSizeUsdc: z.number(),
    copyCaptureRatio: z.number().nullable(),
    targetOpenValueUsdc: z.number(),
    cogniOpenValueUsdc: z.number(),
  }),
  markets: z.array(
    z.object({
      conditionId: z.string(),
      tokenId: z.string(),
      targetVwap: z.number().nullable(),
      cogniVwap: z.number().nullable(),
      targetSizeUsdc: z.number(),
      cogniSizeUsdc: z.number(),
      status: z.enum(["copied", "partial", "missed", "no_response_yet"]),
      reason: z.string(),
    })
  ),
  activeGaps: z.array(
    z.object({
      conditionId: z.string(),
      tokenId: z.string(),
      targetCurrentValueUsdc: z.number(),
      reason: z.string(),
    })
  ),
  computedAt: z.string(),
});
export type WalletAnalysisBenchmark = z.infer<
  typeof WalletAnalysisBenchmarkSchema
>;

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
  distributions: WalletAnalysisDistributionsSchema.optional(),
  benchmark: WalletAnalysisBenchmarkSchema.optional(),
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
  /**
   * Source mode for the `distributions` slice. `live` always succeeds for any
   * 0x address; `historical` reads saved observed trader fills from the
   * service database when the wallet is on the research roster.
   */
  distributionMode: z.enum(["live", "historical"]).optional().default("live"),
});
export type WalletAnalysisQuery = z.infer<typeof WalletAnalysisQuerySchema>;

export const polyWalletAnalysisOperation = {
  id: "poly.wallet-analysis.v1",
  summary: "Wallet analysis — deterministic metrics, trades, and balance",
  description:
    "Single route covering any 0x Polymarket wallet. Slice-scoped via `include` (snapshot, trades, balance, pnl, distributions, benchmark). On-demand slices read public Polymarket APIs; historical distributions and benchmarks read saved observed trader facts when available. Balance is positions-only for non-operator wallets. Each slice is independently optional in the response; partial failure surfaces via `warnings`.",
  input: z.object({
    addr: PolyAddressSchema,
    query: WalletAnalysisQuerySchema,
  }),
  output: WalletAnalysisResponseSchema,
} as const;
