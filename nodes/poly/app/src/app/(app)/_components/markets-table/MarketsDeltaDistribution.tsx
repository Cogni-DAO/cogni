// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/_components/markets-table/MarketsDeltaDistribution`
 * Purpose: Per-event-group |Δ| histogram for the Markets tab. Thin
 *   adapter over `DeltaDistribution` — flattens the live `groups`
 *   into abs-percentage values (cost-basis-weighted blend per group).
 * Scope: Pure client component. No fetch.
 * Invariants:
 *   - LIVE_ONLY: closed groups are excluded; their gaps are realized P/L
 *     and not tracking variance.
 * Side-effects: none
 * @public
 */

"use client";

import type { WalletExecutionMarketGroup } from "@cogni/poly-node-contracts";
import type { ReactElement } from "react";
import { useMemo } from "react";

import { DeltaDistribution } from "./DeltaDistribution";

export type MarketsDeltaDistributionProps = {
  groups?: readonly WalletExecutionMarketGroup[] | undefined;
};

export function MarketsDeltaDistribution({
  groups,
}: MarketsDeltaDistributionProps): ReactElement | null {
  const absDeltaPcts = useMemo(() => {
    const live = (groups ?? []).filter((g) => g.status === "live");
    return live
      .filter(
        (g): g is WalletExecutionMarketGroup & { edgeGapPct: number } =>
          g.edgeGapPct !== null
      )
      .map((g) => Math.abs(g.edgeGapPct * 100));
  }, [groups]);

  return (
    <DeltaDistribution
      absDeltaPcts={absDeltaPcts}
      subtitle={`live · n=${absDeltaPcts.length}`}
    />
  );
}
