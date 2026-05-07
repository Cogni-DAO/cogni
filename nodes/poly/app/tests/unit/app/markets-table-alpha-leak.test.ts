// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/markets-table-alpha-leak`
 * Purpose: Locks the `isAlphaLeak` predicate that drives the dashboard
 *   Markets-table "alpha leak only" toggle.
 * Scope: Pure unit test. No React, no DOM, no DB.
 * Invariants:
 *   - Predicate is `pnlUsd < 0 AND edgeGapPct > 0` (we lost AND targets'
 *     blended return outperformed ours, in pp terms).
 *   - Null `edgeGapPct` short-circuits to false (no comparable targets).
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
    edgeGapPct: 0,
    hedgeCount: 0,
    lines: [],
    ...overrides,
  };
}

describe("isAlphaLeak", () => {
  it("returns true when we lost and targets' return outperformed ours", () => {
    // We are red ($-50) and target's blended return is 5pp ahead of ours.
    expect(isAlphaLeak(group({ pnlUsd: -50, edgeGapPct: 0.05 }))).toBe(true);
  });

  it("returns true when we lost and targets outperformed even slightly", () => {
    // Both may still be in absolute red, but targets did relatively better —
    // alpha leaked in % terms.
    expect(isAlphaLeak(group({ pnlUsd: -100, edgeGapPct: 0.02 }))).toBe(true);
  });

  it("returns false when we are green (no matter what targets did)", () => {
    expect(isAlphaLeak(group({ pnlUsd: 50, edgeGapPct: 0.2 }))).toBe(false);
    expect(isAlphaLeak(group({ pnlUsd: 50, edgeGapPct: -0.1 }))).toBe(false);
  });

  it("returns false at the zero boundary on either side", () => {
    // We are flat — not "lost".
    expect(isAlphaLeak(group({ pnlUsd: 0, edgeGapPct: 0.1 }))).toBe(false);
    // Targets matched our return — not a leak.
    expect(isAlphaLeak(group({ pnlUsd: -10, edgeGapPct: 0 }))).toBe(false);
  });

  it("returns false when we are red but our return outperformed targets", () => {
    // edgeGapPct < 0 means we beat targets in % terms even though we lost $.
    expect(isAlphaLeak(group({ pnlUsd: -10, edgeGapPct: -0.04 }))).toBe(false);
  });

  it("returns false when edgeGapPct is null (no comparable targets)", () => {
    expect(isAlphaLeak(group({ pnlUsd: -50, edgeGapPct: null }))).toBe(false);
    expect(isAlphaLeak(group({ pnlUsd: 50, edgeGapPct: null }))).toBe(false);
  });
});
