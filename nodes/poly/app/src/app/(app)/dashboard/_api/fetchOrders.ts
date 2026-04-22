// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchOrders`
 * Purpose: Client-side fetch for the dashboard execution surface. Calls GET /api/v1/poly/copy-trade/orders.
 * Scope: Data fetching only. Maps UI status-bucket filter → contract status; graceful empty on failure.
 * Side-effects: IO (HTTP fetch)
 * Links: packages/node-contracts/src/poly.copy-trade.orders.v1.contract.ts
 * @public
 */

import type {
  PolyCopyTradeOrderRow,
  PolyCopyTradeOrdersOutput,
} from "@cogni/node-contracts";

export type { PolyCopyTradeOrderRow, PolyCopyTradeOrdersOutput };

/** UI status bucket. Groups several contract statuses for the UI toggle. */
export type OrdersStatusFilter = "all" | "open" | "filled" | "closed";

const STATUS_BUCKET_TO_CONTRACT_STATUSES: Record<
  OrdersStatusFilter,
  readonly PolyCopyTradeOrderRow["status"][] | "all"
> = {
  all: "all",
  open: ["pending", "open", "partial"],
  filled: ["filled"],
  closed: ["canceled", "error"],
};

const EMPTY: PolyCopyTradeOrdersOutput = { orders: [] };

async function fetchOne(
  params: URLSearchParams
): Promise<PolyCopyTradeOrdersOutput> {
  const res = await fetch(
    `/api/v1/poly/copy-trade/orders?${params.toString()}`
  );
  if (res.ok) return (await res.json()) as PolyCopyTradeOrdersOutput;
  if (res.status === 404) return EMPTY;
  throw new Error(`Failed to fetch orders: ${res.status} ${res.statusText}`);
}

export async function fetchOrders(
  opts: { status?: OrdersStatusFilter; limit?: number } = {}
): Promise<PolyCopyTradeOrdersOutput> {
  const status = opts.status ?? "all";
  const limit = opts.limit ?? 50;
  const bucket = STATUS_BUCKET_TO_CONTRACT_STATUSES[status];

  try {
    if (bucket === "all") {
      const qs = new URLSearchParams({ status: "all", limit: String(limit) });
      return await fetchOne(qs);
    }
    // One request per contract status, then merge, resort, and trim.
    const responses = await Promise.all(
      bucket.map((s) =>
        fetchOne(new URLSearchParams({ status: s, limit: String(limit) }))
      )
    );
    const merged = responses.flatMap((r) => r.orders);
    merged.sort((a, b) => b.observed_at.localeCompare(a.observed_at));
    return { orders: merged.slice(0, limit) };
  } catch (err) {
    if (err instanceof TypeError) return EMPTY;
    throw err;
  }
}
