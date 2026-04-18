// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/OrderActivityCard`
 * Purpose: "Active Orders" dashboard card — live table of mirror-order rows from `poly_copy_trade_fills` with a status filter and per-row copy-to-clipboard for paste-into-agent flows.
 * Scope: Client component. Read-only. No cancel/edit actions (agent tools handle that via copied payload).
 * Invariants:
 *   - READ_ONLY: no mutation buttons.
 *   - COPY_PAYLOAD_IS_AGENT_INPUT: per-row copy emits a JSON block shaped for an AI agent prompt.
 * Side-effects: IO (via React Query), clipboard (user-triggered).
 * Links: [fetchOrders](../_api/fetchOrders.ts), work/items/task.0315
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
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
  type OrderRow,
  type OrdersStatusFilter,
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

function buildAgentPayload(row: OrderRow): string {
  return JSON.stringify(
    {
      action: "paste-me-to-your-agent",
      hint: "Inspect / cancel / reprice this Polymarket order via core__poly_place_trade and related tools.",
      order: {
        client_order_id: row.clientOrderId,
        order_id: row.orderId,
        status: row.status,
        market_id: row.marketId,
        market_title: row.marketTitle,
        side: row.side,
        size_usdc: row.sizeUsdc,
        limit_price: row.limitPrice,
        observed_at: row.observedAt,
        target_id: row.targetId,
        fill_id: row.fillId,
        attributes: row.attributes,
      },
    },
    null,
    2
  );
}

function RowCopyButton({ row }: { row: OrderRow }): ReactElement {
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
            <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Active Orders
            </CardTitle>
            <p className="text-muted-foreground/70 text-xs">
              Our mirror-order ledger — read-only. Copy a row to paste into your
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
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Placed</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((row) => (
                <TableRow key={`${row.targetId}:${row.fillId}`}>
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
                  <TableCell className="max-w-[28ch] truncate font-medium text-sm">
                    {row.marketTitle ?? (
                      <span className="font-mono text-muted-foreground text-xs">
                        {row.marketId
                          ? `${row.marketId.slice(0, 10)}…`
                          : "(unknown market)"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {row.side ? (
                      <Badge intent="secondary" size="sm">
                        {row.side}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {row.sizeUsdc !== null ? formatUsdc(row.sizeUsdc) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                    {formatPrice(row.limitPrice)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">
                    {timeAgo(row.observedAt)}
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
