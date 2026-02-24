// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/hooks/useCurrentEpoch`
 * Purpose: React Query hook for current open/review epoch data.
 * Scope: Client-side data fetching for /gov/epoch page; does not access database directly. Multi-fetches ledger API endpoints and composes into EpochView.
 * Invariants: Typed with view model types from types.ts. Prefers open epoch, falls back to review.
 * Side-effects: IO (HTTP GET to ledger API endpoints)
 * Links: src/features/governance/types.ts, src/features/governance/lib/compose-epoch.ts
 * @public
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  AllocationDto,
  ApiActivityEvent,
  EpochDto,
} from "@/features/governance/lib/compose-epoch";
import { composeEpochView } from "@/features/governance/lib/compose-epoch";
import type { CurrentEpochData } from "@/features/governance/types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function fetchCurrentEpoch(): Promise<CurrentEpochData> {
  // 1. List all epochs, find the active one (prefer open, fall back to review)
  const { epochs } = await fetchJson<{ epochs: EpochDto[] }>(
    "/api/v1/ledger/epochs?limit=200"
  );
  const current =
    epochs.find((e) => e.status === "open") ??
    epochs.find((e) => e.status === "review");
  if (!current) return { epoch: null };

  // 2. Fetch allocations + activity for this epoch
  const [allocationsRes, activityRes] = await Promise.all([
    fetchJson<{ allocations: AllocationDto[] }>(
      `/api/v1/ledger/epochs/${current.id}/allocations`
    ),
    fetchJson<{ events: ApiActivityEvent[] }>(
      `/api/v1/ledger/epochs/${current.id}/activity?limit=200`
    ),
  ]);

  // 3. Compose view model
  return {
    epoch: composeEpochView(
      current,
      allocationsRes.allocations,
      activityRes.events
    ),
  };
}

export function useCurrentEpoch(): UseQueryResult<CurrentEpochData, Error> {
  return useQuery({
    queryKey: ["governance", "epoch", "current"],
    queryFn: fetchCurrentEpoch,
    staleTime: 60_000,
  });
}
