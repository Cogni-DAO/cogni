// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/redeem/drizzle-redeem-jobs`
 * Purpose: Drizzle/Postgres implementation of `RedeemJobsPort` (task.0388).
 *   Backs `poly_redeem_jobs` + `poly_subscription_cursors`. Atomic
 *   `claimNextPending` uses raw SQL `FOR UPDATE SKIP LOCKED` because drizzle's
 *   query builder doesn't model locking hints fluently.
 * Scope: Persistence only. State-machine validation is the worker's job (via
 *   `@core/redeem/transitions`); this adapter just persists what it's told.
 * Invariants:
 *   - REDEEM_DEDUP_IS_PERSISTED — `enqueue` writes through the
 *     `(funder_address, condition_id)` unique key and only revives skipped
 *     rows when the new input is a chain-authoritative winner.
 *   - SKIP_LOCKED_FOR_WORKER — concurrent `claimNextPending` callers never
 *     receive the same row.
 * Side-effects: IO (database operations).
 * Links: Implements `RedeemJobsPort` in `@/ports/redeem-jobs.port`.
 *   Consumers: `features/redeem/{redeem-subscriber,redeem-worker,redeem-catchup}.ts`.
 * @public
 */

import { eq, sql } from "drizzle-orm";

import type { Database } from "@/adapters/server/db/client";
import type {
  RedeemFailureClass,
  RedeemFlavor,
  RedeemJob,
  RedeemJobStatus,
  RedeemLifecycleState,
} from "@/core";
import type {
  EnqueueRedeemJobInput,
  EnqueueRedeemJobResult,
  KnownRedeemCondition,
  RedeemJobsPort,
  RedeemSubscriptionId,
} from "@/ports";
import { polyRedeemJobs, polySubscriptionCursors } from "@/shared/db";

type Row = typeof polyRedeemJobs.$inferSelect;

const STALE_CLAIM_RECLAIM_AFTER_MINUTES = 10;

function mapRow(row: Row): RedeemJob {
  return {
    id: row.id,
    funderAddress: row.funderAddress as `0x${string}`,
    conditionId: row.conditionId as `0x${string}`,
    positionId: row.positionId,
    outcomeIndex: row.outcomeIndex,
    status: row.status as RedeemJobStatus,
    flavor: row.flavor as RedeemFlavor,
    indexSet: (row.indexSet as string[]) ?? [],
    collateralToken: row.collateralToken as `0x${string}`,
    expectedShares: row.expectedShares,
    expectedPayoutUsdc: row.expectedPayoutUsdc,
    txHashes: (row.txHashes ?? []) as `0x${string}`[],
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    errorClass: (row.errorClass as RedeemFailureClass | null) ?? null,
    lifecycleState: row.lifecycleState as RedeemLifecycleState,
    receiptBurnObserved: row.receiptBurnObserved,
    submittedAtBlock: row.submittedAtBlock ?? null,
    enqueuedAt: row.enqueuedAt,
    submittedAt: row.submittedAt,
    confirmedAt: row.confirmedAt,
    abandonedAt: row.abandonedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Service-role drizzle adapter for the redeem job queue.
 *
 * Constructed with a `Database` handle (typically `getServiceDb()` from
 * bootstrap, since these are operator-funder writes that need BYPASSRLS).
 */
export class DrizzleRedeemJobsAdapter implements RedeemJobsPort {
  constructor(private readonly db: Database) {}

  async enqueue(input: EnqueueRedeemJobInput): Promise<EnqueueRedeemJobResult> {
    // UPSERT on the unique `(funder_address, condition_id)` key. ON CONFLICT
    // DO NOTHING + RETURNING gives back only the inserted row; if the row
    // already existed, a current winner decision may revive stale terminal
    // read-model rows before we fall back to SELECTing the existing id.
    const inserted = await this.db
      .insert(polyRedeemJobs)
      .values({
        funderAddress: input.funderAddress,
        conditionId: input.conditionId,
        positionId: input.positionId,
        outcomeIndex: input.outcomeIndex,
        flavor: input.flavor,
        indexSet: input.indexSet,
        collateralToken: input.collateralToken,
        expectedShares: input.expectedShares,
        expectedPayoutUsdc: input.expectedPayoutUsdc,
        lifecycleState: input.lifecycleState,
        ...(input.status !== undefined ? { status: input.status } : {}),
      })
      .onConflictDoNothing({
        target: [polyRedeemJobs.funderAddress, polyRedeemJobs.conditionId],
      })
      .returning({ id: polyRedeemJobs.id });

    const insertedRow = inserted[0];
    if (insertedRow !== undefined) {
      return { jobId: insertedRow.id, alreadyExisted: false };
    }

    if (
      input.lifecycleState === "winner" &&
      (input.status === undefined || input.status === "pending")
    ) {
      const revived = await this.db
        .update(polyRedeemJobs)
        .set({
          positionId: input.positionId,
          outcomeIndex: input.outcomeIndex,
          status: "pending",
          flavor: input.flavor,
          indexSet: input.indexSet,
          collateralToken: input.collateralToken,
          expectedShares: input.expectedShares,
          expectedPayoutUsdc: input.expectedPayoutUsdc,
          txHashes: sql`ARRAY[]::text[]`,
          attemptCount: 0,
          lastError: null,
          errorClass: null,
          lifecycleState: "winner",
          receiptBurnObserved: null,
          submittedAtBlock: null,
          enqueuedAt: new Date(),
          submittedAt: null,
          confirmedAt: null,
          abandonedAt: null,
          updatedAt: new Date(),
        })
        .where(
          sql`${polyRedeemJobs.funderAddress} = ${input.funderAddress}
            AND ${polyRedeemJobs.conditionId} = ${input.conditionId}
            AND ${polyRedeemJobs.status} IN ('skipped', 'confirmed', 'abandoned')`
        )
        .returning({ id: polyRedeemJobs.id });

      const revivedRow = revived[0];
      if (revivedRow !== undefined) {
        return { jobId: revivedRow.id, alreadyExisted: true };
      }
    }

    const existing = await this.db
      .select({ id: polyRedeemJobs.id })
      .from(polyRedeemJobs)
      .where(
        sql`${polyRedeemJobs.funderAddress} = ${input.funderAddress}
          AND ${polyRedeemJobs.conditionId} = ${input.conditionId}`
      )
      .limit(1);

    const existingRow = existing[0];
    if (existingRow === undefined) {
      // Vanishingly unlikely race: row deleted between our insert + select.
      throw new Error(
        "redeem job UPSERT race: row vanished between insert and select"
      );
    }
    return { jobId: existingRow.id, alreadyExisted: true };
  }

  async claimNextPending(
    funderAddress: `0x${string}`
  ): Promise<RedeemJob | null> {
    // Atomic claim: a single UPDATE statement is the only contention-safe
    // surface. The naive two-step (SELECT FOR UPDATE SKIP LOCKED + later
    // UPDATE in a separate autocommit tx) releases the row lock between
    // statements — multi-pod workers would both claim the same row and
    // each fire a redeem tx. The CTE here selects with SKIP LOCKED inside
    // the same statement that flips status to 'claimed', so two pods get
    // distinct rows or nothing.
    //
    // The funder filter is inside the SELECT (not the outer UPDATE) so the
    // SKIP LOCKED predicate stays correct under concurrent claims from
    // different tenants — workers for funder B simply skip past funder A's
    // locked rows rather than blocking on them.
    //
    // `claimed` is normally an in-flight worker-owned state. It is also
    // durable, so a pod restart between claim and submit can orphan a winner
    // forever unless a later worker can reclaim old claims.
    //
    // RETURNING is intentionally id-only: `db.execute(sql`…`)` yields raw
    // snake_case rows from postgres, but every consumer of `RedeemJob`
    // expects the drizzle camelCase shape. Re-reading the row through the
    // typed builder keeps column-mapping in one place (`mapRow`) rather
    // than forking a second snake_case-aware mapper.
    const result = await this.db.execute(sql`
      WITH next_job AS (
        SELECT id FROM ${polyRedeemJobs}
        WHERE (
            status IN ('pending', 'failed_transient')
            OR (
              status = 'claimed'
              AND updated_at < now() - make_interval(mins => ${STALE_CLAIM_RECLAIM_AFTER_MINUTES})
            )
          )
          AND ${polyRedeemJobs.funderAddress} = ${funderAddress}
        ORDER BY enqueued_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE ${polyRedeemJobs} AS j
      SET status = 'claimed', updated_at = now()
      FROM next_job
      WHERE j.id = next_job.id
      RETURNING j.id
    `);

    const rows = result as unknown as Array<{ id: string }>;
    const claimedId = rows[0]?.id;
    if (claimedId === undefined) return null;

    const fetched = await this.db
      .select()
      .from(polyRedeemJobs)
      .where(eq(polyRedeemJobs.id, claimedId))
      .limit(1);
    const row = fetched[0];
    if (row === undefined) return null;
    return mapRow(row);
  }

  async claimReaperCandidates(
    headBlock: bigint,
    finalityBlocks: bigint
  ): Promise<RedeemJob[]> {
    // No status flip — caller (worker.reapStale) issues a markX per row,
    // each of which is its own UPDATE that's idempotent under double-evaluation
    // (markAbandoned/markTransientFailure both transition `submitted` to
    // distinct terminal/intermediate states; a second pod's call lands as
    // a no-op overwrite or wrong_status_for_event in the transitions guard).
    const cutoff = headBlock - finalityBlocks;
    const rows = await this.db
      .select()
      .from(polyRedeemJobs)
      .where(
        sql`${polyRedeemJobs.status} = 'submitted'
          AND ${polyRedeemJobs.submittedAtBlock} IS NOT NULL
          AND ${polyRedeemJobs.submittedAtBlock} <= ${cutoff}`
      );
    return rows.map(mapRow);
  }

  async markSubmitted(input: {
    jobId: string;
    txHash: `0x${string}`;
    submittedAtBlock: bigint | null;
    receiptBurnObserved: boolean;
  }): Promise<void> {
    await this.db
      .update(polyRedeemJobs)
      .set({
        status: "submitted",
        txHashes: sql`array_append(${polyRedeemJobs.txHashes}, ${input.txHash})`,
        submittedAtBlock: input.submittedAtBlock,
        receiptBurnObserved: input.receiptBurnObserved,
        attemptCount: sql`${polyRedeemJobs.attemptCount} + 1`,
        lastError: null,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(polyRedeemJobs.id, input.jobId));
  }

  async markConfirmed(input: {
    jobId: string;
    txHash: `0x${string}`;
  }): Promise<void> {
    await this.db
      .update(polyRedeemJobs)
      .set({
        status: "confirmed",
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(polyRedeemJobs.id, input.jobId));
  }

  async markTransientFailure(input: {
    jobId: string;
    error: string;
  }): Promise<void> {
    await this.db
      .update(polyRedeemJobs)
      .set({
        status: "failed_transient",
        lastError: input.error,
        attemptCount: sql`${polyRedeemJobs.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(polyRedeemJobs.id, input.jobId));
  }

  async markAbandoned(input: {
    jobId: string;
    errorClass: RedeemFailureClass;
    error: string;
  }): Promise<void> {
    await this.db
      .update(polyRedeemJobs)
      .set({
        status: "abandoned",
        errorClass: input.errorClass,
        lastError: input.error,
        lifecycleState: "abandoned",
        abandonedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(polyRedeemJobs.id, input.jobId));
  }

  async revertConfirmedToSubmitted(input: { jobId: string }): Promise<void> {
    await this.db
      .update(polyRedeemJobs)
      .set({
        status: "submitted",
        confirmedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(polyRedeemJobs.id, input.jobId));
  }

  async setLifecycleState(input: {
    jobId: string;
    lifecycleState: RedeemLifecycleState;
  }): Promise<void> {
    await this.db
      .update(polyRedeemJobs)
      .set({
        lifecycleState: input.lifecycleState,
        updatedAt: new Date(),
      })
      .where(eq(polyRedeemJobs.id, input.jobId));
  }

  async findByKey(
    funderAddress: `0x${string}`,
    conditionId: `0x${string}`
  ): Promise<RedeemJob | null> {
    const rows = await this.db
      .select()
      .from(polyRedeemJobs)
      .where(
        sql`${polyRedeemJobs.funderAddress} = ${funderAddress}
          AND ${polyRedeemJobs.conditionId} = ${conditionId}`
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return mapRow(row);
  }

  async listForFunder(funderAddress: `0x${string}`): Promise<RedeemJob[]> {
    const rows = await this.db
      .select()
      .from(polyRedeemJobs)
      .where(eq(polyRedeemJobs.funderAddress, funderAddress));
    return rows.map(mapRow);
  }

  async listKnownConditionsForFunder(
    funderAddress: `0x${string}`
  ): Promise<readonly KnownRedeemCondition[]> {
    const rows = await this.db
      .select({
        conditionId: polyRedeemJobs.conditionId,
        lifecycleState: polyRedeemJobs.lifecycleState,
        enqueuedAt: polyRedeemJobs.enqueuedAt,
      })
      .from(polyRedeemJobs)
      .where(eq(polyRedeemJobs.funderAddress, funderAddress));
    return rows.map((r) => ({
      conditionId: r.conditionId as `0x${string}`,
      lifecycleState: r.lifecycleState as RedeemLifecycleState,
      enqueuedAt: r.enqueuedAt,
    }));
  }

  async getLastProcessedBlock(
    subscriptionId: RedeemSubscriptionId
  ): Promise<bigint | null> {
    const rows = await this.db
      .select({ block: polySubscriptionCursors.lastProcessedBlock })
      .from(polySubscriptionCursors)
      .where(eq(polySubscriptionCursors.subscriptionId, subscriptionId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return row.block;
  }

  async setLastProcessedBlock(
    subscriptionId: RedeemSubscriptionId,
    block: bigint
  ): Promise<void> {
    await this.db
      .insert(polySubscriptionCursors)
      .values({
        subscriptionId,
        lastProcessedBlock: block,
      })
      .onConflictDoUpdate({
        target: polySubscriptionCursors.subscriptionId,
        set: {
          lastProcessedBlock: block,
          updatedAt: new Date(),
        },
      });
  }
}
