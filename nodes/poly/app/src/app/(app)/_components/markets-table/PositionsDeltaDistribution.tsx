// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/_components/markets-table/PositionsDeltaDistribution`
 * Purpose: Per-position |Δ| histogram for the Open Positions and History
 *   tabs. Cardinality differs from `MarketsDeltaDistribution` — one item
 *   per position (held by us) rather than one per event-group rollup.
 *   Each position is joined to the per-condition `WalletExecutionMarketLine`
 *   by `conditionId`; that line carries the line-level `edgeGapPct`
 *   (`targetReturnPct − ourReturnPct`, fractional).
 * Scope: Pure client component. No fetch — caller passes both `positions`
 *   and `groups` (already in dashboard state).
 * Invariants:
 *   - JOIN_BY_CONDITION_ID: positions without a matching line drop from
 *     the histogram (silently — they are by definition not comparable).
 *   - STATUS_AT_LINE: line `status` ("live" | "closed") drives the
 *     filter, not position lifecycle. The Open tab passes `live`,
 *     History passes `closed`.
 *   - ABSOLUTE_VALUE: bins on `Math.abs(edgeGapPct)`. Sign asymmetry is
 *     a follow-up; v0 is variance-from-target.
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

import type { WalletPosition } from "@/features/wallet-analysis";

import { DeltaDistribution } from "./DeltaDistribution";

export type PositionsDeltaDistributionProps = {
  positions?: readonly WalletPosition[] | undefined;
  groups?: readonly WalletExecutionMarketGroup[] | undefined;
  /** Drives both the line-status filter and the displayed subtitle. */
  statusFilter: WalletExecutionMarketLineStatus;
};

export function PositionsDeltaDistribution({
  positions,
  groups,
  statusFilter,
}: PositionsDeltaDistributionProps): ReactElement | null {
  const absDeltaPcts = useMemo(() => {
    const lineByCondition = new Map<
      string,
      { edgeGapPct: number; status: WalletExecutionMarketLineStatus }
    >();
    for (const g of groups ?? []) {
      for (const line of g.lines) {
        if (line.edgeGapPct === null) continue;
        lineByCondition.set(line.conditionId, {
          edgeGapPct: line.edgeGapPct,
          status: line.status,
        });
      }
    }
    const out: number[] = [];
    for (const p of positions ?? []) {
      const line = lineByCondition.get(p.conditionId);
      if (!line) continue;
      if (line.status !== statusFilter) continue;
      out.push(Math.abs(line.edgeGapPct * 100));
    }
    return out;
  }, [positions, groups, statusFilter]);

  return (
    <DeltaDistribution absDeltaPcts={absDeltaPcts} subtitle={statusFilter} />
  );
}
