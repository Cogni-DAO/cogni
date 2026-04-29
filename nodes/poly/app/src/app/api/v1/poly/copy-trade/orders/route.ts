// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/copy-trade/orders`
 * Purpose: HTTP GET — recent rows from the order ledger (copy-trade placements from the autonomous mirror poll). v0 orders are not yet user-scoped.
 * Scope: Thin validator — parses query params, reads via `container.orderLedger.listRecent`, maps to contract response shape including `synced_at` (ISO-8601 or null) and `staleness_ms` (derived server-side as `now - synced_at`).
 * Invariants: Response shape is contract-defined; ordering is `observed_at DESC`; agent-tool placements are NOT in the ledger in v0 (follow-up).
 * Side-effects: IO (one DB SELECT via service-role client).
 * Notes: Authenticated via session. HARDCODED_USER — response is not user-scoped in v0.
 * Links: docs/spec/poly-copy-trade-phase1.md, work/items/task.0328.poly-sync-truth-ledger-cache.md (CP3)
 * @public
 */

import {
  type PolyCopyTradeOrderRow,
  polyCopyTradeOrdersOperation,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import type { LedgerRow } from "@/features/trading";
import { logRequestWarn, type RequestContext } from "@/shared/observability";

export const dynamic = "force-dynamic";

function handleRouteError(
  ctx: RequestContext,
  error: unknown
): NextResponse | null {
  if (error && typeof error === "object" && "issues" in error) {
    logRequestWarn(ctx.log, error, "VALIDATION_ERROR");
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  return null;
}

function toContractRow(r: LedgerRow): PolyCopyTradeOrderRow {
  const attrs = (r.attributes ?? {}) as Record<string, unknown>;
  const readStr = (k: string): string | null =>
    typeof attrs[k] === "string" ? (attrs[k] as string) : null;
  const readNum = (k: string): number | null =>
    typeof attrs[k] === "number" ? (attrs[k] as number) : null;
  const sideRaw = readStr("side");
  const side: PolyCopyTradeOrderRow["side"] =
    sideRaw === "BUY" || sideRaw === "SELL" ? sideRaw : null;

  // Polymarket trade-detail URL is dormant post-Stage-4 purge: it used to
  // link to the single-operator wallet's trade page. The per-tenant
  // replacement resolves the owning wallet from `r.billing_account_id`
  // and lands with the Money-page rework.
  const profile: string | null = null;

  const syncedAt = r.synced_at ?? null;
  const staleness_ms =
    syncedAt !== null ? Date.now() - syncedAt.getTime() : null;

  return {
    target_id: r.target_id,
    target_wallet: readStr("target_wallet"),
    fill_id: r.fill_id,
    client_order_id: r.client_order_id,
    order_id: r.order_id,
    status: r.status,
    market_id: readStr("market_id"),
    market_title: readStr("title"),
    market_tx_hash: readStr("transaction_hash"),
    outcome: readStr("outcome"),
    side,
    size_usdc: readNum("size_usdc"),
    limit_price: readNum("limit_price"),
    filled_size_usdc: readNum("filled_size_usdc"),
    error: readStr("error"),
    observed_at: r.observed_at.toISOString(),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    polymarket_profile_url: profile,
    synced_at: syncedAt?.toISOString() ?? null,
    staleness_ms,
  };
}

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.copy_trade.orders",
    auth: { mode: "required", getSessionUser },
  },
  // TODO(HARDCODED_USER): response not user-scoped. Multi-tenant scoping lands
  // in task.0315 P2 when `poly_copy_trade_targets.owner_id` is added.
  async (ctx, request, _sessionUser) => {
    try {
      const { searchParams } = new URL(request.url);
      const limitRaw = searchParams.get("limit");
      const statusRaw = searchParams.get("status");
      const targetIdRaw = searchParams.get("target_id");

      const input = polyCopyTradeOrdersOperation.input.parse({
        ...(limitRaw !== null ? { limit: Number(limitRaw) } : {}),
        ...(statusRaw !== null ? { status: statusRaw } : {}),
        ...(targetIdRaw !== null ? { target_id: targetIdRaw } : {}),
      });

      const ledger = getContainer().orderLedger;
      const listOpts: { limit?: number; target_id?: string } = {};
      if (input.limit !== undefined) listOpts.limit = input.limit;
      if (input.target_id !== undefined) listOpts.target_id = input.target_id;
      const rows = await ledger.listRecent(listOpts);

      const filtered =
        input.status && input.status !== "all"
          ? rows.filter((r) => r.status === input.status)
          : rows;

      const orders = filtered.map((r) => toContractRow(r));
      return NextResponse.json(
        polyCopyTradeOrdersOperation.output.parse({ orders })
      );
    } catch (error) {
      const errorResponse = handleRouteError(ctx, error);
      if (errorResponse) return errorResponse;
      throw error;
    }
  }
);
