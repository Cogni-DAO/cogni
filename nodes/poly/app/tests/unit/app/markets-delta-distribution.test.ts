// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/markets-delta-distribution`
 * Purpose: Locks the bin-edge logic for the dashboard |Δ| distribution chart.
 * Scope: Pure unit test on `binIndex`. No React, no DOM.
 * Invariants:
 *   - Edges are CLOSED on the LEFT, OPEN on the RIGHT (`[lo, hi)`). 1.0 lands
 *     in bin "1–5%", not "<1%". The "<1%" goal contract is exclusive of 1%.
 *   - `0` lands in the "<1%" bin.
 *   - Anything ≥ 100 lands in "100%+".
 * Side-effects: none
 * Links: nodes/poly/app/src/app/(app)/_components/markets-table/MarketsDeltaDistribution.tsx
 * @public
 */

import { describe, expect, it } from "vitest";

import {
  BIN_LABELS,
  binIndex,
} from "@/app/(app)/_components/markets-table/MarketsDeltaDistribution";

const labelOf = (v: number): string => BIN_LABELS[binIndex(v)] ?? "";

describe("binIndex", () => {
  it("places 0 in the ideal <1% bin", () => {
    expect(labelOf(0)).toBe("<1%");
  });

  it("places sub-1% values in <1%", () => {
    expect(labelOf(0.99)).toBe("<1%");
  });

  it("treats exactly 1% as the next bin (right-open boundary)", () => {
    expect(labelOf(1)).toBe("1–5%");
  });

  it("places 5% on the 5–10% boundary", () => {
    expect(labelOf(5)).toBe("5–10%");
  });

  it("places 9.999% in 5–10%", () => {
    expect(labelOf(9.999)).toBe("5–10%");
  });

  it("places 10% in 10–25% (the goal-contract acceptable ceiling)", () => {
    expect(labelOf(10)).toBe("10–25%");
  });

  it("places 50% on the 50–100% boundary", () => {
    expect(labelOf(50)).toBe("50–100%");
  });

  it("places 99.99% in 50–100%", () => {
    expect(labelOf(99.99)).toBe("50–100%");
  });

  it("places exactly 100% in 100%+", () => {
    expect(labelOf(100)).toBe("100%+");
  });

  it("places 999% in 100%+ (the bug.5035 swisstony surge tail)", () => {
    expect(labelOf(999)).toBe("100%+");
  });
});
