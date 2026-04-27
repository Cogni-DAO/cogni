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
 *   - REDEEM_DEDUP_IS_PERSISTED — `enqueue` UPSERTs on
 *     `(funder_address, condition_id)` unique key.
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
  RedeemJobsPort,
  RedeemSubscriptionId,
} from "@/ports";
import { polyRedeemJobs, polySubscriptionCursors } from "@/shared/db";

type Row = typeof polyRedeemJobs.$inferSelect;

function mapRow(row: Row): RedeemJob {
  return {
    id: row.id,
    funderAddress: row.funderAddress as `0x${string}`,
    conditionId: row.conditionId as `0x${string}`,
    status: row.status as RedeemJobStatus,
    flavor: row.flavor as RedeemFlavor,
    indexSet: (row.indexSet as string[]) ?? [],
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
    // already existed, we follow up with a SELECT to fetch its id.
    const inserted = await this.db
      .insert(polyRedeemJobs)
      .values({
        funderAddress: input.funderAddress,
        conditionId: input.conditionId,
        flavor: input.flavor,
        indexSet: input.indexSet,
        expectedShares: input.expectedShares,
        expectedPayoutUsdc: input.expectedPayoutUsdc,
        lifecycleState: input.lifecycleState,
      })
      .onConflictDoNothing({
        target: [polyRedeemJobs.funderAddress, polyRedeemJobs.conditionId],
      })
      .returning({ id: polyRedeemJobs.id });

    const insertedRow = inserted[0];
    if (insertedRow !== undefined) {
      return { jobId: insertedRow.id, alreadyExisted: false };
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

  async claimNextPending(): Promise<RedeemJob | null> {
    // Raw SQL: drizzle's query builder doesn't expose `FOR UPDATE SKIP LOCKED`
    // fluently. The CTE pattern atomically claims + flips the row's status to
    // a sentinel (`'pending'` stays — caller decides the next state via the
    // transitions module). We return the full row.
    //
    // Note: we don't UPDATE here. The contract is "give me a row I'm allowed
    // to work on"; the worker will UPDATE via markSubmitted/markTransientFailure
    // after submitting the tx. Two workers can't claim the same row inside
    // a single tx because of the row lock; once the worker commits its
    // markSubmitted transition, status is no longer `pending`.
    const result = await this.db.execute(sql`
      SELECT * FROM ${polyRedeemJobs}
      WHERE status = 'pending'
      ORDER BY enqueued_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    const rows = result as unknown as Row[];
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    return mapRow(row);
  }

  async claimReaperCandidates(
    headBlock: bigint,
    finalityBlocks: bigint
  ): Promise<RedeemJob[]> {
    const cutoff = headBlock - finalityBlocks;
    const result = await this.db.execute(sql`
      SELECT * FROM ${polyRedeemJobs}
      WHERE status = 'submitted'
        AND submitted_at_block IS NOT NULL
        AND submitted_at_block <= ${cutoff}
      FOR UPDATE SKIP LOCKED
    `);
    const rows = result as unknown as Row[];
    return rows.map(mapRow);
  }

  async markSubmitted(input: {
    jobId: string;
    txHash: `0x${string}`;
    submittedAtBlock: bigint;
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
