// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/kalshi/kalshi.normalizer`
 * Purpose: Pure normalizer — Kalshi Trading API response to NormalizedMarket.
 * Scope: Stateless transform for Kalshi raw types. Does not perform I/O or fetch.
 * Invariants: OBSERVATION_IDEMPOTENT (deterministic IDs), PACKAGES_NO_ENV.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

import type { NormalizedMarket } from "../../domain/schemas.js";
import type { KalshiRawMarket } from "./kalshi.types.js";

/**
 * Convert a dollar string (e.g. "0.6200") to basis points (6200).
 * Kalshi API returns prices as dollar-denominated strings.
 */
function dollarsToBps(dollars: string): number {
  return Math.round(Number.parseFloat(dollars) * 10000);
}

/**
 * Normalize a Kalshi Trading API market to NormalizedMarket.
 * Pure function — no I/O.
 *
 * Price conversion: Kalshi uses dollar strings (e.g. "0.62") → parse to float × 10000 for bps.
 */
export function normalizeKalshiMarket(raw: KalshiRawMarket): NormalizedMarket {
  const yesBidBps = dollarsToBps(raw.yes_bid_dollars);
  const yesAskBps = dollarsToBps(raw.yes_ask_dollars);
  const noBidBps = dollarsToBps(raw.no_bid_dollars);
  const spreadBps = yesAskBps - yesBidBps;

  return {
    id: `prediction-market:kalshi:${raw.ticker}`,
    provider: "kalshi",
    sourceId: raw.ticker,
    title: raw.title,
    category: "Other",
    probabilityBps: yesBidBps,
    spreadBps: Math.max(0, spreadBps),
    volume: Number.parseFloat(raw.volume_fp),
    outcomes: [
      { label: "Yes", probabilityBps: yesBidBps },
      { label: "No", probabilityBps: noBidBps },
    ],
    resolvesAt: raw.expiration_time,
    active: raw.status === "active",
    attributes: { eventTicker: raw.event_ticker },
    updatedAt: raw.close_time ?? raw.expiration_time,
  };
}
