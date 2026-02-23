// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/db/drizzle-ledger.adapter.int`
 * Purpose: Component tests for DrizzleLedgerAdapter against real PostgreSQL via testcontainers.
 * Scope: Verifies adapter + DB triggers (ACTIVITY_APPEND_ONLY, CURATION_FREEZE_ON_CLOSE, ONE_OPEN_EPOCH, ACTIVITY_IDEMPOTENT). Does not test domain logic or routes.
 * Invariants: ACTIVITY_APPEND_ONLY, ACTIVITY_IDEMPOTENT, CURATION_FREEZE_ON_CLOSE, ONE_OPEN_EPOCH, EPOCH_WINDOW_UNIQUE, NODE_SCOPED, SCOPE_GATED_QUERIES
 * Side-effects: IO (database operations via testcontainers)
 * Links: packages/db-client/src/adapters/drizzle-ledger.adapter.ts, packages/ledger-core/src/store.ts
 * @public
 */

import { DrizzleLedgerAdapter } from "@cogni/db-client";
import {
  AllocationNotFoundError,
  EpochNotFoundError,
} from "@cogni/ledger-core";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import {
  makeActivityEvent,
  makeAllocation,
  makeCuration,
  makePoolComponent,
  TEST_NODE_ID,
  TEST_SCOPE_ID,
  TEST_WEIGHT_CONFIG,
  weekWindow,
} from "@tests/_fixtures/ledger/seed-ledger";
import { seedTestActor, type TestActor } from "@tests/_fixtures/stack/seed";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Unwrap DrizzleQueryError → underlying PostgresError message */
function drizzleCause(err: unknown): string {
  if (err instanceof Error && err.cause instanceof Error)
    return err.cause.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

describe("DrizzleLedgerAdapter (Component)", () => {
  const db = getSeedDb();
  const adapter = new DrizzleLedgerAdapter(db, TEST_SCOPE_ID);

  let actor: TestActor;

  beforeAll(async () => {
    actor = await seedTestActor(db);
  });

  // No global afterAll cleanup needed — testcontainers PostgreSQL is ephemeral.

  // ── Epochs ────────────────────────────────────────────────────

  describe("epochs", () => {
    let createdEpochId: bigint;

    afterAll(async () => {
      // Ensure no open epoch leaks to subsequent describes
      const open = await adapter.getOpenEpoch(TEST_NODE_ID, TEST_SCOPE_ID);
      if (open) await adapter.closeEpoch(open.id, 0n);
    });

    it("creates an epoch and retrieves it", async () => {
      const window = weekWindow(0);
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...window,
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      createdEpochId = epoch.id;

      expect(epoch.status).toBe("open");
      expect(epoch.nodeId).toBe(TEST_NODE_ID);
      expect(epoch.poolTotalCredits).toBeNull();
      expect(epoch.closedAt).toBeNull();

      const fetched = await adapter.getEpoch(epoch.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(epoch.id);
    });

    it("getOpenEpoch returns the open epoch for the node", async () => {
      const open = await adapter.getOpenEpoch(TEST_NODE_ID, TEST_SCOPE_ID);
      expect(open).not.toBeNull();
      expect(open?.status).toBe("open");
    });

    it("listEpochs returns all epochs for the node", async () => {
      const list = await adapter.listEpochs(TEST_NODE_ID);
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.every((e) => e.nodeId === TEST_NODE_ID)).toBe(true);
    });

    it("ONE_OPEN_EPOCH: rejects second open epoch for same node", async () => {
      await expect(
        adapter.createEpoch({
          nodeId: TEST_NODE_ID,
          scopeId: TEST_SCOPE_ID,
          ...weekWindow(1),
          weightConfig: TEST_WEIGHT_CONFIG,
        })
      ).rejects.toThrow();
    });

    it("EPOCH_WINDOW_UNIQUE: rejects duplicate window for same node", async () => {
      // Close the open epoch so we can test the window constraint in isolation
      await adapter.closeEpoch(createdEpochId, 10000n);

      await expect(
        adapter.createEpoch({
          nodeId: TEST_NODE_ID,
          scopeId: TEST_SCOPE_ID,
          ...weekWindow(0), // same window as the closed epoch
          weightConfig: TEST_WEIGHT_CONFIG,
        })
      ).rejects.toThrow();
    });

    it("closeEpoch sets status, poolTotal, and closedAt", async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...weekWindow(2),
        weightConfig: TEST_WEIGHT_CONFIG,
      });

      const closed = await adapter.closeEpoch(epoch.id, 50000n);
      expect(closed.status).toBe("closed");
      expect(closed.poolTotalCredits).toBe(50000n);
      expect(closed.closedAt).not.toBeNull();
    });

    it("closeEpoch on already-closed epoch returns it (EPOCH_CLOSE_IDEMPOTENT)", async () => {
      // Find the epoch we just closed (50000n pool)
      const list = await adapter.listEpochs(TEST_NODE_ID);
      const closed = list.find(
        (e) => e.status === "closed" && e.poolTotalCredits === 50000n
      );
      expect(closed).toBeDefined();

      if (!closed) throw new Error("Expected closed epoch");
      const result = await adapter.closeEpoch(closed.id, 99999n);
      expect(result.status).toBe("closed");
      expect(result.poolTotalCredits).toBe(50000n); // unchanged
    });

    it("closeEpoch on non-existent epoch throws EpochNotFoundError", async () => {
      await expect(adapter.closeEpoch(999999n, 100n)).rejects.toThrow(
        EpochNotFoundError
      );
    });
  });

  // ── Activity Events ───────────────────────────────────────────

  describe("activity events", () => {
    it("inserts events and retrieves by time window", async () => {
      const events = [
        makeActivityEvent({
          id: "github:pr:test/repo:1",
          eventTime: new Date("2026-01-06T10:00:00Z"),
          platformUserId: "111",
        }),
        makeActivityEvent({
          id: "github:pr:test/repo:2",
          eventTime: new Date("2026-01-07T10:00:00Z"),
          platformUserId: "222",
        }),
      ];

      await adapter.insertActivityEvents(events);

      const results = await adapter.getActivityForWindow(
        TEST_NODE_ID,
        new Date("2026-01-06T00:00:00Z"),
        new Date("2026-01-08T00:00:00Z")
      );

      expect(results.length).toBeGreaterThanOrEqual(2);
      const ids = results.map((e) => e.id);
      expect(ids).toContain("github:pr:test/repo:1");
      expect(ids).toContain("github:pr:test/repo:2");
    });

    it("ACTIVITY_IDEMPOTENT: re-inserting same event is a no-op", async () => {
      const event = makeActivityEvent({
        id: "github:pr:test/repo:1",
        platformUserId: "111",
      });

      await adapter.insertActivityEvents([event]);

      const results = await adapter.getActivityForWindow(
        TEST_NODE_ID,
        new Date("2026-01-06T00:00:00Z"),
        new Date("2026-01-08T00:00:00Z")
      );
      const matching = results.filter((e) => e.id === "github:pr:test/repo:1");
      expect(matching).toHaveLength(1);
    });

    it("ACTIVITY_APPEND_ONLY: UPDATE on activity_events is rejected by trigger", async () => {
      await expect(
        db.execute(
          sql`UPDATE activity_events SET source = 'modified' WHERE id = 'github:pr:test/repo:1' AND node_id = ${TEST_NODE_ID}::uuid`
        )
      ).rejects.toSatisfy((err: unknown) =>
        /not allowed/i.test(drizzleCause(err))
      );
    });

    it("ACTIVITY_APPEND_ONLY: DELETE on activity_events is rejected by trigger", async () => {
      await expect(
        db.execute(
          sql`DELETE FROM activity_events WHERE id = 'github:pr:test/repo:1' AND node_id = ${TEST_NODE_ID}::uuid`
        )
      ).rejects.toSatisfy((err: unknown) =>
        /not allowed/i.test(drizzleCause(err))
      );
    });
  });

  // ── Curation ──────────────────────────────────────────────────

  describe("curation", () => {
    let epochId: bigint;

    beforeAll(async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...weekWindow(3),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      epochId = epoch.id;
    });

    // Freeze test closes the epoch; afterAll is a safety net
    afterAll(async () => {
      const open = await adapter.getOpenEpoch(TEST_NODE_ID, TEST_SCOPE_ID);
      if (open) await adapter.closeEpoch(open.id, 0n);
    });

    it("upserts curation entries and retrieves them", async () => {
      await adapter.upsertCuration([
        makeCuration({
          epochId,
          eventId: "github:pr:test/repo:1",
          userId: actor.user.id,
        }),
        makeCuration({
          epochId,
          eventId: "github:pr:test/repo:2",
          userId: null,
        }),
      ]);

      const all = await adapter.getCurationForEpoch(epochId);
      expect(all).toHaveLength(2);
    });

    it("getUnresolvedCuration returns only entries with null userId", async () => {
      const unresolved = await adapter.getUnresolvedCuration(epochId);
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0]?.eventId).toBe("github:pr:test/repo:2");
    });

    it("upsert updates existing curation (same epoch+event)", async () => {
      await adapter.upsertCuration([
        makeCuration({
          epochId,
          eventId: "github:pr:test/repo:2",
          userId: actor.user.id,
        }),
      ]);

      const unresolved = await adapter.getUnresolvedCuration(epochId);
      expect(unresolved).toHaveLength(0);
    });

    it("CURATION_FREEZE_ON_CLOSE: rejects curation writes after epoch close", async () => {
      await adapter.closeEpoch(epochId, 5000n);

      await expect(
        adapter.upsertCuration([
          makeCuration({
            epochId,
            eventId: "github:pr:test/repo:1",
            userId: null,
            note: "should fail",
          }),
        ])
      ).rejects.toSatisfy((err: unknown) => /closed/i.test(drizzleCause(err)));
    });
  });

  // ── Allocations ───────────────────────────────────────────────

  describe("allocations", () => {
    let epochId: bigint;

    beforeAll(async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...weekWindow(4),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      epochId = epoch.id;
    });

    afterAll(async () => {
      await adapter.closeEpoch(epochId, 0n);
    });

    it("inserts allocations and retrieves them", async () => {
      await adapter.insertAllocations([
        makeAllocation({
          epochId,
          userId: actor.user.id,
          proposedUnits: 8000n,
          activityCount: 3,
        }),
      ]);

      const allocs = await adapter.getAllocationsForEpoch(epochId);
      expect(allocs).toHaveLength(1);
      expect(allocs[0]?.proposedUnits).toBe(8000n);
      expect(allocs[0]?.finalUnits).toBeNull();
    });

    it("updateAllocationFinalUnits sets final_units and override_reason", async () => {
      await adapter.updateAllocationFinalUnits(
        epochId,
        actor.user.id,
        10000n,
        "bonus for extra work"
      );

      const allocs = await adapter.getAllocationsForEpoch(epochId);
      expect(allocs[0]?.finalUnits).toBe(10000n);
      expect(allocs[0]?.overrideReason).toBe("bonus for extra work");
    });

    it("updateAllocationFinalUnits throws AllocationNotFoundError for missing allocation", async () => {
      await expect(
        adapter.updateAllocationFinalUnits(epochId, "nonexistent-user", 100n)
      ).rejects.toThrow(AllocationNotFoundError);
    });
  });

  // ── Cursors ───────────────────────────────────────────────────

  describe("cursors", () => {
    it("upserts and retrieves a cursor", async () => {
      await adapter.upsertCursor(
        TEST_NODE_ID,
        TEST_SCOPE_ID,
        "github",
        "pull_requests",
        "test/repo",
        "2026-01-06T00:00:00Z"
      );

      const cursor = await adapter.getCursor(
        TEST_NODE_ID,
        TEST_SCOPE_ID,
        "github",
        "pull_requests",
        "test/repo"
      );
      expect(cursor).not.toBeNull();
      expect(cursor?.cursorValue).toBe("2026-01-06T00:00:00Z");
    });

    it("upsert updates existing cursor value", async () => {
      await adapter.upsertCursor(
        TEST_NODE_ID,
        TEST_SCOPE_ID,
        "github",
        "pull_requests",
        "test/repo",
        "2026-01-07T00:00:00Z"
      );

      const cursor = await adapter.getCursor(
        TEST_NODE_ID,
        TEST_SCOPE_ID,
        "github",
        "pull_requests",
        "test/repo"
      );
      expect(cursor?.cursorValue).toBe("2026-01-07T00:00:00Z");
    });

    it("getCursor returns null for unknown cursor", async () => {
      const cursor = await adapter.getCursor(
        TEST_NODE_ID,
        TEST_SCOPE_ID,
        "github",
        "unknown_stream",
        "test/repo"
      );
      expect(cursor).toBeNull();
    });
  });

  // ── Pool Components ───────────────────────────────────────────

  describe("pool components", () => {
    let epochId: bigint;

    beforeAll(async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...weekWindow(5),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      epochId = epoch.id;
    });

    afterAll(async () => {
      await adapter.closeEpoch(epochId, 0n);
    });

    it("inserts and retrieves pool components", async () => {
      const comp = await adapter.insertPoolComponent(
        makePoolComponent({ epochId })
      );

      expect(comp.componentId).toBe("base_issuance");
      expect(comp.amountCredits).toBe(10000n);

      const all = await adapter.getPoolComponentsForEpoch(epochId);
      expect(all).toHaveLength(1);
    });

    it("POOL_UNIQUE_PER_TYPE: rejects duplicate component_id per epoch", async () => {
      await expect(
        adapter.insertPoolComponent(makePoolComponent({ epochId }))
      ).rejects.toThrow();
    });

    it("POOL_IMMUTABLE: UPDATE on pool components is rejected by trigger", async () => {
      await expect(
        db.execute(
          sql`UPDATE epoch_pool_components SET amount_credits = 99999 WHERE epoch_id = ${epochId}`
        )
      ).rejects.toSatisfy((err: unknown) =>
        /not allowed/i.test(drizzleCause(err))
      );
    });
  });

  // ── Payout Statements ─────────────────────────────────────────

  describe("payout statements", () => {
    let epochId: bigint;

    beforeAll(async () => {
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...weekWindow(6),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeEpoch(epoch.id, 10000n);
      epochId = epoch.id;
    });

    it("inserts and retrieves a payout statement", async () => {
      const stmt = await adapter.insertPayoutStatement({
        nodeId: TEST_NODE_ID,
        epochId,
        allocationSetHash: "abc123def456",
        poolTotalCredits: 10000n,
        payoutsJson: [
          {
            user_id: actor.user.id,
            total_units: "8000",
            share: "1.000000",
            amount_credits: "10000",
          },
        ],
      });

      expect(stmt.epochId).toBe(epochId);
      expect(stmt.poolTotalCredits).toBe(10000n);

      const fetched = await adapter.getStatementForEpoch(epochId);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(stmt.id);
    });

    it("getStatementForEpoch throws EpochNotFoundError for non-existent epoch", async () => {
      await expect(adapter.getStatementForEpoch(999999n)).rejects.toThrow(
        EpochNotFoundError
      );
    });
  });

  // ── Statement Signatures ──────────────────────────────────────

  describe("statement signatures", () => {
    let statementId: string;

    beforeAll(async () => {
      // Self-contained: create epoch → close → insert statement
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...weekWindow(7),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      await adapter.closeEpoch(epoch.id, 20000n);

      const stmt = await adapter.insertPayoutStatement({
        nodeId: TEST_NODE_ID,
        epochId: epoch.id,
        allocationSetHash: "sig-test-hash",
        poolTotalCredits: 20000n,
        payoutsJson: [
          {
            user_id: "sig-test-user",
            total_units: "20000",
            share: "1.0",
            amount_credits: "20000",
          },
        ],
      });
      statementId = stmt.id;
    });

    it("inserts and retrieves a signature", async () => {
      await adapter.insertStatementSignature({
        nodeId: TEST_NODE_ID,
        statementId,
        signerWallet: "0x1234567890abcdef1234567890abcdef12345678",
        signature: "0xdeadbeef",
        signedAt: new Date(),
      });

      const sigs = await adapter.getSignaturesForStatement(statementId);
      expect(sigs).toHaveLength(1);
      expect(sigs[0]?.signerWallet).toBe(
        "0x1234567890abcdef1234567890abcdef12345678"
      );
    });
  });

  // ── SCOPE_GATED_QUERIES ─────────────────────────────────────────

  describe("SCOPE_GATED_QUERIES", () => {
    const OTHER_SCOPE_ID = "00000000-0000-4000-8000-000000000099";
    const otherScopeAdapter = new DrizzleLedgerAdapter(db, OTHER_SCOPE_ID);
    let scopeTestEpochId: bigint;

    beforeAll(async () => {
      // Create epoch in TEST_SCOPE_ID (via the main adapter)
      const epoch = await adapter.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        ...weekWindow(10),
        weightConfig: TEST_WEIGHT_CONFIG,
      });
      scopeTestEpochId = epoch.id;
    });

    afterAll(async () => {
      const open = await adapter.getOpenEpoch(TEST_NODE_ID, TEST_SCOPE_ID);
      if (open) await adapter.closeEpoch(open.id, 0n);
    });

    it("getEpoch returns null for cross-scope epochId", async () => {
      const result = await otherScopeAdapter.getEpoch(scopeTestEpochId);
      expect(result).toBeNull();
    });

    it("closeEpoch throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.closeEpoch(scopeTestEpochId, 100n)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getCurationForEpoch throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getCurationForEpoch(scopeTestEpochId)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getUnresolvedCuration throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getUnresolvedCuration(scopeTestEpochId)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getAllocationsForEpoch throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getAllocationsForEpoch(scopeTestEpochId)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getPoolComponentsForEpoch throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getPoolComponentsForEpoch(scopeTestEpochId)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getStatementForEpoch throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getStatementForEpoch(scopeTestEpochId)
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("updateAllocationFinalUnits throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.updateAllocationFinalUnits(
          scopeTestEpochId,
          "any-user",
          100n
        )
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("getUncuratedEvents throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.getUncuratedEvents(
          TEST_NODE_ID,
          scopeTestEpochId,
          new Date("2026-01-01"),
          new Date("2026-12-31")
        )
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("updateCurationUserId throws EpochNotFoundError for cross-scope epochId", async () => {
      await expect(
        otherScopeAdapter.updateCurationUserId(
          scopeTestEpochId,
          "any-event",
          "any-user"
        )
      ).rejects.toThrow(EpochNotFoundError);
    });

    it("listEpochs returns empty for wrong scope", async () => {
      const results = await otherScopeAdapter.listEpochs(TEST_NODE_ID);
      const match = results.find((e) => e.id === scopeTestEpochId);
      expect(match).toBeUndefined();
    });

    it("same-scope adapter can access the epoch normally", async () => {
      const result = await adapter.getEpoch(scopeTestEpochId);
      expect(result).not.toBeNull();
      expect(result?.scopeId).toBe(TEST_SCOPE_ID);
    });
  });
});
