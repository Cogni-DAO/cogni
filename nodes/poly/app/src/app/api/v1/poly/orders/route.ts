// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/orders/route`
 * Purpose: Dashboard endpoint for the Active Orders card — SELECT over `poly_copy_trade_fills` with status filters.
 * Scope: Validates query via Zod, reads via resolveAppDb, projects attributes JSONB into convenience fields.
 * Invariants:
 *   - AUTH_REQUIRED
 *   - READ_ONLY
 *   - SINGLE_TENANT_PROTOTYPE: returns the global ledger; Phase 2 will add target/user scoping.
 * Side-effects: IO (DB)
 * @public
 */

// TODO(task.0315 P2 / single-tenant auth):
// This route returns rows for the whole mirror ledger. Once multi-tenant
// auth lands, scope by target owner / session user.

import { desc, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getServerSessionUser } from "@/lib/auth/server";
import { polyCopyTradeFills } from "@/shared/db/schema";

const QuerySchema = z.object({
  status: z.enum(["all", "open", "filled", "closed"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const STATUS_BUCKETS: Record<
  z.infer<typeof QuerySchema>["status"],
  readonly string[]
> = {
  all: ["pending", "open", "filled", "partial", "canceled", "error"],
  open: ["pending", "open", "partial"],
  filled: ["filled"],
  closed: ["canceled", "error"],
};

function pickString(
  attrs: Record<string, unknown> | null,
  key: string
): string | null {
  if (!attrs) return null;
  const v = attrs[key];
  return typeof v === "string" ? v : null;
}

function pickNumber(
  attrs: Record<string, unknown> | null,
  key: string
): number | null {
  if (!attrs) return null;
  const v = attrs[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.orders",
    auth: { mode: "required", getSessionUser: getServerSessionUser },
  },
  async (_ctx, request) => {
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      status: searchParams.get("status") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { status, limit } = parsed.data;
    const statuses = STATUS_BUCKETS[status];

    const db = resolveAppDb();
    const rows = await db
      .select({
        targetId: polyCopyTradeFills.targetId,
        fillId: polyCopyTradeFills.fillId,
        clientOrderId: polyCopyTradeFills.clientOrderId,
        orderId: polyCopyTradeFills.orderId,
        status: polyCopyTradeFills.status,
        observedAt: polyCopyTradeFills.observedAt,
        attributes: polyCopyTradeFills.attributes,
      })
      .from(polyCopyTradeFills)
      .where(inArray(polyCopyTradeFills.status, [...statuses]))
      .orderBy(desc(polyCopyTradeFills.observedAt))
      .limit(limit);

    const orders = rows.map((r) => {
      const attrs = (r.attributes ?? {}) as Record<string, unknown>;
      return {
        targetId: r.targetId,
        fillId: r.fillId,
        clientOrderId: r.clientOrderId,
        orderId: r.orderId,
        status: r.status,
        observedAt: r.observedAt.toISOString(),
        attributes: attrs,
        marketId:
          pickString(attrs, "market_id") ?? pickString(attrs, "conditionId"),
        marketTitle:
          pickString(attrs, "market_title") ?? pickString(attrs, "title"),
        side: pickString(attrs, "side") ?? pickString(attrs, "outcome"),
        sizeUsdc: pickNumber(attrs, "size_usdc"),
        limitPrice:
          pickNumber(attrs, "limit_price") ?? pickNumber(attrs, "price"),
      };
    });

    return NextResponse.json({
      orders,
      totalCount: orders.length,
      status,
    });
  }
);
