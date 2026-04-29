// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/poly/wallet-grants.server`
 * Purpose: Server-side facade that powers `GET/PUT /api/v1/poly/wallet/grants`. Reads/updates the calling user's active `polyWalletGrants` row under tenant-scoped RLS (`withTenantScope(appDb, userId)`), maps DB row → contract DTO, translates PG check-constraint errors into typed `PolyWalletGrantsError` for clean route responses.
 * Scope: Server-only. Does not provision grants (that's `provisionWithGrant` at wallet onboarding) and does not enforce caps at place-time (that's `authorizeIntent`). v1 surface is read + partial-update of `(per_order_usdc_cap, daily_usdc_cap)` only — `hourly_fills_cap` is provisioned default, no editor.
 * Invariants:
 *   - TENANT_SCOPED: every read / write goes through `withTenantScope(appDb, sessionUser.id)`. The route never accepts a `billing_account_id` from the wire; tenant comes from the session.
 *   - SINGLE_ACTIVE_GRANT: the v0 schema admits only one non-revoked, non-expired grant per tenant (composite filter on `revoked_at IS NULL` + `(expires_at IS NULL OR expires_at > now())`). This facade selects exactly that row.
 *   - CHECK_AT_WIRE: caller's Zod contract enforces `daily_usdc_cap >= per_order_usdc_cap` and `> 0` before this facade runs; the DB CHECK is belt-and-suspenders. PG `23514` → `code: 'invalid_caps'`.
 *   - NO_HOURLY_EDIT: the input type does not carry `hourly_fills_cap`; it is read-only on this surface.
 * Side-effects: IO (Postgres reads + writes via appDb).
 * Notes: facades own DTO mapping (DB row → contract), routes own HTTP shape. Errors bubble as typed instances; the route maps `PolyWalletGrantsError` → 4xx.
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        docs/spec/poly-multi-tenant-auth.md,
 *        nodes/poly/packages/db-schema/src/wallet-grants.ts,
 *        nodes/poly/packages/node-contracts/src/poly.wallet.grants.v1.contract.ts,
 *        work/items/task.0347.poly-wallet-preferences-sizing-config.md
 * @public
 */

import { withTenantScope } from "@cogni/db-client";
import { toUserId, userActor } from "@cogni/ids";
import type { SessionUser } from "@cogni/node-shared";
import { polyWalletGrants } from "@cogni/poly-db-schema";
import type {
  PolyWalletGrantsErrorCode,
  PolyWalletGrantsGetOutput,
  PolyWalletGrantsPutInput,
  PolyWalletGrantsPutOutput,
} from "@cogni/poly-node-contracts";
import { and, desc, gt, isNull, or, sql } from "drizzle-orm";
import type { Logger } from "pino";

import { getContainer, resolveAppDb } from "@/bootstrap/container";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";

export class PolyWalletGrantsError extends Error {
  constructor(
    readonly code: PolyWalletGrantsErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PolyWalletGrantsError";
  }
}

interface ActiveGrantRow {
  id: string;
  per_order_usdc_cap: number;
  daily_usdc_cap: number;
  hourly_fills_cap: number;
}

function rowToContract(row: {
  id: string;
  perOrderUsdcCap: string;
  dailyUsdcCap: string;
  hourlyFillsCap: number;
}): ActiveGrantRow {
  return {
    id: row.id,
    per_order_usdc_cap: Number(row.perOrderUsdcCap),
    daily_usdc_cap: Number(row.dailyUsdcCap),
    hourly_fills_cap: row.hourlyFillsCap,
  };
}

function isConfigured(logger: Logger): boolean {
  try {
    getPolyTraderWalletAdapter(logger);
    return true;
  } catch (err) {
    if (err instanceof WalletAdapterUnconfiguredError) return false;
    throw err;
  }
}

const activeWhere = and(
  isNull(polyWalletGrants.revokedAt),
  or(
    isNull(polyWalletGrants.expiresAt),
    gt(polyWalletGrants.expiresAt, sql`now()`)
  )
);

export async function getWalletGrantsFacade(
  sessionUser: SessionUser,
  logger: Logger
): Promise<PolyWalletGrantsGetOutput> {
  if (!isConfigured(logger)) {
    return { configured: false, connected: false, grant: null };
  }
  const actor = userActor(toUserId(sessionUser.id));
  const db = resolveAppDb();
  const grant = await withTenantScope(db, actor, async (tx) => {
    const [row] = await tx
      .select({
        id: polyWalletGrants.id,
        perOrderUsdcCap: polyWalletGrants.perOrderUsdcCap,
        dailyUsdcCap: polyWalletGrants.dailyUsdcCap,
        hourlyFillsCap: polyWalletGrants.hourlyFillsCap,
      })
      .from(polyWalletGrants)
      .where(activeWhere)
      .orderBy(desc(polyWalletGrants.createdAt))
      .limit(1);
    return row ? rowToContract(row) : null;
  });
  return {
    configured: true,
    connected: grant !== null,
    grant,
  };
}

export async function putWalletGrantsFacade(
  sessionUser: SessionUser,
  input: PolyWalletGrantsPutInput,
  logger: Logger
): Promise<PolyWalletGrantsPutOutput> {
  if (!isConfigured(logger)) {
    throw new PolyWalletGrantsError(
      "no_active_grant",
      "Wallet adapter not configured on this deployment"
    );
  }

  // Defense-in-depth — resolve the billing account so the user has one. RLS
  // enforces per-tenant isolation; this surfaces a clean 404-ish for users
  // who haven't onboarded yet.
  await getContainer()
    .accountsForUser(toUserId(sessionUser.id))
    .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

  const actor = userActor(toUserId(sessionUser.id));
  const db = resolveAppDb();

  try {
    const updated = await withTenantScope(db, actor, async (tx) => {
      const [row] = await tx
        .update(polyWalletGrants)
        .set({
          perOrderUsdcCap: input.per_order_usdc_cap.toFixed(2),
          dailyUsdcCap: input.daily_usdc_cap.toFixed(2),
        })
        .where(activeWhere)
        .returning({
          id: polyWalletGrants.id,
          perOrderUsdcCap: polyWalletGrants.perOrderUsdcCap,
          dailyUsdcCap: polyWalletGrants.dailyUsdcCap,
          hourlyFillsCap: polyWalletGrants.hourlyFillsCap,
        });
      return row ? rowToContract(row) : null;
    });

    if (!updated) {
      throw new PolyWalletGrantsError(
        "no_active_grant",
        "No active wallet grant for this tenant"
      );
    }
    return { grant: updated };
  } catch (err) {
    if (err instanceof PolyWalletGrantsError) throw err;
    if (
      typeof err === "object" &&
      err &&
      "code" in err &&
      (err as { code?: string }).code === "23514"
    ) {
      throw new PolyWalletGrantsError(
        "invalid_caps",
        "daily_usdc_cap must be >= per_order_usdc_cap and both must be > 0"
      );
    }
    throw err;
  }
}
