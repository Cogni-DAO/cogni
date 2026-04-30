// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/db/poly-wallet-connections-auto-wrap.int`
 * Purpose: Schema-level coverage for the task.0429 auto-wrap columns on
 *   `poly_wallet_connections`. Pins the migration shape + the CHECK
 *   constraints + the partial index against a real Postgres testcontainer.
 * Scope: Schema only. The full port-method round-trip
 *   (`setAutoWrapConsent` / `revokeAutoWrapConsent`) lives behind the Privy
 *   adapter and is exercised at the stack-test layer separately.
 * Invariants asserted:
 *   - DEFAULT_FLOOR — fresh rows materialize `auto_wrap_floor_usdce_6dp = 1_000_000`.
 *   - CONSENT_TRIO_CHECK — partial set (e.g. consent_at without actor) rejected.
 *   - FLOOR_POSITIVE_CHECK — non-positive floors rejected.
 *   - REVOKE_INDEPENDENT — `auto_wrap_revoked_at` does not affect connection
 *     `revoked_at` and vice-versa.
 *   - ELIGIBLE_INDEX_FILTERS — only consenting + non-revoked rows surface in
 *     the `auto_wrap_eligible` predicate.
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: nodes/poly/app/src/adapters/server/db/migrations/0035_poly_auto_wrap_consent_loop.sql,
 *        nodes/poly/packages/db-schema/src/wallet-connections.ts,
 *        work/items/task.0429.poly-auto-wrap-consent-loop.md
 */

import { polyWalletConnections } from "@cogni/poly-db-schema";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { billingAccounts, users } from "@/shared/db/schema";

const TENANT = "ba_test_auto_wrap_0429";
const ADDRESS = "0xaaaa000000000000000000000000000000000429" as const;

async function insertSeedRow(
  db: ReturnType<typeof getSeedDb>,
  overrides: { suffix?: string } = {}
): Promise<string> {
  const billingAccountId = `${TENANT}${overrides.suffix ?? ""}`;
  const userId = `user_${billingAccountId}`;
  // FK chain: users → billing_accounts → poly_wallet_connections.
  // Address suffix derived from suffix so concurrent test rows don't collide
  // on the partial unique (chain_id, address) index.
  const addressSuffix = (overrides.suffix ?? "").padStart(2, "0").slice(-2);
  const address = `${ADDRESS.slice(0, 40)}${addressSuffix}` as `0x${string}`;
  await db
    .insert(users)
    .values({
      id: userId,
      name: `auto-wrap test ${billingAccountId}`,
      walletAddress: address,
    })
    .onConflictDoNothing();
  await db
    .insert(billingAccounts)
    .values({
      id: billingAccountId,
      ownerUserId: userId,
      balanceCredits: 0n,
    })
    .onConflictDoNothing();
  const [row] = await db
    .insert(polyWalletConnections)
    .values({
      billingAccountId,
      createdByUserId: userId,
      privyWalletId: `wallet_${billingAccountId}`,
      address,
      chainId: 137,
      // Encrypted creds — bytea content doesn't matter for these tests.
      clobApiKeyCiphertext: Buffer.from("dummy"),
      encryptionKeyId: "test-key-1",
      custodialConsentAcceptedAt: new Date(),
      custodialConsentActorKind: "user",
      custodialConsentActorId: userId,
    })
    .returning({ id: polyWalletConnections.id });
  if (!row) throw new Error("seed row not returned");
  return row.id;
}

describe("poly_wallet_connections — auto-wrap consent loop (task.0429)", () => {
  const db = getSeedDb();

  afterEach(async () => {
    // Delete in FK order: connections → billing_accounts → users.
    await db.execute(
      sql`DELETE FROM poly_wallet_connections WHERE billing_account_id LIKE ${`${TENANT}%`}`
    );
    await db.execute(
      sql`DELETE FROM billing_accounts WHERE id LIKE ${`${TENANT}%`}`
    );
    await db.execute(sql`DELETE FROM users WHERE id LIKE ${`user_${TENANT}%`}`);
  });

  it("materializes the default floor at 1_000_000 atomic (DEFAULT_FLOOR)", async () => {
    await insertSeedRow(db);
    const [row] = await db
      .select({
        autoWrapConsentAt: polyWalletConnections.autoWrapConsentAt,
        autoWrapFloorUsdceE6dp: polyWalletConnections.autoWrapFloorUsdceE6dp,
        autoWrapRevokedAt: polyWalletConnections.autoWrapRevokedAt,
      })
      .from(polyWalletConnections)
      .where(eq(polyWalletConnections.billingAccountId, TENANT));
    expect(row?.autoWrapConsentAt).toBeNull();
    expect(row?.autoWrapRevokedAt).toBeNull();
    expect(row?.autoWrapFloorUsdceE6dp).toBe(1_000_000n);
  });

  it("CHECK rejects a partial-set consent trio (CONSENT_TRIO_CHECK)", async () => {
    const id = await insertSeedRow(db);
    await expect(
      db
        .update(polyWalletConnections)
        .set({
          // consent_at without actor — must fail the trio CHECK.
          autoWrapConsentAt: new Date(),
        })
        .where(eq(polyWalletConnections.id, id))
    ).rejects.toThrow(/auto_wrap_consent_trio/);
  });

  it("CHECK rejects a non-positive floor (FLOOR_POSITIVE_CHECK)", async () => {
    const id = await insertSeedRow(db);
    await expect(
      db
        .update(polyWalletConnections)
        .set({ autoWrapFloorUsdceE6dp: 0n })
        .where(eq(polyWalletConnections.id, id))
    ).rejects.toThrow(/auto_wrap_floor_positive/);
  });

  it("grant + revoke cycle keeps `auto_wrap_consent_at` for forensics (REVOKE_INDEPENDENT)", async () => {
    const id = await insertSeedRow(db);
    const now = new Date();

    await db
      .update(polyWalletConnections)
      .set({
        autoWrapConsentAt: now,
        autoWrapConsentActorKind: "user",
        autoWrapConsentActorId: "user_test",
      })
      .where(eq(polyWalletConnections.id, id));

    let [row] = await db
      .select()
      .from(polyWalletConnections)
      .where(eq(polyWalletConnections.id, id));
    expect(row?.autoWrapConsentAt?.getTime()).toBe(now.getTime());
    expect(row?.autoWrapRevokedAt).toBeNull();
    // Connection-level revoked_at is independent.
    expect(row?.revokedAt).toBeNull();

    const revokedAt = new Date(now.getTime() + 1000);
    await db
      .update(polyWalletConnections)
      .set({ autoWrapRevokedAt: revokedAt })
      .where(eq(polyWalletConnections.id, id));

    [row] = await db
      .select()
      .from(polyWalletConnections)
      .where(eq(polyWalletConnections.id, id));
    expect(row?.autoWrapRevokedAt?.getTime()).toBe(revokedAt.getTime());
    // Original grant remains for audit.
    expect(row?.autoWrapConsentAt?.getTime()).toBe(now.getTime());
    // Connection still alive.
    expect(row?.revokedAt).toBeNull();
  });

  it("eligible-set predicate surfaces only consenting + non-revoked rows (ELIGIBLE_INDEX_FILTERS)", async () => {
    // Tenant A: granted, not revoked → ELIGIBLE
    const aId = await insertSeedRow(db, { suffix: "_A" });
    await db
      .update(polyWalletConnections)
      .set({
        autoWrapConsentAt: new Date(),
        autoWrapConsentActorKind: "user",
        autoWrapConsentActorId: "user_A",
      })
      .where(eq(polyWalletConnections.id, aId));

    // Tenant B: granted, revoked → NOT eligible
    const bId = await insertSeedRow(db, { suffix: "_B" });
    const grantB = new Date();
    await db
      .update(polyWalletConnections)
      .set({
        autoWrapConsentAt: grantB,
        autoWrapConsentActorKind: "user",
        autoWrapConsentActorId: "user_B",
        autoWrapRevokedAt: new Date(grantB.getTime() + 1000),
      })
      .where(eq(polyWalletConnections.id, bId));

    // Tenant C: never granted → NOT eligible
    await insertSeedRow(db, { suffix: "_C" });

    const eligible = await db
      .select({
        billingAccountId: polyWalletConnections.billingAccountId,
      })
      .from(polyWalletConnections)
      .where(
        and(
          isNull(polyWalletConnections.revokedAt),
          isNull(polyWalletConnections.autoWrapRevokedAt),
          isNotNull(polyWalletConnections.autoWrapConsentAt)
        )
      );

    const tenants = eligible
      .map((r) => r.billingAccountId)
      .filter((b) => b.startsWith(TENANT))
      .sort();
    expect(tenants).toEqual([`${TENANT}_A`]);
  });
});
