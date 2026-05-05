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
import { Badge } from "@/components/reui/badge";
import { DataGridColumnFilter } from "@/components/reui/data-grid/data-grid-column-filter";
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

/**
 * `edgeGapUsdc = targetPnl - ourPnl`. Positive = targets ahead of us
 * (alpha leaking) → render as `destructive`. Negative = we are ahead → success.
 * Null = no target legs to compare against → muted (rendered as `—`).
 * Same orientation for the percentage cell.
 */
function edgeGapClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  if (value > 0) return "text-destructive";
  if (value < 0) return "text-success";
  return "text-muted-foreground";
}

function formatEdgeGapPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${(Math.abs(value) * 100).toFixed(1)}%`;
}

/**
 * Best human-readable label for a market group. Prefer the server-hydrated
 * `eventTitle`, then a prettified `eventSlug`, then the first line's
 * `marketTitle`, then a literal placeholder. Slugs like
 * `nba-min-sas-2026-05-04` should never reach the user untouched.
 */
function groupLabel(group: WalletExecutionMarketGroup): string {
  return (
    group.eventTitle ??
    prettifyEventSlug(group.eventSlug, group.lines[0]?.marketTitle ?? "") ??
    group.lines[0]?.marketTitle ??
    group.eventSlug ??
    "Market"
  );
}

/**
 * Convert a polymarket event slug like `nba-min-sas-2026-05-04` to a
 * human-readable label like `NBA MIN SAS`. Mirrors the helper in
 * `positions-table/columns.tsx` (Links field below). Strips the trailing
 * date and any `-more-markets` suffix; uppercases ≤3-letter tokens (team
 * codes), otherwise title-cases. Returns null when the prettified label is
 * already a substring of the line's marketTitle (avoids double-display).
 */
function prettifyEventSlug(
  slug: string | null | undefined,
  marketTitle: string
): string | null {
  if (!slug) return null;
  const stripped = slug
    .replace(/-more-markets$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}(?=-|$)/, "")
    .replace(/-\d{4}$/, "");
  if (!stripped) return null;
  const label = stripped
    .split("-")
    .filter(Boolean)
    .map((w) =>
      w.length <= 3 ? w.toUpperCase() : (w[0] ?? "").toUpperCase() + w.slice(1)
    )
    .join(" ");
  if (!label) return null;
  if (marketTitle.toLowerCase().includes(label.toLowerCase())) return null;
  return label;
}

function polymarketEventUrl(eventSlug: string | null): string | null {
  if (!eventSlug) return null;
  return `https://polymarket.com/event/${eventSlug}`;
}

function polymarketMarketUrl(
  eventSlug: string | null,
  marketSlug: string | null
): string | null {
  if (eventSlug && marketSlug) {
    return `https://polymarket.com/event/${eventSlug}/${marketSlug}`;
  }
  if (marketSlug) return `https://polymarket.com/market/${marketSlug}`;
  return polymarketEventUrl(eventSlug);
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
        // Prefer the event-level URL; fall back to the first line's
        // market URL when the group has no event slug (single-market events).
        const href =
          polymarketEventUrl(group.eventSlug) ??
          polymarketMarketUrl(
            group.eventSlug,
            group.lines[0]?.marketSlug ?? null
          );
        return (
          <div className="flex flex-col gap-0.5">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-sm underline-offset-4 hover:underline"
              >
                {label}
              </a>
            ) : (
              <span className="font-medium text-sm">{label}</span>
            )}
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
    col.accessor((row) => row.status, {
      id: "status",
      header: ({ column }) => (
        <DataGridColumnHeader
          column={column}
          title="Status"
          visibility
          filter={
            <DataGridColumnFilter
              column={column}
              title="Status"
              options={[
                { label: "Live", value: "live" },
                { label: "Closed", value: "closed" },
              ]}
            />
          }
        />
      ),
      size: 90,
      cell: (info) => {
        const status = info.getValue();
        return (
          <Badge
            variant={status === "live" ? "success" : "secondary"}
            size="xs"
          >
            {status === "live" ? "Live" : "Closed"}
          </Badge>
        );
      },
      filterFn: (row, _id, value: string[]) => {
        if (!value || value.length === 0) return true;
        return value.includes(row.getValue<string>("status"));
      },
      meta: {
        headerTitle: "Status",
        skeleton: <Skeleton className="h-4 w-12" />,
      },
    }),
    col.accessor((row) => row.edgeGapPct, {
      id: "edgeGap",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="Edge Gap" visibility />
        ),
      size: 110,
      sortingFn: (left, right) => {
        // Sort by edgeGapPct DESC = "biggest alpha leak first". Nulls sort last
        // either direction so empty-cost-basis rows do not crowd the head.
        const lv = left.original.edgeGapPct;
        const rv = right.original.edgeGapPct;
        if (lv === null && rv === null) return 0;
        if (lv === null) return 1;
        if (rv === null) return -1;
        return lv - rv;
      },
      cell: ({ row }) => {
        const pct = row.original.edgeGapPct;
        const usdc = row.original.edgeGapUsdc;
        const tooltip =
          usdc === null
            ? "No copy-target legs in this market"
            : `Target P/L − our P/L = ${formatSignedUsd(usdc)}`;
        return (
          <div
            className={cn(
              "text-right text-sm tabular-nums",
              edgeGapClass(usdc)
            )}
            title={tooltip}
          >
            {formatEdgeGapPct(pct)}
          </div>
        );
      },
      meta: {
        headerTitle: "Edge Gap",
        skeleton: <Skeleton className="ms-auto h-3.5 w-14" />,
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
        <MarketLineBlock
          key={line.conditionId}
          line={line}
          eventSlug={group.eventSlug}
        />
      ))}
    </div>
  );
}

function MarketLineBlock({
  line,
  eventSlug,
}: {
  line: WalletExecutionMarketLine;
  eventSlug: string | null;
}): ReactElement {
  const href = polymarketMarketUrl(eventSlug, line.marketSlug);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="block truncate font-medium text-sm underline-offset-4 hover:underline"
            >
              {line.marketTitle}
            </a>
          ) : (
            <p className="truncate font-medium text-sm">{line.marketTitle}</p>
          )}
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
