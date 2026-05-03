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
import {
  polyCopyTradeFills,
  polyWalletConnections,
  polyWalletGrants,
} from "@cogni/poly-db-schema";
import type {
  OrderIntentSummary,
  PolyClobApiKeyCreds,
} from "@cogni/poly-wallet";
import type { PrivyClient } from "@privy-io/node";
import { generateTestWallet } from "@tests/_fixtures/auth/db-helpers";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { and, eq, isNull } from "drizzle-orm";
import pino from "pino";
import { getAddress, maxUint256 } from "viem";
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

const { createPublicClientMock, createWalletClientMock } = vi.hoisted(() => ({
  createPublicClientMock: vi.fn(),
  createWalletClientMock: vi.fn(),
}));

vi.mock("@privy-io/node/viem", () => ({
  createViemAccount: createViemAccountMock,
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
    createWalletClient: createWalletClientMock,
  };
});

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
    createPublicClientMock.mockReset();
    createWalletClientMock.mockReset();
    for (const tenant of [tenantA, tenantB]) {
      await seedDb
        .delete(polyCopyTradeFills)
        .where(
          eq(polyCopyTradeFills.billingAccountId, tenant.billingAccountId)
        );
      await seedDb
        .delete(polyWalletGrants)
        .where(eq(polyWalletGrants.billingAccountId, tenant.billingAccountId));
      await seedDb
        .delete(polyWalletConnections)
        .where(
          and(
            eq(polyWalletConnections.createdByUserId, tenant.userId),
            eq(polyWalletConnections.billingAccountId, tenant.billingAccountId)
          )
        );
    }
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

  it("passes a deterministic idempotencyKey to Privy and increments generation across revoke cycles (PROVISION_NO_ORPHAN)", async () => {
    const createWalletMock = vi
      .fn()
      .mockResolvedValueOnce(USER_WALLET_A)
      .mockResolvedValueOnce(USER_WALLET_B);
    const clobCredsFactory = vi.fn(async () => ({
      key: "k",
      secret: "s",
      passphrase: "p",
    }));

    const adapter = new PrivyPolyTraderWalletAdapter({
      privyClient: {
        wallets: () => ({ create: createWalletMock }),
      } as unknown as PrivyClient,
      privySigningKey: "wallet-auth:test-signing-key",
      serviceDb: seedDb,
      encryptionKey: ENCRYPTION_KEY,
      encryptionKeyId: ENCRYPTION_KEY_ID,
      clobCredsFactory,
      logger: log,
    });

    // First provision: generation=1.
    await adapter.provision({
      billingAccountId: tenantA.billingAccountId,
      createdByUserId: tenantA.userId,
      custodialConsent: {
        acceptedAt: new Date("2026-04-21T10:00:00.000Z"),
        actorKind: "user",
        actorId: tenantA.userId,
      },
    });

    expect(createWalletMock).toHaveBeenCalledTimes(1);
    expect(createWalletMock).toHaveBeenNthCalledWith(
      1,
      { chain_type: "ethereum" },
      { idempotencyKey: `poly-wallet:${tenantA.billingAccountId}:1` }
    );

    await adapter.revoke({
      billingAccountId: tenantA.billingAccountId,
      revokedByUserId: tenantA.userId,
    });

    // Second provision after revoke: generation=2 (revoked row still counted).
    await adapter.provision({
      billingAccountId: tenantA.billingAccountId,
      createdByUserId: tenantA.userId,
      custodialConsent: {
        acceptedAt: new Date("2026-04-21T10:05:00.000Z"),
        actorKind: "user",
        actorId: tenantA.userId,
      },
    });

    expect(createWalletMock).toHaveBeenCalledTimes(2);
    expect(createWalletMock).toHaveBeenNthCalledWith(
      2,
      { chain_type: "ethereum" },
      { idempotencyKey: `poly-wallet:${tenantA.billingAccountId}:2` }
    );

    const rows = await seedDb
      .select()
      .from(polyWalletConnections)
      .where(
        eq(polyWalletConnections.billingAccountId, tenantA.billingAccountId)
      );
    expect(rows).toHaveLength(2);
    const active = rows.filter((r) => r.revokedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]?.privyWalletId).toBe(USER_WALLET_B.id);
  });

  it("serializes concurrent provision calls under the advisory lock (PROVISION_IS_IDEMPOTENT)", async () => {
    const createWalletMock = vi.fn().mockResolvedValue(USER_WALLET_A);
    const clobCredsFactory = vi.fn(async () => ({
      key: "k",
      secret: "s",
      passphrase: "p",
    }));

    const adapter = new PrivyPolyTraderWalletAdapter({
      privyClient: {
        wallets: () => ({ create: createWalletMock }),
      } as unknown as PrivyClient,
      privySigningKey: "wallet-auth:test-signing-key",
      serviceDb: seedDb,
      encryptionKey: ENCRYPTION_KEY,
      encryptionKeyId: ENCRYPTION_KEY_ID,
      clobCredsFactory,
      logger: log,
    });

    const consent = {
      acceptedAt: new Date("2026-04-21T10:00:00.000Z"),
      actorKind: "user" as const,
      actorId: tenantA.userId,
    };

    const results = await Promise.all([
      adapter.provision({
        billingAccountId: tenantA.billingAccountId,
        createdByUserId: tenantA.userId,
        custodialConsent: consent,
      }),
      adapter.provision({
        billingAccountId: tenantA.billingAccountId,
        createdByUserId: tenantA.userId,
        custodialConsent: consent,
      }),
      adapter.provision({
        billingAccountId: tenantA.billingAccountId,
        createdByUserId: tenantA.userId,
        custodialConsent: consent,
      }),
    ]);

    expect(createWalletMock).toHaveBeenCalledTimes(1);
    expect(clobCredsFactory).toHaveBeenCalledTimes(1);

    const connectionIds = new Set(results.map((r) => r.connectionId));
    expect(connectionIds.size).toBe(1);

    const rows = await seedDb
      .select()
      .from(polyWalletConnections)
      .where(
        eq(polyWalletConnections.billingAccountId, tenantA.billingAccountId)
      );
    expect(rows).toHaveLength(1);
  });
});

describe("PrivyPolyTraderWalletAdapter.authorizeIntent + provisionWithGrant (component)", () => {
  const log = pino({ level: "silent" });

  let seedDb: Database;
  let tenant: TestTenant;

  beforeAll(async () => {
    seedDb = getSeedDb();
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL not set. Run this suite via vitest.component.config.mts."
      );
    }
    tenant = { userId: randomUUID(), billingAccountId: randomUUID() };
    await seedDb.insert(users).values({
      id: tenant.userId,
      name: `auth ${tenant.userId.slice(0, 8)}`,
      walletAddress: generateTestWallet(`auth-${tenant.userId.slice(0, 8)}`),
    });
    await seedDb.insert(billingAccounts).values({
      id: tenant.billingAccountId,
      ownerUserId: tenant.userId,
      balanceCredits: 0n,
    });
  });

  afterAll(async () => {
    await seedDb
      .delete(polyCopyTradeFills)
      .where(eq(polyCopyTradeFills.billingAccountId, tenant.billingAccountId));
    await seedDb
      .delete(polyWalletGrants)
      .where(eq(polyWalletGrants.billingAccountId, tenant.billingAccountId));
    await seedDb
      .delete(polyWalletConnections)
      .where(
        eq(polyWalletConnections.billingAccountId, tenant.billingAccountId)
      );
    await seedDb
      .delete(billingAccounts)
      .where(eq(billingAccounts.id, tenant.billingAccountId));
    await seedDb.delete(users).where(eq(users.id, tenant.userId));
  });

  beforeEach(async () => {
    createViemAccountMock.mockClear();
    createPublicClientMock.mockReset();
    createWalletClientMock.mockReset();
    await seedDb
      .delete(polyCopyTradeFills)
      .where(eq(polyCopyTradeFills.billingAccountId, tenant.billingAccountId));
    await seedDb
      .delete(polyWalletGrants)
      .where(eq(polyWalletGrants.billingAccountId, tenant.billingAccountId));
    await seedDb
      .delete(polyWalletConnections)
      .where(
        eq(polyWalletConnections.billingAccountId, tenant.billingAccountId)
      );
  });

  const consent = {
    acceptedAt: new Date("2026-04-21T10:00:00.000Z"),
    actorKind: "user" as const,
    actorId: "",
  };

  function makeAdapter(
    walletMock = USER_WALLET_A,
    options?: { polygonRpcUrl?: string }
  ) {
    const createWalletMock = vi.fn().mockResolvedValue(walletMock);
    const clobCredsFactory = vi.fn(async () => ({
      key: "k",
      secret: "s",
      passphrase: "p",
    }));
    const adapter = new PrivyPolyTraderWalletAdapter({
      privyClient: {
        wallets: () => ({ create: createWalletMock }),
      } as unknown as PrivyClient,
      privySigningKey: "wallet-auth:test-signing-key",
      serviceDb: seedDb,
      encryptionKey: ENCRYPTION_KEY,
      encryptionKeyId: ENCRYPTION_KEY_ID,
      clobCredsFactory,
      polygonRpcUrl: options?.polygonRpcUrl,
      logger: log,
    });
    return { adapter, createWalletMock, clobCredsFactory };
  }

  const BUY_INTENT = {
    side: "BUY",
    usdcAmount: 1.5,
    marketConditionId: "0xmarket",
  } satisfies OrderIntentSummary;

  const SELL_INTENT = {
    side: "SELL",
    usdcAmount: 1.5,
    marketConditionId: "0xmarket",
  } satisfies OrderIntentSummary;

  /**
   * APPROVALS_BEFORE_PLACE test fixture. `authorizeIntent` now fails closed
   * with `trading_not_ready` when `trading_approvals_ready_at` is null. Most
   * tests below are about cap/scope/grant semantics, NOT the readiness
   * check, so they pre-stamp here. The dedicated `trading_not_ready` case
   * skips this helper on purpose.
   */
  async function markTradingReady(): Promise<void> {
    await seedDb
      .update(polyWalletConnections)
      .set({ tradingApprovalsReadyAt: new Date() })
      .where(
        and(
          eq(polyWalletConnections.billingAccountId, tenant.billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      );
  }

  async function insertFill(opts: {
    fillId: string;
    status: "pending" | "open" | "filled" | "partial" | "canceled" | "error";
    sizeUsdc: number;
    createdAt?: Date;
    marketId?: string;
  }) {
    const now = opts.createdAt ?? new Date();
    await seedDb.insert(polyCopyTradeFills).values({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      targetId: randomUUID(),
      fillId: `data-api:${opts.fillId}`,
      // task.5001 — market_id is now NOT NULL. Seeded value distinct per row
      // so the partial unique index doesn't reject duplicate test rows.
      marketId:
        opts.marketId ?? `prediction-market:polymarket:test-${opts.fillId}`,
      observedAt: now,
      clientOrderId: `cid-${opts.fillId}`,
      orderId: null,
      status: opts.status,
      attributes: {
        size_usdc: opts.sizeUsdc,
        market_id:
          opts.marketId ?? `prediction-market:polymarket:test-${opts.fillId}`,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  it("happy-path: provisionWithGrant issues default grant + authorizeIntent mints branded context", async () => {
    const { adapter } = makeAdapter();
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 20 },
    });
    await markTradingReady();

    const grants = await seedDb
      .select()
      .from(polyWalletGrants)
      .where(eq(polyWalletGrants.billingAccountId, tenant.billingAccountId));
    expect(grants).toHaveLength(1);
    expect(grants[0]?.scopes).toEqual(["poly:trade:buy", "poly:trade:sell"]);
    expect(Number(grants[0]?.perOrderUsdcCap)).toBe(5);
    expect(Number(grants[0]?.dailyUsdcCap)).toBe(20);
    expect(grants[0]?.hourlyFillsCap).toBe(10_000);

    const result = await adapter.authorizeIntent(
      tenant.billingAccountId,
      BUY_INTENT
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.context.grantId).toBe(grants[0]?.id);
    expect(result.context.authorizedIntent).toEqual(BUY_INTENT);
    expect(result.context.connectionId).toBeDefined();
  });

  it("provisionWithGrant is idempotent under re-hit (no duplicate grants)", async () => {
    const { adapter } = makeAdapter();
    const first = await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 20 },
    });
    const second = await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 10, dailyUsdcCap: 50 },
    });
    expect(second.connectionId).toBe(first.connectionId);
    const grants = await seedDb
      .select()
      .from(polyWalletGrants)
      .where(eq(polyWalletGrants.billingAccountId, tenant.billingAccountId));
    expect(grants).toHaveLength(1);
    // First-call caps win (later re-hits don't rewrite caps).
    expect(Number(grants[0]?.perOrderUsdcCap)).toBe(5);
  });

  it("no_active_grant — tenant with connection but no grant is denied", async () => {
    const { adapter } = makeAdapter();
    // `provision` (not `provisionWithGrant`) → connection without grant.
    await adapter.provision({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
    });
    // Skip APPROVALS_BEFORE_PLACE for this test; we want to reach the grant
    // check specifically.
    await markTradingReady();
    const result = await adapter.authorizeIntent(
      tenant.billingAccountId,
      BUY_INTENT
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("no_active_grant");
  });

  it("grant_expired — expires_at in the past denies", async () => {
    const { adapter } = makeAdapter();
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 20 },
    });
    await markTradingReady();
    await seedDb
      .update(polyWalletGrants)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(polyWalletGrants.billingAccountId, tenant.billingAccountId));

    const result = await adapter.authorizeIntent(
      tenant.billingAccountId,
      BUY_INTENT
    );
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("grant_expired");
  });

  it("scope_missing — SELL intent against BUY-only grant denies", async () => {
    const { adapter } = makeAdapter();
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 20 },
    });
    await markTradingReady();
    await seedDb
      .update(polyWalletGrants)
      .set({ scopes: ["poly:trade:buy"] })
      .where(eq(polyWalletGrants.billingAccountId, tenant.billingAccountId));

    const result = await adapter.authorizeIntent(
      tenant.billingAccountId,
      SELL_INTENT
    );
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("scope_missing");
  });

  it("cap_exceeded_per_order — intent > per_order_usdc_cap denies", async () => {
    const { adapter } = makeAdapter();
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 1, dailyUsdcCap: 10 },
    });
    await markTradingReady();
    const result = await adapter.authorizeIntent(tenant.billingAccountId, {
      ...BUY_INTENT,
      usdcAmount: 2,
    });
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("cap_exceeded_per_order");
  });

  it("cap_exceeded_daily counts pending+open+filled+partial (pending-row race closed)", async () => {
    const { adapter } = makeAdapter();
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 10 },
    });
    await markTradingReady();

    // Each status that commits USDC contributes independently.
    await insertFill({ fillId: "f1", status: "pending", sizeUsdc: 3 });
    await insertFill({ fillId: "f2", status: "open", sizeUsdc: 3 });
    await insertFill({ fillId: "f3", status: "filled", sizeUsdc: 2 });
    // canceled + error don't count (no USDC attached).
    await insertFill({ fillId: "f4", status: "canceled", sizeUsdc: 50 });
    await insertFill({ fillId: "f5", status: "error", sizeUsdc: 50 });

    // spent = 8; intent 3 would push to 11 > cap 10 → deny.
    const deny = await adapter.authorizeIntent(tenant.billingAccountId, {
      ...BUY_INTENT,
      usdcAmount: 3,
    });
    if (deny.ok) throw new Error("expected deny");
    expect(deny.reason).toBe("cap_exceeded_daily");

    // But a 2-USDC intent fits (8 + 2 = 10, not > 10).
    const ok = await adapter.authorizeIntent(tenant.billingAccountId, {
      ...BUY_INTENT,
      usdcAmount: 2,
    });
    expect(ok.ok).toBe(true);
  });

  it("cap_exceeded_hourly_fills — fills count reached denies", async () => {
    const { adapter } = makeAdapter();
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 100 },
    });
    await markTradingReady();
    // Narrow hourly cap to make the test deterministic.
    await seedDb
      .update(polyWalletGrants)
      .set({ hourlyFillsCap: 2 })
      .where(eq(polyWalletGrants.billingAccountId, tenant.billingAccountId));

    await insertFill({ fillId: "h1", status: "open", sizeUsdc: 0.5 });
    await insertFill({ fillId: "h2", status: "pending", sizeUsdc: 0.5 });

    const result = await adapter.authorizeIntent(
      tenant.billingAccountId,
      BUY_INTENT
    );
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("cap_exceeded_hourly_fills");
  });

  it("no_connection — grant present but connection revoked denies", async () => {
    const { adapter } = makeAdapter();
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 20 },
    });
    // Simulate a stale-grant race: flip the grant back to active AFTER
    // revoking the connection (bypassing the adapter.revoke cascade).
    await seedDb
      .update(polyWalletConnections)
      .set({ revokedAt: new Date(), revokedByUserId: tenant.userId })
      .where(
        eq(polyWalletConnections.billingAccountId, tenant.billingAccountId)
      );

    const result = await adapter.authorizeIntent(
      tenant.billingAccountId,
      BUY_INTENT
    );
    if (result.ok) throw new Error("expected deny");
    // Grant still exists (not cascaded because we bypassed adapter.revoke),
    // but resolve returns null → no_connection.
    expect(["no_connection", "no_active_grant"]).toContain(result.reason);
  });

  it("grant_revoked via adapter.revoke cascade — authorizeIntent denies", async () => {
    const { adapter } = makeAdapter();
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 20 },
    });
    await markTradingReady();

    await adapter.revoke({
      billingAccountId: tenant.billingAccountId,
      revokedByUserId: tenant.userId,
    });

    const grants = await seedDb
      .select()
      .from(polyWalletGrants)
      .where(eq(polyWalletGrants.billingAccountId, tenant.billingAccountId));
    // Cascade landed: grant row has revoked_at set.
    expect(grants[0]?.revokedAt).toBeInstanceOf(Date);

    // The connection row is ALSO flipped in the same transaction, and its
    // `trading_approvals_ready_at` is cleared. The APPROVALS_BEFORE_PLACE
    // gate sees no active connection first, so we get `no_connection`.
    const result = await adapter.authorizeIntent(
      tenant.billingAccountId,
      BUY_INTENT
    );
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("no_connection");

    // Sanity: the readiness stamp was cleared on revoke so a fresh
    // post-revoke connection starts un-approved (REVOKE_CASCADES_FROM_CONNECTION
    // extends to the APPROVALS_BEFORE_PLACE stamp).
    const revokedConn = await seedDb
      .select({
        revokedAt: polyWalletConnections.revokedAt,
        tradingApprovalsReadyAt: polyWalletConnections.tradingApprovalsReadyAt,
      })
      .from(polyWalletConnections)
      .where(
        eq(polyWalletConnections.billingAccountId, tenant.billingAccountId)
      );
    expect(revokedConn[0]?.revokedAt).toBeInstanceOf(Date);
    expect(revokedConn[0]?.tradingApprovalsReadyAt).toBeNull();
  });

  it("trading_not_ready — provisioned + granted but approvals not run denies", async () => {
    const { adapter } = makeAdapter();
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 20 },
    });
    // Deliberately DO NOT call markTradingReady() — this is the bug.0335
    // class of failure: fresh wallet, no approvals, must not reach the CLOB.

    const result = await adapter.authorizeIntent(
      tenant.billingAccountId,
      BUY_INTENT
    );
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("trading_not_ready");
  });

  it("ensureTradingApprovals resumes correctly when only the neg-risk adapter CTF approval is missing (V2)", async () => {
    // V2 ceremony (bug.0419): 7 of 8 steps already satisfied — USDC.e fully
    // wrapped (balance=0, Onramp allowance maxed), all pUSD spenders + 2 of
    // 3 CTF operators approved. Only `CTF → Neg-Risk Adapter` remains.
    const V2_EXCHANGE = "0xe111180000d2663c0091e4f400237545b87b996b";
    const V2_NEG_RISK_EXCHANGE = "0xe2222d279d744050d28e00520010520000310f59";
    const NEG_RISK_ADAPTER = "0xd91e80cf2e7be2e162c6513ced06f1dd0da35296";
    const approvalState = {
      ctf: [true, true, false] as [boolean, boolean, boolean],
    };

    const walletWriteContract = vi.fn(
      async (input: { functionName: string; args: readonly unknown[] }) => {
        if (input.functionName !== "setApprovalForAll") {
          throw new Error(`unexpected function ${input.functionName}`);
        }
        const operator = String(input.args[0]).toLowerCase();
        if (operator !== NEG_RISK_ADAPTER) {
          throw new Error(`unexpected operator ${operator}`);
        }
        approvalState.ctf[2] = true;
        return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      }
    );

    createPublicClientMock.mockReturnValue({
      getBalance: vi.fn().mockResolvedValue(100000000000000000n),
      readContract: vi.fn(
        async (input: { functionName: string; args: readonly unknown[] }) => {
          if (input.functionName === "allowance") {
            // USDC.e → Onramp + pUSD → (V2 exchange / V2 negRisk / adapter)
            // all already at maxUint256.
            return maxUint256;
          }
          if (input.functionName === "balanceOf") {
            // Wallet has no residual USDC.e (already wrapped to pUSD).
            return 0n;
          }
          if (input.functionName === "isApprovedForAll") {
            const operator = String(input.args[1]).toLowerCase();
            if (operator === V2_EXCHANGE) return approvalState.ctf[0];
            if (operator === V2_NEG_RISK_EXCHANGE) return approvalState.ctf[1];
            if (operator === NEG_RISK_ADAPTER) return approvalState.ctf[2];
          }
          throw new Error(`unexpected read ${input.functionName}`);
        }
      ),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        blockNumber: 123n,
      }),
    });
    createWalletClientMock.mockReturnValue({
      writeContract: walletWriteContract,
    });

    const { adapter } = makeAdapter(USER_WALLET_A, {
      polygonRpcUrl: "https://polygon.example",
    });
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 20 },
    });

    const result = await adapter.ensureTradingApprovals(
      tenant.billingAccountId
    );

    expect(result.ready).toBe(true);
    expect(result.steps).toHaveLength(8);
    expect(walletWriteContract).toHaveBeenCalledTimes(1);
    expect(walletWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "setApprovalForAll",
        args: ["0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296", true],
      })
    );
    expect(
      result.steps.find(
        (step) =>
          step.label === "CTF → Neg-Risk Adapter" && step.state === "set"
      )
    ).toBeTruthy();

    const [connection] = await seedDb
      .select({
        tradingApprovalsReadyAt: polyWalletConnections.tradingApprovalsReadyAt,
      })
      .from(polyWalletConnections)
      .where(
        and(
          eq(polyWalletConnections.billingAccountId, tenant.billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      )
      .limit(1);
    expect(connection?.tradingApprovalsReadyAt).toBeInstanceOf(Date);
  });

  it("ensureTradingApprovals restores USDC.e onramp allowance after wrapping to pUSD", async () => {
    const V2_EXCHANGE = "0xe111180000d2663c0091e4f400237545b87b996b";
    const V2_NEG_RISK_EXCHANGE = "0xe2222d279d744050d28e00520010520000310f59";
    const NEG_RISK_ADAPTER = "0xd91e80cf2e7be2e162c6513ced06f1dd0da35296";
    const COLLATERAL_ONRAMP = "0x93070a847efef7f70739046a929d47a521f5b8ee";
    const USDC_E = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

    const approvalState = {
      usdcEOnramp: 0n,
      usdcEBalance: 6_000_000n,
    };
    const approveHash1 =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const wrapHash =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    const approveHash2 =
      "0x3333333333333333333333333333333333333333333333333333333333333333";
    const submitted: string[] = [];

    const walletWriteContract = vi.fn(
      async (input: {
        address: string;
        functionName: string;
        args: readonly unknown[];
      }) => {
        if (
          input.functionName === "approve" &&
          input.address.toLowerCase() === USDC_E
        ) {
          const spender = String(input.args[0]).toLowerCase();
          if (spender !== COLLATERAL_ONRAMP) {
            throw new Error(`unexpected USDC.e spender ${spender}`);
          }
          approvalState.usdcEOnramp = maxUint256;
          submitted.push("approve_usdc_e_onramp");
          return submitted.length === 1 ? approveHash1 : approveHash2;
        }
        if (input.functionName === "wrap") {
          approvalState.usdcEOnramp = 0n;
          approvalState.usdcEBalance = 0n;
          submitted.push("wrap");
          return wrapHash;
        }
        throw new Error(`unexpected write ${input.functionName}`);
      }
    );

    createPublicClientMock.mockReturnValue({
      getBalance: vi.fn().mockResolvedValue(100000000000000000n),
      readContract: vi.fn(
        async (input: { functionName: string; args: readonly unknown[] }) => {
          if (input.functionName === "allowance") {
            const spender = String(input.args[1]).toLowerCase();
            if (spender === COLLATERAL_ONRAMP) {
              return approvalState.usdcEOnramp;
            }
            if (
              spender === V2_EXCHANGE ||
              spender === V2_NEG_RISK_EXCHANGE ||
              spender === NEG_RISK_ADAPTER
            ) {
              return maxUint256;
            }
          }
          if (input.functionName === "balanceOf") {
            return approvalState.usdcEBalance;
          }
          if (input.functionName === "isApprovedForAll") {
            return true;
          }
          throw new Error(`unexpected read ${input.functionName}`);
        }
      ),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        blockNumber: 123n,
      }),
    });
    createWalletClientMock.mockReturnValue({
      writeContract: walletWriteContract,
    });

    const { adapter } = makeAdapter(USER_WALLET_A, {
      polygonRpcUrl: "https://polygon.example",
    });
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 20 },
    });

    const result = await adapter.ensureTradingApprovals(
      tenant.billingAccountId
    );

    expect(result.ready).toBe(true);
    expect(submitted).toEqual([
      "approve_usdc_e_onramp",
      "wrap",
      "approve_usdc_e_onramp",
    ]);
    expect(walletWriteContract).toHaveBeenCalledTimes(3);
    expect(
      result.steps.find(
        (step) => step.label === "USDC.e → Onramp" && step.state === "set"
      )
    ).toEqual(
      expect.objectContaining({
        txHash: approveHash2,
      })
    );

    const [connection] = await seedDb
      .select({
        tradingApprovalsReadyAt: polyWalletConnections.tradingApprovalsReadyAt,
      })
      .from(polyWalletConnections)
      .where(
        and(
          eq(polyWalletConnections.billingAccountId, tenant.billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      )
      .limit(1);
    expect(connection?.tradingApprovalsReadyAt).toBeInstanceOf(Date);
  });

  it("withdraw unwraps pUSD through the pinned CollateralOfframp", async () => {
    const approveHash =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const unwrapHash =
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const destination =
      "0x3333333333333333333333333333333333333333" as `0x${string}`;

    const walletWriteContract = vi.fn(
      async (input: { functionName: string }) => {
        if (input.functionName === "approve") return approveHash;
        if (input.functionName === "unwrap") return unwrapHash;
        throw new Error(`unexpected function ${input.functionName}`);
      }
    );
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({
      status: "success",
      blockNumber: 123n,
    });

    createPublicClientMock.mockReturnValue({
      readContract: vi.fn(
        async (input: { functionName: string; args: readonly unknown[] }) => {
          if (input.functionName === "balanceOf") return 5_000_000n;
          if (input.functionName === "allowance") return 0n;
          throw new Error(`unexpected read ${input.functionName}`);
        }
      ),
      waitForTransactionReceipt,
    });
    createWalletClientMock.mockReturnValue({
      writeContract: walletWriteContract,
    });

    const { adapter } = makeAdapter(USER_WALLET_A, {
      polygonRpcUrl: "https://polygon.example",
    });
    await adapter.provisionWithGrant({
      billingAccountId: tenant.billingAccountId,
      createdByUserId: tenant.userId,
      custodialConsent: { ...consent, actorId: tenant.userId },
      defaultGrant: { perOrderUsdcCap: 5, dailyUsdcCap: 20 },
    });

    const result = await adapter.withdraw({
      billingAccountId: tenant.billingAccountId,
      asset: "pusd",
      destination,
      amountAtomic: 2_500_000n,
      requestedByUserId: tenant.userId,
    });

    expect(result).toEqual({
      asset: "pusd",
      deliveredAsset: "usdc_e",
      sourceAddress: getAddress(USER_WALLET_A.address),
      destination,
      amountAtomic: 2_500_000n,
      primaryTxHash: unwrapHash,
      txHashes: [approveHash, unwrapHash],
    });
    expect(walletWriteContract).toHaveBeenCalledTimes(2);
    expect(walletWriteContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        functionName: "approve",
        args: ["0x2957922Eb93258b93368531d39fAcCA3B4dC5854", 2_500_000n],
      })
    );
    expect(walletWriteContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        functionName: "unwrap",
        args: [
          "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
          destination,
          2_500_000n,
        ],
      })
    );
    expect(waitForTransactionReceipt).toHaveBeenCalledTimes(2);
  });
});
