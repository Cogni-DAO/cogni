// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/_lib/enrich-positions`
 * Purpose: Overlay live wallet-analysis enrichment onto DB-owned dashboard position rows.
 * Scope: Pure route helper. Does not fetch, persist, sort, or create rows.
 * Invariants:
 *   - DB_ROW_SET_OWNS_IDENTITY: enrichment never adds, removes, or reorders rows.
 *   - POSITION_MATCH_KEY: live overlays match only by `(conditionId, asset)`.
 *   - TRACE_IS_OBSERVED: missing live trace stays empty; no synthetic flatlines.
 * Side-effects: none
 * Links: docs/design/poly-dashboard-balance-and-positions.md
 * @internal
 */

import type { WalletExecutionPosition } from "@cogni/poly-node-contracts";

type Position = WalletExecutionPosition;

export function enrichWalletExecutionPositions(
  dbPositions: readonly Position[],
  livePositions: readonly Position[],
  capturedAt: Date
): Position[] {
  const liveByKey = new Map<string, Position>();
  for (const live of livePositions) {
    liveByKey.set(positionKey(live), live);
  }

  return dbPositions.map((db) => {
    const live = liveByKey.get(positionKey(db));
    if (!live) return db;

    const openedAt = earliestIso(db.openedAt, live.openedAt) ?? db.openedAt;
    const closedAt = db.closedAt ?? live.closedAt ?? null;
    const heldUntil = closedAt ?? capturedAt.toISOString();

    return {
      ...db,
      openedAt,
      closedAt,
      resolvesAt: db.resolvesAt ?? live.resolvesAt ?? null,
      heldMinutes: minutesBetween(openedAt, heldUntil),
      entryPrice: live.entryPrice,
      currentPrice: live.currentPrice,
      size: live.size,
      currentValue: live.currentValue,
      pnlUsd: live.pnlUsd,
      pnlPct: live.pnlPct,
      timeline: live.timeline.length > 0 ? [...live.timeline] : db.timeline,
      events: live.events.length > 0 ? [...live.events] : db.events,
    };
  });
}

function positionKey(
  position: Pick<Position, "conditionId" | "asset">
): string {
  return `${position.conditionId}:${position.asset}`;
}

function earliestIso(left: string, right: string): string | null {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) && !Number.isFinite(rightMs)) return null;
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return leftMs <= rightMs ? left : right;
}

function minutesBetween(startIso: string, endIso: string): number {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 60_000));
}
