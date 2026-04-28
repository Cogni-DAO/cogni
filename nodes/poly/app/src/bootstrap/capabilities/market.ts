// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/market`
 * Purpose: Factory for MarketCapability — bridges ai-tools capability interface to market-provider adapters.
 * Scope: Creates MarketCapability from server environment. Does not implement transport or place trades.
 * Invariants:
 *   - NO_SECRETS_IN_CONTEXT: Kalshi credentials resolved from env, never passed to tools
 *   - READ_ONLY: Only listMarkets, no order placement
 * Side-effects: none (factory only)
 * Links: packages/market-provider/, work/items/task.0230.market-data-package.md
 * @internal
 */

import type {
  MarketProviderPort,
  NormalizedMarket,
} from "@cogni/market-provider";
import { KalshiAdapter } from "@cogni/market-provider/adapters/kalshi";
import { PolymarketAdapter } from "@cogni/market-provider/adapters/polymarket";
import type { MarketCapability, MarketListOutput } from "@cogni/poly-ai-tools";

/**
 * Convert NormalizedMarket[] from one or more providers into MarketListOutput.
 */
function toMarketListOutput(
  markets: NormalizedMarket[],
  providers: string[]
): MarketListOutput {
  return {
    markets: markets.map((m) => ({
      id: m.id,
      provider: m.provider as string,
      title: m.title,
      category: m.category,
      probabilityPct: Math.round(m.probabilityBps / 100),
      spreadBps: m.spreadBps,
      volume: m.volume,
      active: m.active,
      resolvesAt: m.resolvesAt,
    })),
    totalCount: markets.length,
    providers,
  };
}

/**
 * Create MarketCapability from server environment.
 *
 * - Polymarket: always available (public API, no auth)
 * - Kalshi: available if KALSHI_API_KEY + KALSHI_API_SECRET are set
 *
 * @returns MarketCapability backed by live market-provider adapters
 */
export function createMarketCapability(env?: {
  KALSHI_API_KEY?: string | undefined;
  KALSHI_API_SECRET?: string | undefined;
}): MarketCapability {
  const providers: MarketProviderPort[] = [];

  // Polymarket — always available (public Gamma API)
  providers.push(new PolymarketAdapter());

  // Kalshi — optional, requires RSA key credentials
  if (env?.KALSHI_API_KEY && env?.KALSHI_API_SECRET) {
    providers.push(
      new KalshiAdapter({
        credentials: {
          apiKey: env.KALSHI_API_KEY,
          apiSecret: env.KALSHI_API_SECRET,
        },
      })
    );
  }

  return {
    listMarkets: async (params) => {
      const targetProvider = params?.provider;
      const limit = params?.limit ?? 20;

      const active = providers.filter(
        (p) =>
          !targetProvider ||
          targetProvider === "all" ||
          p.provider === targetProvider
      );

      const results = await Promise.allSettled(
        active.map((p) =>
          p.listMarkets({
            activeOnly: true,
            limit,
            category: params?.category,
            search: params?.search,
          })
        )
      );

      const allMarkets: NormalizedMarket[] = [];
      const activeProviders: string[] = [];

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result?.status === "fulfilled") {
          allMarkets.push(...result.value);
          const provider = active[i]?.provider;
          if (provider) activeProviders.push(provider as string);
        }
        // Silently skip failed providers — partial results are fine
      }

      return toMarketListOutput(allMarkets, activeProviders);
    },
  };
}
