// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/wallet-analysis/trader-observation-service`
 * Purpose: Unit tests for pure live-observation paging helpers.
 * Scope: Fake Data API client only; no DB, no timers, no external I/O.
 * Invariants: POSITION_PAGINATION_IS_BOUNDED, PARTIAL_POSITION_POLLS_ARE_VISIBLE.
 * Side-effects: none
 * Links: src/features/wallet-analysis/server/trader-observation-service.ts
 * @internal
 */

import type {
  PolymarketDataApiClient,
  PolymarketUserPosition,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { describe, expect, it } from "vitest";
import { fetchTraderPositionsPages } from "@/features/wallet-analysis/server/trader-observation-service";

const WALLET = "0x1000000000000000000000000000000000005005";

type PositionCall = {
  wallet: string;
  limit?: number;
  offset?: number;
};

function position(asset: string): PolymarketUserPosition {
  return {
    proxyWallet: WALLET,
    asset,
    conditionId: `condition-${asset}`,
    size: 2,
    avgPrice: 0.5,
    initialValue: 1,
    currentValue: 1,
    cashPnl: 0,
    percentPnl: 0,
    realizedPnl: 0,
    curPrice: 0.5,
    redeemable: false,
    mergeable: false,
    title: `Market ${asset}`,
  };
}

function clientForPages(pages: PolymarketUserPosition[][]): {
  client: PolymarketDataApiClient;
  calls: PositionCall[];
} {
  const calls: PositionCall[] = [];
  return {
    calls,
    client: {
      async listUserPositions(
        wallet: string,
        params?: { limit?: number; offset?: number }
      ) {
        calls.push({
          wallet,
          limit: params?.limit,
          offset: params?.offset,
        });
        const page = Math.floor((params?.offset ?? 0) / (params?.limit ?? 1));
        return pages[page] ?? [];
      },
    } as unknown as PolymarketDataApiClient,
  };
}

describe("fetchTraderPositionsPages", () => {
  it("paginates until a short page proves the current position set is complete", async () => {
    const { client, calls } = clientForPages([
      Array.from({ length: 500 }, (_, i) => position(`a-${i}`)),
      [position("tail")],
    ]);

    const result = await fetchTraderPositionsPages({
      client,
      walletAddress: WALLET,
      maxPages: 10,
    });

    expect(result.complete).toBe(true);
    expect(result.positions).toHaveLength(501);
    expect(calls).toEqual([
      { wallet: WALLET, limit: 500, offset: 0 },
      { wallet: WALLET, limit: 500, offset: 500 },
    ]);
  });

  it("returns partial when the configured page cap is exhausted", async () => {
    const { client, calls } = clientForPages([
      Array.from({ length: 500 }, (_, i) => position(`a-${i}`)),
    ]);

    const result = await fetchTraderPositionsPages({
      client,
      walletAddress: WALLET,
      maxPages: 1,
    });

    expect(result.complete).toBe(false);
    expect(result.positions).toHaveLength(500);
    expect(calls).toEqual([{ wallet: WALLET, limit: 500, offset: 0 }]);
  });
});
