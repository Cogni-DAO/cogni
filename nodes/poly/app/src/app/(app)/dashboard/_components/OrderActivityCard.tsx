// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/OrderActivityCard`
 * Purpose: "Active Orders" dashboard card — live table of mirror-order rows from the copy-trade ledger with a status filter and per-row copy-to-clipboard for paste-into-agent flows.
 * Scope: Client component. Read-only. No cancel/edit actions (agent tools handle that via copied payload).
 * Invariants:
 *   - READ_ONLY: no mutation buttons.
 *   - COPY_PAYLOAD_IS_AGENT_INPUT: per-row copy emits a JSON block shaped for an AI agent prompt.
 *   - LEDGER_STATUS_IS_RECONCILED: status is reconciled from CLOB every reconciler tick; synced_at + staleness_ms render a staleness dot when synced_at IS NULL or staleness > 60s. (task.0328)
 *   - VISUAL_RESTRAINT: only BUY (green) / SELL (red) carry color. Status uses a tiny dot + muted text.
 *   - NO_EOA_PROFILE_LINKS: row click points at the target's Polygon tx (authoritative on-chain proof), never at polymarket.com/profile/<operator> — that redirects to an empty Safe-proxy for EOA-direct operators. See `.claude/skills/poly-dev-expert/SKILL.md`.
 *   - NO_EXTERNAL_PROXY: market title + tx hash are read directly from the row (denormalized at write time in `decide.ts` + `order-ledger.ts`). We do NOT proxy Polymarket Gamma from the client.
 * Side-effects: IO (via React Query), clipboard (user-triggered).
 * Links: [fetchOrders](../_api/fetchOrders.ts), packages/node-contracts/src/poly.copy-trade.orders.v1.contract.ts
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { type ReactElement, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import { cn } from "@/shared/util/cn";
import {
  fetchOrders,
  type OrdersStatusFilter,
  type PolyCopyTradeOrderRow,
} from "../_api/fetchOrders";
import { formatPrice, formatUsdc, timeAgo } from "./wallet-format";

const FILTERS: readonly { value: OrdersStatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "filled", label: "Filled" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
] as const;

const STATUS_DOT: Record<string, string> = {
  pending: "bg-muted-foreground animate-pulse",
  open: "bg-success",
  partial: "bg-warning",
  filled: "bg-success",
  canceled: "bg-muted-foreground",
  error: "bg-destructive",
};

function buildAgentPayload(row: PolyCopyTradeOrderRow): string {
  return JSON.stringify(
    {
      action: "paste-me-to-your-agent",
      hint: "Inspect / cancel / reprice this Polymarket copy-trade order via core__poly_place_trade and related tools. Trust row.status when staleness_ms < 60000; treat null synced_at or staleness_ms > 60000 as unverified and cross-check against Data-API /positions.",
      order: row,
      ground_truth: {
        target_wallet_positions: row.target_wallet
          ? `https://data-api.polymarket.com/positions?user=${row.target_wallet}`
          : null,
        target_wallet_trades: row.target_wallet
          ? `https://data-api.polymarket.com/trades?user=${row.target_wallet}&limit=10`
          : null,
        polygon_tx: row.market_tx_hash
          ? `https://polygonscan.com/tx/${row.market_tx_hash}`
          : null,
      },
    },
    null,
    2
  );
}

function RowCopyButton({ row }: { row: PolyCopyTradeOrderRow }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy order details for agent"
      title="Copy order JSON — paste to your agent to cancel or edit"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(buildAgentPayload(row)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {copied ? (
        <Check className="size-3.5 text-success" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  );
}

const STALE_THRESHOLD_MS = 60_000;

/**
 * Small dot rendered next to the status label.
 * - No dot when the row is fresh (synced within 60 s).
 * - Grey dot with tooltip "Never synced" when `synced_at` is null.
 * - Yellow dot with relative-time tooltip when staleness > 60 s.
 */
function StalenessDot({
  synced_at,
  staleness_ms,
}: {
  synced_at: string | null;
  staleness_ms: number | null;
}): ReactElement | null {
  if (synced_at !== null && (staleness_ms ?? 0) <= STALE_THRESHOLD_MS) {
    return null; // Fresh — no badge needed.
  }

  const isNeverSynced = synced_at === null;
  const tooltip = isNeverSynced
    ? "Never synced"
    : `Last synced ${timeAgo(synced_at)} ago`;

  return (
    // biome-ignore lint/a11y/useAriaPropsForRole: decorative dot uses title for tooltip only
    <span
      title={tooltip}
      className={cn(
        "inline-block size-1.5 rounded-full",
        isNeverSynced ? "bg-muted-foreground" : "bg-warning"
      )}
    />
  );
}

export function OrderActivityCard(): ReactElement {
  const [filter, setFilter] = useState<OrdersStatusFilter>("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-orders", filter],
    queryFn: () => fetchOrders({ status: filter, limit: 50 }),
    refetchInterval: 10_000,
    staleTime: 5_000,
    gcTime: 60_000,
    retry: 1,
  });

  const orders = data?.orders ?? [];

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Active Orders
          </CardTitle>
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(v) => {
              if (v) setFilter(v as OrdersStatusFilter);
            }}
            className="rounded-lg border"
          >
            {FILTERS.map((f) => (
              <ToggleGroupItem
                key={f.value}
                value={f.value}
                className="px-3 text-xs"
              >
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="animate-pulse space-y-px px-5 pb-4">
            <div className="h-9 rounded bg-muted" />
            <div className="h-9 rounded bg-muted" />
            <div className="h-9 rounded bg-muted" />
          </div>
        ) : isError ? (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">
            Failed to load orders. Try again shortly.
          </p>
        ) : orders.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Status</TableHead>
                <TableHead>Market</TableHead>
                <TableHead className="w-16 text-center">Side</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Filled</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Placed</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((row) => {
                // Authoritative click target: the target wallet's on-chain tx
                // that triggered this mirror. Falls back to null → row not
                // clickable (old rows written before the title stash).
                const href = row.market_tx_hash
                  ? `https://polygonscan.com/tx/${row.market_tx_hash}`
                  : null;
                // Data-API trades always carry a human-readable title (Zod
                // schema default=""), so for rows written post-#918 this is
                // always populated. Pre-#918 legacy rows may render empty;
                // that's a finite migration tail, not worth placeholder UX.
                const display = row.market_title ?? "";

                const openHref = () => {
                  if (href) window.open(href, "_blank", "noopener");
                };
                return (
                  <TableRow
                    key={`${row.target_id}:${row.fill_id}`}
                    role={href ? "link" : undefined}
                    tabIndex={href ? 0 : undefined}
                    onClick={openHref}
                    onAuxClick={(e) => {
                      // middle-click → new tab (same as left-click today).
                      if (e.button === 1) openHref();
                    }}
                    onKeyDown={(e) => {
                      if (href && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        openHref();
                      }
                    }}
                    className={cn(
                      href &&
                        "cursor-pointer hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none"
                    )}
                  >
                    <TableCell className="text-muted-foreground text-sm">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-block size-2 rounded-full",
                            STATUS_DOT[row.status] ?? "bg-muted-foreground"
                          )}
                        />
                        {row.status}
                        <StalenessDot
                          synced_at={row.synced_at}
                          staleness_ms={row.staleness_ms}
                        />
                      </span>
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {display}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.side === "BUY" ? (
                        <span className="font-mono font-semibold text-success text-xs tracking-wide">
                          BUY
                        </span>
                      ) : row.side === "SELL" ? (
                        <span className="font-mono font-semibold text-destructive text-xs tracking-wide">
                          SELL
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {row.size_usdc !== null ? formatUsdc(row.size_usdc) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                      {row.filled_size_usdc !== null
                        ? formatUsdc(row.filled_size_usdc)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                      {formatPrice(row.limit_price)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      {timeAgo(row.observed_at)}
                    </TableCell>
                    <TableCell className="pl-0 text-right">
                      <RowCopyButton row={row} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">
            No {filter === "all" ? "" : `${filter} `}orders yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
