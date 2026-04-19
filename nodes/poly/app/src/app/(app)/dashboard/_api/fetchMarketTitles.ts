// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchMarketTitles`
 * Purpose: Batch-resolve Polymarket condition IDs to human-readable market titles + slugs via the public Gamma API.
 * Scope: Data fetching only. No auth. No caching beyond React Query on the caller side.
 * Side-effects: IO (HTTPS fetch to gamma-api.polymarket.com)
 * @public
 */

export interface MarketTitle {
  conditionId: string;
  question: string;
  slug: string;
}

/** Map of conditionId (lowercased) → { question, slug }. Missing IDs are omitted. */
export type MarketTitleMap = Record<string, { question: string; slug: string }>;

/**
 * The copy-trade ledger stores market_id as a namespaced string —
 * `"prediction-market:polymarket:<conditionId>"` per the normalize-fill
 * adapter. Gamma only accepts the bare 0x... conditionId, so strip the
 * prefix before querying. Returns `null` when the input isn't a Polymarket
 * market id.
 */
export function extractConditionId(marketId: string | null): string | null {
  if (!marketId) return null;
  const prefix = "prediction-market:polymarket:";
  if (marketId.startsWith(prefix)) return marketId.slice(prefix.length);
  if (marketId.startsWith("0x") && marketId.length >= 10) return marketId; // tolerate bare conditionIds
  return null;
}

/**
 * Fetches market titles for up to ~50 condition IDs in one call.
 * The caller should dedupe + chunk if it has more than that.
 *
 * Calls our own `/api/v1/poly/markets` route, NOT Gamma directly —
 * gamma-api.polymarket.com returns no CORS headers, so direct browser
 * fetches are blocked. The proxy route on the poly-node forwards to
 * Gamma server-side.
 *
 * Returns an empty map on network / parse failure (graceful degrade —
 * the card falls back to rendering the truncated condition id).
 */
export async function fetchMarketTitles(
  conditionIds: readonly string[]
): Promise<MarketTitleMap> {
  if (conditionIds.length === 0) return {};

  const unique = Array.from(new Set(conditionIds.map((c) => c.toLowerCase())));
  const qs = new URLSearchParams({ condition_ids: unique.join(",") });

  try {
    const res = await fetch(`/api/v1/poly/markets?${qs.toString()}`);
    if (!res.ok) return {};
    const body = (await res.json()) as { markets: MarketTitle[] };
    const out: MarketTitleMap = {};
    for (const r of body.markets ?? []) {
      if (!r.conditionId) continue;
      out[r.conditionId.toLowerCase()] = {
        question: r.question ?? "",
        slug: r.slug ?? "",
      };
    }
    return out;
  } catch {
    return {};
  }
}
