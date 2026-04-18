// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchOrders`
 * Purpose: Client-side fetch for the Active Orders dashboard card. Calls GET /api/v1/poly/orders.
 * Scope: Data fetching only. Graceful empty state on failure.
 * Side-effects: IO (HTTP fetch)
 * @public
 */

export type OrderStatus =
  | "pending"
  | "open"
  | "filled"
  | "partial"
  | "canceled"
  | "error";

export interface OrderRow {
  targetId: string;
  fillId: string;
  clientOrderId: string;
  orderId: string | null;
  status: OrderStatus;
  observedAt: string;
  /** Copy-icon payload — full attributes JSONB so the agent sees everything. */
  attributes: Record<string, unknown>;
  /** Denormalized convenience fields (best-effort from attributes). */
  marketId: string | null;
  marketTitle: string | null;
  side: string | null;
  sizeUsdc: number | null;
  limitPrice: number | null;
}

export interface OrdersResponse {
  orders: OrderRow[];
  totalCount: number;
  status: string;
}

export type OrdersStatusFilter = "all" | "open" | "filled" | "closed";

const EMPTY: OrdersResponse = {
  orders: [],
  totalCount: 0,
  status: "all",
};

export async function fetchOrders(
  params: { status?: OrdersStatusFilter; limit?: number } = {}
): Promise<OrdersResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));

  try {
    const res = await fetch(`/api/v1/poly/orders?${qs.toString()}`);
    if (res.ok) return (await res.json()) as OrdersResponse;
    if (res.status === 404) return EMPTY;
    throw new Error(`Failed to fetch orders: ${res.status} ${res.statusText}`);
  } catch (err) {
    if (err instanceof TypeError) return EMPTY;
    throw err;
  }
}
