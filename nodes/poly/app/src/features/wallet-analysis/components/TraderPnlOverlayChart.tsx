// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/TraderPnlOverlayChart`
 * Purpose: Multi-series PnL trajectory overlay for the research viewport — same area-chart visual as `WalletProfitLossCard`, but plotting up to three traders on the same axes so RN1 / swisstony / your wallet can be compared at a glance.
 * Scope: Presentational. Receives the trader-comparison contract; toggles between "% of peak swing" (default) and "$ delta" modes.
 * Invariants:
 *   - PCT_NORMALIZED_PER_SERIES: in % mode each series is rebased to its own first point and scaled by its own max-magnitude swing, so wildly different wallet sizes share one axis without one dominating.
 *   - DOLLAR_IS_RAW_DELTA: $ mode plots `pnl[i] − pnl[0]` per series on a shared axis — small wallets will read flat against whales, by design.
 *   - SAFE_NORMALIZATION: zero-magnitude series degrade to 0 instead of NaN.
 * Side-effects: none
 * @public
 */

"use client";

import type {
  PolyResearchTraderComparisonResponse,
  PolyResearchTraderComparisonTrader,
} from "@cogni/poly-node-contracts";
import { type ReactElement, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "@/components";
import { cn } from "@/shared/util/cn";

type OverlayMode = "pct" | "usd";

const SERIES_COLORS = [
  "#0ea5e9",
  "#10b981",
  "#fbbf24",
  "#d946ef",
  "#f43f5e",
  "#67e8f9",
] as const;

export function TraderPnlOverlayChart({
  data,
  isLoading,
  isError,
}: {
  data?: PolyResearchTraderComparisonResponse | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
}): ReactElement {
  const [mode, setMode] = useState<OverlayMode>("pct");
  const traders = data?.traders ?? [];

  const { rows, seriesKeys } = useMemo(
    () => buildOverlayRows(traders),
    [traders]
  );
  const config = useMemo(() => {
    const out: Record<string, { label: string; color: string }> = {};
    seriesKeys.forEach((key, i) => {
      out[key] = {
        label: key,
        color: SERIES_COLORS[i % SERIES_COLORS.length] ?? SERIES_COLORS[0],
      };
    });
    return out;
  }, [seriesKeys]);

  if (isLoading && !data) {
    return <div className="h-80 animate-pulse rounded bg-muted" />;
  }
  if (isError && traders.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Trader P/L overlay is unavailable.
      </p>
    );
  }
  if (traders.length === 0 || rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No P/L history available for the selected wallets.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TraderPnlSummary traders={traders} />
        <OverlayModeToggle mode={mode} onChange={setMode} />
      </div>
      <ChartContainer config={config} className="h-80 w-full">
        <AreaChart
          data={rows}
          margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
        >
          <defs>
            {seriesKeys.map((key, i) => (
              <linearGradient
                key={key}
                id={`trader-pnl-overlay-${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={
                    SERIES_COLORS[i % SERIES_COLORS.length] ?? SERIES_COLORS[0]
                  }
                  stopOpacity={0.28}
                />
                <stop
                  offset="95%"
                  stopColor={
                    SERIES_COLORS[i % SERIES_COLORS.length] ?? SERIES_COLORS[0]
                  }
                  stopOpacity={0.04}
                />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="ts"
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tickMargin={8}
            tickFormatter={formatDateTick}
          />
          <YAxis
            tickFormatter={(v) => formatYTick(Number(v), mode)}
            width={56}
          />
          <Tooltip
            cursor={false}
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0) return null;
              return (
                <div className="rounded border border-border/60 bg-background/95 p-2 text-xs shadow-md">
                  <div className="mb-1 font-medium text-muted-foreground">
                    {formatDateLabel(String(label))}
                  </div>
                  {payload.map((p) => {
                    const seriesKey = String(p.dataKey ?? "").replace(
                      mode === "pct" ? "_pct" : "_usd",
                      ""
                    );
                    return (
                      <div
                        key={String(p.dataKey)}
                        className="flex items-center gap-2"
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: String(p.color) }}
                        />
                        <span>{seriesKey}</span>
                        <span className="ml-auto font-mono">
                          {formatValue(Number(p.value), mode)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            height={28}
            iconType="circle"
            wrapperStyle={{ fontSize: "12px" }}
          />
          {seriesKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={`${key}_${mode === "pct" ? "pct" : "usd"}`}
              name={key}
              stroke={
                SERIES_COLORS[i % SERIES_COLORS.length] ?? SERIES_COLORS[0]
              }
              strokeWidth={2.5}
              fill={`url(#trader-pnl-overlay-${i})`}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

type OverlayRow = {
  ts: string;
  [key: string]: number | string | null;
};

function buildOverlayRows(
  traders: readonly PolyResearchTraderComparisonTrader[]
): { rows: OverlayRow[]; seriesKeys: readonly string[] } {
  const seriesKeys = traders.map((t) => t.label);
  const tsSet = new Set<string>();
  const seriesPoints = traders.map((t) => {
    const points = t.pnl.history;
    const baseline = points[0]?.pnl ?? 0;
    const deltas = points.map((p) => p.pnl - baseline);
    const peak = Math.max(...deltas.map((d) => Math.abs(d)), 0);
    const map = new Map<string, { usd: number; pct: number }>();
    points.forEach((p, i) => {
      const usd = deltas[i] ?? 0;
      const pct = peak > 0 ? (usd / peak) * 100 : 0;
      map.set(p.ts, { usd, pct });
      tsSet.add(p.ts);
    });
    return { label: t.label, map };
  });
  const tsList = Array.from(tsSet).sort();
  const rows: OverlayRow[] = tsList.map((ts) => {
    const row: OverlayRow = { ts };
    seriesPoints.forEach(({ label, map }) => {
      const point = map.get(ts);
      row[`${label}_usd`] = point ? point.usd : null;
      row[`${label}_pct`] = point ? point.pct : null;
    });
    return row;
  });
  return { rows, seriesKeys };
}

function OverlayModeToggle({
  mode,
  onChange,
}: {
  mode: OverlayMode;
  onChange: (mode: OverlayMode) => void;
}): ReactElement {
  return (
    <div className="inline-flex rounded border bg-muted p-0.5 text-xs">
      {(["pct", "usd"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "rounded px-2 py-1 font-medium uppercase tracking-wider transition-colors",
            mode === m
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {m === "pct" ? "% change" : "$ change"}
        </button>
      ))}
    </div>
  );
}

function TraderPnlSummary({
  traders,
}: {
  traders: readonly PolyResearchTraderComparisonTrader[];
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {traders.map((t, i) => {
        const usd = t.pnl.usdc;
        const cls =
          usd === null
            ? "text-muted-foreground"
            : usd > 0
              ? "text-success"
              : usd < 0
                ? "text-destructive"
                : "text-muted-foreground";
        return (
          <span key={t.address} className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{
                backgroundColor:
                  SERIES_COLORS[i % SERIES_COLORS.length] ?? SERIES_COLORS[0],
              }}
              aria-hidden
            />
            <span className="text-muted-foreground">{t.label}</span>
            <span className={cn("font-mono", cls)}>
              {usd === null ? "—" : formatSignedUsd(usd)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function formatDateTick(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateLabel(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatYTick(value: number, mode: OverlayMode): string {
  if (mode === "pct") return `${value.toFixed(0)}%`;
  return formatCompactUsd(value);
}

function formatValue(value: number, mode: OverlayMode): string {
  if (mode === "pct") return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
  return formatSignedUsd(value);
}

function formatSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatCompactUsd(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
