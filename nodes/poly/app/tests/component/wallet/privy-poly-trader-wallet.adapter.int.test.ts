// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/wallet/privy-poly-trader-wallet.adapter`
 * Purpose: Component test for the Privy-backed per-tenant PolyTraderWallet adapter.
 * Scope: Exercises the adapter lifecycle against real Postgres + RLS via
 *   testcontainers while mocking the Privy wallet factory. Does not test the
 *   HTTP route or live Privy/Polymarket integrations.
 * Invariants:
 *   - PROVISION_IS_IDEMPOTENT: repeated provision for the same tenant reuses the
 *     active row and does not create a second Privy wallet.
 *   - TENANT_SCOPED: two tenants provision distinct rows and addresses.
 *   - RLS_ENFORCED: app-role reads scoped with tenant context only see the
 *     caller's row; no tenant context returns zero rows.
 *   - TENANT_DEFENSE_IN_DEPTH: stored ciphertext is bound to
 *     (billing_account_id, connection_id, provider) and cannot be rebound.
 *   - REVOKE_IS_DURABLE: revoke soft-deletes the active row and resolve/getAddress
 *     fail closed for that tenant while the other tenant remains active.
 * Side-effects: IO (database operations via testcontainers)
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts
 * @public
 */

import { randomUUID } from "node:crypto";
import { createAppDbClient, type Database } from "@cogni/db-client";
import { billingAccounts, users } from "@cogni/db-schema";
import { toUserId, userActor } from "@cogni/ids";
import { type AeadAAD, aeadDecrypt } from "@cogni/node-shared";
import { polyWalletConnections } from "@cogni/poly-db-schema";
import type { PolyClobApiKeyCreds } from "@cogni/poly-wallet";
import type { PrivyClient } from "@privy-io/node";
import { generateTestWallet } from "@tests/_fixtures/auth/db-helpers";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { and, eq, isNull } from "drizzle-orm";
import pino from "pino";
import { getAddress } from "viem";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { withTenantScope } from "@/adapters/server/db/client";
import { PrivyPolyTraderWalletAdapter } from "@/adapters/server/wallet";

const { createViemAccountMock } = vi.hoisted(() => ({
  createViemAccountMock: vi.fn(
    (
      _client: unknown,
      input: {
        walletId: string;
        address: `0x${string}`;
      }
    ) =>
      ({
        address: getAddress(input.address),
        sourceWalletId: input.walletId,
      }) as unknown
  ),
}));

vi.mock("@privy-io/node/viem", () => ({
  createViemAccount: createViemAccountMock,
}));

interface TestTenant {
  userId: string;
  billingAccountId: string;
}

interface SeededConnectionRow {
  id: string;
  billingAccountId: string;
  createdByUserId: string;
  address: string;
  privyWalletId: string;
  clobApiKeyCiphertext: Buffer;
  encryptionKeyId: string;
  revokedAt: Date | null;
}

const ENCRYPTION_KEY = Buffer.from("11".repeat(32), "hex");
const ENCRYPTION_KEY_ID = "wallet-test-key-v1";
const USER_WALLET_A = {
  id: "privy-wallet-a",
  address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
};
const USER_WALLET_B = {
  id: "privy-wallet-b",
  address: "0x2222222222222222222222222222222222222222" as `0x${string}`,
};

function decryptStoredCreds(row: SeededConnectionRow): PolyClobApiKeyCreds {
  const aad: AeadAAD = {
    billing_account_id: row.billingAccountId,
    connection_id: row.id,
    provider: "polymarket_clob",
  };
  return JSON.parse(
    aeadDecrypt(row.clobApiKeyCiphertext, aad, ENCRYPTION_KEY)
  ) as PolyClobApiKeyCreds;
}

describe("PrivyPolyTraderWalletAdapter (component, RLS)", () => {
  const log = pino({ level: "silent" });

  let seedDb: Database;
  let appDb: Database;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

  beforeAll(async () => {
    seedDb = getSeedDb();
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL not set. Run this suite via vitest.component.config.mts."
      );
    }
    appDb = createAppDbClient(databaseUrl);

    tenantA = { userId: randomUUID(), billingAccountId: randomUUID() };
    tenantB = { userId: randomUUID(), billingAccountId: randomUUID() };

    for (const tenant of [tenantA, tenantB]) {
      await seedDb.insert(users).values({
        id: tenant.userId,
        name: `poly wallet ${tenant.userId.slice(0, 8)}`,
        walletAddress: generateTestWallet(
          `poly-wallet-${tenant.userId.slice(0, 8)}`
        ),
      });
      await seedDb.insert(billingAccounts).values({
        id: tenant.billingAccountId,
        ownerUserId: tenant.userId,
        balanceCredits: 0n,
      });
    }
  });

  afterAll(async () => {
    for (const tenant of [tenantA, tenantB]) {
      if (tenant?.billingAccountId) {
        await seedDb
          .delete(billingAccounts)
          .where(eq(billingAccounts.id, tenant.billingAccountId));
      }
      if (tenant?.userId) {
        await seedDb.delete(users).where(eq(users.id, tenant.userId));
      }
    }
  });

  beforeEach(async () => {
    createViemAccountMock.mockClear();
    await seedDb
      .delete(polyWalletConnections)
      .where(
        and(
          eq(polyWalletConnections.createdByUserId, tenantA.userId),
          eq(polyWalletConnections.billingAccountId, tenantA.billingAccountId)
        )
      );
    await seedDb
      .delete(polyWalletConnections)
      .where(
        and(
          eq(polyWalletConnections.createdByUserId, tenantB.userId),
          eq(polyWalletConnections.billingAccountId, tenantB.billingAccountId)
        )
      );
  });

  it("round-trips provision -> resolve -> getAddress -> revoke across two tenants with RLS + AEAD binding", async () => {
    const createWalletMock = vi
      .fn()
      .mockResolvedValueOnce(USER_WALLET_A)
      .mockResolvedValueOnce(USER_WALLET_B);
    const clobCredsFactory = vi.fn(async (signer: { address: string }) => {
      const suffix = signer.address.slice(-6).toLowerCase();
      return {
        key: `key-${suffix}`,
        secret: `secret-${suffix}`,
        passphrase: `passphrase-${suffix}`,
      } satisfies PolyClobApiKeyCreds;
    });

    const adapter = new PrivyPolyTraderWalletAdapter({
      privyClient: {
        wallets: () => ({
          create: createWalletMock,
        }),
      } as unknown as PrivyClient,
      privySigningKey: "wallet-auth:test-signing-key",
      serviceDb: seedDb,
      encryptionKey: ENCRYPTION_KEY,
      encryptionKeyId: ENCRYPTION_KEY_ID,
      clobCredsFactory,
      logger: log,
    });

    const aProvision = await adapter.provision({
      billingAccountId: tenantA.billingAccountId,
      createdByUserId: tenantA.userId,
      custodialConsent: {
        acceptedAt: new Date("2026-04-21T10:00:00.000Z"),
        actorKind: "user",
        actorId: tenantA.userId,
      },
    });
    const bProvision = await adapter.provision({
      billingAccountId: tenantB.billingAccountId,
      createdByUserId: tenantB.userId,
      custodialConsent: {
        acceptedAt: new Date("2026-04-21T10:01:00.000Z"),
        actorKind: "user",
        actorId: tenantB.userId,
      },
    });
    const aProvisionAgain = await adapter.provision({
      billingAccountId: tenantA.billingAccountId,
      createdByUserId: tenantA.userId,
      custodialConsent: {
        acceptedAt: new Date("2026-04-21T10:02:00.000Z"),
        actorKind: "user",
        actorId: tenantA.userId,
      },
    });

    expect(createWalletMock).toHaveBeenCalledTimes(2);
    expect(clobCredsFactory).toHaveBeenCalledTimes(2);

    expect(aProvision.connectionId).toBe(aProvisionAgain.connectionId);
    expect(aProvision.funderAddress).toBe(aProvisionAgain.funderAddress);
    expect(aProvision.funderAddress).not.toBe(bProvision.funderAddress);
    expect(aProvision.connectionId).not.toBe(bProvision.connectionId);

    const resolvedA = await adapter.resolve(tenantA.billingAccountId);
    const resolvedB = await adapter.resolve(tenantB.billingAccountId);
    expect(resolvedA).not.toBeNull();
    expect(resolvedB).not.toBeNull();
    expect(resolvedA?.connectionId).toBe(aProvision.connectionId);
    expect(resolvedB?.connectionId).toBe(bProvision.connectionId);
    expect(resolvedA?.funderAddress).toBe(getAddress(USER_WALLET_A.address));
    expect(resolvedB?.funderAddress).toBe(getAddress(USER_WALLET_B.address));

    expect(await adapter.getAddress(tenantA.billingAccountId)).toBe(
      getAddress(USER_WALLET_A.address)
    );
    expect(await adapter.getAddress(tenantB.billingAccountId)).toBe(
      getAddress(USER_WALLET_B.address)
    );

    const allRows = (await seedDb
      .select()
      .from(polyWalletConnections)
      .where(isNull(polyWalletConnections.revokedAt))) as SeededConnectionRow[];
    expect(allRows).toHaveLength(2);

    const rowA = allRows.find(
      (row) => row.billingAccountId === tenantA.billingAccountId
    );
    const rowB = allRows.find(
      (row) => row.billingAccountId === tenantB.billingAccountId
    );
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowA?.address).toBe(getAddress(USER_WALLET_A.address));
    expect(rowB?.address).toBe(getAddress(USER_WALLET_B.address));
    expect(rowA?.encryptionKeyId).toBe(ENCRYPTION_KEY_ID);
    expect(rowB?.encryptionKeyId).toBe(ENCRYPTION_KEY_ID);

    const decryptedA = decryptStoredCreds(rowA as SeededConnectionRow);
    const decryptedB = decryptStoredCreds(rowB as SeededConnectionRow);
    expect(decryptedA).toEqual(aProvision.clobCreds);
    expect(decryptedB).toEqual(bProvision.clobCreds);
    expect(() =>
      aeadDecrypt(
        (rowA as SeededConnectionRow).clobApiKeyCiphertext,
        {
          billing_account_id: tenantB.billingAccountId,
          connection_id: (rowA as SeededConnectionRow).id,
          provider: "polymarket_clob",
        },
        ENCRYPTION_KEY
      )
    ).toThrow();

    const tenantARows = await withTenantScope(
      appDb,
      userActor(toUserId(tenantA.userId)),
      async (tx) => tx.select().from(polyWalletConnections)
    );
    const tenantBRows = await withTenantScope(
      appDb,
      userActor(toUserId(tenantB.userId)),
      async (tx) => tx.select().from(polyWalletConnections)
    );
    const unscopedRows = await appDb.transaction(async (tx) =>
      tx.select().from(polyWalletConnections)
    );

    expect(tenantARows).toHaveLength(1);
    expect(tenantBRows).toHaveLength(1);
    expect(tenantARows[0]?.billingAccountId).toBe(tenantA.billingAccountId);
    expect(tenantBRows[0]?.billingAccountId).toBe(tenantB.billingAccountId);
    expect(tenantARows[0]?.billingAccountId).not.toBe(tenantB.billingAccountId);
    expect(tenantBRows[0]?.billingAccountId).not.toBe(tenantA.billingAccountId);
    expect(unscopedRows).toHaveLength(0);

    await adapter.revoke({
      billingAccountId: tenantA.billingAccountId,
      revokedByUserId: tenantA.userId,
    });

    expect(await adapter.resolve(tenantA.billingAccountId)).toBeNull();
    expect(await adapter.getAddress(tenantA.billingAccountId)).toBeNull();

    const resolvedBAfterRevoke = await adapter.resolve(
      tenantB.billingAccountId
    );
    expect(resolvedBAfterRevoke?.connectionId).toBe(bProvision.connectionId);
    expect(resolvedBAfterRevoke?.funderAddress).toBe(
      getAddress(USER_WALLET_B.address)
    );

    const revokedRowA = (
      await seedDb
        .select()
        .from(polyWalletConnections)
        .where(eq(polyWalletConnections.id, aProvision.connectionId))
        .limit(1)
    )[0] as SeededConnectionRow | undefined;
    expect(revokedRowA?.revokedAt).toBeInstanceOf(Date);
  });
});
