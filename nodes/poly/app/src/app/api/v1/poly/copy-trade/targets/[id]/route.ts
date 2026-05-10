// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/copy-trade/targets/[id]`
 * Purpose: HTTP DELETE/PATCH for one of the calling user's tracked Polymarket wallets.
 *          DELETE soft-deletes by setting `disabled_at`; PATCH updates the per-target
 *          mirror sizing policy. Per docs/spec/poly-tenant-and-collateral.md.
 * Scope: Validators + RLS-scoped UPDATEs. No cross-tenant access.
 * Invariants:
 *   - TENANT_SCOPED: UPDATE runs under `withTenantScope(appDb, sessionUser.id)`. RLS
 *     clamp means a user attempting to delete another user's row sees 0 rows
 *     affected → returns 404. Cross-tenant visibility blocked at the DB layer.
 *   - SOFT_DELETE: writes `disabled_at = now()` rather than DELETE. Preserves
 *     attribution history in `poly_copy_trade_fills`.
 * Side-effects: IO (Postgres UPDATE via appDb).
 * Links: docs/spec/poly-tenant-and-collateral.md, work/items/task.0318
 * @public
 */

import { withTenantScope } from "@cogni/db-client";
import { toUserId, userActor } from "@cogni/ids";
import { polyCopyTradeTargets } from "@cogni/poly-db-schema";
import {
  polyCopyTradeTargetDeleteOperation,
  polyCopyTradeTargetUpdateOperation,
} from "@cogni/poly-node-contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { sizingPolicyKindForTargetWallet } from "@/bootstrap/jobs/copy-trade-mirror.job";

export const dynamic = "force-dynamic";

export const DELETE = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "poly.copy_trade.targets.delete",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    if (!sessionUser) throw new Error("sessionUser required");

    const { id } = await context.params;
    const parsed = polyCopyTradeTargetDeleteOperation.input.safeParse({ id });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid target id", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const appDb = resolveAppDb() as unknown as PostgresJsDatabase<
      Record<string, unknown>
    >;
    const actorId = userActor(toUserId(sessionUser.id));

    const updatedRows = await withTenantScope(appDb, actorId, async (tx) =>
      tx
        .update(polyCopyTradeTargets)
        .set({ disabledAt: new Date() })
        .where(
          and(
            eq(polyCopyTradeTargets.id, parsed.data.id),
            isNull(polyCopyTradeTargets.disabledAt)
          )
        )
        .returning({ id: polyCopyTradeTargets.id })
    );

    if (updatedRows.length === 0) {
      // RLS-clamped UPDATE returned 0 rows — either the row never existed,
      // already disabled, or belongs to another tenant. All collapse to 404
      // (do not distinguish — would leak existence across tenants).
      return NextResponse.json(
        { error: "Tracked wallet not found" },
        { status: 404 }
      );
    }

    ctx.log.info(
      { target_id: parsed.data.id },
      "poly.copy_trade.targets.delete_success"
    );

    return NextResponse.json(
      polyCopyTradeTargetDeleteOperation.output.parse({ deleted: true })
    );
  }
);

export const PATCH = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "poly.copy_trade.targets.update",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser, context) => {
    if (!context) throw new Error("context required for dynamic routes");
    if (!sessionUser) throw new Error("sessionUser required");

    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = polyCopyTradeTargetUpdateOperation.input.safeParse({
      ...(typeof body === "object" && body !== null ? body : {}),
      id,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const appDb = resolveAppDb() as unknown as PostgresJsDatabase<
      Record<string, unknown>
    >;
    const actorId = userActor(toUserId(sessionUser.id));

    const updatedRows = await withTenantScope(appDb, actorId, async (tx) =>
      tx
        .update(polyCopyTradeTargets)
        .set({
          mirrorFilterPercentile: parsed.data.mirror_filter_percentile,
          mirrorMaxUsdcPerTrade:
            parsed.data.mirror_max_usdc_per_trade.toFixed(2),
        })
        .where(
          and(
            eq(polyCopyTradeTargets.id, parsed.data.id),
            isNull(polyCopyTradeTargets.disabledAt)
          )
        )
        .returning({
          id: polyCopyTradeTargets.id,
          target_wallet: polyCopyTradeTargets.targetWallet,
          mirror_filter_percentile: polyCopyTradeTargets.mirrorFilterPercentile,
          mirror_max_usdc_per_trade: polyCopyTradeTargets.mirrorMaxUsdcPerTrade,
        })
    );

    const row = updatedRows[0];
    if (!row) {
      return NextResponse.json(
        { error: "Tracked wallet not found" },
        { status: 404 }
      );
    }

    ctx.log.info(
      {
        target_id: parsed.data.id,
        mirror_filter_percentile: row.mirror_filter_percentile,
        mirror_max_usdc_per_trade: row.mirror_max_usdc_per_trade,
      },
      "poly.copy_trade.targets.update_success"
    );

    return NextResponse.json(
      polyCopyTradeTargetUpdateOperation.output.parse({
        target: {
          target_id: row.id,
          target_wallet: row.target_wallet,
          mode: "live",
          mirror_usdc: Number(row.mirror_max_usdc_per_trade),
          mirror_filter_percentile: row.mirror_filter_percentile,
          mirror_max_usdc_per_trade: Number(row.mirror_max_usdc_per_trade),
          sizing_policy_kind: sizingPolicyKindForTargetWallet(
            row.target_wallet as `0x${string}`
          ),
          source: "db",
        },
      })
    );
  }
);
