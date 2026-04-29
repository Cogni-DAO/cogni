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
 *   - TENANT_DEFENSE_IN_DEPTH: write paths (POST) verify `row.billing_account_id ===
 *     expected.billingAccountId` after the RLS-scoped INSERT/SELECT (mirrors
 *     `DrizzleConnectionBrokerAdapter.resolve()`). Read paths (GET / DELETE) rely on
 *     the RLS clamp alone — they project bare wallet strings or do RLS-scoped
 *     UPDATE-by-id; there is no row-shaped tenant column to defense-check.
 *   - CONFIG_ROW_AUTO_ENABLED_ON_FIRST_POST: POST upserts `poly_copy_trade_config`
 *     with `enabled: true` inside the same tenant-scoped tx as the target insert.
 *     `ON CONFLICT (billing_account_id) DO NOTHING` — pre-existing rows (enabled
 *     OR user-disabled) are never overwritten. Ref bug.0338.
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
  polyCopyTradeConfig,
  polyCopyTradeTargets,
} from "@cogni/poly-db-schema";
import {
  type PolyCopyTradeTarget,
  polyCopyTradeTargetCreateOperation,
  polyCopyTradeTargetsOperation,
} from "@cogni/poly-node-contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { buildMirrorTargetConfig } from "@/bootstrap/jobs/copy-trade-mirror.job";

export const dynamic = "force-dynamic";

/**
 * Hardcoded scaffolding caps the dashboard surfaces alongside each tracked
 * wallet. Operator-wide in Phase A — Phase B sources these per-tenant from
 * `poly_wallet_grants`. `id` is the DB row PK from `poly_copy_trade_targets`,
 * exposed as the contract's `target_id` so DELETE can find it.
 */
function buildTargetView(params: {
  id: string;
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
    target_id: params.id,
    target_wallet: params.targetWallet,
    mode: config.mode,
    // Response shape keeps a flat `mirror_usdc` field for contract stability;
    // the internal sizing policy is a discriminated union (bug.0342). For
    // `kind: "fixed"`, project `mirror_usdc`. For `kind: "min_bet"`, project
    // the per-intent ceiling (closest stable scalar — the actual size is
    // market-dependent and computed at decision time).
    mirror_usdc:
      config.sizing.kind === "fixed"
        ? config.sizing.mirror_usdc
        : config.sizing.max_usdc_per_trade,
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
  async (_ctx, _request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");
    const container = getContainer();

    // Resolve the user's billing account (defense-in-depth target).
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    const rows = await container.copyTradeTargetSource.listForActor(
      userActor(toUserId(sessionUser.id))
    );

    if (rows.length === 0) {
      return NextResponse.json(
        polyCopyTradeTargetsOperation.output.parse({ targets: [] })
      );
    }

    // Per-tenant kill-switch — single read for all rows in this response.
    // `snapshotState` is called against any one of the synthetic per-wallet
    // target_ids; the kill-switch read is keyed on `billing_account_id`.
    const firstRow = rows[0];
    if (!firstRow) throw new Error("unreachable"); // guarded by rows.length === 0 above
    const firstConfig = buildMirrorTargetConfig({
      targetWallet: firstRow.targetWallet,
      billingAccountId: account.id,
      createdByUserId: sessionUser.id,
    });
    const snapshot = await container.orderLedger.snapshotState(
      firstConfig.target_id,
      account.id
    );

    const targets = rows.map((row) =>
      buildTargetView({
        id: row.id,
        targetWallet: row.targetWallet,
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

    // INSERT target + upsert tenant config under withTenantScope in a single
    // RLS-clamped transaction. POST is the opt-in act: a fresh tenant gets
    // config{enabled:true}; a pre-existing row (enabled OR user-disabled) is
    // left alone via ON CONFLICT DO NOTHING. Spec: CONFIG_ROW_AUTO_ENABLED_ON_FIRST_POST.
    const insertedRows = await withTenantScope(appDb, actorId, async (tx) => {
      await tx
        .insert(polyCopyTradeConfig)
        .values({
          billingAccountId: account.id,
          createdByUserId: sessionUser.id,
          enabled: true,
        })
        .onConflictDoNothing();

      return (
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
    });

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
    const config = buildMirrorTargetConfig({
      targetWallet,
      billingAccountId: account.id,
      createdByUserId: sessionUser.id,
    });
    const snapshot = await container.orderLedger.snapshotState(
      config.target_id,
      account.id
    );

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
