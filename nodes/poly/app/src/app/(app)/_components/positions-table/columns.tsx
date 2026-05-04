// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/_components/positions-table/columns`
 * Purpose: TanStack column definitions for the poly positions table.
 * Scope: Pure column descriptors + inline cells. No fetching, no router.
 * Invariants:
 *   - HEADER_OWNS_CONTROLS: every header renders via reui `DataGridColumnHeader`
 *     so sort + visibility live inside the column dropdown; no toolbar.
 *   - Variant-conditional columns: `currentValue` + `action` only when
 *     variant === "default"; `closedAt` only when variant === "history".
 *   - Action button stops click propagation so future `onRowClick` wiring on
 *     the DataGrid does not trigger when a user clicks Close/Redeem.
 * Side-effects: none
 * @internal
 */

"use client";

import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { LoaderCircle } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";

import { Button, Skeleton } from "@/components";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { PositionTimelineChart } from "@/features/wallet-analysis/components/PositionTimelineChart";
import type { WalletPosition } from "@/features/wallet-analysis/types/wallet-analysis";

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous TanStack column array
type AnyCol = ColumnDef<WalletPosition, any>;

export type PositionsTableVariant = "default" | "history";

export type PositionAction = "close" | "redeem";

export type MakeColumnsOpts = {
  variant: PositionsTableVariant;
  onPositionAction?:
    | ((
        position: WalletPosition,
        action: PositionAction
      ) => void | Promise<void>)
    | undefined;
  pendingActionPositionId?: string | null;
};

const col = createColumnHelper<WalletPosition>();

const rightHeader = (node: ReactNode) => (
  <div className="flex w-full justify-end">{node}</div>
);

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
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatClosedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function pnlClass(value: number): string {
  return value >= 0 ? "text-success" : "text-destructive";
}

// Slug-derived event label for the Market column sub-line. Trims trailing
// ISO date / bare year so it doesn't duplicate the date that's already in
// most marketTitle strings. Returns null when the slug is missing or its
// prettified form is fully contained in the title (avoids "Event: X" /
// "Market: ...X..." double-render). Will be replaced when the contract
// hydrates a real eventTitle (vNext, bug.5001 — DB-owned positions).
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

export function makeColumns(opts: MakeColumnsOpts): AnyCol[] {
  const { variant, onPositionAction, pendingActionPositionId = null } = opts;
  const isHistory = variant === "history";

  const columns: AnyCol[] = [
    col.accessor((row) => row.marketTitle, {
      id: "market",
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title="Market" visibility />
      ),
      minSize: 240,
      cell: ({ row }) => {
        const p = row.original;
        const eventLabel =
          p.eventTitle ?? prettifyEventSlug(p.eventSlug, p.marketTitle);
        return (
          <div className="flex flex-col gap-0.5">
            {eventLabel ? (
              <span className="text-muted-foreground text-xs">
                {eventLabel}
              </span>
            ) : null}
            {p.marketUrl ? (
              <a
                href={p.marketUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-sm underline-offset-4 hover:underline"
              >
                {p.marketTitle}
              </a>
            ) : (
              <span className="font-medium text-sm">{p.marketTitle}</span>
            )}
          </div>
        );
      },
      meta: {
        headerTitle: "Market",
        skeleton: <Skeleton className="h-3.5 w-40" />,
      },
    }),

    col.accessor("outcome", {
      id: "bet",
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title="Bet" visibility />
      ),
      size: 100,
      cell: (info) => (
        <span className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
          {info.getValue()}
        </span>
      ),
      meta: {
        headerTitle: "Bet",
        skeleton: <Skeleton className="h-3 w-12" />,
      },
    }),

    col.accessor((row) => row.resolvesAt ?? null, {
      id: "endsAt",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="Resolves" visibility />
        ),
      size: 130,
      sortingFn: (a, b) => {
        const av = a.getValue<string | null>("endsAt");
        const bv = b.getValue<string | null>("endsAt");
        const at = av ? Date.parse(av) : Number.POSITIVE_INFINITY;
        const bt = bv ? Date.parse(bv) : Number.POSITIVE_INFINITY;
        return at === bt ? 0 : at < bt ? -1 : 1;
      },
      cell: ({ getValue, row }) => {
        const v = getValue();
        return (
          <div className="text-right text-muted-foreground text-sm tabular-nums">
            {v ? (
              <ResolvesCountdown
                iso={v}
                status={row.original.status}
                lifecycleState={row.original.lifecycleState}
              />
            ) : (
              "—"
            )}
          </div>
        );
      },
      meta: {
        headerTitle: "Resolves",
        skeleton: <Skeleton className="ms-auto h-3.5 w-20" />,
      },
    }),

    col.accessor("heldMinutes", {
      id: "heldMinutes",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="Held" visibility />
        ),
      size: 90,
      cell: (info) => (
        <div className="text-right text-muted-foreground text-sm tabular-nums">
          {formatHeldDuration(info.getValue())}
        </div>
      ),
      meta: {
        headerTitle: "Held",
        skeleton: <Skeleton className="ms-auto h-3.5 w-12" />,
      },
    }),

    col.display({
      id: "trace",
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title="Trace" />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 288,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <PositionTimelineChart
            points={p.timeline}
            events={p.events}
            entryPrice={p.entryPrice}
            status={p.status}
            pnlUsd={p.pnlUsd}
          />
        );
      },
      meta: {
        headerTitle: "Trace",
        skeleton: <Skeleton className="h-3.5 w-64" />,
      },
    }),
  ];

  if (isHistory) {
    columns.push(
      col.accessor("closedAt", {
        id: "closedAt",
        header: ({ column }) =>
          rightHeader(
            <DataGridColumnHeader column={column} title="Closed" visibility />
          ),
        size: 120,
        sortingFn: (a, b) => {
          const av = a.getValue<string | null | undefined>("closedAt");
          const bv = b.getValue<string | null | undefined>("closedAt");
          const at = av ? Date.parse(av) : Number.NEGATIVE_INFINITY;
          const bt = bv ? Date.parse(bv) : Number.NEGATIVE_INFINITY;
          return at === bt ? 0 : at < bt ? -1 : 1;
        },
        cell: (info) => {
          const v = info.getValue();
          return (
            <div className="text-right text-muted-foreground text-sm tabular-nums">
              {v ? formatClosedAt(v) : "—"}
            </div>
          );
        },
        meta: {
          headerTitle: "Closed",
          skeleton: <Skeleton className="ms-auto h-3.5 w-16" />,
        },
      })
    );
  } else {
    columns.push(
      col.accessor("currentValue", {
        id: "currentValue",
        header: ({ column }) =>
          rightHeader(
            <DataGridColumnHeader column={column} title="Current" visibility />
          ),
        size: 110,
        cell: (info) => (
          <div className="text-right text-sm tabular-nums">
            {formatUsd(info.getValue())}
          </div>
        ),
        meta: {
          headerTitle: "Current",
          skeleton: <Skeleton className="ms-auto h-3.5 w-16" />,
        },
      })
    );
  }

  columns.push(
    col.accessor("pnlUsd", {
      id: "pnlUsd",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="P/L" visibility />
        ),
      size: 110,
      cell: (info) => {
        const v = info.getValue();
        return (
          <div className={`text-right text-sm tabular-nums ${pnlClass(v)}`}>
            {formatSignedUsd(v)}
          </div>
        );
      },
      meta: {
        headerTitle: "P/L",
        skeleton: <Skeleton className="ms-auto h-3.5 w-16" />,
      },
    }),
    col.accessor("pnlPct", {
      id: "pnlPct",
      header: ({ column }) =>
        rightHeader(
          <DataGridColumnHeader column={column} title="P/L %" visibility />
        ),
      size: 90,
      cell: (info) => {
        const v = info.getValue();
        return (
          <div className={`text-right text-sm tabular-nums ${pnlClass(v)}`}>
            {formatSignedPct(v)}
          </div>
        );
      },
      meta: {
        headerTitle: "P/L %",
        skeleton: <Skeleton className="ms-auto h-3.5 w-12" />,
      },
    })
  );

  if (!isHistory) {
    columns.push(
      col.display({
        id: "action",
        header: ({ column }) =>
          rightHeader(<DataGridColumnHeader column={column} title="Action" />),
        enableSorting: false,
        enableHiding: false,
        size: 112,
        cell: ({ row }) => (
          <div className="text-right">
            <PositionActionButton
              position={row.original}
              onPositionAction={onPositionAction}
              pendingActionPositionId={pendingActionPositionId}
            />
          </div>
        ),
        meta: {
          headerTitle: "Action",
          skeleton: <Skeleton className="ms-auto h-3.5 w-12" />,
        },
      })
    );
  }

  return columns;
}

function formatTimeUntil(targetMs: number, nowMs: number): string {
  const deltaMs = targetMs - nowMs;
  if (deltaMs <= 0) return "now";
  const totalMinutes = Math.floor(deltaMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days >= 7) return `${days}d`;
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Countdown to resolution. TZ-agnostic by design — `targetMs - nowMs` is the
// same delta in any timezone, so SSR/client mismatch collapses to a few-second
// drift that's invisible at minute resolution. Ticks every 60s post-mount.
function ResolvesCountdown({
  iso,
  status,
  lifecycleState,
}: {
  iso: string;
  status: WalletPosition["status"];
  lifecycleState?: WalletPosition["lifecycleState"];
}): ReactElement {
  const targetMs = Date.parse(iso);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (!Number.isFinite(targetMs)) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (targetMs <= nowMs) {
    if (status === "redeemable" || lifecycleState === "winner") {
      return <span className="text-warning">redeemable</span>;
    }
    if (
      lifecycleState === "redeemed" ||
      lifecycleState === "closed" ||
      lifecycleState === "loser" ||
      lifecycleState === "dust" ||
      lifecycleState === "abandoned"
    ) {
      return <span className="text-muted-foreground">resolved</span>;
    }
    return <span className="text-muted-foreground">awaiting</span>;
  }
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatTimeUntil(targetMs, nowMs)}
    </time>
  );
}

function actionLabel(status: WalletPosition["status"]): string {
  if (status === "closed") return "Settled";
  return "Close";
}

function PositionActionButton({
  position,
  onPositionAction,
  pendingActionPositionId,
}: {
  position: WalletPosition;
  onPositionAction?: MakeColumnsOpts["onPositionAction"];
  pendingActionPositionId: string | null;
}): ReactElement {
  const lifecycle = position.lifecycleState ?? null;
  const isTerminal =
    lifecycle === "closed" ||
    lifecycle === "loser" ||
    lifecycle === "dust" ||
    lifecycle === "redeemed" ||
    lifecycle === "abandoned";
  const isRedeemable =
    position.status === "redeemable" &&
    (lifecycle === null || lifecycle === "winner");
  const isCloseable =
    position.status === "open" &&
    (lifecycle === null || lifecycle === "unresolved" || lifecycle === "open");
  const label = isRedeemable
    ? "Redeem"
    : isCloseable
      ? "Close"
      : actionLabel(position.status);
  const wired = typeof onPositionAction === "function";
  const actionable = wired && (isRedeemable || isCloseable);
  const busy = pendingActionPositionId === position.positionId;
  const kind: PositionAction | null = isRedeemable
    ? "redeem"
    : isCloseable
      ? "close"
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
            : lifecycle === "redeem_pending"
              ? "Redeem already pending"
              : isTerminal
                ? "Position already settled"
                : lifecycle === "closing" || lifecycle === "resolving"
                  ? "Position action already pending"
                  : busy
                    ? "Working…"
                    : `${label} via Polymarket`
      }
      aria-label={`${label} ${position.marketTitle}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!actionable || busy || !kind) return;
        void onPositionAction?.(position, kind);
      }}
      className={
        actionable && !busy
          ? isRedeemable
            ? "w-20 border-primary/40 bg-primary/10 font-semibold text-primary hover:bg-primary/20"
            : "w-20 border-border/70 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
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
