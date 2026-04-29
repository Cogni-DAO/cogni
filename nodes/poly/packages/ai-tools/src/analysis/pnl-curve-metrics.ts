// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools/analysis/pnl-curve-metrics`
 * Purpose: Pure-function reducer + 12-cell sparkline + numerical hard-filter verdict for a Polymarket wallet PnL time-series; drives the AI snapshot tool `core__poly_data_user_pnl_summary` per chr.poly-wallet-research §AI snapshot.
 * Scope: Pure deterministic compute. Does not perform I/O, does not load env, does not hit the network, does not persist anywhere — `now` is passed explicitly for replay determinism.
 * Invariants:
 *   - PURE: same input + same `now` → same output, always.
 *   - NUMERICAL_ROBUSTNESS: empty / single-point / constant / NaN / Infinity inputs return clean structured values, never throw.
 *   - SELF_NORMALIZED_SPARKLINE: sparkline maps wallet's own min/max to 8 quantile blocks — magnitude lives in metric strip, not shape.
 * Side-effects: none
 * Notes: Intentional v0 duplication of `packages/market-provider/src/analysis/pnl-curve-metrics.ts` (PR #1120) to keep this PR single-domain (poly-only). Once #1120 merges, this module collapses into the shared one and the tool re-imports.
 * Links: work/charters/POLY_WALLET_RESEARCH.md, work/items/task.0420.poly-wallet-curve-metrics-tools.md
 * @public
 */

export interface PnlCurvePoint {
  readonly t: number; // unix seconds
  readonly p: number; // cumulative realized PnL in USDC
}

export interface PnlCurveMetrics {
  readonly n: number;
  readonly monthsActive: number;
  readonly totalPnl: number;
  readonly peakPnl: number;
  readonly maxDdUsd: number;
  readonly maxDdPctOfPeak: number;
  readonly slope: number;
  readonly slopeR2: number;
  readonly slopeSign: 1 | -1 | 0;
  readonly daysSinceLastChange: number;
  readonly longestUpStreak: number;
  readonly dailyPositiveFraction: number;
  readonly degenerate: boolean;
}

export interface CharterVerdict {
  readonly passed: boolean;
  readonly reasons: readonly string[];
  readonly score: number;
  readonly confidence: number;
}

export interface PnlCurveSummary {
  readonly metrics: PnlCurveMetrics;
  readonly sparkline12: string;
  readonly verdict: CharterVerdict;
  readonly computedAt: string;
}

const SPARK_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
const SPARK_CELLS = 12;

const HARD_FILTERS = {
  monthsActive: 3,
  daysSinceLastTrade: 7,
  totalPnl: 500_000,
  maxDdPctOfPeak: 0.25,
} as const;

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function sanitize(points: readonly PnlCurvePoint[]): PnlCurvePoint[] {
  const seen = new Map<number, number>();
  for (const pt of points) {
    if (!pt) continue;
    if (!isFiniteNumber(pt.t) || !isFiniteNumber(pt.p)) continue;
    seen.set(pt.t, pt.p);
  }
  return [...seen.entries()]
    .map(([t, p]) => ({ t, p }))
    .sort((a, b) => a.t - b.t);
}

export function computeMetrics(
  rawPoints: readonly PnlCurvePoint[],
  now: number = Math.floor(Date.now() / 1000)
): PnlCurveMetrics {
  const points = sanitize(rawPoints);
  const n = points.length;

  const single = points[0];
  if (n < 2) {
    return {
      n,
      monthsActive: 0,
      totalPnl: single?.p ?? 0,
      peakPnl: single?.p ?? 0,
      maxDdUsd: 0,
      maxDdPctOfPeak: 0,
      slope: 0,
      slopeR2: 0,
      slopeSign: 0,
      daysSinceLastChange: 0,
      longestUpStreak: 0,
      dailyPositiveFraction: 0,
      degenerate: true,
    };
  }

  const first = points[0];
  const last = points[n - 1];
  if (!first || !last) {
    return computeMetrics([], now);
  }
  const totalPnl = last.p;
  const monthsActive = (last.t - first.t) / (86_400 * 30);

  let peak = -Infinity;
  let maxDd = 0;
  let peakAtMaxDd = 0;
  for (const pt of points) {
    if (pt.p > peak) peak = pt.p;
    const dd = peak - pt.p;
    if (dd > maxDd) {
      maxDd = dd;
      peakAtMaxDd = peak;
    }
  }
  const maxDdPctOfPeak = peakAtMaxDd > 0 ? maxDd / peakAtMaxDd : 0;

  let sumX = 0;
  let sumY = 0;
  for (const pt of points) {
    sumX += pt.t;
    sumY += pt.p;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;
  for (const pt of points) {
    const dx = pt.t - meanX;
    const dy = pt.p - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }

  const degenerate = !(ssXX > 0 && ssYY > 0);
  const slope = ssXX > 0 ? ssXY / ssXX : 0;
  const slopeR2 = degenerate ? 0 : (ssXY * ssXY) / (ssXX * ssYY);
  const slopeSign: 1 | -1 | 0 = degenerate
    ? 0
    : slope > 0
      ? 1
      : slope < 0
        ? -1
        : 0;

  const referenceNow = Math.max(now, last.t);
  let lastChangeT = last.t;
  for (let i = n - 1; i > 0; i--) {
    const cur = points[i];
    const prev = points[i - 1];
    if (cur && prev && cur.p !== prev.p) {
      lastChangeT = cur.t;
      break;
    }
  }
  const daysSinceLastChange = (referenceNow - lastChangeT) / 86_400;

  let streak = 0;
  let maxStreak = 0;
  let posSteps = 0;
  let nonZeroSteps = 0;
  for (let i = 1; i < n; i++) {
    const cur = points[i];
    const prev = points[i - 1];
    if (!cur || !prev) continue;
    const d = cur.p - prev.p;
    if (d > 0) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
      posSteps++;
      nonZeroSteps++;
    } else if (d < 0) {
      streak = 0;
      nonZeroSteps++;
    } else {
      streak = 0;
    }
  }
  const dailyPositiveFraction = nonZeroSteps > 0 ? posSteps / nonZeroSteps : 0;

  return {
    n,
    monthsActive,
    totalPnl,
    peakPnl: peak === -Infinity ? 0 : peak,
    maxDdUsd: maxDd,
    maxDdPctOfPeak,
    slope,
    slopeR2,
    slopeSign,
    daysSinceLastChange: Math.max(0, daysSinceLastChange),
    longestUpStreak: maxStreak,
    dailyPositiveFraction,
    degenerate,
  };
}

export function buildSparkline(rawPoints: readonly PnlCurvePoint[]): string {
  const points = sanitize(rawPoints);
  if (points.length < 2) return "";
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";
  const span = last.t - first.t;
  if (span <= 0) return "";

  const binMedians: number[] = [];
  for (let i = 0; i < SPARK_CELLS; i++) {
    const tStart = first.t + (span * i) / SPARK_CELLS;
    const tEnd = first.t + (span * (i + 1)) / SPARK_CELLS;
    const inBin = points.filter(
      (pt, idx) =>
        pt.t >= tStart &&
        (pt.t < tEnd || (idx === points.length - 1 && i === SPARK_CELLS - 1))
    );
    const median =
      inBin.length > 0
        ? inBin.map((pt) => pt.p).sort((a, b) => a - b)[
            Math.floor(inBin.length / 2)
          ]
        : undefined;
    if (median !== undefined) {
      binMedians.push(median);
    } else {
      const lastSeen = binMedians[binMedians.length - 1];
      binMedians.push(lastSeen ?? first.p);
    }
  }

  const minP = Math.min(...binMedians);
  const maxP = Math.max(...binMedians);
  const range = maxP - minP;
  if (range === 0) return SPARK_BLOCKS[3].repeat(SPARK_CELLS);
  return binMedians
    .map((p) => {
      const norm = (p - minP) / range;
      const idx = Math.min(
        SPARK_BLOCKS.length - 1,
        Math.floor(norm * SPARK_BLOCKS.length)
      );
      return SPARK_BLOCKS[idx];
    })
    .join("");
}

export function deriveVerdict(metrics: PnlCurveMetrics): CharterVerdict {
  const reasons: string[] = [];
  if (metrics.degenerate) reasons.push("degenerate-curve");
  if (metrics.monthsActive < HARD_FILTERS.monthsActive) {
    reasons.push(
      `monthsActive=${metrics.monthsActive.toFixed(1)} < ${HARD_FILTERS.monthsActive}`
    );
  }
  if (metrics.daysSinceLastChange > HARD_FILTERS.daysSinceLastTrade) {
    reasons.push(
      `daysSinceLastChange=${metrics.daysSinceLastChange.toFixed(1)} > ${HARD_FILTERS.daysSinceLastTrade}`
    );
  }
  if (metrics.totalPnl < HARD_FILTERS.totalPnl) {
    reasons.push(
      `totalPnl=${Math.round(metrics.totalPnl)} < ${HARD_FILTERS.totalPnl}`
    );
  }
  if (metrics.maxDdPctOfPeak > HARD_FILTERS.maxDdPctOfPeak) {
    reasons.push(
      `maxDdPctOfPeak=${(metrics.maxDdPctOfPeak * 100).toFixed(1)}% > ${HARD_FILTERS.maxDdPctOfPeak * 100}%`
    );
  }
  if (metrics.slopeSign <= 0) reasons.push("slope-not-positive");

  const curveQuality = Math.max(0, metrics.slopeSign * metrics.slopeR2);
  const magnitudeFactor =
    metrics.totalPnl > 0 ? Math.sqrt(metrics.totalPnl / 1_000_000) : 0;
  const livenessFactor =
    metrics.daysSinceLastChange < 1
      ? 1
      : Math.max(0, 1 - metrics.daysSinceLastChange / 14);
  const score = curveQuality * magnitudeFactor * livenessFactor;
  const confidence = Math.min(1, metrics.monthsActive / 12);

  return { passed: reasons.length === 0, reasons, score, confidence };
}

export function summarize(
  rawPoints: readonly PnlCurvePoint[],
  now: number = Math.floor(Date.now() / 1000)
): PnlCurveSummary {
  const metrics = computeMetrics(rawPoints, now);
  return {
    metrics,
    sparkline12: buildSparkline(rawPoints),
    verdict: deriveVerdict(metrics),
    computedAt: new Date(now * 1000).toISOString(),
  };
}
