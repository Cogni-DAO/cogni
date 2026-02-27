// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/hooks/useEpochHistory`
 * Purpose: React Query hook for finalized epoch history with contributor drill-down.
 * Scope: Client-side data fetching for /gov/history page; does not access database directly. Fetches finalized epochs, then for each fetches statement + activity, composing into EpochView[].
 * Invariants:
 *   - Uses payout statements as source of truth for finalized epochs (frozen, deterministic)
 *   - Throws if a finalized epoch has no statement (data integrity violation)
 * Side-effects: IO (HTTP GET to ledger API endpoints)
 * Links: src/features/governance/types.ts, src/features/governance/lib/compose-epoch.ts
 * @public
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import pLimit from "p-limit";
import type {
  ApiIngestionReceipt,
  EpochDto,
  StatementDto,
} from "@/features/governance/lib/compose-epoch";
import { composeEpochViewFromStatement } from "@/features/governance/lib/compose-epoch";
import type { EpochHistoryData, EpochView } from "@/features/governance/types";

const limit = pLimit(3);

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

async function fetchHistory(): Promise<EpochHistoryData> {
  const { epochs } = await fetchJson<{ epochs: EpochDto[] }>(
    "/api/v1/ledger/epochs?limit=200"
  );
  const finalized = epochs.filter((e) => e.status === "finalized");

  const views: EpochView[] = await Promise.all(
    finalized.map((epoch) =>
      limit(async () => {
        const [statementRes, activityRes] = await Promise.all([
          fetchJson<{ statement: StatementDto | null }>(
            `/api/v1/ledger/epochs/${epoch.id}/statement`
          ),
          fetchJson<{ events: ApiIngestionReceipt[] }>(
            `/api/v1/ledger/epochs/${epoch.id}/activity?limit=200`
          ),
        ]);

        if (!statementRes.statement) {
          throw new Error(
            `Epoch ${epoch.id} is finalized but has no payout statement — data integrity issue`
          );
        }

        return composeEpochViewFromStatement(
          epoch,
          statementRes.statement,
          activityRes.events
        );
      })
    )
  );

  return { epochs: views };
}

export function useEpochHistory(): UseQueryResult<EpochHistoryData, Error> {
  return useQuery({
    queryKey: ["governance", "epoch", "history"],
    queryFn: fetchHistory,
    staleTime: 60_000,
  });
}
