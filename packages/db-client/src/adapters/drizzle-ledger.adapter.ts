// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-client/adapters/drizzle-ledger`
 * Purpose: Drizzle ORM implementation of ActivityLedgerStore port.
 * Scope: Single adapter shared by app (via container.ts) and scheduler-worker. Implements all ActivityLedgerStore methods including identity resolution via user_bindings (cross-domain). Does not contain domain logic or define port interfaces.
 * Invariants:
 * - Uses serviceDb (BYPASSRLS) — no RLS in V0.
 * - SCOPE_GATED_QUERIES: Every epochId-based method enforces scope_id = this.scopeId. Scope mismatches throw EpochNotFoundError.
 * - ACTIVITY_IDEMPOTENT: insertActivityEvents uses onConflictDoNothing on PK.
 * - CURATION_AUTO_POPULATE: insertCurationDoNothing uses onConflictDoNothing; updateCurationUserId only sets userId where NULL.
 * - CURATION_FREEZE_ON_FINALIZE: DB trigger enforces; adapter does not duplicate check.
 * - ONE_OPEN_EPOCH: DB constraint enforces; adapter lets DB error propagate.
 * - ALLOCATION_PRESERVES_OVERRIDES: upsertAllocations updates proposed_units/activity_count only; never touches final_units.
 * - POOL_LOCKED_AT_REVIEW: insertPoolComponent rejects inserts when epoch status != 'open'.
 * - CONFIG_LOCKED_AT_REVIEW: closeIngestion pins allocationAlgoRef + weightConfigHash.
 * Side-effects: IO (database operations)
 * Links: docs/spec/epoch-ledger.md, packages/ledger-core/src/store.ts
 * @public
 */

import { userBindings } from "@cogni/db-schema/identity";
import {
  activityCuration,
  activityEvents,
  epochAllocations,
  epochPoolComponents,
  epochs,
  payoutStatements,
  sourceCursors,
  statementSignatures,
} from "@cogni/db-schema/ledger";
import type {
  ActivityLedgerStore,
  CuratedEventForAllocation,
  InsertActivityEventParams,
  InsertAllocationParams,
  InsertCurationAutoParams,
  InsertPayoutStatementParams,
  InsertPoolComponentParams,
  InsertSignatureParams,
  LedgerActivityEvent,
  LedgerAllocation,
  LedgerCuration,
  LedgerEpoch,
  LedgerPayoutStatement,
  LedgerPoolComponent,
  LedgerSourceCursor,
  LedgerStatementSignature,
  UncuratedEvent,
  UpsertCurationParams,
} from "@cogni/ledger-core";
import {
  AllocationNotFoundError,
  EpochNotFoundError,
  EpochNotOpenError,
  type EpochStatus,
} from "@cogni/ledger-core";
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Database } from "../client";

// ── Row mappers ─────────────────────────────────────────────────

function toEpoch(row: typeof epochs.$inferSelect): LedgerEpoch {
  return {
    id: row.id,
    nodeId: row.nodeId,
    scopeId: row.scopeId,
    status: row.status as EpochStatus,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    weightConfig: row.weightConfig,
    poolTotalCredits: row.poolTotalCredits,
    approverSetHash: row.approverSetHash,
    allocationAlgoRef: row.allocationAlgoRef,
    weightConfigHash: row.weightConfigHash,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
  };
}

function toActivityEvent(
  row: typeof activityEvents.$inferSelect
): LedgerActivityEvent {
  return {
    id: row.id,
    nodeId: row.nodeId,
    scopeId: row.scopeId,
    source: row.source,
    eventType: row.eventType,
    platformUserId: row.platformUserId,
    platformLogin: row.platformLogin,
    artifactUrl: row.artifactUrl,
    metadata: row.metadata,
    payloadHash: row.payloadHash,
    producer: row.producer,
    producerVersion: row.producerVersion,
    eventTime: row.eventTime,
    retrievedAt: row.retrievedAt,
    ingestedAt: row.ingestedAt,
  };
}

function toCuration(row: typeof activityCuration.$inferSelect): LedgerCuration {
  return {
    id: row.id,
    nodeId: row.nodeId,
    epochId: row.epochId,
    eventId: row.eventId,
    userId: row.userId,
    included: row.included,
    weightOverrideMilli: row.weightOverrideMilli,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAllocation(
  row: typeof epochAllocations.$inferSelect
): LedgerAllocation {
  return {
    id: row.id,
    nodeId: row.nodeId,
    epochId: row.epochId,
    userId: row.userId,
    proposedUnits: row.proposedUnits,
    finalUnits: row.finalUnits,
    overrideReason: row.overrideReason,
    activityCount: row.activityCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCursor(row: typeof sourceCursors.$inferSelect): LedgerSourceCursor {
  return {
    nodeId: row.nodeId,
    scopeId: row.scopeId,
    source: row.source,
    stream: row.stream,
    sourceRef: row.sourceRef,
    cursorValue: row.cursorValue,
    retrievedAt: row.retrievedAt,
  };
}

function toPoolComponent(
  row: typeof epochPoolComponents.$inferSelect
): LedgerPoolComponent {
  return {
    id: row.id,
    nodeId: row.nodeId,
    epochId: row.epochId,
    componentId: row.componentId,
    algorithmVersion: row.algorithmVersion,
    inputsJson: row.inputsJson,
    amountCredits: row.amountCredits,
    evidenceRef: row.evidenceRef,
    computedAt: row.computedAt,
  };
}

function toStatement(
  row: typeof payoutStatements.$inferSelect
): LedgerPayoutStatement {
  return {
    id: row.id,
    nodeId: row.nodeId,
    epochId: row.epochId,
    allocationSetHash: row.allocationSetHash,
    poolTotalCredits: row.poolTotalCredits,
    payoutsJson: row.payoutsJson,
    supersedesStatementId: row.supersedesStatementId,
    createdAt: row.createdAt,
  };
}

function toSignature(
  row: typeof statementSignatures.$inferSelect
): LedgerStatementSignature {
  return {
    id: row.id,
    nodeId: row.nodeId,
    statementId: row.statementId,
    signerWallet: row.signerWallet,
    signature: row.signature,
    signedAt: row.signedAt,
  };
}

// ── Adapter ─────────────────────────────────────────────────────

export class DrizzleLedgerAdapter implements ActivityLedgerStore {
  constructor(
    private readonly db: Database,
    private readonly scopeId: string
  ) {}

  // ── Scope gate ────────────────────────────────────────────────

  /**
   * Validate that an epoch belongs to this adapter's scope.
   * SCOPE_GATED_QUERIES: scope mismatches throw EpochNotFoundError
   * (indistinguishable from a genuinely missing epoch).
   */
  private async resolveEpochScoped(epochId: bigint): Promise<LedgerEpoch> {
    const rows = await this.db
      .select()
      .from(epochs)
      .where(and(eq(epochs.id, epochId), eq(epochs.scopeId, this.scopeId)))
      .limit(1);
    if (!rows[0]) throw new EpochNotFoundError(epochId.toString());
    return toEpoch(rows[0]);
  }

  /**
   * Validate that all epochIds in a batch belong to this adapter's scope.
   * Deduplicates before querying. Throws on first mismatch.
   */
  private async validateEpochIds(epochIds: bigint[]): Promise<void> {
    const unique = [...new Set(epochIds.map((id) => id.toString()))];
    for (const id of unique) {
      await this.resolveEpochScoped(BigInt(id));
    }
  }

  // ── Epochs ──────────────────────────────────────────────────

  async createEpoch(params: {
    nodeId: string;
    scopeId: string;
    periodStart: Date;
    periodEnd: Date;
    weightConfig: Record<string, number>;
  }): Promise<LedgerEpoch> {
    const [row] = await this.db
      .insert(epochs)
      .values({
        nodeId: params.nodeId,
        scopeId: params.scopeId,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        weightConfig: params.weightConfig,
      })
      .returning();
    if (!row) throw new Error("createEpoch: INSERT returned no rows");
    return toEpoch(row);
  }

  async getOpenEpoch(
    nodeId: string,
    scopeId: string
  ): Promise<LedgerEpoch | null> {
    const rows = await this.db
      .select()
      .from(epochs)
      .where(
        and(
          eq(epochs.nodeId, nodeId),
          eq(epochs.scopeId, scopeId),
          eq(epochs.status, "open")
        )
      )
      .limit(1);
    return rows[0] ? toEpoch(rows[0]) : null;
  }

  async getEpochByWindow(
    nodeId: string,
    scopeId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<LedgerEpoch | null> {
    const rows = await this.db
      .select()
      .from(epochs)
      .where(
        and(
          eq(epochs.nodeId, nodeId),
          eq(epochs.scopeId, scopeId),
          eq(epochs.periodStart, periodStart),
          eq(epochs.periodEnd, periodEnd)
        )
      )
      .limit(1);
    return rows[0] ? toEpoch(rows[0]) : null;
  }

  async getEpoch(id: bigint): Promise<LedgerEpoch | null> {
    const rows = await this.db
      .select()
      .from(epochs)
      .where(and(eq(epochs.id, id), eq(epochs.scopeId, this.scopeId)))
      .limit(1);
    return rows[0] ? toEpoch(rows[0]) : null;
  }

  async listEpochs(nodeId: string): Promise<LedgerEpoch[]> {
    const rows = await this.db
      .select()
      .from(epochs)
      .where(and(eq(epochs.nodeId, nodeId), eq(epochs.scopeId, this.scopeId)))
      .orderBy(epochs.id);
    return rows.map(toEpoch);
  }

  async closeIngestion(
    epochId: bigint,
    approverSetHash: string,
    allocationAlgoRef: string,
    weightConfigHash: string
  ): Promise<LedgerEpoch> {
    const [row] = await this.db
      .update(epochs)
      .set({
        status: "review",
        approverSetHash,
        allocationAlgoRef,
        weightConfigHash,
      })
      .where(
        and(
          eq(epochs.id, epochId),
          eq(epochs.scopeId, this.scopeId),
          eq(epochs.status, "open")
        )
      )
      .returning();
    if (!row) {
      const existing = await this.getEpoch(epochId);
      if (!existing) {
        throw new EpochNotFoundError(epochId.toString());
      }
      // Idempotent: already in review or finalized → return as-is
      if (existing.status === "review" || existing.status === "finalized") {
        return existing;
      }
      // Should not happen (open epoch that didn't match UPDATE) — defensive
      throw new EpochNotOpenError(epochId.toString());
    }
    return toEpoch(row);
  }

  async finalizeEpoch(
    epochId: bigint,
    poolTotal: bigint
  ): Promise<LedgerEpoch> {
    const [row] = await this.db
      .update(epochs)
      .set({
        status: "finalized",
        poolTotalCredits: poolTotal,
        closedAt: new Date(),
      })
      .where(
        and(
          eq(epochs.id, epochId),
          eq(epochs.scopeId, this.scopeId),
          eq(epochs.status, "review")
        )
      )
      .returning();
    if (!row) {
      const existing = await this.getEpoch(epochId);
      if (!existing) {
        throw new EpochNotFoundError(epochId.toString());
      }
      // Idempotent: already finalized → return as-is
      if (existing.status === "finalized") {
        return existing;
      }
      // Wrong state (open) — caller must closeIngestion first
      throw new EpochNotOpenError(epochId.toString());
    }
    return toEpoch(row);
  }

  // ── Allocation computation ──────────────────────────────────

  async getCuratedEventsForAllocation(
    epochId: bigint
  ): Promise<CuratedEventForAllocation[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select({
        eventId: activityCuration.eventId,
        userId: activityCuration.userId,
        source: activityEvents.source,
        eventType: activityEvents.eventType,
        included: activityCuration.included,
        weightOverrideMilli: activityCuration.weightOverrideMilli,
      })
      .from(activityCuration)
      .innerJoin(
        activityEvents,
        and(
          eq(activityEvents.id, activityCuration.eventId),
          eq(activityEvents.nodeId, activityCuration.nodeId)
        )
      )
      .where(
        and(
          eq(activityCuration.epochId, epochId),
          isNotNull(activityCuration.userId)
        )
      );
    return rows.map((r) => ({
      eventId: r.eventId,
      // Safe: WHERE clause filters to userId IS NOT NULL
      userId: r.userId as string,
      source: r.source,
      eventType: r.eventType,
      included: r.included,
      weightOverrideMilli: r.weightOverrideMilli,
    }));
  }

  // ── Activity events ─────────────────────────────────────────

  async insertActivityEvents(
    events: InsertActivityEventParams[]
  ): Promise<void> {
    if (events.length === 0) return;
    await this.db
      .insert(activityEvents)
      .values(
        events.map((e) => ({
          nodeId: e.nodeId,
          scopeId: e.scopeId,
          id: e.id,
          source: e.source,
          eventType: e.eventType,
          platformUserId: e.platformUserId,
          platformLogin: e.platformLogin ?? null,
          artifactUrl: e.artifactUrl ?? null,
          metadata: e.metadata ?? null,
          payloadHash: e.payloadHash,
          producer: e.producer,
          producerVersion: e.producerVersion,
          eventTime: e.eventTime,
          retrievedAt: e.retrievedAt,
        }))
      )
      .onConflictDoNothing();
  }

  async getActivityForWindow(
    nodeId: string,
    since: Date,
    until: Date
  ): Promise<LedgerActivityEvent[]> {
    const rows = await this.db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.nodeId, nodeId),
          gte(activityEvents.eventTime, since),
          lte(activityEvents.eventTime, until)
        )
      )
      .orderBy(activityEvents.eventTime);
    return rows.map(toActivityEvent);
  }

  // ── Curation ────────────────────────────────────────────────

  async upsertCuration(params: UpsertCurationParams[]): Promise<void> {
    if (params.length === 0) return;
    await this.validateEpochIds(params.map((p) => p.epochId));
    for (const p of params) {
      await this.db
        .insert(activityCuration)
        .values({
          nodeId: p.nodeId,
          epochId: p.epochId,
          eventId: p.eventId,
          userId: p.userId ?? null,
          included: p.included ?? true,
          weightOverrideMilli: p.weightOverrideMilli ?? null,
          note: p.note ?? null,
        })
        .onConflictDoUpdate({
          target: [activityCuration.epochId, activityCuration.eventId],
          set: {
            userId: p.userId ?? null,
            included: p.included ?? true,
            weightOverrideMilli: p.weightOverrideMilli ?? null,
            note: p.note ?? null,
            updatedAt: new Date(),
          },
        });
    }
  }

  async insertCurationDoNothing(
    params: InsertCurationAutoParams[]
  ): Promise<void> {
    if (params.length === 0) return;
    await this.validateEpochIds(params.map((p) => p.epochId));
    for (const p of params) {
      await this.db
        .insert(activityCuration)
        .values({
          nodeId: p.nodeId,
          epochId: p.epochId,
          eventId: p.eventId,
          userId: p.userId ?? null,
          included: p.included,
        })
        .onConflictDoNothing({
          target: [activityCuration.epochId, activityCuration.eventId],
        });
    }
  }

  async getCurationForEpoch(epochId: bigint): Promise<LedgerCuration[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select()
      .from(activityCuration)
      .where(eq(activityCuration.epochId, epochId));
    return rows.map(toCuration);
  }

  async getUnresolvedCuration(epochId: bigint): Promise<LedgerCuration[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select()
      .from(activityCuration)
      .where(
        and(
          eq(activityCuration.epochId, epochId),
          isNull(activityCuration.userId)
        )
      );
    return rows.map(toCuration);
  }

  // ── Allocations ─────────────────────────────────────────────

  async insertAllocations(params: InsertAllocationParams[]): Promise<void> {
    if (params.length === 0) return;
    await this.validateEpochIds(params.map((a) => a.epochId));
    await this.db.insert(epochAllocations).values(
      params.map((a) => ({
        nodeId: a.nodeId,
        epochId: a.epochId,
        userId: a.userId,
        proposedUnits: a.proposedUnits,
        finalUnits: a.finalUnits ?? null,
        overrideReason: a.overrideReason ?? null,
        activityCount: a.activityCount,
      }))
    );
  }

  async upsertAllocations(params: InsertAllocationParams[]): Promise<void> {
    if (params.length === 0) return;
    await this.validateEpochIds(params.map((a) => a.epochId));
    for (const a of params) {
      await this.db
        .insert(epochAllocations)
        .values({
          nodeId: a.nodeId,
          epochId: a.epochId,
          userId: a.userId,
          proposedUnits: a.proposedUnits,
          finalUnits: a.finalUnits ?? null,
          overrideReason: a.overrideReason ?? null,
          activityCount: a.activityCount,
        })
        .onConflictDoUpdate({
          target: [epochAllocations.epochId, epochAllocations.userId],
          set: {
            proposedUnits: sql`EXCLUDED.proposed_units`,
            activityCount: sql`EXCLUDED.activity_count`,
            updatedAt: new Date(),
          },
        });
    }
  }

  async deleteStaleAllocations(
    epochId: bigint,
    activeUserIds: string[]
  ): Promise<void> {
    await this.resolveEpochScoped(epochId);
    if (activeUserIds.length === 0) return;
    await this.db
      .delete(epochAllocations)
      .where(
        and(
          eq(epochAllocations.epochId, epochId),
          notInArray(epochAllocations.userId, activeUserIds),
          isNull(epochAllocations.finalUnits)
        )
      );
  }

  async updateAllocationFinalUnits(
    epochId: bigint,
    userId: string,
    finalUnits: bigint,
    overrideReason?: string
  ): Promise<void> {
    await this.resolveEpochScoped(epochId);
    const [row] = await this.db
      .update(epochAllocations)
      .set({
        finalUnits,
        overrideReason: overrideReason ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(epochAllocations.epochId, epochId),
          eq(epochAllocations.userId, userId)
        )
      )
      .returning({ id: epochAllocations.id });
    if (!row) {
      throw new AllocationNotFoundError(epochId.toString(), userId);
    }
  }

  async getAllocationsForEpoch(epochId: bigint): Promise<LedgerAllocation[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select()
      .from(epochAllocations)
      .where(eq(epochAllocations.epochId, epochId));
    return rows.map(toAllocation);
  }

  // ── Cursors ─────────────────────────────────────────────────

  async upsertCursor(
    nodeId: string,
    scopeId: string,
    source: string,
    stream: string,
    sourceRef: string,
    cursorValue: string
  ): Promise<void> {
    await this.db
      .insert(sourceCursors)
      .values({
        nodeId,
        scopeId,
        source,
        stream,
        sourceRef,
        cursorValue,
        retrievedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          sourceCursors.nodeId,
          sourceCursors.scopeId,
          sourceCursors.source,
          sourceCursors.stream,
          sourceCursors.sourceRef,
        ],
        set: {
          cursorValue,
          retrievedAt: new Date(),
        },
      });
  }

  async getCursor(
    nodeId: string,
    scopeId: string,
    source: string,
    stream: string,
    sourceRef: string
  ): Promise<LedgerSourceCursor | null> {
    const rows = await this.db
      .select()
      .from(sourceCursors)
      .where(
        and(
          eq(sourceCursors.nodeId, nodeId),
          eq(sourceCursors.scopeId, scopeId),
          eq(sourceCursors.source, source),
          eq(sourceCursors.stream, stream),
          eq(sourceCursors.sourceRef, sourceRef)
        )
      )
      .limit(1);
    return rows[0] ? toCursor(rows[0]) : null;
  }

  // ── Pool components ─────────────────────────────────────────

  async insertPoolComponent(
    params: InsertPoolComponentParams
  ): Promise<LedgerPoolComponent> {
    const epoch = await this.resolveEpochScoped(params.epochId);
    // POOL_LOCKED_AT_REVIEW: reject pool component inserts after closeIngestion
    if (epoch.status !== "open") {
      throw new EpochNotOpenError(params.epochId.toString());
    }
    const [row] = await this.db
      .insert(epochPoolComponents)
      .values({
        nodeId: params.nodeId,
        epochId: params.epochId,
        componentId: params.componentId,
        algorithmVersion: params.algorithmVersion,
        inputsJson: params.inputsJson,
        amountCredits: params.amountCredits,
        evidenceRef: params.evidenceRef ?? null,
      })
      .returning();
    if (!row) throw new Error("insertPoolComponent: INSERT returned no rows");
    return toPoolComponent(row);
  }

  async getPoolComponentsForEpoch(
    epochId: bigint
  ): Promise<LedgerPoolComponent[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select()
      .from(epochPoolComponents)
      .where(eq(epochPoolComponents.epochId, epochId));
    return rows.map(toPoolComponent);
  }

  // ── Payout statements ──────────────────────────────────────

  async insertPayoutStatement(
    params: InsertPayoutStatementParams
  ): Promise<LedgerPayoutStatement> {
    await this.resolveEpochScoped(params.epochId);
    const [row] = await this.db
      .insert(payoutStatements)
      .values({
        nodeId: params.nodeId,
        epochId: params.epochId,
        allocationSetHash: params.allocationSetHash,
        poolTotalCredits: params.poolTotalCredits,
        payoutsJson: params.payoutsJson,
        supersedesStatementId: params.supersedesStatementId ?? null,
      })
      .returning();
    if (!row) throw new Error("insertPayoutStatement: INSERT returned no rows");
    return toStatement(row);
  }

  async getStatementForEpoch(
    epochId: bigint
  ): Promise<LedgerPayoutStatement | null> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select()
      .from(payoutStatements)
      .where(eq(payoutStatements.epochId, epochId))
      .limit(1);
    return rows[0] ? toStatement(rows[0]) : null;
  }

  // ── Atomic finalize ────────────────────────────────────────

  async finalizeEpochAtomic(params: {
    epochId: bigint;
    poolTotal: bigint;
    statement: Omit<InsertPayoutStatementParams, "epochId">;
    signature: Omit<InsertSignatureParams, "statementId">;
    expectedAllocationSetHash: string;
  }): Promise<{ epoch: LedgerEpoch; statement: LedgerPayoutStatement }> {
    return await this.db.transaction(async (tx) => {
      // 1. Load epoch with scope gate (inline — avoid separate connection)
      const epochRows = await tx
        .select()
        .from(epochs)
        .where(
          and(eq(epochs.id, params.epochId), eq(epochs.scopeId, this.scopeId))
        )
        .limit(1);
      if (!epochRows[0]) {
        throw new EpochNotFoundError(params.epochId.toString());
      }

      const epochRow = epochRows[0];
      const status = epochRow.status as string;

      if (status === "open") {
        throw new EpochNotOpenError(params.epochId.toString());
      }

      let finalEpochRow: typeof epochs.$inferSelect;

      if (status === "review") {
        // 2a. Transition review → finalized (re-check status in WHERE for concurrency guard)
        const [updated] = await tx
          .update(epochs)
          .set({
            status: "finalized",
            poolTotalCredits: params.poolTotal,
            closedAt: new Date(),
          })
          .where(
            and(
              eq(epochs.id, params.epochId),
              eq(epochs.scopeId, this.scopeId),
              eq(epochs.status, "review")
            )
          )
          .returning();

        if (!updated) {
          // Concurrent finalize won — reload
          const [reloaded] = await tx
            .select()
            .from(epochs)
            .where(
              and(
                eq(epochs.id, params.epochId),
                eq(epochs.scopeId, this.scopeId)
              )
            )
            .limit(1);
          if (!reloaded || reloaded.status !== "finalized") {
            throw new Error(
              `finalizeEpochAtomic: concurrent state change for epoch ${params.epochId.toString()}`
            );
          }
          finalEpochRow = reloaded;
        } else {
          finalEpochRow = updated;
        }
      } else if (status === "finalized") {
        finalEpochRow = epochRow;
      } else {
        throw new Error(
          `finalizeEpochAtomic: unexpected epoch status '${status}'`
        );
      }

      // 2b/3a. Upsert statement — ON CONFLICT (node_id, epoch_id) DO NOTHING
      await tx
        .insert(payoutStatements)
        .values({
          nodeId: params.statement.nodeId,
          epochId: params.epochId,
          allocationSetHash: params.statement.allocationSetHash,
          poolTotalCredits: params.statement.poolTotalCredits,
          payoutsJson: params.statement.payoutsJson,
          supersedesStatementId: params.statement.supersedesStatementId ?? null,
        })
        .onConflictDoNothing({
          target: [payoutStatements.nodeId, payoutStatements.epochId],
        });

      // Fetch the statement (either just inserted or previously existing)
      const [stmtRow] = await tx
        .select()
        .from(payoutStatements)
        .where(
          and(
            eq(payoutStatements.nodeId, params.statement.nodeId),
            eq(payoutStatements.epochId, params.epochId)
          )
        )
        .limit(1);

      if (!stmtRow) {
        throw new Error(
          `finalizeEpochAtomic: statement insert/select failed for epoch ${params.epochId.toString()}`
        );
      }

      // Hash assertion — if statement pre-existed, verify hash matches
      if (stmtRow.allocationSetHash !== params.expectedAllocationSetHash) {
        throw new Error(
          `finalizeEpochAtomic: allocationSetHash mismatch — expected ${params.expectedAllocationSetHash}, found ${stmtRow.allocationSetHash}`
        );
      }

      // 2d/3b. Upsert signature — ON CONFLICT (statement_id, signer_wallet) DO NOTHING
      await tx
        .insert(statementSignatures)
        .values({
          nodeId: params.signature.nodeId,
          statementId: stmtRow.id,
          signerWallet: params.signature.signerWallet,
          signature: params.signature.signature,
          signedAt: params.signature.signedAt,
        })
        .onConflictDoNothing({
          target: [
            statementSignatures.statementId,
            statementSignatures.signerWallet,
          ],
        });

      // 2e/3c. Verify signature — if row exists with DIFFERENT signature text, throw
      const [sigRow] = await tx
        .select()
        .from(statementSignatures)
        .where(
          and(
            eq(statementSignatures.statementId, stmtRow.id),
            eq(statementSignatures.signerWallet, params.signature.signerWallet)
          )
        )
        .limit(1);

      if (sigRow && sigRow.signature !== params.signature.signature) {
        throw new Error(
          `finalizeEpochAtomic: signature divergence — signer ${params.signature.signerWallet} has different signature on statement ${stmtRow.id}`
        );
      }

      return {
        epoch: toEpoch(finalEpochRow),
        statement: toStatement(stmtRow),
      };
    });
  }

  // ── Statement signatures ───────────────────────────────────

  async insertStatementSignature(params: InsertSignatureParams): Promise<void> {
    await this.db
      .insert(statementSignatures)
      .values({
        nodeId: params.nodeId,
        statementId: params.statementId,
        signerWallet: params.signerWallet,
        signature: params.signature,
        signedAt: params.signedAt,
      })
      .onConflictDoNothing({
        target: [
          statementSignatures.statementId,
          statementSignatures.signerWallet,
        ],
      });
  }

  async getSignaturesForStatement(
    statementId: string
  ): Promise<LedgerStatementSignature[]> {
    const rows = await this.db
      .select()
      .from(statementSignatures)
      .where(eq(statementSignatures.statementId, statementId));
    return rows.map(toSignature);
  }

  // ── Identity resolution ───────────────────────────────────────

  async resolveIdentities(
    provider: "github",
    externalIds: string[]
  ): Promise<Map<string, string>> {
    if (externalIds.length === 0) return new Map();
    const uniqueIds = [...new Set(externalIds)];
    const rows = await this.db
      .select({
        externalId: userBindings.externalId,
        userId: userBindings.userId,
      })
      .from(userBindings)
      .where(
        and(
          eq(userBindings.provider, provider),
          inArray(userBindings.externalId, uniqueIds)
        )
      );
    return new Map(rows.map((r) => [r.externalId, r.userId]));
  }

  async getUncuratedEvents(
    nodeId: string,
    epochId: bigint,
    periodStart: Date,
    periodEnd: Date
  ): Promise<UncuratedEvent[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select({
        event: activityEvents,
        curationId: activityCuration.id,
      })
      .from(activityEvents)
      .leftJoin(
        activityCuration,
        and(
          eq(activityCuration.epochId, epochId),
          eq(activityCuration.eventId, activityEvents.id)
        )
      )
      .where(
        and(
          eq(activityEvents.nodeId, nodeId),
          gte(activityEvents.eventTime, periodStart),
          lte(activityEvents.eventTime, periodEnd),
          or(
            isNull(activityCuration.id), // no curation row
            isNull(activityCuration.userId) // curation exists but unresolved
          )
        )
      )
      .orderBy(activityEvents.eventTime);
    return rows.map((r) => ({
      event: toActivityEvent(r.event),
      hasExistingCuration: r.curationId !== null,
    }));
  }

  async updateCurationUserId(
    epochId: bigint,
    eventId: string,
    userId: string
  ): Promise<void> {
    await this.resolveEpochScoped(epochId);
    await this.db
      .update(activityCuration)
      .set({ userId, updatedAt: new Date() })
      .where(
        and(
          eq(activityCuration.epochId, epochId),
          eq(activityCuration.eventId, eventId),
          isNull(activityCuration.userId)
        )
      );
  }
}
