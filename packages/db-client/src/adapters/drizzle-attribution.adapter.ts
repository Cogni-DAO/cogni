// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-client/adapters/drizzle-attribution`
 * Purpose: Drizzle ORM implementation of AttributionStore port.
 * Scope: Single adapter shared by app (via container.ts) and scheduler-worker. Implements all AttributionStore methods including identity resolution via user_bindings (cross-domain). Does not contain domain logic or define port interfaces.
 * Invariants:
 * - Uses serviceDb (BYPASSRLS) — no RLS in V0.
 * - SCOPE_GATED_QUERIES: Every epochId-based method enforces scope_id = this.scopeId. Scope mismatches throw EpochNotFoundError.
 * - RECEIPT_SCOPE_AGNOSTIC: ingestion_receipts has no scope_id — scope assigned at selection via epoch membership.
 * - SELECTION_AUTO_POPULATE: insertSelectionDoNothing uses onConflictDoNothing; updateSelectionUserId only sets userId where NULL.
 * - SELECTION_FREEZE_ON_FINALIZE: DB trigger enforces; adapter does not duplicate check.
 * - ONE_OPEN_EPOCH: DB constraint enforces; adapter lets DB error propagate.
 * - ALLOCATION_PRESERVES_OVERRIDES: upsertAllocations updates proposed_units/activity_count only; never touches final_units.
 * - POOL_LOCKED_AT_REVIEW: insertPoolComponent rejects inserts when epoch status != 'open'.
 * - CONFIG_LOCKED_AT_REVIEW: closeIngestion pins allocationAlgoRef + weightConfigHash.
 * - EVALUATION_FINAL_ATOMIC: closeIngestionWithEvaluations inserts locked evaluations + sets artifacts_hash + transitions epoch in one transaction.
 * - STATEMENT_ITEMS_BOUNDARY_CLONE: toStatementItemsJson converts readonly AttributionStatementItem[] to mutable Drizzle-compatible JSONB at the adapter boundary.
 * Side-effects: IO (database operations)
 * Links: docs/spec/attribution-ledger.md, packages/attribution-ledger/src/store.ts
 * @public
 */

import type {
  AttributionAllocation,
  AttributionEpoch,
  AttributionEvaluation,
  AttributionPoolComponent,
  AttributionSelection,
  AttributionStatement,
  AttributionStatementItem,
  AttributionStatementSignature,
  AttributionStore,
  CloseIngestionWithEvaluationsParams,
  IngestionCursor,
  IngestionReceipt,
  InsertAllocationParams,
  InsertPoolComponentParams,
  InsertReceiptParams,
  InsertSelectionAutoParams,
  InsertSignatureParams,
  InsertStatementParams,
  SelectedReceiptForAllocation,
  SelectedReceiptForAttribution,
  SelectedReceiptWithMetadata,
  SubjectOverrideRecord,
  UnselectedReceipt,
  UpsertEvaluationParams,
  UpsertSelectionParams,
  UpsertSubjectOverrideParams,
} from "@cogni/attribution-ledger";
import {
  EpochNotFoundError,
  EpochNotInReviewError,
  EpochNotOpenError,
  type EpochStatus,
} from "@cogni/attribution-ledger";
import {
  epochAllocations,
  epochEvaluations,
  epochPoolComponents,
  epochSelection,
  epochStatementSignatures,
  epochStatements,
  epochSubjectOverrides,
  epochs,
  ingestionCursors,
  ingestionReceipts,
} from "@cogni/db-schema/attribution";
import { userBindings } from "@cogni/db-schema/identity";
import { userProfiles } from "@cogni/db-schema/profile";
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

function toEpoch(row: typeof epochs.$inferSelect): AttributionEpoch {
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
    artifactsHash: row.artifactsHash,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
  };
}

function toIngestionReceipt(
  row: typeof ingestionReceipts.$inferSelect
): IngestionReceipt {
  return {
    receiptId: row.receiptId,
    nodeId: row.nodeId,
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

function toSelection(
  row: typeof epochSelection.$inferSelect
): AttributionSelection {
  return {
    id: row.id,
    nodeId: row.nodeId,
    epochId: row.epochId,
    receiptId: row.receiptId,
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
): AttributionAllocation {
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

function toCursor(row: typeof ingestionCursors.$inferSelect): IngestionCursor {
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
): AttributionPoolComponent {
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
  row: typeof epochStatements.$inferSelect
): AttributionStatement {
  return {
    id: row.id,
    nodeId: row.nodeId,
    epochId: row.epochId,
    allocationSetHash: row.allocationSetHash,
    poolTotalCredits: row.poolTotalCredits,
    statementItems: row.statementItemsJson,
    reviewOverridesJson: row.reviewOverridesJson ?? null,
    supersedesStatementId: row.supersedesStatementId,
    createdAt: row.createdAt,
  };
}

function toSubjectOverride(
  row: typeof epochSubjectOverrides.$inferSelect
): SubjectOverrideRecord {
  return {
    id: row.id,
    nodeId: row.nodeId,
    epochId: row.epochId,
    subjectRef: row.subjectRef,
    overrideUnits: row.overrideUnits,
    overrideSharesJson: row.overrideSharesJson ?? null,
    overrideReason: row.overrideReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type EpochStatementItemsJson = NonNullable<
  typeof epochStatements.$inferInsert.statementItemsJson
>;
type EpochStatementItemJson = EpochStatementItemsJson[number];

function toStatementItemsJson(
  items: readonly AttributionStatementItem[]
): EpochStatementItemsJson {
  return items.map(
    (item): EpochStatementItemJson => ({
      user_id: item.user_id,
      total_units: item.total_units,
      share: item.share,
      amount_credits: item.amount_credits,
      claimant_key: item.claimant_key,
      claimant: item.claimant
        ? item.claimant.kind === "user"
          ? {
              kind: "user",
              userId: item.claimant.userId,
            }
          : {
              kind: "identity",
              provider: item.claimant.provider,
              externalId: item.claimant.externalId,
              providerLogin: item.claimant.providerLogin,
            }
        : undefined,
      // Clone nested arrays at the adapter boundary so core statement items stay
      // readonly while Drizzle receives mutable JSON-compatible values.
      receipt_ids: item.receipt_ids ? [...item.receipt_ids] : undefined,
    })
  );
}

type EpochReviewOverridesJson = NonNullable<
  typeof epochStatements.$inferInsert.reviewOverridesJson
>;

/**
 * STATEMENT_ITEMS_BOUNDARY_CLONE: strips readonly from ReviewOverrideSnapshot[]
 * so Drizzle's mutable JSONB types are satisfied.
 */
function toReviewOverridesJson(
  snapshots: readonly import("@cogni/attribution-ledger").ReviewOverrideSnapshot[]
): EpochReviewOverridesJson {
  return snapshots.map((s) => ({
    subject_ref: s.subject_ref,
    original_units: s.original_units,
    override_units: s.override_units,
    original_shares: s.original_shares.map((cs) => ({
      claimant:
        cs.claimant.kind === "user"
          ? { kind: "user" as const, userId: cs.claimant.userId }
          : {
              kind: "identity" as const,
              provider: cs.claimant.provider,
              externalId: cs.claimant.externalId,
              providerLogin: cs.claimant.providerLogin,
            },
      sharePpm: cs.sharePpm,
    })),
    override_shares: s.override_shares
      ? s.override_shares.map((cs) => ({
          claimant:
            cs.claimant.kind === "user"
              ? { kind: "user" as const, userId: cs.claimant.userId }
              : {
                  kind: "identity" as const,
                  provider: cs.claimant.provider,
                  externalId: cs.claimant.externalId,
                  providerLogin: cs.claimant.providerLogin,
                },
          sharePpm: cs.sharePpm,
        }))
      : null,
    reason: s.reason,
  }));
}

function toStatementSignature(
  row: typeof epochStatementSignatures.$inferSelect
): AttributionStatementSignature {
  return {
    id: row.id,
    nodeId: row.nodeId,
    statementId: row.statementId,
    signerWallet: row.signerWallet,
    signature: row.signature,
    signedAt: row.signedAt,
  };
}

function toEvaluation(
  row: typeof epochEvaluations.$inferSelect
): AttributionEvaluation {
  return {
    id: row.id,
    nodeId: row.nodeId,
    epochId: row.epochId,
    evaluationRef: row.evaluationRef,
    status: row.status as "draft" | "locked",
    algoRef: row.algoRef,
    inputsHash: row.inputsHash,
    payloadHash: row.payloadHash,
    payloadJson: row.payloadJson,
    payloadRef: row.payloadRef,
    createdAt: row.createdAt,
  };
}

// ── Adapter ─────────────────────────────────────────────────────

export class DrizzleAttributionAdapter implements AttributionStore {
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
  private async resolveEpochScoped(epochId: bigint): Promise<AttributionEpoch> {
    const rows = await this.db
      .select()
      .from(epochs)
      .where(and(eq(epochs.id, epochId), eq(epochs.scopeId, this.scopeId)))
      .limit(1);
    if (!rows[0]) throw new EpochNotFoundError(epochId.toString());
    return toEpoch(rows[0]);
  }

  /**
   * Like resolveEpochScoped but acquires a row-level lock (SELECT ... FOR UPDATE).
   * Use for write operations that must serialize against concurrent finalization.
   */
  private async resolveEpochScopedForUpdate(
    epochId: bigint
  ): Promise<AttributionEpoch> {
    const rows = await this.db
      .select()
      .from(epochs)
      .where(and(eq(epochs.id, epochId), eq(epochs.scopeId, this.scopeId)))
      .limit(1)
      .for("update");
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
  }): Promise<AttributionEpoch> {
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
  ): Promise<AttributionEpoch | null> {
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
  ): Promise<AttributionEpoch | null> {
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

  async getEpoch(id: bigint): Promise<AttributionEpoch | null> {
    const rows = await this.db
      .select()
      .from(epochs)
      .where(and(eq(epochs.id, id), eq(epochs.scopeId, this.scopeId)))
      .limit(1);
    return rows[0] ? toEpoch(rows[0]) : null;
  }

  async listEpochs(nodeId: string): Promise<AttributionEpoch[]> {
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
  ): Promise<AttributionEpoch> {
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
  ): Promise<AttributionEpoch> {
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

  // ── Evaluations ──────────────────────────────────────────────

  async closeIngestionWithEvaluations(
    params: CloseIngestionWithEvaluationsParams
  ): Promise<AttributionEpoch> {
    return await this.db.transaction(async (tx) => {
      // 1. Scope gate + status check (inline)
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
      if (epochRows[0].status !== "open") {
        // Idempotent: already in review/finalized → return as-is
        if (
          epochRows[0].status === "review" ||
          epochRows[0].status === "finalized"
        ) {
          return toEpoch(epochRows[0]);
        }
        throw new EpochNotOpenError(params.epochId.toString());
      }

      // 2. Insert locked evaluations
      for (const evaluation of params.evaluations) {
        await tx
          .insert(epochEvaluations)
          .values({
            nodeId: evaluation.nodeId,
            epochId: evaluation.epochId,
            evaluationRef: evaluation.evaluationRef,
            status: "locked",
            algoRef: evaluation.algoRef,
            inputsHash: evaluation.inputsHash,
            payloadHash: evaluation.payloadHash,
            payloadJson: evaluation.payloadJson,
          })
          .onConflictDoNothing({
            target: [
              epochEvaluations.epochId,
              epochEvaluations.evaluationRef,
              epochEvaluations.status,
            ],
          });
      }

      // 3. Transition epoch open → review with config pins + artifacts_hash
      const [updated] = await tx
        .update(epochs)
        .set({
          status: "review",
          approverSetHash: params.approverSetHash,
          allocationAlgoRef: params.allocationAlgoRef,
          weightConfigHash: params.weightConfigHash,
          artifactsHash: params.artifactsHash,
        })
        .where(
          and(
            eq(epochs.id, params.epochId),
            eq(epochs.scopeId, this.scopeId),
            eq(epochs.status, "open")
          )
        )
        .returning();

      if (!updated) {
        // Concurrent close won — reload and return
        const [reloaded] = await tx
          .select()
          .from(epochs)
          .where(
            and(eq(epochs.id, params.epochId), eq(epochs.scopeId, this.scopeId))
          )
          .limit(1);
        if (!reloaded) {
          throw new EpochNotFoundError(params.epochId.toString());
        }
        return toEpoch(reloaded);
      }

      return toEpoch(updated);
    });
  }

  async upsertDraftEvaluation(params: UpsertEvaluationParams): Promise<void> {
    await this.resolveEpochScoped(params.epochId);
    await this.db
      .insert(epochEvaluations)
      .values({
        nodeId: params.nodeId,
        epochId: params.epochId,
        evaluationRef: params.evaluationRef,
        status: "draft",
        algoRef: params.algoRef,
        inputsHash: params.inputsHash,
        payloadHash: params.payloadHash,
        payloadJson: params.payloadJson,
      })
      .onConflictDoUpdate({
        target: [
          epochEvaluations.epochId,
          epochEvaluations.evaluationRef,
          epochEvaluations.status,
        ],
        set: {
          algoRef: params.algoRef,
          inputsHash: params.inputsHash,
          payloadHash: params.payloadHash,
          payloadJson: params.payloadJson,
          createdAt: new Date(),
        },
      });
  }

  async getEvaluationsForEpoch(
    epochId: bigint,
    status?: "draft" | "locked"
  ): Promise<AttributionEvaluation[]> {
    await this.resolveEpochScoped(epochId);
    const conditions = [eq(epochEvaluations.epochId, epochId)];
    if (status) conditions.push(eq(epochEvaluations.status, status));
    const rows = await this.db
      .select()
      .from(epochEvaluations)
      .where(and(...conditions));
    return rows.map(toEvaluation);
  }

  async getEvaluation(
    epochId: bigint,
    evaluationRef: string,
    status?: "draft" | "locked"
  ): Promise<AttributionEvaluation | null> {
    await this.resolveEpochScoped(epochId);
    const conditions = [
      eq(epochEvaluations.epochId, epochId),
      eq(epochEvaluations.evaluationRef, evaluationRef),
    ];
    if (status) conditions.push(eq(epochEvaluations.status, status));
    const rows = await this.db
      .select()
      .from(epochEvaluations)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ? toEvaluation(rows[0]) : null;
  }

  async getSelectedReceiptsWithMetadata(
    epochId: bigint
  ): Promise<SelectedReceiptWithMetadata[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select({
        receiptId: epochSelection.receiptId,
        userId: epochSelection.userId,
        source: ingestionReceipts.source,
        eventType: ingestionReceipts.eventType,
        included: epochSelection.included,
        weightOverrideMilli: epochSelection.weightOverrideMilli,
        metadata: ingestionReceipts.metadata,
        payloadHash: ingestionReceipts.payloadHash,
      })
      .from(epochSelection)
      .innerJoin(
        ingestionReceipts,
        and(
          eq(ingestionReceipts.receiptId, epochSelection.receiptId),
          eq(ingestionReceipts.nodeId, epochSelection.nodeId)
        )
      )
      .where(
        and(
          eq(epochSelection.epochId, epochId),
          isNotNull(epochSelection.userId)
        )
      );
    return rows.map((r) => ({
      receiptId: r.receiptId,
      userId: r.userId as string,
      source: r.source,
      eventType: r.eventType,
      included: r.included,
      weightOverrideMilli: r.weightOverrideMilli,
      metadata: r.metadata,
      payloadHash: r.payloadHash,
    }));
  }

  async getSelectedReceiptsForAttribution(
    epochId: bigint
  ): Promise<SelectedReceiptForAttribution[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select({
        receiptId: epochSelection.receiptId,
        userId: epochSelection.userId,
        source: ingestionReceipts.source,
        eventType: ingestionReceipts.eventType,
        included: epochSelection.included,
        weightOverrideMilli: epochSelection.weightOverrideMilli,
        platformUserId: ingestionReceipts.platformUserId,
        platformLogin: ingestionReceipts.platformLogin,
        artifactUrl: ingestionReceipts.artifactUrl,
        eventTime: ingestionReceipts.eventTime,
        payloadHash: ingestionReceipts.payloadHash,
      })
      .from(epochSelection)
      .innerJoin(
        ingestionReceipts,
        and(
          eq(ingestionReceipts.receiptId, epochSelection.receiptId),
          eq(ingestionReceipts.nodeId, epochSelection.nodeId)
        )
      )
      .where(eq(epochSelection.epochId, epochId));

    return rows.map((r) => ({
      receiptId: r.receiptId,
      userId: r.userId,
      source: r.source,
      eventType: r.eventType,
      included: r.included,
      weightOverrideMilli: r.weightOverrideMilli,
      platformUserId: r.platformUserId,
      platformLogin: r.platformLogin,
      artifactUrl: r.artifactUrl,
      eventTime: r.eventTime,
      payloadHash: r.payloadHash,
    }));
  }

  // ── Allocation computation ──────────────────────────────────

  async getSelectedReceiptsForAllocation(
    epochId: bigint
  ): Promise<SelectedReceiptForAllocation[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select({
        receiptId: epochSelection.receiptId,
        userId: epochSelection.userId,
        source: ingestionReceipts.source,
        eventType: ingestionReceipts.eventType,
        included: epochSelection.included,
        weightOverrideMilli: epochSelection.weightOverrideMilli,
      })
      .from(epochSelection)
      .innerJoin(
        ingestionReceipts,
        and(
          eq(ingestionReceipts.receiptId, epochSelection.receiptId),
          eq(ingestionReceipts.nodeId, epochSelection.nodeId)
        )
      )
      .where(
        and(
          eq(epochSelection.epochId, epochId),
          isNotNull(epochSelection.userId)
        )
      );
    return rows.map((r) => ({
      receiptId: r.receiptId,
      // Safe: WHERE clause filters to userId IS NOT NULL
      userId: r.userId as string,
      source: r.source,
      eventType: r.eventType,
      included: r.included,
      weightOverrideMilli: r.weightOverrideMilli,
    }));
  }

  // ── Ingestion receipts ─────────────────────────────────────

  async insertIngestionReceipts(
    receipts: InsertReceiptParams[]
  ): Promise<void> {
    if (receipts.length === 0) return;
    await this.db
      .insert(ingestionReceipts)
      .values(
        receipts.map((e) => ({
          nodeId: e.nodeId,
          receiptId: e.receiptId,
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

  async getReceiptsForWindow(
    nodeId: string,
    since: Date,
    until: Date
  ): Promise<IngestionReceipt[]> {
    // RECEIPT_SCOPE_AGNOSTIC: no scope filter — returns all receipts for node in window
    const rows = await this.db
      .select()
      .from(ingestionReceipts)
      .where(
        and(
          eq(ingestionReceipts.nodeId, nodeId),
          gte(ingestionReceipts.eventTime, since),
          lte(ingestionReceipts.eventTime, until)
        )
      )
      .orderBy(ingestionReceipts.eventTime);
    return rows.map(toIngestionReceipt);
  }

  // ── Selection ────────────────────────────────────────────────

  async upsertSelection(params: UpsertSelectionParams[]): Promise<void> {
    if (params.length === 0) return;
    await this.validateEpochIds(params.map((p) => p.epochId));
    for (const p of params) {
      await this.db
        .insert(epochSelection)
        .values({
          nodeId: p.nodeId,
          epochId: p.epochId,
          receiptId: p.receiptId,
          userId: p.userId ?? null,
          included: p.included ?? true,
          weightOverrideMilli: p.weightOverrideMilli ?? null,
          note: p.note ?? null,
        })
        .onConflictDoUpdate({
          target: [epochSelection.epochId, epochSelection.receiptId],
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

  async insertSelectionDoNothing(
    params: InsertSelectionAutoParams[]
  ): Promise<void> {
    if (params.length === 0) return;
    await this.validateEpochIds(params.map((p) => p.epochId));
    for (const p of params) {
      await this.db
        .insert(epochSelection)
        .values({
          nodeId: p.nodeId,
          epochId: p.epochId,
          receiptId: p.receiptId,
          userId: p.userId ?? null,
          included: p.included,
        })
        .onConflictDoNothing({
          target: [epochSelection.epochId, epochSelection.receiptId],
        });
    }
  }

  async getSelectionForEpoch(epochId: bigint): Promise<AttributionSelection[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select()
      .from(epochSelection)
      .where(eq(epochSelection.epochId, epochId));
    return rows.map(toSelection);
  }

  async getUnresolvedSelection(
    epochId: bigint
  ): Promise<AttributionSelection[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select()
      .from(epochSelection)
      .where(
        and(eq(epochSelection.epochId, epochId), isNull(epochSelection.userId))
      );
    return rows.map(toSelection);
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

  async getAllocationsForEpoch(
    epochId: bigint
  ): Promise<AttributionAllocation[]> {
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
      .insert(ingestionCursors)
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
          ingestionCursors.nodeId,
          ingestionCursors.scopeId,
          ingestionCursors.source,
          ingestionCursors.stream,
          ingestionCursors.sourceRef,
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
  ): Promise<IngestionCursor | null> {
    const rows = await this.db
      .select()
      .from(ingestionCursors)
      .where(
        and(
          eq(ingestionCursors.nodeId, nodeId),
          eq(ingestionCursors.scopeId, scopeId),
          eq(ingestionCursors.source, source),
          eq(ingestionCursors.stream, stream),
          eq(ingestionCursors.sourceRef, sourceRef)
        )
      )
      .limit(1);
    return rows[0] ? toCursor(rows[0]) : null;
  }

  // ── Pool components ─────────────────────────────────────────

  async insertPoolComponent(
    params: InsertPoolComponentParams
  ): Promise<AttributionPoolComponent> {
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
  ): Promise<AttributionPoolComponent[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select()
      .from(epochPoolComponents)
      .where(eq(epochPoolComponents.epochId, epochId));
    return rows.map(toPoolComponent);
  }

  // ── Epoch statements ──────────────────────────────────────

  async insertEpochStatement(
    params: InsertStatementParams
  ): Promise<AttributionStatement> {
    await this.resolveEpochScoped(params.epochId);
    const [row] = await this.db
      .insert(epochStatements)
      .values({
        nodeId: params.nodeId,
        epochId: params.epochId,
        allocationSetHash: params.allocationSetHash,
        poolTotalCredits: params.poolTotalCredits,
        statementItemsJson: toStatementItemsJson(params.statementItems),
        reviewOverridesJson: params.reviewOverridesJson
          ? toReviewOverridesJson(params.reviewOverridesJson)
          : null,
        supersedesStatementId: params.supersedesStatementId ?? null,
      })
      .returning();
    if (!row) throw new Error("insertEpochStatement: INSERT returned no rows");
    return toStatement(row);
  }

  async getStatementForEpoch(
    epochId: bigint
  ): Promise<AttributionStatement | null> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select()
      .from(epochStatements)
      .where(eq(epochStatements.epochId, epochId))
      .limit(1);
    return rows[0] ? toStatement(rows[0]) : null;
  }

  // ── Atomic finalize ────────────────────────────────────────

  async finalizeEpochAtomic(params: {
    epochId: bigint;
    poolTotal: bigint;
    statement: Omit<InsertStatementParams, "epochId">;
    signature: Omit<InsertSignatureParams, "statementId">;
    expectedAllocationSetHash: string;
  }): Promise<{ epoch: AttributionEpoch; statement: AttributionStatement }> {
    return await this.db.transaction(async (tx) => {
      // 1. Load epoch with scope gate + row lock (prevents concurrent override writes)
      const epochRows = await tx
        .select()
        .from(epochs)
        .where(
          and(eq(epochs.id, params.epochId), eq(epochs.scopeId, this.scopeId))
        )
        .limit(1)
        .for("update");
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
        .insert(epochStatements)
        .values({
          nodeId: params.statement.nodeId,
          epochId: params.epochId,
          allocationSetHash: params.statement.allocationSetHash,
          poolTotalCredits: params.statement.poolTotalCredits,
          statementItemsJson: toStatementItemsJson(
            params.statement.statementItems
          ),
          reviewOverridesJson: params.statement.reviewOverridesJson
            ? toReviewOverridesJson(params.statement.reviewOverridesJson)
            : null,
          supersedesStatementId: params.statement.supersedesStatementId ?? null,
        })
        .onConflictDoNothing({
          target: [epochStatements.nodeId, epochStatements.epochId],
        });

      // Fetch the statement (either just inserted or previously existing)
      const [statementRow] = await tx
        .select()
        .from(epochStatements)
        .where(
          and(
            eq(epochStatements.nodeId, params.statement.nodeId),
            eq(epochStatements.epochId, params.epochId)
          )
        )
        .limit(1);

      if (!statementRow) {
        throw new Error(
          `finalizeEpochAtomic: statement insert/select failed for epoch ${params.epochId.toString()}`
        );
      }

      // Hash assertion — if statement pre-existed, verify hash matches
      if (statementRow.allocationSetHash !== params.expectedAllocationSetHash) {
        throw new Error(
          `finalizeEpochAtomic: allocationSetHash mismatch — expected ${params.expectedAllocationSetHash}, found ${statementRow.allocationSetHash}`
        );
      }

      // 2d/3b. Upsert signature — ON CONFLICT (statement_id, signer_wallet) DO NOTHING
      await tx
        .insert(epochStatementSignatures)
        .values({
          nodeId: params.signature.nodeId,
          statementId: statementRow.id,
          signerWallet: params.signature.signerWallet,
          signature: params.signature.signature,
          signedAt: params.signature.signedAt,
        })
        .onConflictDoNothing({
          target: [
            epochStatementSignatures.statementId,
            epochStatementSignatures.signerWallet,
          ],
        });

      // 2e/3c. Verify signature — if row exists with DIFFERENT signature text, throw
      const [sigRow] = await tx
        .select()
        .from(epochStatementSignatures)
        .where(
          and(
            eq(epochStatementSignatures.statementId, statementRow.id),
            eq(
              epochStatementSignatures.signerWallet,
              params.signature.signerWallet
            )
          )
        )
        .limit(1);

      if (sigRow && sigRow.signature !== params.signature.signature) {
        throw new Error(
          `finalizeEpochAtomic: signature divergence — signer ${params.signature.signerWallet} has different signature on statement ${statementRow.id}`
        );
      }

      return {
        epoch: toEpoch(finalEpochRow),
        statement: toStatement(statementRow),
      };
    });
  }

  // ── Statement signatures ───────────────────────────────────

  async insertStatementSignature(params: InsertSignatureParams): Promise<void> {
    await this.db
      .insert(epochStatementSignatures)
      .values({
        nodeId: params.nodeId,
        statementId: params.statementId,
        signerWallet: params.signerWallet,
        signature: params.signature,
        signedAt: params.signedAt,
      })
      .onConflictDoNothing({
        target: [
          epochStatementSignatures.statementId,
          epochStatementSignatures.signerWallet,
        ],
      });
  }

  async getSignaturesForStatement(
    statementId: string
  ): Promise<AttributionStatementSignature[]> {
    const rows = await this.db
      .select()
      .from(epochStatementSignatures)
      .where(eq(epochStatementSignatures.statementId, statementId));
    return rows.map(toStatementSignature);
  }

  // ── Subject overrides ────────────────────────────────────────

  async upsertSubjectOverride(
    params: UpsertSubjectOverrideParams
  ): Promise<SubjectOverrideRecord> {
    const epoch = await this.resolveEpochScopedForUpdate(params.epochId);
    if (epoch.status !== "review") {
      throw new EpochNotInReviewError(params.epochId.toString(), epoch.status);
    }

    const now = new Date();
    const [row] = await this.db
      .insert(epochSubjectOverrides)
      .values({
        nodeId: params.nodeId,
        epochId: params.epochId,
        subjectRef: params.subjectRef,
        overrideUnits: params.overrideUnits ?? null,
        overrideSharesJson: params.overrideSharesJson ?? null,
        overrideReason: params.overrideReason ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          epochSubjectOverrides.epochId,
          epochSubjectOverrides.subjectRef,
        ],
        set: {
          overrideUnits: params.overrideUnits ?? null,
          overrideSharesJson: params.overrideSharesJson ?? null,
          overrideReason: params.overrideReason ?? null,
          updatedAt: now,
        },
      })
      .returning();
    if (!row)
      throw new Error("upsertSubjectOverride: INSERT/UPDATE returned no rows");
    return toSubjectOverride(row);
  }

  async deleteSubjectOverride(
    epochId: bigint,
    subjectRef: string
  ): Promise<void> {
    const epoch = await this.resolveEpochScopedForUpdate(epochId);
    if (epoch.status !== "review") {
      throw new EpochNotInReviewError(epochId.toString(), epoch.status);
    }
    await this.db
      .delete(epochSubjectOverrides)
      .where(
        and(
          eq(epochSubjectOverrides.epochId, epochId),
          eq(epochSubjectOverrides.subjectRef, subjectRef)
        )
      );
  }

  async getSubjectOverridesForEpoch(
    epochId: bigint
  ): Promise<SubjectOverrideRecord[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select()
      .from(epochSubjectOverrides)
      .where(eq(epochSubjectOverrides.epochId, epochId))
      .orderBy(epochSubjectOverrides.subjectRef);
    return rows.map(toSubjectOverride);
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

  async getUserDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const uniqueIds = [...new Set(userIds)];

    const [profiles, bindings] = await Promise.all([
      this.db
        .select({
          userId: userProfiles.userId,
          displayName: userProfiles.displayName,
        })
        .from(userProfiles)
        .where(
          and(
            inArray(userProfiles.userId, uniqueIds),
            isNotNull(userProfiles.displayName)
          )
        ),
      this.db
        .select({
          userId: userBindings.userId,
          providerLogin: userBindings.providerLogin,
        })
        .from(userBindings)
        .where(
          and(
            inArray(userBindings.userId, uniqueIds),
            isNotNull(userBindings.providerLogin)
          )
        ),
    ]);

    const names = new Map<string, string>();
    for (const row of profiles) {
      if (row.displayName) {
        names.set(row.userId, row.displayName);
      }
    }
    for (const row of bindings) {
      if (!names.has(row.userId) && row.providerLogin) {
        names.set(row.userId, row.providerLogin);
      }
    }

    return names;
  }

  async getUnselectedReceipts(
    nodeId: string,
    epochId: bigint,
    periodStart: Date,
    periodEnd: Date
  ): Promise<UnselectedReceipt[]> {
    await this.resolveEpochScoped(epochId);
    const rows = await this.db
      .select({
        receipt: ingestionReceipts,
        selectionId: epochSelection.id,
      })
      .from(ingestionReceipts)
      .leftJoin(
        epochSelection,
        and(
          eq(epochSelection.epochId, epochId),
          eq(epochSelection.receiptId, ingestionReceipts.receiptId)
        )
      )
      .where(
        and(
          eq(ingestionReceipts.nodeId, nodeId),
          gte(ingestionReceipts.eventTime, periodStart),
          lte(ingestionReceipts.eventTime, periodEnd),
          or(
            isNull(epochSelection.id), // no selection row
            isNull(epochSelection.userId) // selection exists but unresolved
          )
        )
      )
      .orderBy(ingestionReceipts.eventTime);
    return rows.map((r) => ({
      receipt: toIngestionReceipt(r.receipt),
      hasExistingSelection: r.selectionId !== null,
    }));
  }

  async updateSelectionUserId(
    epochId: bigint,
    receiptId: string,
    userId: string
  ): Promise<void> {
    await this.resolveEpochScoped(epochId);
    await this.db
      .update(epochSelection)
      .set({ userId, updatedAt: new Date() })
      .where(
        and(
          eq(epochSelection.epochId, epochId),
          eq(epochSelection.receiptId, receiptId),
          isNull(epochSelection.userId)
        )
      );
  }
}
