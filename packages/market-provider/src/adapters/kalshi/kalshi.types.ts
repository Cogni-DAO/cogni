// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/kalshi/kalshi.types`
 * Purpose: Zod schemas for raw Kalshi Trading API response shapes.
 * Scope: Pure type definitions for API response validation. Does not contain I/O or runtime logic.
 * Invariants: PACKAGES_NO_ENV.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

import { z } from "zod";

/**
 * Raw market shape from Kalshi Trading API: GET /trade-api/v2/markets
 * Prices are dollar strings (e.g. "0.6200") — parse to float, multiply by 100 for cents, then by 100 for bps.
 * Status values: "active", "closed", "settled" (not "open").
 */
export const KalshiRawMarketSchema = z.object({
  ticker: z.string(),
  title: z.string(),
  event_ticker: z.string(),
  status: z.string(),
  expiration_time: z.string(),
  close_time: z.string().optional().nullable(),
  /** Dollar-denominated string prices */
  yes_bid_dollars: z.string().default("0.0000"),
  yes_ask_dollars: z.string().default("0.0000"),
  no_bid_dollars: z.string().default("0.0000"),
  no_ask_dollars: z.string().default("0.0000"),
  /** Dollar-denominated string volumes */
  volume_fp: z.string().default("0.00"),
  volume_24h_fp: z.string().default("0.00"),
  /** Price format indicator */
  response_price_units: z.string().optional(),
});
export type KalshiRawMarket = z.infer<typeof KalshiRawMarketSchema>;

/** Kalshi paginated response envelope */
export const KalshiMarketsResponseSchema = z.object({
  markets: z.array(KalshiRawMarketSchema),
  cursor: z.string().optional().nullable(),
});
export type KalshiMarketsResponse = z.infer<typeof KalshiMarketsResponseSchema>;
