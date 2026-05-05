// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/markets-table-alpha-leak`
 * Purpose: Locks the `isAlphaLeak` predicate that drives the dashboard
 *   Markets-table "alpha leak only" toggle. Any change in sign convention or
 *   field semantics on `WalletExecutionMarketGroup.pnlUsd` /
 *   `edgeGapUsdc` must keep these cases passing.
 * Scope: Pure unit test. No React, no DOM, no DB.
 * Invariants:
 *   - Predicate is `pnlUsd < 0 AND (pnlUsd + edgeGapUsdc) > 0`.
 *   - Boundaries (`pnlUsd === 0`, `targetPnl === 0`) are NOT alpha leaks.
 * Side-effects: none
 * Links: nodes/poly/app/src/app/(app)/_components/markets-table/MarketsTable.tsx
 * @public
 */

import type { WalletExecutionMarketGroup } from "@cogni/poly-node-contracts";
import { describe, expect, it } from "vitest";

import { isAlphaLeak } from "@/app/(app)/_components/markets-table/MarketsTable";

function group(
  overrides: Partial<WalletExecutionMarketGroup> = {}
): WalletExecutionMarketGroup {
  return {
    groupKey: "condition:0xabc",
    eventTitle: null,
    eventSlug: null,
    marketCount: 1,
    status: "live",
    ourValueUsdc: 0,
    targetValueUsdc: 0,
    pnlUsd: 0,
    edgeGapUsdc: 0,
    edgeGapPct: null,
    hedgeCount: 0,
    lines: [],
    ...overrides,
  };
}

describe("isAlphaLeak", () => {
  it("returns true when we are red and target is green", () => {
    // pnlUsd = -50, edgeGap = +120 → targetPnl = +70.
    expect(isAlphaLeak(group({ pnlUsd: -50, edgeGapUsdc: 120 }))).toBe(true);
  });

  it("returns false when we are red and target is also red (less red)", () => {
    // pnlUsd = -100, edgeGap = +30 → targetPnl = -70 (still negative).
    expect(isAlphaLeak(group({ pnlUsd: -100, edgeGapUsdc: 30 }))).toBe(false);
  });

  it("returns false when we are green (no matter how the target did)", () => {
    expect(isAlphaLeak(group({ pnlUsd: 50, edgeGapUsdc: 200 }))).toBe(false);
    expect(isAlphaLeak(group({ pnlUsd: 50, edgeGapUsdc: -10 }))).toBe(false);
  });

  it("returns false at the zero boundary on either side", () => {
    // We are flat — not "lost".
    expect(isAlphaLeak(group({ pnlUsd: 0, edgeGapUsdc: 100 }))).toBe(false);
    // Target is flat — not "green".
    expect(isAlphaLeak(group({ pnlUsd: -10, edgeGapUsdc: 10 }))).toBe(false);
  });

  it("returns false when both are red and target is more red", () => {
    // pnlUsd = -10, edgeGap = -40 → targetPnl = -50.
    expect(isAlphaLeak(group({ pnlUsd: -10, edgeGapUsdc: -40 }))).toBe(false);
  });

  it("returns false when edgeGapUsdc is null (no target legs)", () => {
    // Solo market: we hold the position but no copy-target snapshot exists.
    // "Edge gap vs. nobody" is undefined, not a leak.
    expect(isAlphaLeak(group({ pnlUsd: -50, edgeGapUsdc: null }))).toBe(false);
    expect(isAlphaLeak(group({ pnlUsd: 50, edgeGapUsdc: null }))).toBe(false);
  });
});
