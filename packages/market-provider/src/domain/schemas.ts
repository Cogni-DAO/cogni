// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/domain/schemas`
 * Purpose: Zod schemas for normalized prediction market types.
 * Scope: Pure type definitions. Does not contain I/O or adapter dependencies.
 * Invariants: OBSERVATION_IDEMPOTENT (market IDs deterministic), PACKAGES_NO_ENV.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

import { z } from "zod";

export const MarketProviderSchema = z.enum(["polymarket", "kalshi"]);
export type MarketProvider = z.infer<typeof MarketProviderSchema>;

export const MarketOutcomeSchema = z.object({
  label: z.string(),
  /** Probability in basis points (0–10000) */
  probabilityBps: z.number().int().min(0).max(10000),
});
export type MarketOutcome = z.infer<typeof MarketOutcomeSchema>;

/**
 * Platform-normalized prediction market.
 * ID format: "prediction-market:{provider}:{sourceId}" (OBSERVATION_IDEMPOTENT)
 */
export const NormalizedMarketSchema = z.object({
  /** Deterministic: "prediction-market:{provider}:{sourceId}" */
  id: z.string(),
  provider: MarketProviderSchema,
  sourceId: z.string(),
  title: z.string(),
  category: z.string(),
  /** YES probability in basis points (0–10000) */
  probabilityBps: z.number().int().min(0).max(10000),
  /** Bid-ask spread in basis points */
  spreadBps: z.number().int().min(0),
  volume: z.number(),
  outcomes: z.array(MarketOutcomeSchema),
  resolvesAt: z.string(),
  active: z.boolean(),
  /** Platform-specific fields (conditionId, eventTicker, etc.) */
  attributes: z.record(z.string(), z.unknown()),
  updatedAt: z.string(),
});
export type NormalizedMarket = z.infer<typeof NormalizedMarketSchema>;

export const ListMarketsParamsSchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  activeOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});
export type ListMarketsParams = z.infer<typeof ListMarketsParamsSchema>;
