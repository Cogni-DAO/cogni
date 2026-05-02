// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_hooks/useDashboardExecution`
 * Purpose: Progressive dashboard execution query: render the DB read model first,
 * then replace it with live Polymarket enrichment when available.
 * Scope: Client-side React Query composition only. No route logic.
 * Side-effects: IO (HTTP fetch via React Query).
 * Links: docs/design/poly-dashboard-balance-and-positions.md
 * @internal
 */

"use client";

import type { PolyWalletExecutionOutput } from "@cogni/poly-node-contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchExecution } from "../_api/fetchExecution";

const EXECUTION_REFETCH_MS = 30_000;

export function useDashboardExecution(opts?: {
  includeLive?: boolean;
  onLiveData?: (data: PolyWalletExecutionOutput) => void;
}): {
  data: PolyWalletExecutionOutput | undefined;
  isLoading: boolean;
  isError: boolean;
  isLiveEnriching: boolean;
} {
  const includeLive = opts?.includeLive ?? true;
  const onLiveData = opts?.onLiveData;

  const readModelQuery = useQuery({
    queryKey: ["dashboard-wallet-execution", "read_model"],
    queryFn: () => fetchExecution({ freshness: "read_model" }),
    refetchInterval: EXECUTION_REFETCH_MS,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const liveQuery = useQuery({
    queryKey: ["dashboard-wallet-execution", "live"],
    queryFn: () => fetchExecution({ freshness: "live" }),
    refetchInterval: EXECUTION_REFETCH_MS,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
    enabled: includeLive,
  });

  useEffect(() => {
    if (liveQuery.data) onLiveData?.(liveQuery.data);
  }, [liveQuery.data, onLiveData]);

  const data = liveQuery.data ?? readModelQuery.data;

  return {
    data,
    isLoading:
      data === undefined &&
      (readModelQuery.isLoading || (includeLive && liveQuery.isLoading)),
    isError:
      data === undefined &&
      readModelQuery.isError &&
      (!includeLive || liveQuery.isError),
    isLiveEnriching:
      data !== undefined &&
      data.freshness === "read_model" &&
      includeLive &&
      liveQuery.isFetching,
  };
}
