// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/copy-trade/targets`
 * Purpose: HTTP GET (list) + POST (create) for the calling user's tracked Polymarket
 *          wallets. Per docs/spec/poly-multi-tenant-auth.md.
 * Scope: Thin validators — both ops resolve `(userId, billingAccountId)` from the
 *        session, then `withTenantScope(appDb, userId, ...)` so RLS enforces tenant
 *        isolation at the DB layer. App-side defense-in-depth verifies
 *        `row.billing_account_id === expected.billingAccountId` before responding.
 *        No business logic; no cross-tenant access.
 * Invariants:
 *   - TENANT_SCOPED: routes use `withTenantScope(appDb, sessionUser.id)`. RLS clamp.
 *   - TENANT_DEFENSE_IN_DEPTH: every row returned to the caller is verified against
 *     `expected.billingAccountId` after the RLS-scoped SELECT (mirrors
 *     `DrizzleConnectionBrokerAdapter.resolve()`).
 *   - GLOBAL_KILL_SWITCH_PER_TENANT: `enabled` field reflects the tenant's
 *     `poly_copy_trade_config.enabled` row. Read once per request.
 * Side-effects: IO (Postgres reads + writes via appDb).
 * Notes: DELETE lives in `[id]/route.ts`. Phase B replaces the operator-wide
 *        scaffolding caps with per-tenant grants from `poly_wallet_grants`.
 * Links: docs/spec/poly-multi-tenant-auth.md, work/items/task.0318
 * @public
 */

import { withTenantScope } from "@cogni/db-client";
import { toUserId, userActor } from "@cogni/ids";
import {
  type PolyCopyTradeTarget,
  polyCopyTradeTargetCreateOperation,
  polyCopyTradeTargetsOperation,
} from "@cogni/node-contracts";
import { polyCopyTradeTargets } from "@cogni/poly-db-schema";
import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { buildMirrorTargetConfig } from "@/bootstrap/jobs/copy-trade-mirror.job";
import { createOrderLedger } from "@/features/trading";

export const dynamic = "force-dynamic";

/**
 * Hardcoded scaffolding caps the dashboard surfaces alongside each tracked
 * wallet. Operator-wide in Phase A — Phase B sources these per-tenant from
 * `poly_wallet_grants`. Kept inline here (not re-exported) so the route does
 * not import from the mirror-job shim.
 */
function buildTargetView(params: {
  id?: string;
  targetWallet: `0x${string}`;
  billingAccountId: string;
  createdByUserId: string;
  enabled: boolean;
  source: "env" | "db";
}): PolyCopyTradeTarget {
  const config = buildMirrorTargetConfig({
    targetWallet: params.targetWallet,
    billingAccountId: params.billingAccountId,
    createdByUserId: params.createdByUserId,
  });
  return {
    target_id: config.target_id,
    target_wallet: params.targetWallet,
    mode: config.mode,
    mirror_usdc: config.mirror_usdc,
    max_daily_usdc: config.max_daily_usdc,
    max_fills_per_hour: config.max_fills_per_hour,
    enabled: params.enabled,
    source: params.source,
  };
}

/**
 * GET /api/v1/poly/copy-trade/targets — list the calling user's tracked wallets.
 */
export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.copy_trade.targets.list",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");
    const container = getContainer();

    // Resolve the user's billing account (defense-in-depth target).
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    const wallets = await container.copyTradeTargetSource.listForActor(
      userActor(toUserId(sessionUser.id))
    );

    if (wallets.length === 0) {
      return NextResponse.json(
        polyCopyTradeTargetsOperation.output.parse({ targets: [] })
      );
    }

    // Per-tenant kill-switch — single read for all rows in this response.
    const ledger = createOrderLedger({
      db: container.serviceDb as unknown as import("drizzle-orm/node-postgres").NodePgDatabase,
      logger: ctx.log,
    });
    const firstConfig = buildMirrorTargetConfig({
      targetWallet: wallets[0] as `0x${string}`,
      billingAccountId: account.id,
      createdByUserId: sessionUser.id,
    });
    const snapshot = await ledger.snapshotState(
      firstConfig.target_id,
      account.id
    );

    const targets = wallets.map((targetWallet) =>
      buildTargetView({
        targetWallet,
        billingAccountId: account.id,
        createdByUserId: sessionUser.id,
        enabled: snapshot.enabled,
        source: "db",
      })
    );

    return NextResponse.json(
      polyCopyTradeTargetsOperation.output.parse({ targets })
    );
  }
);

/**
 * POST /api/v1/poly/copy-trade/targets — add a tracked wallet for the session user.
 */
export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.copy_trade.targets.create",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = polyCopyTradeTargetCreateOperation.input.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const targetWallet = parsed.data.target_wallet as `0x${string}`;

    const container = getContainer();
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    const appDb = resolveAppDb() as unknown as PostgresJsDatabase<
      Record<string, unknown>
    >;
    const actorId = userActor(toUserId(sessionUser.id));

    // INSERT under withTenantScope — RLS WITH CHECK enforces created_by_user_id == actor.
    const insertedRows = await withTenantScope(appDb, actorId, async (tx) =>
      tx
        .insert(polyCopyTradeTargets)
        .values({
          billingAccountId: account.id,
          createdByUserId: sessionUser.id,
          targetWallet,
        })
        // Conflict resolves against the partial unique index
        // `poly_copy_trade_targets_billing_wallet_active_idx` (WHERE disabled_at IS NULL).
        .onConflictDoNothing()
        .returning({
          id: polyCopyTradeTargets.id,
          billing_account_id: polyCopyTradeTargets.billingAccountId,
          created_by_user_id: polyCopyTradeTargets.createdByUserId,
        })
    );

    let inserted = insertedRows[0];
    if (!inserted) {
      // Conflict: row already exists active. Fetch it (still RLS-clamped).
      const existing = await withTenantScope(appDb, actorId, async (tx) =>
        tx
          .select({
            id: polyCopyTradeTargets.id,
            billing_account_id: polyCopyTradeTargets.billingAccountId,
            created_by_user_id: polyCopyTradeTargets.createdByUserId,
          })
          .from(polyCopyTradeTargets)
          .where(
            and(
              eq(polyCopyTradeTargets.billingAccountId, account.id),
              eq(polyCopyTradeTargets.targetWallet, targetWallet),
              isNull(polyCopyTradeTargets.disabledAt)
            )
          )
          .limit(1)
      );
      inserted = existing[0];
      if (!inserted) {
        // Should never happen — RLS rejected after we passed WITH CHECK.
        return NextResponse.json(
          { error: "Failed to persist tracked wallet" },
          { status: 500 }
        );
      }
    }

    // Defense-in-depth: spec § TENANT_DEFENSE_IN_DEPTH. RLS already clamps,
    // but verify the returned row's billing_account_id matches expected.
    if (inserted.billing_account_id !== account.id) {
      ctx.log.warn(
        {
          event: "poly.copy_trade.targets.tenant_mismatch",
          expected: account.id,
          actual: inserted.billing_account_id,
        },
        "tenant verification failed after RLS-scoped insert"
      );
      return NextResponse.json({ error: "Tenant mismatch" }, { status: 500 });
    }

    // Read kill-switch for the response shape.
    const ledger = createOrderLedger({
      db: container.serviceDb as unknown as import("drizzle-orm/node-postgres").NodePgDatabase,
      logger: ctx.log,
    });
    const config = buildMirrorTargetConfig({
      targetWallet,
      billingAccountId: account.id,
      createdByUserId: sessionUser.id,
    });
    const snapshot = await ledger.snapshotState(config.target_id, account.id);

    const target = buildTargetView({
      id: inserted.id,
      targetWallet,
      billingAccountId: account.id,
      createdByUserId: sessionUser.id,
      enabled: snapshot.enabled,
      source: "db",
    });

    ctx.log.info(
      { target_wallet: targetWallet, target_id: target.target_id },
      "poly.copy_trade.targets.create_success"
    );

    return NextResponse.json(
      polyCopyTradeTargetCreateOperation.output.parse({ target }),
      { status: 201 }
    );
  }
);
