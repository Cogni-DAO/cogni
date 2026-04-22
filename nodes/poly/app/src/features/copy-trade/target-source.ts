// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/target-source`
 * Purpose: Strongly-typed seam for "which wallets is the operator monitoring right now?".
 *          Two query shapes: `listForActor(userId)` for user-scoped HTTP routes (RLS via
 *          appDb), and `listAllActive()` for the cross-tenant mirror-poll enumerator
 *          (BYPASSRLS via serviceDb — the ONE sanctioned cross-tenant read path).
 *          Per docs/spec/poly-multi-tenant-auth.md.
 * Scope: Two impls today — `envTargetSource` (local-dev fallback) and `dbTargetSource`
 *        (production, reads `poly_copy_trade_targets`). No caps, no per-target enable
 *        flag, no mode switches — those stay hardcoded in the job shim per SCAFFOLDING.
 * Invariants:
 *   - TARGET_SOURCE_TENANT_SCOPED — `listForActor(userId)` returns only the rows whose
 *     `created_by_user_id` equals `userId` under appDb's RLS clamp. The cross-tenant
 *     enumerator is a separate, explicitly-named method (`listAllActive`) that runs
 *     under serviceDb and is the ONLY place that observes more than one tenant.
 *   - NO_PER_TARGET_ENABLED — the per-tenant `poly_copy_trade_config.enabled` row is
 *     the only kill-switch. No per-row enable flag.
 *   - ENV_IMPL_LOCAL_DEV_ONLY — `envTargetSource` is wired only when APP_ENV=test;
 *     production wires `dbTargetSource`.
 * Side-effects: dbTargetSource → DB I/O. envTargetSource → none.
 * Links: docs/spec/poly-multi-tenant-auth.md, work/items/task.0318
 *
 * @public
 */

import { withTenantScope } from "@cogni/db-client";
import type { ActorId } from "@cogni/ids";
import {
  COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
} from "@cogni/node-shared";
import {
  polyCopyTradeConfig,
  polyCopyTradeTargets,
  polyWalletConnections,
  polyWalletGrants,
} from "@cogni/poly-db-schema";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { targetIdFromWallet } from "@/features/copy-trade/target-id";

export type WalletAddress = `0x${string}`;

/**
 * One enumerated target row carrying enough tenant attribution for the
 * mirror-coordinator to set `withTenantScope` for fills/decisions writes.
 */
export interface EnumeratedTarget {
  billingAccountId: string;
  createdByUserId: string;
  targetWallet: WalletAddress;
}

/**
 * One row returned to per-user list/CRUD callers. `id` is the DB row PK —
 * the value DELETE accepts, distinct from the deterministic UUIDv5
 * (`targetIdFromWallet`) used internally for `client_order_id` correlation
 * in the fills ledger.
 */
export interface UserTargetRow {
  id: string;
  targetWallet: WalletAddress;
}

export interface CopyTradeTargetSource {
  /**
   * Rows the calling user is monitoring. Caller passes their session user
   * UUID (branded `ActorId`). Implementation uses appDb under
   * `withTenantScope(actorId)` so RLS enforces tenant boundary at the DB layer.
   * Caller-visible order is preserved (`created_at` ascending — stable rendering).
   * Returns `{ id, targetWallet }` so callers can route DELETE by the DB row PK.
   */
  listForActor(actorId: ActorId): Promise<readonly UserTargetRow[]>;

  /**
   * **The ONE sanctioned cross-tenant read path.** Returns every active
   * (target_wallet, billing_account_id, created_by_user_id) triple for tenants
   * whose `poly_copy_trade_config.enabled = true`. Runs under serviceDb
   * (BYPASSRLS) — used exclusively by the autonomous mirror poll. Every
   * downstream write fans out under `withTenantScope(appDb, createdByUserId)`.
   */
  listAllActive(): Promise<readonly EnumeratedTarget[]>;
}

// ── env impl (local-dev / tests only) ───────────────────────────────────────

/**
 * Env-backed target source. Captures a list of (system-tenant) wallets at
 * construction time. **Not wired in production** — only when APP_ENV=test or
 * a developer needs a dependency-free dev loop.
 *
 * `listForActor` returns the env wallets to ANY caller (no real RLS — there
 * is no DB to clamp against). `listAllActive` attributes everything to the
 * system tenant.
 *
 * @public
 */
export function envTargetSource(
  wallets: readonly WalletAddress[]
): CopyTradeTargetSource {
  // Synthesize stable per-wallet UUIDs so the test impl behaves like the DB
  // impl: each wallet has a single `id` consistent across listForActor calls.
  // Use the same UUIDv5 helper the fills ledger uses; consumers (the dashboard)
  // need a stable id to round-trip through DELETE.
  const userRows: readonly UserTargetRow[] = Object.freeze(
    wallets.map((targetWallet) => ({
      id: targetIdFromWallet(targetWallet),
      targetWallet,
    }))
  );
  const enumerated: readonly EnumeratedTarget[] = Object.freeze(
    wallets.map((targetWallet) => ({
      billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
      createdByUserId: COGNI_SYSTEM_PRINCIPAL_USER_ID,
      targetWallet,
    }))
  );
  return {
    listForActor: async () => userRows,
    listAllActive: async () => enumerated,
  };
}

// ── DB impl (production) ────────────────────────────────────────────────────

export interface DbTargetSourceDeps {
  /**
   * RLS-enforced client for per-user reads. `withTenantScope` opens a
   * transaction with `app.current_user_id` SET LOCAL to the caller's actorId.
   */
  appDb: PostgresJsDatabase<Record<string, unknown>>;
  /**
   * BYPASSRLS client for the cross-tenant enumerator. Used exclusively by
   * `listAllActive` — every other code path goes through `appDb`.
   */
  serviceDb: PostgresJsDatabase<Record<string, unknown>>;
}

/**
 * DB-backed target source over `poly_copy_trade_targets` × `poly_copy_trade_config`.
 *
 * @public
 */
export function dbTargetSource(
  deps: DbTargetSourceDeps
): CopyTradeTargetSource {
  return {
    async listForActor(actorId: ActorId): Promise<readonly UserTargetRow[]> {
      const rows = await withTenantScope(deps.appDb, actorId, async (tx) =>
        tx
          .select({
            id: polyCopyTradeTargets.id,
            target_wallet: polyCopyTradeTargets.targetWallet,
          })
          .from(polyCopyTradeTargets)
          .where(isNull(polyCopyTradeTargets.disabledAt))
          .orderBy(polyCopyTradeTargets.createdAt)
      );
      return rows.map((r) => ({
        id: r.id,
        targetWallet: r.target_wallet as WalletAddress,
      }));
    },

    async listAllActive(): Promise<readonly EnumeratedTarget[]> {
      // The ONE sanctioned BYPASSRLS read. Joins:
      //   targets × config  — only tenants with kill-switch ON
      //   × wallet_connections (status='active')  — only tenants with a live trader wallet
      //   × wallet_grants (revoked_at IS NULL, expires_at > now or NULL) — only tenants with an active grant
      // Net effect: `listAllActive` returns exactly the tenants for whom the
      // per-tenant path can actually sign + `authorizeIntent` will let through.
      // Side benefit: the system-tenant prototype drops out of the mirror fan-out
      // until Stage 4 back-fills a grant row.
      const rows = await deps.serviceDb
        .select({
          billing_account_id: polyCopyTradeTargets.billingAccountId,
          created_by_user_id: polyCopyTradeTargets.createdByUserId,
          target_wallet: polyCopyTradeTargets.targetWallet,
        })
        .from(polyCopyTradeTargets)
        .innerJoin(
          polyCopyTradeConfig,
          eq(
            polyCopyTradeConfig.billingAccountId,
            polyCopyTradeTargets.billingAccountId
          )
        )
        .innerJoin(
          polyWalletConnections,
          and(
            eq(
              polyWalletConnections.billingAccountId,
              polyCopyTradeTargets.billingAccountId
            ),
            isNull(polyWalletConnections.revokedAt)
          )
        )
        .innerJoin(
          polyWalletGrants,
          and(
            eq(polyWalletGrants.walletConnectionId, polyWalletConnections.id),
            isNull(polyWalletGrants.revokedAt),
            or(
              isNull(polyWalletGrants.expiresAt),
              gt(polyWalletGrants.expiresAt, sql`now()`)
            )
          )
        )
        .where(
          and(
            isNull(polyCopyTradeTargets.disabledAt),
            eq(polyCopyTradeConfig.enabled, true)
          )
        )
        .orderBy(polyCopyTradeTargets.createdAt);

      return rows.map((r) => ({
        billingAccountId: r.billing_account_id,
        createdByUserId: r.created_by_user_id,
        targetWallet: r.target_wallet as WalletAddress,
      }));
    },
  };
}
