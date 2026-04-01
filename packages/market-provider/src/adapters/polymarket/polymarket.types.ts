// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket/polymarket.types`
 * Purpose: Zod schemas for raw Polymarket Gamma API response shapes.
 * Scope: Pure type definitions for API response validation. Does not contain I/O or runtime logic.
 * Invariants: PACKAGES_NO_ENV.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

import { z } from "zod";

/**
 * Raw market shape from Polymarket Gamma API: GET /markets
 * Gotchas: outcomePrices is a JSON *string*, not parsed.
 * Prices are 0.0–1.0 (multiply by 10000 for bps).
 */
export const PolymarketRawMarketSchema = z.object({
  id: z.string(),
  question: z.string(),
  category: z.string().optional().nullable(),
  conditionId: z.string(),
  negRisk: z.boolean().optional().default(false),
  outcomePrices: z.string(), // JSON string: "[0.35, 0.65]"
  outcomes: z.string().or(z.array(z.string())), // May be JSON string or array
  volume: z.coerce.number().default(0),
  active: z.boolean(),
  closed: z.boolean(),
  endDate: z.string(),
  updatedAt: z.string().optional().default(""),
  spreadPrice: z.coerce.number().optional().default(0),
});
export type PolymarketRawMarket = z.infer<typeof PolymarketRawMarketSchema>;

/** Gamma API list response — array of markets */
export const PolymarketMarketsResponseSchema = z.array(
  PolymarketRawMarketSchema
);
