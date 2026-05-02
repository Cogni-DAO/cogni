// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_hooks/useTradingWalletOverview`
 * Purpose: Progressive trading-wallet summary query: current cash/read-model
 * balances first, live Polymarket valuation and P/L chart second.
 * Scope: Client-side React Query composition only. No route logic.
 * Side-effects: IO (HTTP fetch via React Query).
 * Links: docs/design/poly-dashboard-balance-and-positions.md
 * @internal
 */

"use client";

import type {
  PolyWalletOverviewInterval,
  PolyWalletOverviewOutput,
} from "@cogni/poly-node-contracts";
import { useQuery } from "@tanstack/react-query";
import { fetchTradingWallet } from "../_api/fetchTradingWallet";

const TRADING_WALLET_OVERVIEW_REFETCH_MS = 5 * 60_000;

export function useTradingWalletOverview(
  interval: PolyWalletOverviewInterval
): {
  data: PolyWalletOverviewOutput | undefined;
  isLoading: boolean;
  isError: boolean;
  isLiveEnriching: boolean;
} {
  const readModelQuery = useQuery({
    queryKey: ["dashboard-trading-wallet", "read_model", interval],
    queryFn: () => fetchTradingWallet(interval, { freshness: "read_model" }),
    refetchInterval: TRADING_WALLET_OVERVIEW_REFETCH_MS,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const liveQuery = useQuery({
    queryKey: ["dashboard-trading-wallet", "live", interval],
    queryFn: () => fetchTradingWallet(interval, { freshness: "live" }),
    refetchInterval: TRADING_WALLET_OVERVIEW_REFETCH_MS,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const data = liveQuery.data ?? readModelQuery.data;

  return {
    data,
    isLoading:
      data === undefined && (readModelQuery.isLoading || liveQuery.isLoading),
    isError: data === undefined && readModelQuery.isError && liveQuery.isError,
    isLiveEnriching:
      data !== undefined &&
      data.freshness === "read_model" &&
      liveQuery.isFetching,
  };
}
