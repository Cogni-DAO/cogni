// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/OrderActivityCard`
 * Purpose: "Active Orders" dashboard card — live table of mirror-order rows from the copy-trade ledger with a status filter and per-row copy-to-clipboard for paste-into-agent flows.
 * Scope: Client component. Read-only. No cancel/edit actions (agent tools handle that via copied payload).
 * Invariants:
 *   - READ_ONLY: no mutation buttons.
 *   - COPY_PAYLOAD_IS_AGENT_INPUT: per-row copy emits a JSON block shaped for an AI agent prompt.
 *   - LEDGER_STATUS_MAY_BE_STALE: `status` is set at placement time and is not reconciled with the CLOB. An `open` row may already be filled/canceled on-chain. (task.0323 §2)
 * Side-effects: IO (via React Query), clipboard (user-triggered).
 * Links: [fetchOrders](../_api/fetchOrders.ts), packages/node-contracts/src/poly.copy-trade.orders.v1.contract.ts
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { type ReactElement, useState } from "react";
import {
  Badge,
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
  open: "bg-primary animate-pulse",
  partial: "bg-warning",
  filled: "bg-success",
  canceled: "bg-muted-foreground",
  error: "bg-destructive",
};

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  open: "default",
  partial: "secondary",
  filled: "secondary",
  canceled: "secondary",
  error: "destructive",
};

function buildAgentPayload(row: PolyCopyTradeOrderRow): string {
  return JSON.stringify(
    {
      action: "paste-me-to-your-agent",
      hint: "Inspect / cancel / reprice this Polymarket copy-trade order via core__poly_place_trade and related tools. Ledger status may be stale (task.0323 §2) — cross-check against Data-API /positions.",
      order: row,
      ground_truth: row.target_wallet
        ? {
            positions_url: `https://data-api.polymarket.com/positions?user=${row.target_wallet}`,
            trades_url: `https://data-api.polymarket.com/trades?user=${row.target_wallet}&limit=10`,
          }
        : null,
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
      onClick={() => {
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

export function OrderActivityCard(): ReactElement {
  const [filter, setFilter] = useState<OrdersStatusFilter>("open");

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
          <div className="flex flex-col gap-0.5">
            <CardTitle className="flex items-center gap-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Active Orders
              <span
                title="Ledger status is set at placement and not reconciled with the CLOB — an 'open' row may already be filled on-chain. Cross-check via the ground-truth links (task.0323 §2)."
                className="inline-flex items-center text-warning"
              >
                <AlertTriangle className="size-3" />
              </span>
            </CardTitle>
            <p className="text-muted-foreground/70 text-xs">
              Mirror-order ledger — read-only. Copy a row to paste into your
              agent for cancel / reprice.
            </p>
          </div>
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
                <TableHead className="w-8" />
                <TableHead>Status</TableHead>
                <TableHead>Market</TableHead>
                <TableHead className="text-center">Side</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Filled</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Placed</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((row) => (
                <TableRow key={`${row.target_id}:${row.fill_id}`}>
                  <TableCell className="pr-0">
                    <span
                      className={cn(
                        "inline-block size-2 rounded-full",
                        STATUS_DOT[row.status] ?? "bg-muted-foreground"
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge
                      intent={STATUS_BADGE[row.status] ?? "secondary"}
                      size="sm"
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-56 truncate font-medium text-sm">
                    {/* NB: Intentionally NOT linking `row.polymarket_profile_url` —
                        that URL points at the operator's Polymarket profile
                        trade-detail page, and the operator is EOA-direct.
                        Polymarket auto-redirects `/profile/<EOA>` to an empty
                        Safe-proxy page. Copy-payload carries the ground-truth
                        Data-API URLs instead. See `.claude/skills/poly-dev-expert/SKILL.md`. */}
                    {row.market_id ? (
                      <span className="font-mono text-muted-foreground text-xs">
                        {row.market_id.slice(0, 10)}…
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        (unknown market)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {row.side ? (
                      <Badge
                        intent={row.side === "BUY" ? "default" : "secondary"}
                        size="sm"
                      >
                        {row.side}
                      </Badge>
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
              ))}
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
