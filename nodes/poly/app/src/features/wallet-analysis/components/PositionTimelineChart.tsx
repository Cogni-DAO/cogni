// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/PositionTimelineChart`
 * Purpose: Compact, interactive price trace for a single position row.
 * Scope: Presentational only. Uses the app-standard chart stack so hover/cursor
 * behavior matches larger dashboard charts.
 * Invariants:
 *   - Y-axis is market price, not fabricated wallet value.
 *   - Open rows never show a close line.
 *   - Entry basis is always visible as a dashed horizontal reference.
 * Side-effects: none
 * @public
 */

"use client";

import type { ReactElement } from "react";
import {
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components";
import { cn } from "@/shared/util/cn";
import type {
  WalletPositionEvent,
  WalletPositionStatus,
  WalletPositionTimelinePoint,
} from "../types/wallet-analysis";

const CHART_CONFIG = {
  price: {
    label: "Price",
    color: "hsl(var(--foreground))",
  },
} satisfies ChartConfig;

export type PositionTimelineChartProps = {
  points?: readonly WalletPositionTimelinePoint[] | undefined;
  events?: readonly WalletPositionEvent[] | undefined;
  entryPrice: number;
  status: WalletPositionStatus;
  pnlUsd: number;
  className?: string | undefined;
  isLoading?: boolean | undefined;
};

export function PositionTimelineChart({
  points,
  events,
  entryPrice,
  status,
  pnlUsd,
  className,
  isLoading,
}: PositionTimelineChartProps): ReactElement {
  if (isLoading) {
    return (
      <div
        className={cn("h-12 w-full animate-pulse rounded bg-muted", className)}
      />
    );
  }

  if (!points || points.length < 2) {
    return (
      <div
        className={cn(
          "flex h-12 w-full items-center justify-center rounded border border-border/70 text-muted-foreground text-xs",
          className
        )}
      >
        No trace
      </div>
    );
  }

  const firstEvent = events?.find((event) => event.kind === "entry");
  const terminalEvent = [...(events ?? [])]
    .reverse()
    .find((event) => event.kind === "close" || event.kind === "redeemable");
  const tradeMarkers = (events ?? [])
    .filter((event) => event.kind === "add" || event.kind === "reduce")
    .slice(-4);
  const lastPoint = points.at(-1);
  const yDomain = getPriceDomain(points, entryPrice);

  return (
    <ChartContainer
      config={CHART_CONFIG}
      className={cn(
        "aspect-auto h-12 w-full min-w-[var(--dropdown-xl)]",
        className
      )}
    >
      <LineChart
        data={[...points]}
        margin={{ top: 4, right: 6, bottom: 4, left: 6 }}
      >
        <XAxis dataKey="ts" hide />
        <YAxis hide domain={yDomain} />
        <ChartTooltip
          cursor={{ stroke: "hsl(var(--border))", strokeDasharray: "3 3" }}
          content={<TimelineTooltip entryPrice={entryPrice} status={status} />}
        />

        <ReferenceLine
          y={entryPrice}
          stroke="hsl(var(--muted-foreground))"
          strokeOpacity={0.35}
          strokeDasharray="4 4"
        />

        {firstEvent ? (
          <ReferenceLine
            x={firstEvent.ts}
            stroke="hsl(var(--chart-1))"
            strokeOpacity={0.75}
          />
        ) : null}

        {terminalEvent ? (
          <ReferenceLine
            x={terminalEvent.ts}
            stroke={terminalEventColor(terminalEvent, pnlUsd)}
            strokeOpacity={0.85}
          />
        ) : null}

        {tradeMarkers.map((event) => (
          <ReferenceDot
            key={`${event.kind}:${event.ts}`}
            x={event.ts}
            y={event.price}
            r={2}
            fill={
              event.kind === "add"
                ? "hsl(var(--chart-3))"
                : "hsl(var(--chart-4))"
            }
            stroke="transparent"
          />
        ))}

        <Line
          dataKey="price"
          type="linear"
          stroke="var(--color-price)"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3 }}
          isAnimationActive={false}
        />

        {lastPoint ? (
          <ReferenceDot
            x={lastPoint.ts}
            y={lastPoint.price}
            r={3}
            fill={statusEndpointColor(status, pnlUsd)}
            stroke="transparent"
          />
        ) : null}
      </LineChart>
    </ChartContainer>
  );
}

function TimelineTooltip({
  active,
  payload,
  label,
  entryPrice,
  status,
}: {
  active?: boolean;
  payload?: Array<{
    value?: number;
    payload?: WalletPositionTimelinePoint;
  }>;
  label?: string;
  entryPrice: number;
  status: WalletPositionStatus;
}): ReactElement | null {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  const price = Number(payload[0]?.value ?? 0);
  const deltaPct =
    entryPrice > 0 ? ((price - entryPrice) / entryPrice) * 100 : 0;

  return (
    <div className="min-w-[var(--dropdown-md)] rounded-lg border border-border/60 bg-background px-2.5 py-2 text-xs shadow-xl">
      <div className="font-medium">
        {formatDateLabel(label ?? point?.ts ?? "")}
      </div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Price</span>
        <span className="font-mono tabular-nums">{formatPrice(price)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Vs entry</span>
        <span
          className={cn(
            "font-mono tabular-nums",
            deltaPct >= 0 ? "text-success" : "text-destructive"
          )}
        >
          {formatSignedPct(deltaPct)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Exposure</span>
        <span className="font-mono tabular-nums">
          {formatShares(point?.size ?? 0)}
        </span>
      </div>
      <div className="mt-1 text-[var(--text-xs)] text-muted-foreground uppercase tracking-wide">
        {status}
      </div>
    </div>
  );
}

function getPriceDomain(
  points: readonly WalletPositionTimelinePoint[],
  entryPrice: number
): [number, number] {
  const values = points.map((point) => point.price).concat(entryPrice);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(0.01, (max - min) * 0.18);
  return [Math.max(0, min - padding), max + padding];
}

function terminalStroke(kind: "close" | "redeemable", pnlUsd: number): string {
  if (kind === "redeemable") return "hsl(var(--warning))";
  return pnlUsd >= 0 ? "hsl(var(--chart-2))" : "hsl(var(--destructive))";
}

function terminalEventColor(
  event: WalletPositionEvent,
  pnlUsd: number
): string {
  return terminalStroke(
    event.kind === "redeemable" ? "redeemable" : "close",
    pnlUsd
  );
}

function statusEndpointColor(
  status: WalletPositionStatus,
  pnlUsd: number
): string {
  return terminalStroke(
    status === "redeemable" ? "redeemable" : "close",
    pnlUsd
  );
}

function formatPrice(value: number): string {
  return `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}c`;
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function formatShares(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function formatDateLabel(value: string): string {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
