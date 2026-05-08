// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/_components/markets-table/MarketsDeltaDistribution`
 * Purpose: Per-event-group |Δ| histogram for the Markets tab. Thin
 *   adapter over `DeltaDistribution` — flattens the filtered `groups`
 *   into abs-percentage values (cost-basis-weighted blend per group).
 * Scope: Pure client component. No fetch.
 * Invariants:
 *   - REACTS_TO_FILTER: bins live or closed groups according to the
 *     parent panel's `statusFilter`. The dashboard's Live/Closed toggle
 *     is the single source of truth.
 * Side-effects: none
 * @public
 */

"use client";

import type {
  WalletExecutionMarketGroup,
  WalletExecutionMarketLineStatus,
} from "@cogni/poly-node-contracts";
import type { ReactElement } from "react";
import { useMemo } from "react";

import { DeltaDistribution } from "./DeltaDistribution";

export type MarketsDeltaDistributionProps = {
  groups?: readonly WalletExecutionMarketGroup[] | undefined;
  statusFilter: WalletExecutionMarketLineStatus;
};

export function MarketsDeltaDistribution({
  groups,
  statusFilter,
}: MarketsDeltaDistributionProps): ReactElement | null {
  const absDeltaPcts = useMemo(() => {
    return (groups ?? [])
      .filter((g) => g.status === statusFilter)
      .filter(
        (g): g is WalletExecutionMarketGroup & { edgeGapPct: number } =>
          g.edgeGapPct !== null
      )
      .map((g) => Math.abs(g.edgeGapPct * 100));
  }, [groups, statusFilter]);

  return (
    <DeltaDistribution absDeltaPcts={absDeltaPcts} subtitle={statusFilter} />
  );
}
