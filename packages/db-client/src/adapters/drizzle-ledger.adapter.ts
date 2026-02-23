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
 * - CURATION_FREEZE_ON_CLOSE: DB trigger enforces; adapter does not duplicate check.
 * - ONE_OPEN_EPOCH: DB constraint enforces; adapter lets DB error propagate.
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
  type EpochStatus,
} from "@cogni/ledger-core";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
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

  async closeEpoch(epochId: bigint, poolTotal: bigint): Promise<LedgerEpoch> {
    const [row] = await this.db
      .update(epochs)
      .set({
        status: "closed",
        poolTotalCredits: poolTotal,
        closedAt: new Date(),
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
      // Distinguish not-found/wrong-scope from already-closed for EPOCH_CLOSE_IDEMPOTENT
      const existing = await this.getEpoch(epochId);
      if (!existing) {
        throw new EpochNotFoundError(epochId.toString());
      }
      // Already closed — return as-is (caller implements EPOCH_CLOSE_IDEMPOTENT)
      return existing;
    }
    return toEpoch(row);
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
    await this.resolveEpochScoped(params.epochId);
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

  // ── Statement signatures ───────────────────────────────────

  async insertStatementSignature(params: InsertSignatureParams): Promise<void> {
    await this.db.insert(statementSignatures).values({
      nodeId: params.nodeId,
      statementId: params.statementId,
      signerWallet: params.signerWallet,
      signature: params.signature,
      signedAt: params.signedAt,
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
