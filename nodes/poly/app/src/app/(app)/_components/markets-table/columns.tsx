// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/_components/markets-table/columns`
 * Purpose: TanStack column definitions for the dashboard markets aggregation
 *   table. The outer rows are market groups; the row-expansion cell renders a
 *   nested per-line + per-participant view via `meta.expandedContent`.
 * Scope: Pure column descriptors + inline cells. No fetching.
 * Invariants:
 *   - HEADER_OWNS_CONTROLS: every header renders via reui `DataGridColumnHeader`
 *     so sort + visibility live inside the column dropdown; no toolbar.
 *   - EXPAND_VIA_GRID_META: row expansion piggybacks the reui DataGrid's
 *     `meta.expandedContent` slot — one rendered colspan cell per expanded row
 *     hosts the nested per-line participant grid.
 *   - PIVOTED_PARTICIPANT_ROW: each participant row already carries primary +
 *     optional hedge legs + net (server-side pivot per
 *     market-exposure-service). The client never groups token legs itself.
 * Side-effects: none
 * @internal
 */

"use client";

import type {
  WalletExecutionMarketGroup,
  WalletExecutionMarketLeg,
  WalletExecutionMarketLine,
  WalletExecutionMarketParticipantRow,
} from "@cogni/poly-node-contracts";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Skeleton } from "@/components";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/vendor/shadcn/table";
import { cn } from "@/shared/util/cn";

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous TanStack column array
type AnyCol = ColumnDef<WalletExecutionMarketGroup, any>;

const col = createColumnHelper<WalletExecutionMarketGroup>();

const rightHeader = (node: ReactNode) => (
  <div className="flex w-full justify-end">{node}</div>
);

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(3);
}

function formatShares(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function pnlClass(value: number): string {
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "text-muted-foreground";
}

function groupLabel(group: WalletExecutionMarketGroup): string {
  return (
    group.eventTitle ??
    group.eventSlug ??
    group.lines[0]?.marketTitle ??
    "Market"
  );
}

export function makeColumns(): AnyCol[] {
  return [
    col.display({
      id: "expand",
      header: () => <span className="sr-only">Expand</span>,
      enableSorting: false,
      enableHiding: false,
      size: 32,
      cell: ({ row }) => (
        <button
          type="button"
          aria-label={row.getIsExpanded() ? "Collapse market" : "Expand market"}
          onClick={(event) => {
            event.stopPropagation();
            row.toggleExpanded();
          }}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          {row.getIsExpanded() ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
        </button>
      ),
      meta: {
        headerTitle: "",
        skeleton: <Skeleton className="size-4" />,
        // The reui DataGrid renders `meta.expandedContent` as a single colspan
        // cell when `row.getIsExpanded()`. Hosting it on this column keeps the
        // chevron + body co-located.
        expandedContent: (group: WalletExecutionMarketGroup) => (
          <MarketGroupExpandedBody group={group} />
        ),
      },
    }),
    col.accessor((row) => groupLabel(row), {
      id: "market",
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title="Market" visibility />
      ),
      minSize: 240,
      cell: ({ row }) => {
        const group = row.original;
        const label = groupLabel(group);
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-sm">{label}</span>
            <span className="text-muted-foreground text-xs">
              {group.marketCount} line{group.marketCount === 1 ? "" : "s"}
            </span>
          </div>
        );
      },
      meta: {
        headerTitle: "Market",
        skeleton: <Skeleton className="h-3.5 w-40" />,
      },
    }),
    col.accessor((row) => row.ourValueUsdc, {
      id: "ourValue",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="Our value" visibility />
        ),
      size: 120,
      cell: (info) => (
        <div className="text-right text-sm tabular-nums">
          {formatUsd(info.getValue())}
        </div>
      ),
      meta: {
        headerTitle: "Our value",
        skeleton: <Skeleton className="ms-auto h-3.5 w-16" />,
      },
    }),
    col.accessor((row) => row.targetValueUsdc, {
      id: "targets",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="Targets" visibility />
        ),
      size: 120,
      cell: (info) => (
        <div className="text-right text-muted-foreground text-sm tabular-nums">
          {formatUsd(info.getValue())}
        </div>
      ),
      meta: {
        headerTitle: "Targets",
        skeleton: <Skeleton className="ms-auto h-3.5 w-16" />,
      },
    }),
    col.accessor((row) => row.pnlUsd, {
      id: "pnl",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="P/L" visibility />
        ),
      size: 110,
      cell: (info) => {
        const v = info.getValue();
        return (
          <div className={cn("text-right text-sm tabular-nums", pnlClass(v))}>
            {formatSignedUsd(v)}
          </div>
        );
      },
      meta: {
        headerTitle: "P/L",
        skeleton: <Skeleton className="ms-auto h-3.5 w-16" />,
      },
    }),
    col.accessor((row) => row.hedgeCount, {
      id: "hedges",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="Hedges" visibility />
        ),
      size: 90,
      cell: (info) => (
        <div className="text-right text-muted-foreground text-sm tabular-nums">
          {info.getValue()}
        </div>
      ),
      meta: {
        headerTitle: "Hedges",
        skeleton: <Skeleton className="ms-auto h-3.5 w-12" />,
      },
    }),
  ];
}

function MarketGroupExpandedBody({
  group,
}: {
  group: WalletExecutionMarketGroup;
}): ReactElement {
  return (
    <div className="space-y-4 bg-muted/10 px-4 py-3">
      {group.lines.map((line) => (
        <MarketLineBlock key={line.conditionId} line={line} />
      ))}
    </div>
  );
}

function MarketLineBlock({
  line,
}: {
  line: WalletExecutionMarketLine;
}): ReactElement {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">{line.marketTitle}</p>
          <p className="text-muted-foreground text-xs">
            {line.participants.length} trader
            {line.participants.length === 1 ? "" : "s"}
            {" · "}
            our VWAP {formatPrice(line.ourVwap)} · targets{" "}
            {formatPrice(line.targetVwap)}
          </p>
        </div>
        <div className="text-muted-foreground text-xs tabular-nums">
          our {formatUsd(line.ourValueUsdc)} · target line{" "}
          {formatUsd(line.targetValueUsdc)}
        </div>
      </div>
      <ParticipantsTable line={line} />
    </div>
  );
}

function ParticipantsTable({
  line,
}: {
  line: WalletExecutionMarketLine;
}): ReactElement {
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <Table className="text-xs">
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="h-8 px-2">Trader</TableHead>
            <TableHead
              className="h-8 px-2 text-right"
              colSpan={3}
              aria-label="Primary leg"
            >
              <div className="flex flex-col items-end">
                <span className="font-medium text-foreground">Primary</span>
                <span className="font-normal text-[10px] text-muted-foreground">
                  Value · VWAP · P/L
                </span>
              </div>
            </TableHead>
            <TableHead
              className="h-8 px-2 text-right"
              colSpan={3}
              aria-label="Hedge leg"
            >
              <div className="flex flex-col items-end">
                <span className="font-medium text-foreground">Hedge</span>
                <span className="font-normal text-[10px] text-muted-foreground">
                  Value · VWAP · P/L
                </span>
              </div>
            </TableHead>
            <TableHead
              className="h-8 px-2 text-right"
              colSpan={2}
              aria-label="Net across legs"
            >
              <div className="flex flex-col items-end">
                <span className="font-medium text-foreground">Net</span>
                <span className="font-normal text-[10px] text-muted-foreground">
                  Value · P/L
                </span>
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {line.participants.map((participant) => (
            <ParticipantRow
              key={`${participant.walletAddress}:${participant.conditionId}`}
              participant={participant}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ParticipantRow({
  participant,
}: {
  participant: WalletExecutionMarketParticipantRow;
}): ReactElement {
  return (
    <TableRow>
      <TableCell className="py-1.5 align-top">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">
            {participant.side === "our_wallet"
              ? "Our wallet"
              : participant.label}
          </span>
          {participant.primary ? (
            <span className="text-[11px] text-muted-foreground">
              {participant.primary.outcome}
              {" · "}
              {formatShares(participant.primary.shares)} sh
            </span>
          ) : null}
        </div>
      </TableCell>
      <LegTriple leg={participant.primary} />
      <LegTriple leg={participant.hedge} />
      <NetPair net={participant.net} />
    </TableRow>
  );
}

function LegTriple({
  leg,
}: {
  leg: WalletExecutionMarketLeg | null;
}): ReactElement {
  if (leg === null) {
    return (
      <>
        <TableCell className="py-1.5 text-right text-muted-foreground tabular-nums">
          —
        </TableCell>
        <TableCell className="py-1.5 text-right text-muted-foreground tabular-nums">
          —
        </TableCell>
        <TableCell className="py-1.5 text-right text-muted-foreground tabular-nums">
          —
        </TableCell>
      </>
    );
  }
  return (
    <>
      <TableCell className="py-1.5 text-right tabular-nums">
        {formatUsd(leg.currentValueUsdc)}
      </TableCell>
      <TableCell className="py-1.5 text-right text-muted-foreground tabular-nums">
        {formatPrice(leg.vwap)}
      </TableCell>
      <TableCell
        className={cn("py-1.5 text-right tabular-nums", pnlClass(leg.pnlUsdc))}
      >
        {formatSignedUsd(leg.pnlUsdc)}
      </TableCell>
    </>
  );
}

function NetPair({
  net,
}: {
  net: WalletExecutionMarketParticipantRow["net"];
}): ReactElement {
  return (
    <>
      <TableCell className="py-1.5 text-right font-medium tabular-nums">
        {formatUsd(net.currentValueUsdc)}
      </TableCell>
      <TableCell
        className={cn(
          "py-1.5 text-right font-medium tabular-nums",
          pnlClass(net.pnlUsdc)
        )}
      >
        {formatSignedUsd(net.pnlUsdc)}
      </TableCell>
    </>
  );
}
