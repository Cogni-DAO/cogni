// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/copy-trade/db-target-source.int`
 * Purpose: Component tests for `dbTargetSource` against a real Postgres + RLS via testcontainers.
 *          Verifies TARGET_SOURCE_TENANT_SCOPED + the cross-tenant enumerator semantics.
 * Scope: Two tenants seeded; assertions on `listForActor(userId)` + `listAllActive()` + the
 *        config-disabled filter on the enumerator. Does not test routes (separate file)
 *        and does not test on-chain/USDC isolation (Phase B; spec § Phase A scope).
 * Invariants tested (per docs/spec/poly-multi-tenant-auth.md):
 *   - TARGET_SOURCE_TENANT_SCOPED — listForActor returns only the actor's rows under appDb RLS.
 *   - cross-tenant enumerator surfaces both tenants attribution-correctly.
 *   - GLOBAL_KILL_SWITCH_PER_TENANT — disabling one tenant's config drops their rows from
 *     the enumerator output without affecting other tenants.
 * Side-effects: IO (testcontainers Postgres).
 * @public
 */

import { randomUUID } from "node:crypto";
import type { Database } from "@cogni/db-client";
import { billingAccounts, users } from "@cogni/db-schema";
import { toUserId, userActor } from "@cogni/ids";
import {
  polyCopyTradeConfig,
  polyCopyTradeTargets,
  polyWalletConnections,
  polyWalletGrants,
} from "@cogni/poly-db-schema";
import { generateTestWallet } from "@tests/_fixtures/auth/db-helpers";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAppDb } from "@/adapters/server/db/client";
import { dbTargetSource } from "@/features/copy-trade/target-source";

interface TestTenant {
  userId: string;
  billingAccountId: string;
  walletConnectionId: string;
}

const TARGET_A = "0xAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbb";
const TARGET_B = "0xCCCCddddCCCCddddCCCCddddCCCCddddCCCCdddd";
const TARGET_SHARED = "0xEEEEffffEEEEffffEEEEffffEEEEffffEEEEffff";

/**
 * Seed a placeholder wallet connection + active grant for a tenant so the
 * enumerator's `listAllActive` join (connections + grants) matches this row.
 * The address + ciphertext contents don't matter for these tests — they exist
 * only so the inner joins succeed. Address is derived from tenant id to
 * satisfy the chain+address unique-active index across tenants.
 */
async function seedWalletConnectionAndGrant(
  superDb: Database,
  t: TestTenant
): Promise<void> {
  const addrSuffix = t.billingAccountId.replace(/-/g, "").slice(0, 40);
  const paddedAddr = addrSuffix.padEnd(40, "0");
  const address = `0x${paddedAddr}`;
  await superDb.insert(polyWalletConnections).values({
    id: t.walletConnectionId,
    billingAccountId: t.billingAccountId,
    createdByUserId: t.userId,
    privyWalletId: `privy-wallet-${t.billingAccountId.slice(0, 8)}`,
    address,
    chainId: 137,
    clobApiKeyCiphertext: Buffer.from("placeholder-ciphertext"),
    encryptionKeyId: "test-key-v1",
    custodialConsentAcceptedAt: new Date("2026-04-21T10:00:00.000Z"),
    custodialConsentActorKind: "user",
    custodialConsentActorId: t.userId,
  });
  await superDb.insert(polyWalletGrants).values({
    billingAccountId: t.billingAccountId,
    walletConnectionId: t.walletConnectionId,
    createdByUserId: t.userId,
    scopes: ["poly:trade:buy", "poly:trade:sell"],
    perOrderUsdcCap: "5",
    dailyUsdcCap: "20",
    hourlyFillsCap: 50,
  });
}

describe("dbTargetSource (component, RLS)", () => {
  let superDb: Database;
  let appDb: Database;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    superDb = getSeedDb();
    appDb = getAppDb();

    tenantA = {
      userId: randomUUID(),
      billingAccountId: randomUUID(),
      walletConnectionId: randomUUID(),
    };
    tenantB = {
      userId: randomUUID(),
      billingAccountId: randomUUID(),
      walletConnectionId: randomUUID(),
    };

    for (const t of [tenantA, tenantB]) {
      await superDb.insert(users).values({
        id: t.userId,
        name: `dbTargetSource test ${t.userId.slice(0, 8)}`,
        walletAddress: generateTestWallet(`tgt-src-${t.userId.slice(0, 8)}`),
      });
      await superDb.insert(billingAccounts).values({
        id: t.billingAccountId,
        ownerUserId: t.userId,
        balanceCredits: 0n,
      });
      // Per-tenant kill-switch ENABLED — required for the enumerator to surface rows.
      await superDb.insert(polyCopyTradeConfig).values({
        billingAccountId: t.billingAccountId,
        createdByUserId: t.userId,
        enabled: true,
      });
      // Stage 3: listAllActive now inner-joins wallet_connections + wallet_grants.
      // Without these rows, the enumerator filters the tenant out entirely.
      await seedWalletConnectionAndGrant(superDb, t);
    }

    // tenantA tracks TARGET_A + TARGET_SHARED.
    await superDb.insert(polyCopyTradeTargets).values([
      {
        billingAccountId: tenantA.billingAccountId,
        createdByUserId: tenantA.userId,
        targetWallet: TARGET_A,
      },
      {
        billingAccountId: tenantA.billingAccountId,
        createdByUserId: tenantA.userId,
        targetWallet: TARGET_SHARED,
      },
    ]);
    // tenantB tracks TARGET_B + TARGET_SHARED (overlap is intentional —
    // each tenant owns their own row, even for the same wallet).
    await superDb.insert(polyCopyTradeTargets).values([
      {
        billingAccountId: tenantB.billingAccountId,
        createdByUserId: tenantB.userId,
        targetWallet: TARGET_B,
      },
      {
        billingAccountId: tenantB.billingAccountId,
        createdByUserId: tenantB.userId,
        targetWallet: TARGET_SHARED,
      },
    ]);
  });

  afterAll(async () => {
    // Grants + connections don't cascade from billing_accounts; clean up first.
    for (const t of [tenantA, tenantB]) {
      if (!t?.billingAccountId) continue;
      await superDb
        .delete(polyWalletGrants)
        .where(eq(polyWalletGrants.billingAccountId, t.billingAccountId));
      await superDb
        .delete(polyWalletConnections)
        .where(eq(polyWalletConnections.billingAccountId, t.billingAccountId));
    }
    // Cascading deletes from billing_accounts → poly_copy_trade_*.
    if (tenantA?.billingAccountId) {
      await superDb
        .delete(billingAccounts)
        .where(eq(billingAccounts.id, tenantA.billingAccountId));
    }
    if (tenantB?.billingAccountId) {
      await superDb
        .delete(billingAccounts)
        .where(eq(billingAccounts.id, tenantB.billingAccountId));
    }
    if (tenantA?.userId) {
      await superDb.delete(users).where(eq(users.id, tenantA.userId));
    }
    if (tenantB?.userId) {
      await superDb.delete(users).where(eq(users.id, tenantB.userId));
    }
  });

  it("listForActor returns only the calling user's tracked wallets (RLS)", async () => {
    const source = dbTargetSource({
      appDb: appDb as unknown as PostgresJsDatabase<Record<string, unknown>>,
      serviceDb: superDb as unknown as PostgresJsDatabase<
        Record<string, unknown>
      >,
    });

    const aRows = await source.listForActor(
      userActor(toUserId(tenantA.userId))
    );
    const bRows = await source.listForActor(
      userActor(toUserId(tenantB.userId))
    );

    const aWallets = aRows.map((r) => r.targetWallet);
    const bWallets = bRows.map((r) => r.targetWallet);

    expect(aWallets).toEqual(expect.arrayContaining([TARGET_A, TARGET_SHARED]));
    expect(aWallets).not.toContain(TARGET_B);
    expect(bWallets).toEqual(expect.arrayContaining([TARGET_B, TARGET_SHARED]));
    expect(bWallets).not.toContain(TARGET_A);

    // Each row carries a stable DB row uuid (not the UUIDv5-from-wallet).
    // The two tenants' rows for TARGET_SHARED have distinct ids — same wallet,
    // different per-tenant tracking record.
    const aShared = aRows.find((r) => r.targetWallet === TARGET_SHARED);
    const bShared = bRows.find((r) => r.targetWallet === TARGET_SHARED);
    expect(aShared?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(bShared?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(aShared?.id).not.toEqual(bShared?.id);
  });

  it("listAllActive enumerates both tenants with correct attribution", async () => {
    const source = dbTargetSource({
      appDb: appDb as unknown as PostgresJsDatabase<Record<string, unknown>>,
      serviceDb: superDb as unknown as PostgresJsDatabase<
        Record<string, unknown>
      >,
    });

    const enumerated = await source.listAllActive();

    const aRows = enumerated.filter(
      (e) => e.billingAccountId === tenantA.billingAccountId
    );
    const bRows = enumerated.filter(
      (e) => e.billingAccountId === tenantB.billingAccountId
    );

    expect(aRows.map((r) => r.targetWallet).sort()).toEqual(
      [TARGET_A, TARGET_SHARED].sort()
    );
    expect(bRows.map((r) => r.targetWallet).sort()).toEqual(
      [TARGET_B, TARGET_SHARED].sort()
    );
    // Attribution carries created_by_user_id alongside billing.
    for (const r of aRows) expect(r.createdByUserId).toBe(tenantA.userId);
    for (const r of bRows) expect(r.createdByUserId).toBe(tenantB.userId);
  });

  it("disabling a tenant's config drops their rows from listAllActive (per-tenant kill-switch)", async () => {
    // Flip tenantA's kill-switch off via service role.
    await superDb
      .update(polyCopyTradeConfig)
      .set({ enabled: false })
      .where(
        eq(polyCopyTradeConfig.billingAccountId, tenantA.billingAccountId)
      );

    const source = dbTargetSource({
      appDb: appDb as unknown as PostgresJsDatabase<Record<string, unknown>>,
      serviceDb: superDb as unknown as PostgresJsDatabase<
        Record<string, unknown>
      >,
    });

    const enumerated = await source.listAllActive();
    const aRows = enumerated.filter(
      (e) => e.billingAccountId === tenantA.billingAccountId
    );
    const bRows = enumerated.filter(
      (e) => e.billingAccountId === tenantB.billingAccountId
    );

    expect(aRows).toHaveLength(0);
    // tenantB unaffected.
    expect(bRows.map((r) => r.targetWallet).sort()).toEqual(
      [TARGET_B, TARGET_SHARED].sort()
    );

    // Restore for any later tests in the same suite.
    await superDb
      .update(polyCopyTradeConfig)
      .set({ enabled: true })
      .where(
        eq(polyCopyTradeConfig.billingAccountId, tenantA.billingAccountId)
      );
  });

  it("listAllActive drops tenants whose wallet_grant is revoked (Stage 3 join)", async () => {
    // Revoke tenantA's grant — tenantA should disappear from the enumerator.
    await superDb
      .update(polyWalletGrants)
      .set({ revokedAt: new Date(), revokedByUserId: tenantA.userId })
      .where(eq(polyWalletGrants.billingAccountId, tenantA.billingAccountId));

    const source = dbTargetSource({
      appDb: appDb as unknown as PostgresJsDatabase<Record<string, unknown>>,
      serviceDb: superDb as unknown as PostgresJsDatabase<
        Record<string, unknown>
      >,
    });

    const enumerated = await source.listAllActive();
    expect(
      enumerated.filter((e) => e.billingAccountId === tenantA.billingAccountId)
    ).toHaveLength(0);
    // tenantB still has an active grant and must remain.
    expect(
      enumerated
        .filter((e) => e.billingAccountId === tenantB.billingAccountId)
        .map((r) => r.targetWallet)
        .sort()
    ).toEqual([TARGET_B, TARGET_SHARED].sort());

    // Restore.
    await superDb
      .update(polyWalletGrants)
      .set({ revokedAt: null, revokedByUserId: null })
      .where(eq(polyWalletGrants.billingAccountId, tenantA.billingAccountId));
  });

  it("listAllActive drops tenants whose wallet_grant has expired (Stage 3 join)", async () => {
    // Expire tenantB's grant in the past.
    await superDb
      .update(polyWalletGrants)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(polyWalletGrants.billingAccountId, tenantB.billingAccountId));

    const source = dbTargetSource({
      appDb: appDb as unknown as PostgresJsDatabase<Record<string, unknown>>,
      serviceDb: superDb as unknown as PostgresJsDatabase<
        Record<string, unknown>
      >,
    });

    const enumerated = await source.listAllActive();
    expect(
      enumerated.filter((e) => e.billingAccountId === tenantB.billingAccountId)
    ).toHaveLength(0);
    // tenantA unaffected (still NULL expires_at).
    expect(
      enumerated
        .filter((e) => e.billingAccountId === tenantA.billingAccountId)
        .map((r) => r.targetWallet)
        .sort()
    ).toEqual([TARGET_A, TARGET_SHARED].sort());

    // Restore.
    await superDb
      .update(polyWalletGrants)
      .set({ expiresAt: null })
      .where(eq(polyWalletGrants.billingAccountId, tenantB.billingAccountId));
  });

  it("listAllActive drops tenants whose wallet_connection is revoked (Stage 3 join)", async () => {
    // Revoke tenantA's connection directly — grant stays active but the join
    // on connections (revoked_at IS NULL) filters the tenant out.
    await superDb
      .update(polyWalletConnections)
      .set({ revokedAt: new Date(), revokedByUserId: tenantA.userId })
      .where(
        eq(polyWalletConnections.billingAccountId, tenantA.billingAccountId)
      );

    const source = dbTargetSource({
      appDb: appDb as unknown as PostgresJsDatabase<Record<string, unknown>>,
      serviceDb: superDb as unknown as PostgresJsDatabase<
        Record<string, unknown>
      >,
    });

    const enumerated = await source.listAllActive();
    expect(
      enumerated.filter((e) => e.billingAccountId === tenantA.billingAccountId)
    ).toHaveLength(0);

    // Restore.
    await superDb
      .update(polyWalletConnections)
      .set({ revokedAt: null, revokedByUserId: null })
      .where(
        eq(polyWalletConnections.billingAccountId, tenantA.billingAccountId)
      );
  });

  it("soft-deleted rows are excluded from both listForActor and listAllActive", async () => {
    // Soft-delete tenantA's TARGET_A.
    await superDb
      .update(polyCopyTradeTargets)
      .set({ disabledAt: new Date() })
      .where(
        and(
          eq(polyCopyTradeTargets.billingAccountId, tenantA.billingAccountId),
          eq(polyCopyTradeTargets.targetWallet, TARGET_A)
        )
      );

    const source = dbTargetSource({
      appDb: appDb as unknown as PostgresJsDatabase<Record<string, unknown>>,
      serviceDb: superDb as unknown as PostgresJsDatabase<
        Record<string, unknown>
      >,
    });

    const aWallets = await source.listForActor(
      userActor(toUserId(tenantA.userId))
    );
    expect(aWallets).not.toContain(TARGET_A);

    const enumerated = await source.listAllActive();
    const aTargets = enumerated
      .filter((e) => e.billingAccountId === tenantA.billingAccountId)
      .map((e) => e.targetWallet);
    expect(aTargets).not.toContain(TARGET_A);

    // Restore for downstream tests.
    await superDb
      .update(polyCopyTradeTargets)
      .set({ disabledAt: null })
      .where(
        and(
          eq(polyCopyTradeTargets.billingAccountId, tenantA.billingAccountId),
          eq(polyCopyTradeTargets.targetWallet, TARGET_A)
        )
      );
  });
});
