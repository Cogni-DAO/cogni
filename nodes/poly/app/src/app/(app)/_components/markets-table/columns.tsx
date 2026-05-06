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
import { useDataGrid } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnFilter } from "@/components/reui/data-grid/data-grid-column-filter";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
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
 * Sign convention (per docs/design/poly-markets-aggregation-redesign.md §3.2):
 *   positive = target ahead = alpha leaking from us → destructive
 *   negative = we are ahead → success
 *   null     = undefined comparison → muted
 * Applied uniformly to `rateGapPct` and `sizeScaledGapUsdc`.
 */
function gapClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  if (value > 0) return "text-destructive";
  if (value < 0) return "text-success";
  return "text-muted-foreground";
}

function formatReturnPct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${(Math.abs(value) * 100).toFixed(1)}%`;
}

function formatRateGapPp(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${(Math.abs(value) * 100).toFixed(1)}pp`;
}

/**
 * Returns and dollar-deltas use the same sign-aware coloring as the gap
 * columns: green when we're ahead (positive own-return; negative own loss),
 * red when behind. For pure return cells without a comparison axis, this
 * keeps directionality consistent with the rest of the row.
 */
function returnClass(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "text-muted-foreground";
}

/**
 * TanStack sortingFn for a nullable numeric accessor. Nulls always sort to
 * the tail regardless of direction so unmatched markets don't crowd the head.
 */
function nullableNumberSort(
  pick: (row: WalletExecutionMarketGroup) => number | null
) {
  return (
    left: { original: WalletExecutionMarketGroup },
    right: { original: WalletExecutionMarketGroup }
  ) => {
    const lv = pick(left.original);
    const rv = pick(right.original);
    if (lv === null && rv === null) return 0;
    if (lv === null) return 1;
    if (rv === null) return -1;
    return lv - rv;
  };
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
    col.accessor((row) => row.ourReturnPct, {
      id: "ourReturn",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="Our ret%" visibility />
        ),
      size: 100,
      sortingFn: nullableNumberSort((g) => g.ourReturnPct),
      cell: ({ row }) => {
        const v = row.original.ourReturnPct;
        return (
          <div
            className={cn("text-right text-sm tabular-nums", returnClass(v))}
            title="Round-trip USDC return on our deployed capital for this market"
          >
            {formatReturnPct(v)}
          </div>
        );
      },
      meta: {
        headerTitle: "Our ret%",
        skeleton: <Skeleton className="ms-auto h-3.5 w-12" />,
      },
    }),
    col.accessor((row) => row.targetReturnPct, {
      id: "targetReturn",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="Tgt ret%" visibility />
        ),
      size: 100,
      sortingFn: nullableNumberSort((g) => g.targetReturnPct),
      cell: ({ row }) => {
        const v = row.original.targetReturnPct;
        return (
          <div
            className={cn("text-right text-sm tabular-nums", returnClass(v))}
            title="Cost-basis-weighted blend across active copy-target legs"
          >
            {formatReturnPct(v)}
          </div>
        );
      },
      meta: {
        headerTitle: "Tgt ret%",
        skeleton: <Skeleton className="ms-auto h-3.5 w-12" />,
      },
    }),
    col.accessor((row) => row.rateGapPct, {
      id: "rateGap",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="Rate gap" visibility />
        ),
      size: 100,
      sortingFn: nullableNumberSort((g) => g.rateGapPct),
      cell: ({ row }) => {
        const v = row.original.rateGapPct;
        return (
          <div
            className={cn("text-right text-sm tabular-nums", gapClass(v))}
            title="Target return − our return. Positive = target ahead = alpha leak"
          >
            {formatRateGapPp(v)}
          </div>
        );
      },
      meta: {
        headerTitle: "Rate gap",
        skeleton: <Skeleton className="ms-auto h-3.5 w-12" />,
      },
    }),
    col.accessor((row) => row.sizeScaledGapUsdc, {
      id: "sizeScaledGap",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader
            column={column}
            title="$ gap on us"
            visibility
          />
        ),
      size: 110,
      sortingFn: nullableNumberSort((g) => g.sizeScaledGapUsdc),
      cell: ({ row }) => {
        const v = row.original.sizeScaledGapUsdc;
        return (
          <div
            className={cn("text-right text-sm tabular-nums", gapClass(v))}
            title="Rate gap × our buy notional. Dollar cost on OUR book"
          >
            {v === null ? "—" : formatSignedUsd(v)}
          </div>
        );
      },
      meta: {
        headerTitle: "$ gap on us",
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
      <ParticipantsAlignedGrid line={line} />
    </div>
  );
}

/**
 * Renders one row per (trader × leg) inside the expansion. Each row is a
 * CSS grid whose `gridTemplateColumns` is read from the outer DataGrid's
 * visible-leaf-columns, so the trader-leg cells slot **directly** under
 * the parent table's columns. No more inner `<table>` with its own
 * widths fighting the outer; no more floating Primary/Hedge/Net
 * sub-headers.
 *
 * Cells are dispatched per outer column id — when the column doesn't
 * apply to a given (trader, leg) (e.g. `Tgt $` on an our-wallet row),
 * the cell renders an em-dash so the visual columns stay legible.
 */
function ParticipantsAlignedGrid({
  line,
}: {
  line: WalletExecutionMarketLine;
}): ReactElement {
  // Build (trader × leg) rows. Solo positions emit one row, hedged two.
  const rows: {
    key: string;
    participant: WalletExecutionMarketParticipantRow;
    leg: WalletExecutionMarketLeg;
    isHedge: boolean;
    /** Our wallet's same-outcome VWAP, for cheaper-entry coloring. */
    ourSameSideVwap: number | null;
  }[] = [];
  const ourByOutcome = new Map<string, number | null>();
  const ours = line.participants.find((p) => p.side === "our_wallet");
  if (ours) {
    if (ours.primary) ourByOutcome.set(ours.primary.outcome, ours.primary.vwap);
    if (ours.hedge) ourByOutcome.set(ours.hedge.outcome, ours.hedge.vwap);
  }
  for (const p of line.participants) {
    if (p.primary) {
      rows.push({
        key: `${p.walletAddress}:primary`,
        participant: p,
        leg: p.primary,
        isHedge: false,
        ourSameSideVwap: ourByOutcome.get(p.primary.outcome) ?? null,
      });
    }
    if (p.hedge) {
      rows.push({
        key: `${p.walletAddress}:hedge`,
        participant: p,
        leg: p.hedge,
        isHedge: true,
        ourSameSideVwap: ourByOutcome.get(p.hedge.outcome) ?? null,
      });
    }
  }

  return (
    <div className="rounded-md border bg-background/40">
      {rows.map((row) => (
        <ParticipantAlignedRow key={row.key} row={row} line={line} />
      ))}
    </div>
  );
}

function ParticipantAlignedRow({
  row,
  line,
}: {
  row: {
    participant: WalletExecutionMarketParticipantRow;
    leg: WalletExecutionMarketLeg;
    isHedge: boolean;
    ourSameSideVwap: number | null;
  };
  line: WalletExecutionMarketLine;
}): ReactElement {
  const { table } = useDataGrid();
  const visibleCols = table.getVisibleLeafColumns();
  const gridTemplateColumns = visibleCols
    .map((c) => `${c.getSize()}px`)
    .join(" ");

  return (
    <div
      className="grid items-center border-b last:border-b-0 hover:bg-muted/20"
      style={{ gridTemplateColumns }}
    >
      {visibleCols.map((column) => (
        <ParticipantAlignedCell
          key={column.id}
          columnId={column.id}
          row={row}
          line={line}
        />
      ))}
    </div>
  );
}

function ParticipantAlignedCell({
  columnId,
  row,
  line,
}: {
  columnId: string;
  row: {
    participant: WalletExecutionMarketParticipantRow;
    leg: WalletExecutionMarketLeg;
    isHedge: boolean;
    ourSameSideVwap: number | null;
  };
  line: WalletExecutionMarketLine;
}): ReactElement | null {
  const { participant, leg, isHedge, ourSameSideVwap } = row;
  const isOurs = participant.side === "our_wallet";
  const isTarget = participant.side === "copy_target";

  switch (columnId) {
    case "expand":
      // Empty cell — the chevron lives only on the parent row.
      return <div className="px-2 py-1.5" />;

    case "market": {
      const traderLabel = isOurs ? "Our wallet" : participant.label;
      const cheaper =
        isTarget &&
        leg.vwap !== null &&
        ourSameSideVwap !== null &&
        leg.vwap < ourSameSideVwap;
      return (
        <div className="flex flex-col gap-0.5 py-1.5 ps-8 pe-2">
          <span className="font-medium text-sm">{traderLabel}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {isHedge ? `${leg.outcome} (hedge)` : leg.outcome} · VWAP{" "}
            <span
              className={cn(
                cheaper && "font-medium text-destructive",
                !cheaper && isOurs && "text-foreground/80"
              )}
              title={
                cheaper
                  ? "Target entered at a lower VWAP than us — pricing alpha source"
                  : "Volume-weighted average entry price"
              }
            >
              {formatPrice(leg.vwap)}
            </span>{" "}
            · {formatShares(leg.shares)} sh
          </span>
        </div>
      );
    }

    case "ourValue":
      return (
        <div className="px-2 py-1.5 text-right text-sm tabular-nums">
          {isOurs ? formatUsd(leg.currentValueUsdc) : "—"}
        </div>
      );

    case "targets":
      return (
        <div className="px-2 py-1.5 text-right text-muted-foreground text-sm tabular-nums">
          {isTarget ? formatUsd(leg.currentValueUsdc) : "—"}
        </div>
      );

    case "ourReturn": {
      // Show this trader's per-condition return on the primary leg row only;
      // hedge row skips it (it's the same value).
      if (!isOurs || isHedge)
        return (
          <div className="px-2 py-1.5 text-right text-muted-foreground">—</div>
        );
      const v = participant.net.roundTripReturnPct;
      return (
        <div
          className={cn(
            "px-2 py-1.5 text-right text-sm tabular-nums",
            returnClass(v)
          )}
        >
          {formatReturnPct(v)}
        </div>
      );
    }

    case "targetReturn": {
      if (!isTarget || isHedge)
        return (
          <div className="px-2 py-1.5 text-right text-muted-foreground">—</div>
        );
      const v = participant.net.roundTripReturnPct;
      return (
        <div
          className={cn(
            "px-2 py-1.5 text-right text-sm tabular-nums",
            returnClass(v)
          )}
        >
          {formatReturnPct(v)}
        </div>
      );
    }

    case "rateGap": {
      // Per-target rate gap: target's return − our line return, in pp.
      // Only on target primary-leg rows.
      if (!isTarget || isHedge)
        return (
          <div className="px-2 py-1.5 text-right text-muted-foreground">—</div>
        );
      const t = participant.net.roundTripReturnPct;
      const u = line.ourReturnPct;
      const v =
        t === null || u === null ? null : Math.round((t - u) * 10_000) / 10_000;
      return (
        <div
          className={cn(
            "px-2 py-1.5 text-right text-sm tabular-nums",
            gapClass(v)
          )}
          title="This target's return − our return for this condition"
        >
          {formatRateGapPp(v)}
        </div>
      );
    }

    case "sizeScaledGap":
    case "pnl":
    case "hedges":
    case "status":
      // Group-level only — leave child cells blank to preserve alignment.
      return (
        <div className="px-2 py-1.5 text-right text-muted-foreground">—</div>
      );

    default:
      return <div className="px-2 py-1.5" />;
  }
}
