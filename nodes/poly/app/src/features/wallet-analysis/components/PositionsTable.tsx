// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/PositionsTable`
 * Purpose: Reusable table for wallet positions with an interactive price trace and holding-time columns.
 * Scope: Presentational only. Callers pass already-computed position rows.
 * Invariants:
 *   - The chart is supplemental; P/L truth comes from the numeric columns.
 *   - Market links open the actual Polymarket event/market URL when upstream slugs are present.
 *   - In "default" variant, Current value + Action columns are shown; in "history" variant, a Closed timestamp column replaces them and no action buttons render.
 * Side-effects: none
 * @public
 */

"use client";

import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import type { WalletPosition } from "../types/wallet-analysis";
import { PositionTimelineChart } from "./PositionTimelineChart";

export type PositionsTableProps = {
  positions?: readonly WalletPosition[] | undefined;
  isLoading?: boolean | undefined;
  emptyMessage?: string | undefined;
  /**
   * "default" — shows Current value + Action columns (Close/Redeem buttons).
   * "history" — shows Closed At timestamp instead; no Action column. Used for closed-position history.
   */
  variant?: "default" | "history";
  /** When set, clicking Close / Redeem invokes this (open → Close, redeemable → Redeem). */
  onPositionAction?: (
    position: WalletPosition,
    action: "close" | "redeem"
  ) => void | Promise<void>;
  /** Row `positionId` while an action request is in flight. */
  pendingActionPositionId?: string | null;
};

export function PositionsTable({
  positions,
  isLoading,
  emptyMessage = "No positions yet.",
  variant = "default",
  onPositionAction,
  pendingActionPositionId = null,
}: PositionsTableProps): ReactElement {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-9 animate-pulse rounded bg-muted" />
        <div className="h-9 animate-pulse rounded bg-muted" />
        <div className="h-9 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!positions || positions.length === 0) {
    return (
      <div className="rounded border border-border bg-muted/20 px-4 py-6 text-center text-muted-foreground text-sm">
        {emptyMessage}
      </div>
    );
  }

  const isHistory = variant === "history";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Market</TableHead>
          <TableHead className="w-72">Trace</TableHead>
          <TableHead className="text-right">Held</TableHead>
          {isHistory ? (
            <TableHead className="text-right">Closed</TableHead>
          ) : (
            <TableHead className="text-right">Current</TableHead>
          )}
          <TableHead className="text-right">P/L</TableHead>
          <TableHead className="text-right">P/L %</TableHead>
          {!isHistory && (
            <TableHead className="w-28 text-right">Action</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => {
          const pnlClass =
            position.pnlUsd >= 0 ? "text-success" : "text-destructive";

          return (
            <TableRow key={position.positionId}>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  {position.marketUrl ? (
                    <a
                      href={position.marketUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-sm underline-offset-4 hover:underline"
                    >
                      {position.marketTitle}
                    </a>
                  ) : (
                    <span className="font-medium text-sm">
                      {position.marketTitle}
                    </span>
                  )}
                  <span className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
                    {position.outcome}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <PositionTimelineChart
                  points={position.timeline}
                  events={position.events}
                  entryPrice={position.entryPrice}
                  status={position.status}
                  pnlUsd={position.pnlUsd}
                />
              </TableCell>
              <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                {formatHeldDuration(position.heldMinutes)}
              </TableCell>
              {isHistory ? (
                <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                  {position.closedAt ? formatClosedAt(position.closedAt) : "—"}
                </TableCell>
              ) : (
                <TableCell className="text-right text-sm tabular-nums">
                  {formatUsd(position.currentValue)}
                </TableCell>
              )}
              <TableCell
                className={`text-right text-sm tabular-nums ${pnlClass}`}
              >
                {formatSignedUsd(position.pnlUsd)}
              </TableCell>
              <TableCell
                className={`text-right text-sm tabular-nums ${pnlClass}`}
              >
                {formatSignedPct(position.pnlPct)}
              </TableCell>
              {!isHistory && (
                <TableCell className="text-right">
                  <PositionActionButton
                    position={position}
                    onPositionAction={onPositionAction}
                    pendingActionPositionId={pendingActionPositionId}
                  />
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function formatClosedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatHeldDuration(heldMinutes: number): string {
  const totalMinutes = Math.max(0, Math.round(heldMinutes));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function actionLabel(status: WalletPosition["status"]): string {
  if (status === "redeemable") return "Redeem";
  if (status === "closed") return "Settled";
  return "Close";
}

function PositionActionButton({
  position,
  onPositionAction,
  pendingActionPositionId,
}: {
  position: WalletPosition;
  onPositionAction?: PositionsTableProps["onPositionAction"];
  pendingActionPositionId: string | null;
}): ReactElement {
  const label = actionLabel(position.status);
  const wired = typeof onPositionAction === "function";
  const actionable =
    wired && (position.status === "open" || position.status === "redeemable");
  const busy = pendingActionPositionId === position.positionId;
  const kind =
    position.status === "redeemable"
      ? ("redeem" as const)
      : position.status === "open"
        ? ("close" as const)
        : null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!actionable || busy}
      title={
        !wired
          ? "Actions require a dashboard handler"
          : position.status === "closed"
            ? "Position already settled"
            : busy
              ? "Working…"
              : `${label} via Polymarket`
      }
      aria-label={`${label} ${position.marketTitle}`}
      onClick={(event) => {
        event.preventDefault();
        if (!actionable || busy || !kind) return;
        void onPositionAction(position, kind);
      }}
      className={
        actionable && !busy
          ? "w-20 border-border/70 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          : "w-20 border-border/70 text-muted-foreground"
      }
    >
      {busy ? (
        <span className="inline-flex items-center justify-center">
          <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
          <span className="sr-only">{label} in progress</span>
        </span>
      ) : (
        label
      )}
    </Button>
  );
}
