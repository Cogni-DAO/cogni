// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/PositionTimelineSparkline`
 * Purpose: Lightweight inline position-lifecycle chart for dense table rows.
 * Scope: Pure SVG render. Designed for many rows at once, so it deliberately avoids mounting a full Recharts chart per row.
 * Invariants:
 *   - Timeline line is normalized per row; comparisons across rows belong in the numeric columns, not the sparkline y-scale.
 *   - Marker colors are semantic: entry = blue, open/current = green, losing close = red.
 *   - Empty datasets render a muted placeholder instead of a misleading flat line.
 * Side-effects: none
 * @public
 */

"use client";

import type { ReactElement } from "react";

import { cn } from "@/shared/util/cn";
import type {
  WalletPositionMarker,
  WalletPositionTimelinePoint,
} from "../types/wallet-analysis";

export type PositionTimelineSparklineProps = {
  points?: readonly WalletPositionTimelinePoint[] | undefined;
  markers?: readonly WalletPositionMarker[] | undefined;
  isLoading?: boolean | undefined;
  className?: string | undefined;
};

const WIDTH = 120;
const HEIGHT = 32;
const PADDING_X = 4;
const PADDING_Y = 3;

export function PositionTimelineSparkline({
  points,
  markers,
  isLoading,
  className,
}: PositionTimelineSparklineProps): ReactElement {
  if (isLoading) {
    return (
      <div
        className={cn("h-8 w-full animate-pulse rounded bg-muted", className)}
      />
    );
  }

  if (!points || points.length < 2) {
    return (
      <div
        className={cn(
          "flex h-8 w-full items-center justify-center text-muted-foreground text-xs",
          className
        )}
      >
        —
      </div>
    );
  }

  const xs = normalizeX(points);
  const ys = normalizeY(points);
  const lastPoint = points[points.length - 1];
  if (!lastPoint) {
    return (
      <div
        className={cn(
          "flex h-8 w-full items-center justify-center text-muted-foreground text-xs",
          className
        )}
      >
        —
      </div>
    );
  }
  const path = points
    .map(
      (point, index) => `${index === 0 ? "M" : "L"} ${xs(point)} ${ys(point)}`
    )
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("h-8 w-full overflow-visible", className)}
      preserveAspectRatio="none"
      role="img"
      aria-label="Position timeline"
    >
      <path
        d={path}
        fill="none"
        stroke="hsl(var(--chart-5))"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {markers?.map((marker) => {
        const x = xs({ ts: marker.ts });
        const stroke = markerStroke(marker);
        return (
          <line
            key={`${marker.kind}:${marker.ts}`}
            x1={x}
            x2={x}
            y1={PADDING_Y}
            y2={HEIGHT - PADDING_Y}
            stroke={stroke}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        );
      })}

      <circle
        cx={xs(lastPoint)}
        cy={ys(lastPoint)}
        r="2.5"
        fill="hsl(var(--chart-5))"
      />
    </svg>
  );
}

function normalizeX(points: readonly WalletPositionTimelinePoint[]) {
  const times = points.map((point) => new Date(point.ts).getTime());
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(max - min, 1);

  return (point: Pick<WalletPositionTimelinePoint, "ts">) => {
    const value = new Date(point.ts).getTime();
    return PADDING_X + ((value - min) / span) * (WIDTH - PADDING_X * 2);
  };
}

function normalizeY(points: readonly WalletPositionTimelinePoint[]) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);

  return (point: Pick<WalletPositionTimelinePoint, "value">) => {
    const ratio = (point.value - min) / span;
    return HEIGHT - PADDING_Y - ratio * (HEIGHT - PADDING_Y * 2);
  };
}

function markerStroke(marker: WalletPositionMarker): string {
  if (marker.kind === "entry") return "hsl(var(--chart-1))";
  if (marker.kind === "current") return "hsl(var(--chart-2))";
  if (marker.kind === "close" && marker.tone === "negative") {
    return "hsl(var(--destructive))";
  }
  if (marker.kind === "close" && marker.tone === "positive") {
    return "hsl(var(--chart-2))";
  }
  return "hsl(var(--chart-3))";
}
