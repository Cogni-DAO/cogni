// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/db/drizzle-redeem-jobs.adapter.int`
 * Purpose: Component tests for `DrizzleRedeemJobsAdapter` against real
 *   PostgreSQL via testcontainers. Ground-truth coverage for the Blocker #2
 *   fix from task.0388 § Static review: the v0.2 redeem flow no longer
 *   strands resolved positions behind a stale `skipped` row, because the
 *   `decision-to-enqueue-input` boundary doesn't WRITE one for transient
 *   reasons in the first place. These tests pin that contract at the
 *   adapter layer:
 *     1. Fresh enqueue creates a `pending/winner` row.
 *     2. Re-enqueueing the same `(funder, conditionId)` returns
 *        `alreadyExisted: true` and the row is unchanged (idempotency).
 *     3. `claimNextPending` atomically flips `pending` → `claimed` and
 *        returns the row exactly once across concurrent claimers.
 *     4. A pre-existing terminal `skipped/loser` row is NOT silently
 *        promoted by a later `pending/winner` enqueue — `onConflictDoNothing`
 *        keeps it terminal. (The fix at the input layer means we never
 *        write the trap rows; this test documents that the adapter's UPSERT
 *        is correctly idempotent and does not perform any reclassification.)
 * Scope: Adapter ↔ Postgres only. No subscriber/worker/route involvement.
 * Invariants: REDEEM_DEDUP_IS_PERSISTED, SKIP_LOCKED_FOR_WORKER (B3 atomic claim).
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: src/adapters/server/redeem/drizzle-redeem-jobs.adapter.ts,
 *   src/features/redeem/decision-to-enqueue-input.ts,
 *   work/items/task.0388 § Static review Blocker #2
 * @public
 */

import { polyRedeemJobs } from "@cogni/poly-db-schema";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { DrizzleRedeemJobsAdapter } from "@/adapters/server/redeem";

const FUNDER = "0xaaaa000000000000000000000000000000000001" as const;
const COND =
  "0x86c171b757d290aebed1d5a22e63da3c06900e6e9f42e84ac27baf89fcf09e4b" as const;
const COND_OTHER =
  "0x18ec34d073083a5cc3c576e2cdf93fbbb162167ffc4f770dbfa15ba4c2a0927d" as const;
const POSITION_ID = "12345678901234567890";

describe("DrizzleRedeemJobsAdapter (Component) — Blocker #2 regression", () => {
  const db = getSeedDb();
  const adapter = new DrizzleRedeemJobsAdapter(db);

  afterEach(async () => {
    // Each test owns a clean slice of the table.
    await db.execute(
      sql`DELETE FROM ${polyRedeemJobs} WHERE funder_address = ${FUNDER}`
    );
  });

  it("fresh winner enqueue creates a pending row the worker can claim", async () => {
    const result = await adapter.enqueue({
      funderAddress: FUNDER,
      conditionId: COND,
      positionId: POSITION_ID,
      outcomeIndex: 0,
      flavor: "binary",
      indexSet: ["1", "2"],
      expectedShares: "5000000",
      expectedPayoutUsdc: "5000000",
      lifecycleState: "winner",
    });
    expect(result.alreadyExisted).toBe(false);

    const claimed = await adapter.claimNextPending(FUNDER);
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(result.jobId);
    expect(claimed?.status).toBe("claimed");
    expect(claimed?.lifecycleState).toBe("winner");
    expect(claimed?.flavor).toBe("binary");
  });

  it("re-enqueueing the same (funder, conditionId) returns alreadyExisted=true (REDEEM_DEDUP_IS_PERSISTED)", async () => {
    const first = await adapter.enqueue({
      funderAddress: FUNDER,
      conditionId: COND,
      positionId: POSITION_ID,
      outcomeIndex: 0,
      flavor: "binary",
      indexSet: ["1", "2"],
      expectedShares: "5000000",
      expectedPayoutUsdc: "5000000",
      lifecycleState: "winner",
    });
    expect(first.alreadyExisted).toBe(false);

    const second = await adapter.enqueue({
      funderAddress: FUNDER,
      conditionId: COND,
      positionId: POSITION_ID,
      outcomeIndex: 0,
      flavor: "binary",
      indexSet: ["1", "2"],
      expectedShares: "5000000",
      expectedPayoutUsdc: "5000000",
      lifecycleState: "winner",
    });
    expect(second.alreadyExisted).toBe(true);
    expect(second.jobId).toBe(first.jobId);
  });

  it("two concurrent claimNextPending callers receive distinct rows (B3 SKIP LOCKED)", async () => {
    await adapter.enqueue({
      funderAddress: FUNDER,
      conditionId: COND,
      positionId: POSITION_ID,
      outcomeIndex: 0,
      flavor: "binary",
      indexSet: ["1", "2"],
      expectedShares: "1",
      expectedPayoutUsdc: "1",
      lifecycleState: "winner",
    });
    await adapter.enqueue({
      funderAddress: FUNDER,
      conditionId: COND_OTHER,
      positionId: POSITION_ID,
      outcomeIndex: 0,
      flavor: "binary",
      indexSet: ["1", "2"],
      expectedShares: "1",
      expectedPayoutUsdc: "1",
      lifecycleState: "winner",
    });

    const [a, b] = await Promise.all([
      adapter.claimNextPending(FUNDER),
      adapter.claimNextPending(FUNDER),
    ]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a?.id).not.toBe(b?.id);
    expect([a?.status, b?.status]).toEqual(["claimed", "claimed"]);

    const third = await adapter.claimNextPending(FUNDER);
    expect(third).toBeNull(); // pool drained
  });

  it("a pre-existing terminal skipped/loser row is NOT promoted by a later enqueue (onConflictDoNothing is correctly idempotent)", async () => {
    // Simulate the dust-loser case: backfill writes a `skipped/loser` row
    // for a market that's already resolved against us.
    const initial = await adapter.enqueue({
      funderAddress: FUNDER,
      conditionId: COND,
      positionId: POSITION_ID,
      outcomeIndex: 0,
      flavor: "binary",
      indexSet: [],
      expectedShares: "0",
      expectedPayoutUsdc: "0",
      lifecycleState: "loser",
      status: "skipped",
    });
    expect(initial.alreadyExisted).toBe(false);

    // A later subscriber-side enqueue (e.g. a stray ConditionResolution
    // re-fire) for the same key with `pending/winner` MUST NOT silently
    // overwrite the terminal row — that would mark a known-loser as
    // redeemable. The adapter is intentionally idempotent at this layer.
    const later = await adapter.enqueue({
      funderAddress: FUNDER,
      conditionId: COND,
      positionId: POSITION_ID,
      outcomeIndex: 0,
      flavor: "binary",
      indexSet: ["1", "2"],
      expectedShares: "5000000",
      expectedPayoutUsdc: "5000000",
      lifecycleState: "winner",
    });
    expect(later.alreadyExisted).toBe(true);
    expect(later.jobId).toBe(initial.jobId);

    const rows = await db
      .select()
      .from(polyRedeemJobs)
      .where(eq(polyRedeemJobs.id, initial.jobId));
    expect(rows[0]?.status).toBe("skipped");
    expect(rows[0]?.lifecycleState).toBe("loser");

    // And the worker still cannot claim it — `claimNextPending` filters
    // on status IN ('pending', 'failed_transient').
    const claimed = await adapter.claimNextPending(FUNDER);
    expect(claimed).toBeNull();
  });

  it("claimNextPending is funder-scoped — funder A never claims funder B's row (task.0412 multi-tenant fan-out)", async () => {
    const FUNDER_B = "0xbbbb000000000000000000000000000000000002" as const;
    try {
      // Two pending rows for two different funders.
      await adapter.enqueue({
        funderAddress: FUNDER,
        conditionId: COND,
        positionId: POSITION_ID,
        outcomeIndex: 0,
        flavor: "binary",
        indexSet: ["1", "2"],
        expectedShares: "1",
        expectedPayoutUsdc: "1",
        lifecycleState: "winner",
      });
      await adapter.enqueue({
        funderAddress: FUNDER_B,
        conditionId: COND_OTHER,
        positionId: POSITION_ID,
        outcomeIndex: 0,
        flavor: "binary",
        indexSet: ["1", "2"],
        expectedShares: "1",
        expectedPayoutUsdc: "1",
        lifecycleState: "winner",
      });

      // Funder A's worker claims A's row. Funder B's row stays pending.
      const aClaimed = await adapter.claimNextPending(FUNDER);
      expect(aClaimed?.funderAddress).toBe(FUNDER);

      // Funder A then sees nothing — its only pending row is now claimed.
      const aSecond = await adapter.claimNextPending(FUNDER);
      expect(aSecond).toBeNull();

      // Funder B's worker still finds its own row untouched.
      const bClaimed = await adapter.claimNextPending(FUNDER_B);
      expect(bClaimed?.funderAddress).toBe(FUNDER_B);
      expect(bClaimed?.id).not.toBe(aClaimed?.id);
    } finally {
      await db.execute(
        sql`DELETE FROM ${polyRedeemJobs} WHERE funder_address = ${FUNDER_B}`
      );
    }
  });

  it("findByKey + listForFunder reflect the row state after enqueue", async () => {
    const { jobId } = await adapter.enqueue({
      funderAddress: FUNDER,
      conditionId: COND,
      positionId: POSITION_ID,
      outcomeIndex: 0,
      flavor: "binary",
      indexSet: ["1", "2"],
      expectedShares: "1",
      expectedPayoutUsdc: "1",
      lifecycleState: "winner",
    });

    const byKey = await adapter.findByKey(FUNDER, COND);
    expect(byKey?.id).toBe(jobId);
    expect(byKey?.status).toBe("pending");

    const list = await adapter.listForFunder(FUNDER);
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(jobId);
  });
});
