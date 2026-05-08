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

// Green → amber → red gradient. Bin 0 is the "ideal" goal contract; bin 6 is
// pathology. Hard-coded hex (not theme tokens) so the gradient survives
// dark/light mode without duplicating the curve in CSS.
//
// `lo` is inclusive, `hi` is exclusive. The terminal bin's `hi` is +Infinity
// so the search loop matches everything not already binned.
const BINS = [
  { label: "<1%", lo: 0, hi: 1, color: "#22c55e" },
  { label: "1–5%", lo: 1, hi: 5, color: "#84cc16" },
  { label: "5–10%", lo: 5, hi: 10, color: "#eab308" },
  { label: "10–25%", lo: 10, hi: 25, color: "#f97316" },
  { label: "25–50%", lo: 25, hi: 50, color: "#ef4444" },
  { label: "50–100%", lo: 50, hi: 100, color: "#dc2626" },
  { label: "100%+", lo: 100, hi: Number.POSITIVE_INFINITY, color: "#991b1b" },
] as const;

export const BIN_LABELS = BINS.map((b) => b.label);

const CHART_CONFIG: ChartConfig = {
  count: {
    label: "Markets",
    color: "var(--chart-1)",
  },
};

// Class strings extracted to consts so prettier-plugin-tailwindcss leaves
// them alone and biome's useSortedClasses can settle on a single ordering.
// Without the indirection the two formatters disagree on the sort order
// of `border` shorthand vs `border-<color>` and `text-<color>` vs typography
// modifiers, producing a fix-then-rerun loop.
const CONTAINER_CLASS =
  "space-y-2 rounded-md border border-border/60 bg-card/40 p-3";
const HEADER_ROW_CLASS =
  "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1";
const HEADER_LEFT_CLASS = "flex items-baseline gap-2";
const TITLE_CLASS =
  "font-semibold text-foreground text-xs uppercase tracking-wider";
const HEADER_META_CLASS = "text-muted-foreground text-xs";
const STATS_ROW_CLASS =
  "flex flex-wrap gap-x-3 font-mono text-muted-foreground text-xs tabular-nums";
const STAT_VALUE_CLASS = "text-foreground";
const CHART_WRAPPER_CLASS = "aspect-auto h-24 w-full";

export function binIndex(absDeltaPct: number): number {
  for (let i = 0; i < BINS.length; i += 1) {
    const b = BINS[i];
    if (b && absDeltaPct >= b.lo && absDeltaPct < b.hi) return i;
  }
  return BINS.length - 1;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
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
    const counts = new Array(BINS.length).fill(0) as number[];
    for (const v of abs) {
      const idx = binIndex(v);
      counts[idx] = (counts[idx] ?? 0) + 1;
    }
    const meanAbs =
      abs.length > 0 ? abs.reduce((s, v) => s + v, 0) / abs.length : 0;
    const medAbs = median(abs);
    const under1 = abs.filter((v) => v < 1).length;
    const under10 = abs.filter((v) => v < 10).length;
    return {
      bars: BINS.map((b, i) => ({
        bin: b.label,
        count: counts[i] ?? 0,
        fill: b.color,
      })),
      stats: { meanAbs, medAbs, under1, under10, total: abs.length },
      comparable: abs.length,
    };
  }, [groups]);

  if (comparable === 0) return null;

  const pctUnder1 = Math.round((stats.under1 / stats.total) * 100);
  const pctUnder10 = Math.round((stats.under10 / stats.total) * 100);

  return (
    <div className={CONTAINER_CLASS}>
      <div className={HEADER_ROW_CLASS}>
        <div className={HEADER_LEFT_CLASS}>
          <h4 className={TITLE_CLASS}>|Δ| distribution</h4>
          <span className={HEADER_META_CLASS}>live · n={stats.total}</span>
        </div>
        <div className={STATS_ROW_CLASS}>
          <span>
            mean{" "}
            <span className={STAT_VALUE_CLASS}>
              {stats.meanAbs.toFixed(1)}%
            </span>
          </span>
          <span>
            median{" "}
            <span className={STAT_VALUE_CLASS}>{stats.medAbs.toFixed(1)}%</span>
          </span>
          <span>
            &lt;1% <span className={STAT_VALUE_CLASS}>{pctUnder1}%</span>
          </span>
          <span>
            &lt;10% <span className={STAT_VALUE_CLASS}>{pctUnder10}%</span>
          </span>
        </div>
      </div>
      <ChartContainer config={CHART_CONFIG} className={CHART_WRAPPER_CLASS}>
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
