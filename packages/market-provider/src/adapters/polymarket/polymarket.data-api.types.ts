// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket/polymarket.data-api.types`
 * Purpose: Zod schemas for the Polymarket Data API + Gamma public-search — leaderboard, user trades / activity / positions / value, market holders + trades, profiles.
 * Scope: Pure type definitions for API response validation. Does not contain I/O or runtime logic.
 * Invariants: PACKAGES_NO_ENV.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md, work/items/task.0386.poly-agent-wallet-research-v0.md, docs/research/poly-copy-trading-wallets.md
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

// ─────────────────────────────────────────────────────────────────────────────
// Additional Data API schemas (task.0386 — agent wallet research)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lifecycle event type on `GET /activity`.
 * Distinct from `/trades` — activity covers TRADE, SPLIT, MERGE, REDEEM, etc.
 */
export const ActivityEventTypeSchema = z.enum([
  "TRADE",
  "SPLIT",
  "MERGE",
  "REDEEM",
  "REWARD",
  "CONVERSION",
]);
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;

/**
 * Raw activity event from `GET /activity?user=<wallet>`.
 * `.passthrough()` — /activity responses are richer than /trades and vary by type.
 */
export const ActivityEventSchema = z
  .object({
    proxyWallet: z.string(),
    type: z.string(),
    timestamp: z.coerce.number(),
    conditionId: z.string().optional().nullable().default(""),
    asset: z.string().optional().nullable().default(""),
    side: z.string().optional().nullable().default(""),
    size: z.coerce.number().optional().default(0),
    usdcSize: z.coerce.number().optional().default(0),
    price: z.coerce.number().optional().default(0),
    outcome: z.string().optional().nullable().default(""),
    title: z.string().optional().nullable().default(""),
    slug: z.string().optional().nullable().default(""),
    eventSlug: z.string().optional().nullable().default(""),
    transactionHash: z.string().optional().nullable().default(""),
  })
  .passthrough();
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const ActivityEventsResponseSchema = z.array(ActivityEventSchema);

/**
 * `GET /value?user=<wallet>` — cheap wallet-value probe.
 * Shape verified against shaunlebron data-api gist: `[{ user, value }]`.
 */
export const UserValueEntrySchema = z
  .object({
    user: z.string(),
    value: z.coerce.number(),
  })
  .passthrough();
export const UserValueResponseSchema = z.array(UserValueEntrySchema);

/**
 * Single holder entry from `GET /holders?market=<conditionId>`.
 * Hidden-gem discovery input — lists wallets holding shares on a given market.
 */
export const MarketHolderSchema = z
  .object({
    proxyWallet: z.string(),
    asset: z.string().optional().nullable().default(""),
    outcomeIndex: z.coerce.number().optional().default(0),
    outcome: z.string().optional().nullable().default(""),
    amount: z.coerce.number().optional().default(0),
    name: z.string().optional().nullable().default(""),
    displayUsername: z.string().optional().nullable().default(""),
  })
  .passthrough();
export type MarketHolder = z.infer<typeof MarketHolderSchema>;

export const MarketHoldersResponseSchema = z.array(MarketHolderSchema);

/**
 * Raw trade on `GET /trades?market=<conditionId>` (market-level, no user filter).
 * Distinct from `PolymarketUserTrade` — includes both taker (proxyWallet) + maker addrs.
 */
export const MarketTradeSchema = z
  .object({
    proxyWallet: z.string(),
    makerAddress: z.string().optional().nullable().default(""),
    takerAddress: z.string().optional().nullable().default(""),
    side: z.enum(["BUY", "SELL"]),
    asset: z.string(),
    conditionId: z.string(),
    size: z.coerce.number(),
    price: z.coerce.number(),
    timestamp: z.coerce.number(),
    outcome: z.string().optional().default(""),
    outcomeIndex: z.coerce.number().optional().default(0),
    transactionHash: z.string().optional().default(""),
    name: z.string().optional().nullable().default(""),
    title: z.string().optional().nullable().default(""),
  })
  .passthrough();
export type MarketTrade = z.infer<typeof MarketTradeSchema>;

export const MarketTradesResponseSchema = z.array(MarketTradeSchema);

/**
 * Gamma `/public-search?profile=true` — handle → proxyWallet resolution.
 * Gamma has a different host (`gamma-api.polymarket.com`) than the Data API.
 */
export const GammaProfileSchema = z
  .object({
    name: z.string().optional().nullable().default(""),
    pseudonym: z.string().optional().nullable().default(""),
    displayUsername: z.string().optional().nullable().default(""),
    proxyWallet: z.string(),
    profileImage: z.string().optional().nullable().default(""),
    bio: z.string().optional().nullable().default(""),
  })
  .passthrough();
export type GammaProfile = z.infer<typeof GammaProfileSchema>;

/**
 * Gamma `/public-search` top-level response — we only care about `profiles`.
 */
export const GammaPublicSearchResponseSchema = z
  .object({
    profiles: z.array(GammaProfileSchema).optional().default([]),
  })
  .passthrough();
