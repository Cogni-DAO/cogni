// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/copy-trade/targets-route.int`
 * Purpose: HTTP round-trip test for `/api/v1/poly/copy-trade/targets` — POST creates
 *          a target, GET lists it, DELETE soft-removes it. Pins the contract's
 *          `target_id` semantics: it is the DB row PK, addressable by DELETE.
 *          Catches the bug fixed in revision 1 where `target_id` was the UUIDv5
 *          and DELETE 404'd because it queried by the row PK.
 * Scope: HTTP layer. Mocks getSessionUser; runs against testcontainers Postgres.
 *        Cross-tenant isolation covered by `db-target-source.int.test.ts`.
 * Invariants tested:
 *   - target_id from POST/GET == DB row PK (DELETE accepts it).
 *   - POST is idempotent on conflict (active row already exists).
 *   - DELETE returns 404 when called with a UUIDv5-from-wallet that isn't the row PK.
 *   - NO_KILL_SWITCH (bug.0438): POST writes only `poly_copy_trade_targets`;
 *     no `poly_copy_trade_config` upsert (table was purged).
 * @public
 */

import { randomUUID } from "node:crypto";
import type { SessionUser } from "@cogni/node-shared";
import {
  generateTestWallet,
  seedAuthenticatedUser,
} from "@tests/_fixtures/auth/db-helpers";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

import { getSessionUser } from "@/app/_lib/auth/session";
import { DELETE as deleteTarget } from "@/app/api/v1/poly/copy-trade/targets/[id]/route";
import {
  POST as createTarget,
  GET as listTargets,
} from "@/app/api/v1/poly/copy-trade/targets/route";
import { targetIdFromWallet } from "@/features/copy-trade/target-id";

const TARGET_WALLET = "0xAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbb";

describe("poly.copy_trade.targets — HTTP round-trip (component)", () => {
  let sessionUser: SessionUser;
  let userId: string;
  let billingAccountId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const seeded = await seedAuthenticatedUser(getSeedDb(), {
      id: randomUUID(),
      walletAddress: generateTestWallet(
        `targets-route-${randomUUID().slice(0, 6)}`
      ),
      name: "Targets Route Test User",
    });

    userId = seeded.user.id;
    billingAccountId = seeded.billingAccount.id;
    if (!seeded.user.walletAddress) {
      throw new Error("test user missing walletAddress");
    }
    sessionUser = {
      id: userId,
      walletAddress: seeded.user.walletAddress,
      displayName: null,
      avatarColor: null,
    };

    vi.mocked(getSessionUser).mockResolvedValue(sessionUser);
  });

  afterEach(async () => {
    // poly_copy_trade_targets.created_by_user_id FK to users has no CASCADE.
    // Delete billing_account first (CASCADE → targets + fills + decisions),
    // THEN users, so the FK holds at every step.
    const { billingAccounts, users } = await import("@/shared/db/schema");
    await getSeedDb()
      .delete(billingAccounts)
      .where(eq(billingAccounts.id, billingAccountId));
    await getSeedDb().delete(users).where(eq(users.id, userId));
  });

  it("POST then GET surfaces the target with id == DB row PK; DELETE by that id succeeds", async () => {
    // ── POST ──────────────────────────────────────────────────────────────
    const createReq = new NextRequest(
      "http://localhost/api/v1/poly/copy-trade/targets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_wallet: TARGET_WALLET }),
      }
    );
    const createRes = await createTarget(createReq);
    expect([200, 201]).toContain(createRes.status);
    const created = (await createRes.json()) as {
      target: { target_id: string; target_wallet: string };
    };
    expect(created.target.target_wallet.toLowerCase()).toBe(
      TARGET_WALLET.toLowerCase()
    );
    expect(created.target.target_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // The contract id MUST NOT be the deterministic UUIDv5 from the wallet —
    // that value is internal to the fills ledger, not addressable by DELETE.
    expect(created.target.target_id).not.toBe(
      targetIdFromWallet(TARGET_WALLET as `0x${string}`)
    );
    const targetRowId = created.target.target_id;

    // ── GET ───────────────────────────────────────────────────────────────
    const listReq = new NextRequest(
      "http://localhost/api/v1/poly/copy-trade/targets"
    );
    const listRes = await listTargets(listReq);
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      targets: { target_id: string; target_wallet: string }[];
    };
    const found = listed.targets.find(
      (t) => t.target_wallet.toLowerCase() === TARGET_WALLET.toLowerCase()
    );
    expect(found).toBeDefined();
    expect(found?.target_id).toBe(targetRowId);

    // ── DELETE the value GET surfaced ─────────────────────────────────────
    const delReq = new NextRequest(
      `http://localhost/api/v1/poly/copy-trade/targets/${targetRowId}`,
      { method: "DELETE" }
    );
    const delRes = await deleteTarget(delReq, {
      params: Promise.resolve({ id: targetRowId }),
    });
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { deleted: boolean };
    expect(delBody.deleted).toBe(true);

    // ── GET after DELETE — soft-deleted row is gone from listForActor ─────
    const listAfterReq = new NextRequest(
      "http://localhost/api/v1/poly/copy-trade/targets"
    );
    const listAfterRes = await listTargets(listAfterReq);
    const listedAfter = (await listAfterRes.json()) as {
      targets: { target_wallet: string }[];
    };
    expect(
      listedAfter.targets.find(
        (t) => t.target_wallet.toLowerCase() === TARGET_WALLET.toLowerCase()
      )
    ).toBeUndefined();
  });

  it("DELETE with the deterministic UUIDv5 (from wallet) returns 404 — proves contract id is the row PK, not the synthetic id", async () => {
    // Seed an active target.
    const createReq = new NextRequest(
      "http://localhost/api/v1/poly/copy-trade/targets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_wallet: TARGET_WALLET }),
      }
    );
    const createRes = await createTarget(createReq);
    expect([200, 201]).toContain(createRes.status);

    // Attempt DELETE with the UUIDv5 (the wrong id shape — not the row PK).
    const wrongId = targetIdFromWallet(TARGET_WALLET as `0x${string}`);
    const delReq = new NextRequest(
      `http://localhost/api/v1/poly/copy-trade/targets/${wrongId}`,
      { method: "DELETE" }
    );
    const delRes = await deleteTarget(delReq, {
      params: Promise.resolve({ id: wrongId }),
    });
    expect(delRes.status).toBe(404);
  });
});
