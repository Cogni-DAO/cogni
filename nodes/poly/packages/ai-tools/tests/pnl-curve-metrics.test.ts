// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools/tests/pnl-curve-metrics`
 * Purpose: Unit tests for the poly-internal pnl-curve-metrics reducer that powers `core__poly_data_user_pnl_summary`. Covers numerical robustness gaps surfaced by the chr.poly-wallet-research 50-fresh subagent screen.
 * Scope: Pure-function tests. Does not touch network, filesystem, or any capability.
 * Invariants: NUMERICAL_ROBUSTNESS, PURE.
 * Side-effects: none
 * Links: work/charters/POLY_WALLET_RESEARCH.md
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  buildSparkline,
  computeMetrics,
  deriveVerdict,
  type PnlCurvePoint,
  summarize,
} from "../src/analysis/pnl-curve-metrics";

const NOW = 1777492800; // 2026-04-28T20:00:00Z
const DAY = 86_400;

function smoothUp(months: number, peak: number, n = 100): PnlCurvePoint[] {
  const arr: PnlCurvePoint[] = [];
  const span = months * 30 * DAY;
  for (let i = 0; i < n; i++) {
    arr.push({
      t: NOW - span + (span * i) / (n - 1),
      p: (peak * i) / (n - 1),
    });
  }
  return arr;
}

describe("pnl-curve-metrics — numerical robustness", () => {
  it("empty input → degenerate, all zeros, no throw", () => {
    const m = computeMetrics([]);
    expect(m.degenerate).toBe(true);
    expect(m.totalPnl).toBe(0);
    expect(m.slopeR2).toBe(0);
    expect(Number.isFinite(m.maxDdPctOfPeak)).toBe(true);
  });

  it("NaN / Infinity in input → silently dropped", () => {
    const dirty = [
      { t: NOW - 3 * DAY, p: 0 },
      { t: NOW - 2 * DAY, p: Number.NaN },
      { t: NOW - 1 * DAY, p: Number.POSITIVE_INFINITY },
      { t: NOW, p: 1000 },
    ] as PnlCurvePoint[];
    expect(computeMetrics(dirty).n).toBe(2);
  });

  it("constant series → degenerate, slopeSign=0", () => {
    const flat = Array.from({ length: 50 }, (_, i) => ({
      t: NOW - (50 - i) * DAY,
      p: 1000,
    }));
    const m = computeMetrics(flat);
    expect(m.degenerate).toBe(true);
    expect(m.slopeSign).toBe(0);
  });
});

describe("pnl-curve-metrics — known-good shape", () => {
  it("smooth uptrend over 9 months → swisstony-like profile", () => {
    const m = computeMetrics(smoothUp(9, 6_500_000), NOW);
    expect(m.slopeSign).toBe(1);
    expect(m.slopeR2).toBeGreaterThan(0.99);
    expect(m.totalPnl).toBeCloseTo(6_500_000, 0);
    expect(m.maxDdPctOfPeak).toBe(0);
  });
});

describe("buildSparkline", () => {
  it("smooth uptrend → ascending blocks ending in █", () => {
    const spark = buildSparkline(smoothUp(9, 6_500_000));
    expect(spark.length).toBe(12);
    expect(spark[spark.length - 1]).toBe("█");
  });

  it("self-normalizes — $7M and $100k same shape look identical", () => {
    expect(buildSparkline(smoothUp(9, 7_000_000))).toBe(
      buildSparkline(smoothUp(9, 100_000))
    );
  });

  it("degenerate input → empty string", () => {
    expect(buildSparkline([])).toBe("");
  });
});

describe("deriveVerdict — charter hard filters", () => {
  it("smooth-uptrend + $6.5M + 9mo → passes", () => {
    const v = deriveVerdict(computeMetrics(smoothUp(9, 6_500_000), NOW));
    expect(v.passed).toBe(true);
    expect(v.score).toBeGreaterThan(2);
  });

  it("PnL just under $500k → fails on H3", () => {
    const v = deriveVerdict(computeMetrics(smoothUp(9, 499_000), NOW));
    expect(v.passed).toBe(false);
    expect(v.reasons.some((r) => r.includes("totalPnl"))).toBe(true);
  });

  it("2-month wallet → fails on H1", () => {
    const v = deriveVerdict(computeMetrics(smoothUp(2, 1_000_000), NOW));
    expect(v.passed).toBe(false);
    expect(v.reasons.some((r) => r.includes("monthsActive"))).toBe(true);
  });

  it("degenerate → fails", () => {
    const v = deriveVerdict(computeMetrics([]));
    expect(v.passed).toBe(false);
    expect(v.score).toBe(0);
  });
});

describe("summarize — full pipeline determinism", () => {
  it("same input + same now → identical output", () => {
    const points = smoothUp(6, 1_000_000);
    expect(summarize(points, NOW)).toEqual(summarize(points, NOW));
  });
});
