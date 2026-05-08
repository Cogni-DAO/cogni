// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/_components/markets-table/MarketsDeltaDistribution`
 * Purpose: |Δ| (`edgeGapPct`) distribution across live markets — sibling
 *   of `MarketsTable`. Surfaces the dispersion the row-by-row table can't:
 *   "are most markets near 0% gap, or is the long tail eating us?"
 * Scope: Pure client component. No fetch — receives the same
 *   `groups` array the table receives, derives bins in-memory.
 *   Bounded by `live.length` (≤ a few hundred), no V8 risk.
 * Invariants:
 *   - LIVE_ONLY: closed markets are excluded; their gaps are realized P/L
 *     and not tracking variance.
 *   - ABSOLUTE_VALUE: bins on `Math.abs(edgeGapPct)`. Sign asymmetry is a
 *     follow-up; v0 is variance-from-target.
 *   - BIN_BOUNDARIES_FIXED: 0, 1, 5, 10, 25, 50, 100, ∞ (% units). Driven
 *     by the goal contract: ideal <1%, acceptable <10%, anything past 25%
 *     is mirror-loop pathology.
 * Side-effects: none
 * @public
 */

"use client";

import type { WalletExecutionMarketGroup } from "@cogni/poly-node-contracts";
import type { ReactElement } from "react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/vendor/shadcn/chart";

export const BIN_BOUNDARIES = [
  0,
  1,
  5,
  10,
  25,
  50,
  100,
  Number.POSITIVE_INFINITY,
];
export const BIN_LABELS = [
  "<1%",
  "1–5%",
  "5–10%",
  "10–25%",
  "25–50%",
  "50–100%",
  "100%+",
];

// Green → amber → red gradient. Bin 0 is the "ideal" goal contract; bin 6 is
// pathology. Hard-coded hex (not theme tokens) so the gradient survives
// dark/light mode without duplicating the curve in CSS.
const BIN_COLORS = [
  "#22c55e", // <1%   ideal
  "#84cc16", // 1–5%
  "#eab308", // 5–10%
  "#f97316", // 10–25%
  "#ef4444", // 25–50%
  "#dc2626", // 50–100%
  "#991b1b", // 100%+
];

const CHART_CONFIG: ChartConfig = {
  count: {
    label: "Markets",
    color: "var(--chart-1)",
  },
};

export function binIndex(absDeltaPct: number): number {
  for (let i = 0; i < BIN_BOUNDARIES.length - 1; i += 1) {
    if (
      absDeltaPct >= BIN_BOUNDARIES[i] &&
      absDeltaPct < BIN_BOUNDARIES[i + 1]
    ) {
      return i;
    }
  }
  return BIN_LABELS.length - 1;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export type MarketsDeltaDistributionProps = {
  groups?: readonly WalletExecutionMarketGroup[] | undefined;
};

export function MarketsDeltaDistribution({
  groups,
}: MarketsDeltaDistributionProps): ReactElement | null {
  const { bars, stats, comparable } = useMemo(() => {
    const live = (groups ?? []).filter((g) => g.status === "live");
    const withGap = live.filter(
      (g): g is WalletExecutionMarketGroup & { edgeGapPct: number } =>
        g.edgeGapPct !== null
    );
    const abs = withGap.map((g) => Math.abs(g.edgeGapPct * 100));
    const counts = new Array(BIN_LABELS.length).fill(0) as number[];
    for (const v of abs) counts[binIndex(v)] += 1;
    const meanAbs =
      abs.length > 0 ? abs.reduce((s, v) => s + v, 0) / abs.length : 0;
    const medAbs = median(abs);
    const under1 = abs.filter((v) => v < 1).length;
    const under10 = abs.filter((v) => v < 10).length;
    return {
      bars: BIN_LABELS.map((label, i) => ({
        bin: label,
        count: counts[i],
        fill: BIN_COLORS[i],
      })),
      stats: { meanAbs, medAbs, under1, under10, total: abs.length },
      comparable: abs.length,
    };
  }, [groups]);

  if (comparable === 0) return null;

  const pctUnder1 = Math.round((stats.under1 / stats.total) * 100);
  const pctUnder10 = Math.round((stats.under10 / stats.total) * 100);

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-card/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider">
            |Δ| distribution
          </h4>
          <span className="text-muted-foreground text-xs">
            live · n={stats.total}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 font-mono text-muted-foreground text-xs tabular-nums">
          <span>
            mean{" "}
            <span className="text-foreground">{stats.meanAbs.toFixed(1)}%</span>
          </span>
          <span>
            median{" "}
            <span className="text-foreground">{stats.medAbs.toFixed(1)}%</span>
          </span>
          <span>
            &lt;1% <span className="text-foreground">{pctUnder1}%</span>
          </span>
          <span>
            &lt;10% <span className="text-foreground">{pctUnder10}%</span>
          </span>
        </div>
      </div>
      <ChartContainer config={CHART_CONFIG} className="aspect-auto h-24 w-full">
        <BarChart
          data={bars}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          barCategoryGap="14%"
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="bin"
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            fontSize={11}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={28}
            allowDecimals={false}
            fontSize={11}
          />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent indicator="dot" />}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {bars.map((b) => (
              <Cell key={b.bin} fill={b.fill} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}
