// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/OrderActivityCard`
 * Purpose: "Active Orders" dashboard card — live table of mirror-order rows from the copy-trade ledger with a status filter and per-row copy-to-clipboard for paste-into-agent flows.
 * Scope: Client component. Read-only. No cancel/edit actions (agent tools handle that via copied payload).
 * Invariants:
 *   - READ_ONLY: no mutation buttons.
 *   - COPY_PAYLOAD_IS_AGENT_INPUT: per-row copy emits a JSON block shaped for an AI agent prompt.
 *   - LEDGER_STATUS_MAY_BE_STALE: `status` is set at placement time and is not reconciled with the CLOB. (task.0323 §2)
 *   - VISUAL_RESTRAINT: only BUY (green) / SELL (red) carry color. Status uses a tiny dot + muted text. Matches the rest of the dashboard's minimal palette.
 *   - NO_EOA_PROFILE_LINKS: row links point to the market page (`polymarket.com/market/<slug>`), never to `/profile/<operator>` — EOA-direct operator profiles redirect to an empty Safe proxy. See `.claude/skills/poly-dev-expert/SKILL.md`.
 * Side-effects: IO (via React Query), clipboard (user-triggered).
 * Links: [fetchOrders](../_api/fetchOrders.ts), [fetchMarketTitles](../_api/fetchMarketTitles.ts)
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
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
  extractConditionId,
  fetchMarketTitles,
  type MarketTitleMap,
} from "../_api/fetchMarketTitles";
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

/** Dot color = fast-scan status cue. Text color is always muted-foreground. */
const STATUS_DOT: Record<string, string> = {
  pending: "bg-muted-foreground animate-pulse",
  open: "bg-success",
  partial: "bg-warning",
  filled: "bg-success",
  canceled: "bg-muted-foreground",
  error: "bg-destructive",
};

function buildAgentPayload(
  row: PolyCopyTradeOrderRow,
  title: string | undefined
): string {
  return JSON.stringify(
    {
      action: "paste-me-to-your-agent",
      hint: "Inspect / cancel / reprice this Polymarket copy-trade order via core__poly_place_trade and related tools. Ledger status may be stale (task.0323 §2) — cross-check against Data-API /positions.",
      order: { ...row, market_title: title ?? null },
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

function RowCopyButton({
  row,
  title,
}: {
  row: PolyCopyTradeOrderRow;
  title: string | undefined;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy order details for agent"
      title="Copy order JSON — paste to your agent to cancel or edit"
      onClick={(e) => {
        e.stopPropagation(); // don't trigger the row-link navigation
        void navigator.clipboard
          .writeText(buildAgentPayload(row, title))
          .then(() => {
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

  const conditionIds = useMemo(
    () =>
      Array.from(
        new Set(
          orders.flatMap((o) => {
            const cid = extractConditionId(o.market_id);
            return cid ? [cid.toLowerCase()] : [];
          })
        )
      ),
    [orders]
  );

  const { data: titles } = useQuery<MarketTitleMap>({
    queryKey: ["dashboard-market-titles", conditionIds],
    queryFn: () => fetchMarketTitles(conditionIds),
    enabled: conditionIds.length > 0,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });

  const lookupFor = (
    marketId: string | null
  ): {
    question: string | undefined;
    slug: string | undefined;
    conditionId: string | null;
  } => {
    const cid = extractConditionId(marketId);
    if (!cid) {
      return { conditionId: null, question: undefined, slug: undefined };
    }
    const hit = titles?.[cid.toLowerCase()];
    return {
      conditionId: cid,
      question: hit?.question,
      slug: hit?.slug,
    };
  };

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
                const { question: title, slug } = lookupFor(row.market_id);
                const href = slug
                  ? `https://polymarket.com/market/${slug}`
                  : null;
                const displayMarket =
                  title ??
                  (row.market_id
                    ? (() => {
                        const cid = extractConditionId(row.market_id);
                        return cid ? `${cid.slice(0, 10)}…` : "(unknown)";
                      })()
                    : "(unknown)");

                return (
                  <TableRow
                    key={`${row.target_id}:${row.fill_id}`}
                    onClick={() => {
                      if (href) window.open(href, "_blank", "noopener");
                    }}
                    className={cn(href && "cursor-pointer hover:bg-muted/30")}
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
                      </span>
                    </TableCell>
                    <TableCell
                      className="max-w-80 truncate font-medium text-sm"
                      title={title ?? undefined}
                    >
                      {displayMarket}
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
                      <RowCopyButton row={row} title={title} />
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
