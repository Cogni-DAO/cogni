// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/account-activity/view`
 * Purpose: Client view for the user's full account activity — counter
 *   strip + paginated tables for open orders, open positions, closed
 *   positions over a 14d window. Modeled on the wallet-research page but
 *   tenant-scoped to the connected wallet.
 * Scope: Client component. Read-only. Pagination is client-side over the
 *   already-fetched arrays (positions cap at 30 in the upstream slice;
 *   orders are unbounded).
 * Invariants:
 *   - TENANT_SCOPED: data sourced from session-authed routes only.
 *   - PROTOTYPE_SCOPE: 14d window is fixed by upstream `getExecutionSlice`;
 *     timeframe selector deferred until the capability accepts a range.
 * Side-effects: IO (React Query)
 * Links: bug.5000, [page](./page.tsx)
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { type ReactElement, useMemo, useState } from "react";
import { PositionsTable } from "@/app/(app)/_components/positions-table";
import { fetchExecution } from "@/app/(app)/dashboard/_api/fetchExecution";
import type { PolyWalletOpenOrder } from "@cogni/poly-node-contracts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/components";
import { fetchWalletOrders } from "./_api/fetchOrders";

const PAGE_SIZE = 25;

export function AccountActivityView(): ReactElement {
  const execution = useQuery({
    queryKey: ["account-activity-execution"],
    queryFn: fetchExecution,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });

  const orders = useQuery({
    queryKey: ["account-activity-orders"],
    queryFn: fetchWalletOrders,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });

  const openOrders = orders.data?.orders ?? [];
  const openPositions = execution.data?.live_positions ?? [];
  const closedPositions = execution.data?.closed_positions ?? [];
  const dailyTradeCounts = execution.data?.dailyTradeCounts ?? [];
  const totalTrades14d = useMemo(
    () => dailyTradeCounts.reduce((acc, d) => acc + d.n, 0),
    [dailyTradeCounts]
  );

  const isLoading = execution.isLoading || orders.isLoading;

  return (
    <div className="space-y-4 px-4 py-4 lg:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-lg">Account Activity</h1>
        <p className="text-muted-foreground text-xs">
          {execution.data?.address ? (
            <>
              Wallet <span className="font-mono">{execution.data.address}</span>{" "}
              — last 14 days
            </>
          ) : (
            "Loading wallet…"
          )}
        </p>
      </header>

      <CounterStrip
        openOrders={openOrders.length}
        openPositions={openPositions.length}
        closedPositions14d={closedPositions.length}
        totalTrades14d={totalTrades14d}
        isLoading={isLoading}
      />

      <Section title="Open Orders" countLabel={`${openOrders.length} resting`}>
        <OrdersTable orders={openOrders} isLoading={orders.isLoading} />
      </Section>

      <Section
        title="Open Positions"
        countLabel={`${openPositions.length} live`}
      >
        <PositionsTable
          positions={openPositions}
          isLoading={execution.isLoading}
          emptyMessage="No open positions."
        />
      </Section>

      <Section
        title="Closed Positions (14d)"
        countLabel={`${closedPositions.length} settled`}
      >
        <PositionsTable
          positions={closedPositions}
          isLoading={execution.isLoading}
          variant="history"
          emptyMessage="No closed positions in the last 14 days."
        />
      </Section>
    </div>
  );
}

function CounterStrip({
  openOrders,
  openPositions,
  closedPositions14d,
  totalTrades14d,
  isLoading,
}: {
  openOrders: number;
  openPositions: number;
  closedPositions14d: number;
  totalTrades14d: number;
  isLoading: boolean;
}): ReactElement {
  const items = [
    { label: "Open Orders", value: openOrders },
    { label: "Open Positions", value: openPositions },
    { label: "Closed (14d)", value: closedPositions14d },
    { label: "Trades (14d)", value: totalTrades14d },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="px-4 py-3">
            <div className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              {it.label}
            </div>
            <div className="mt-1 font-semibold text-2xl tabular-nums">
              {isLoading ? <Skeleton className="h-7 w-16" /> : it.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Section({
  title,
  countLabel,
  children,
}: {
  title: string;
  countLabel: string;
  children: ReactElement;
}): ReactElement {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between px-5 py-3">
        <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          {title}
        </CardTitle>
        <span className="text-muted-foreground text-xs tabular-nums">
          {countLabel}
        </span>
      </CardHeader>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

function OrdersTable({
  orders,
  isLoading,
}: {
  orders: readonly PolyWalletOpenOrder[];
  isLoading: boolean;
}): ReactElement {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const slice = orders.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE
  );

  if (isLoading) {
    return (
      <div className="space-y-2 px-5 py-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <p className="px-5 py-6 text-center text-muted-foreground text-sm">
        No open orders.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-muted-foreground text-xs uppercase tracking-wider">
            <tr>
              <th className="px-5 py-2 text-left font-semibold">Side</th>
              <th className="px-5 py-2 text-left font-semibold">Outcome</th>
              <th className="px-5 py-2 text-right font-semibold">Price</th>
              <th className="px-5 py-2 text-right font-semibold">Shares</th>
              <th className="px-5 py-2 text-right font-semibold">
                Remaining $
              </th>
              <th className="px-5 py-2 text-right font-semibold">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((o) => (
              <tr key={o.orderId} className="border-b last:border-0">
                <td className="px-5 py-2 font-mono text-xs uppercase">
                  {o.side ?? "—"}
                </td>
                <td className="px-5 py-2">{o.outcome ?? "—"}</td>
                <td className="px-5 py-2 text-right tabular-nums">
                  {o.price !== null ? o.price.toFixed(4) : "—"}
                </td>
                <td className="px-5 py-2 text-right tabular-nums">
                  {o.originalShares !== null
                    ? o.originalShares.toFixed(2)
                    : "—"}
                </td>
                <td className="px-5 py-2 text-right tabular-nums">
                  {o.remainingUsdc !== null
                    ? `$${o.remainingUsdc.toFixed(2)}`
                    : "—"}
                </td>
                <td className="px-5 py-2 text-right text-muted-foreground text-xs tabular-nums">
                  <time dateTime={o.submittedAt} suppressHydrationWarning>
                    {new Date(o.submittedAt).toISOString()}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <div className="flex items-center justify-between border-t px-5 py-2 text-muted-foreground text-xs">
          <span>
            Page {safePage + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage === totalPages - 1}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
