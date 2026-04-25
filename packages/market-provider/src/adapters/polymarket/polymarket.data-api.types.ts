// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket/polymarket.data-api.types`
 * Purpose: Zod schemas for the Polymarket Data API — leaderboard, user trades, user positions.
 * Scope: Pure type definitions for API response validation. Does not contain I/O or runtime logic.
 * Invariants: PACKAGES_NO_ENV.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md, docs/research/poly-copy-trading-wallets.md
 * @public
 */

import { z } from "zod";

/**
 * Leaderboard time window.
 * Matches the `timePeriod` query param on `GET /v1/leaderboard`.
 * Verified 2026-04-17 — see docs/research/poly-copy-trading-wallets.md.
 */
export const PolymarketLeaderboardTimePeriodSchema = z.enum([
  "DAY",
  "WEEK",
  "MONTH",
  "ALL",
]);
export type PolymarketLeaderboardTimePeriod = z.infer<
  typeof PolymarketLeaderboardTimePeriodSchema
>;

/** Leaderboard sort metric. */
export const PolymarketLeaderboardOrderBySchema = z.enum(["PNL", "VOL"]);
export type PolymarketLeaderboardOrderBy = z.infer<
  typeof PolymarketLeaderboardOrderBySchema
>;

/**
 * Raw leaderboard entry from `GET /v1/leaderboard`.
 * Fixture: `docs/research/fixtures/polymarket-leaderboard.json`.
 * Gotchas: `rank` is a string ("1", "2", …), not a number.
 */
export const PolymarketLeaderboardEntrySchema = z.object({
  rank: z.string(),
  proxyWallet: z.string(),
  userName: z.string().nullable().default(""),
  xUsername: z.string().nullable().default(""),
  verifiedBadge: z.boolean().default(false),
  vol: z.coerce.number().default(0),
  pnl: z.coerce.number().default(0),
  profileImage: z.string().nullable().default(""),
});
export type PolymarketLeaderboardEntry = z.infer<
  typeof PolymarketLeaderboardEntrySchema
>;

export const PolymarketLeaderboardResponseSchema = z.array(
  PolymarketLeaderboardEntrySchema
);

/**
 * Raw user trade from `GET /trades?user=<wallet>`.
 * Only the fields we rely on are validated; extras pass through via `.passthrough()`.
 */
export const PolymarketUserTradeSchema = z
  .object({
    proxyWallet: z.string(),
    side: z.enum(["BUY", "SELL"]),
    asset: z.string(),
    conditionId: z.string(),
    size: z.coerce.number(),
    price: z.coerce.number(),
    timestamp: z.coerce.number(),
    title: z.string().optional().default(""),
    slug: z.string().optional().nullable().default(""),
    eventSlug: z.string().optional().nullable().default(""),
    icon: z.string().optional().nullable().default(""),
    outcome: z.string().optional().default(""),
    outcomeIndex: z.coerce.number().optional().default(0),
    transactionHash: z.string().optional().default(""),
  })
  .passthrough();
export type PolymarketUserTrade = z.infer<typeof PolymarketUserTradeSchema>;

export const PolymarketUserTradesResponseSchema = z.array(
  PolymarketUserTradeSchema
);

/**
 * Raw user position from `GET /positions?user=<wallet>`.
 * Covers open positions only — historical/closed are not exposed by the Data API.
 */
export const PolymarketUserPositionSchema = z
  .object({
    proxyWallet: z.string(),
    asset: z.string(),
    conditionId: z.string(),
    size: z.coerce.number(),
    avgPrice: z.coerce.number(),
    initialValue: z.coerce.number(),
    currentValue: z.coerce.number(),
    cashPnl: z.coerce.number(),
    percentPnl: z.coerce.number(),
    totalBought: z.coerce.number().optional().default(0),
    realizedPnl: z.coerce.number(),
    percentRealizedPnl: z.coerce.number().optional().default(0),
    curPrice: z.coerce.number(),
    redeemable: z.boolean().default(false),
    mergeable: z.boolean().default(false),
    title: z.string().optional().default(""),
    slug: z.string().optional().nullable().default(""),
    icon: z.string().optional().nullable().default(""),
    eventId: z.string().optional().nullable().default(""),
    eventSlug: z.string().optional().nullable().default(""),
    outcome: z.string().optional().default(""),
    outcomeIndex: z.coerce.number().optional().default(0),
    oppositeOutcome: z.string().optional().nullable().default(""),
    oppositeAsset: z.string().optional().nullable().default(""),
    endDate: z.string().optional().nullable().default(""),
    negativeRisk: z.boolean().optional().default(false),
  })
  .passthrough();
export type PolymarketUserPosition = z.infer<
  typeof PolymarketUserPositionSchema
>;

export const PolymarketUserPositionsResponseSchema = z.array(
  PolymarketUserPositionSchema
);
