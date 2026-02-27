// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/store`
 * Purpose: Port interface for the epoch ledger store. Shared by app and scheduler-worker.
 * Scope: Type definitions only. Does not contain implementations or I/O.
 * Invariants:
 * - RECEIPT_APPEND_ONLY: insertIngestionReceipts never updates existing rows.
 * - SELECTION_FREEZE_ON_FINALIZE: upsertSelection rejects writes when epoch is finalized.
 * - SELECTION_AUTO_POPULATE: insertSelectionDoNothing + updateSelectionUserId never overwrite admin-set fields.
 * - IDENTITY_BEST_EFFORT: resolveIdentities is best-effort; unresolved receipts get userId=null.
 * - ONE_OPEN_EPOCH: createEpoch enforced by DB constraint.
 * - NODE_SCOPED: all operations are scoped to a node_id.
 * - RECEIPT_SCOPE_AGNOSTIC: receipts carry no scope_id; scope assigned at selection via epoch membership.
 * - EVALUATION_FINAL_ATOMIC: locked evaluation writes + artifacts_hash + epoch open→review in one transaction.
 * - STATEMENT_FROM_FINAL_ONLY: allocation for statements consumes only status='locked' evaluations.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

import type { SelectedReceiptForAllocation } from "./allocation";
import type { EpochStatus } from "./model";

// ---------------------------------------------------------------------------
// Domain record types (read-side)
// ---------------------------------------------------------------------------

export interface LedgerEpoch {
  readonly id: bigint;
  readonly nodeId: string;
  readonly scopeId: string;
  readonly status: EpochStatus;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly weightConfig: Record<string, number>;
  readonly poolTotalCredits: bigint | null;
  readonly approverSetHash: string | null;
  readonly allocationAlgoRef: string | null;
  readonly weightConfigHash: string | null;
  readonly artifactsHash: string | null;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly createdAt: Date;
}

export interface LedgerIngestionReceipt {
  readonly receiptId: string;
  readonly nodeId: string;
  readonly source: string;
  readonly eventType: string;
  readonly platformUserId: string;
  readonly platformLogin: string | null;
  readonly artifactUrl: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly payloadHash: string;
  readonly producer: string;
  readonly producerVersion: string;
  readonly eventTime: Date;
  readonly retrievedAt: Date;
  readonly ingestedAt: Date;
}

export interface LedgerSelection {
  readonly id: string;
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly receiptId: string;
  readonly userId: string | null;
  readonly included: boolean;
  readonly weightOverrideMilli: bigint | null;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LedgerAllocation {
  readonly id: string;
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly userId: string;
  readonly proposedUnits: bigint;
  readonly finalUnits: bigint | null;
  readonly overrideReason: string | null;
  readonly activityCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LedgerIngestionCursor {
  readonly nodeId: string;
  readonly scopeId: string;
  readonly source: string;
  readonly stream: string;
  readonly sourceRef: string;
  readonly cursorValue: string;
  readonly retrievedAt: Date;
}

export interface LedgerPoolComponent {
  readonly id: string;
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly componentId: string;
  readonly algorithmVersion: string;
  readonly inputsJson: Record<string, unknown>;
  readonly amountCredits: bigint;
  readonly evidenceRef: string | null;
  readonly computedAt: Date;
}

export interface LedgerEpochStatement {
  readonly id: string;
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly allocationSetHash: string;
  readonly poolTotalCredits: bigint;
  readonly payoutsJson: Array<{
    user_id: string;
    total_units: string;
    share: string;
    amount_credits: string;
  }>;
  readonly supersedesStatementId: string | null;
  readonly createdAt: Date;
}

export interface LedgerStatementSignature {
  readonly id: string;
  readonly nodeId: string;
  readonly statementId: string;
  readonly signerWallet: string;
  readonly signature: string;
  readonly signedAt: Date;
}

export interface LedgerEpochEvaluation {
  readonly id: string;
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly evaluationRef: string;
  readonly status: "draft" | "locked";
  readonly algoRef: string;
  readonly inputsHash: string;
  readonly payloadHash: string;
  readonly payloadJson: Record<string, unknown> | null;
  readonly payloadRef: string | null;
  readonly createdAt: Date;
}

/** Selected receipt with raw receipt metadata, for enricher consumption. */
export interface SelectedReceiptWithMetadata
  extends SelectedReceiptForAllocation {
  readonly metadata: Record<string, unknown> | null;
  readonly payloadHash: string;
}

// ---------------------------------------------------------------------------
// Write-side parameter types
// ---------------------------------------------------------------------------

export interface InsertIngestionReceiptParams {
  readonly receiptId: string;
  readonly nodeId: string;
  readonly source: string;
  readonly eventType: string;
  readonly platformUserId: string;
  readonly platformLogin?: string | null;
  readonly artifactUrl?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly payloadHash: string;
  readonly producer: string;
  readonly producerVersion: string;
  readonly eventTime: Date;
  readonly retrievedAt: Date;
}

export interface UpsertSelectionParams {
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly receiptId: string;
  readonly userId?: string | null;
  readonly included?: boolean;
  readonly weightOverrideMilli?: bigint | null;
  readonly note?: string | null;
}

export interface InsertAllocationParams {
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly userId: string;
  readonly proposedUnits: bigint;
  readonly finalUnits?: bigint | null;
  readonly overrideReason?: string | null;
  readonly activityCount: number;
}

export interface InsertPoolComponentParams {
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly componentId: string;
  readonly algorithmVersion: string;
  readonly inputsJson: Record<string, unknown>;
  readonly amountCredits: bigint;
  readonly evidenceRef?: string | null;
}

export interface InsertEpochStatementParams {
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly allocationSetHash: string;
  readonly poolTotalCredits: bigint;
  readonly payoutsJson: Array<{
    user_id: string;
    total_units: string;
    share: string;
    amount_credits: string;
  }>;
  readonly supersedesStatementId?: string | null;
}

export interface InsertStatementSignatureParams {
  readonly nodeId: string;
  readonly statementId: string;
  readonly signerWallet: string;
  readonly signature: string;
  readonly signedAt: Date;
}

export interface UpsertEvaluationParams {
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly evaluationRef: string;
  readonly status: "draft" | "locked";
  readonly algoRef: string;
  readonly inputsHash: string;
  readonly payloadHash: string;
  readonly payloadJson: Record<string, unknown>;
}

export interface CloseIngestionWithEvaluationsParams {
  readonly epochId: bigint;
  readonly approverSetHash: string;
  readonly allocationAlgoRef: string;
  readonly weightConfigHash: string;
  readonly evaluations: ReadonlyArray<UpsertEvaluationParams>;
  readonly artifactsHash: string;
}

/**
 * Narrowed params for auto-population INSERT (SELECTION_AUTO_POPULATE).
 * Intentionally excludes weightOverrideMilli and note to prevent accidental overwrites.
 */
export interface InsertSelectionAutoParams {
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly receiptId: string;
  readonly userId: string | null;
  readonly included: boolean;
}

// ---------------------------------------------------------------------------
// Identity resolution types
// ---------------------------------------------------------------------------

/**
 * A receipt that needs selection work — either no selection row exists,
 * or the selection row has user_id IS NULL (unresolved).
 */
export interface UnselectedReceipt {
  readonly receipt: LedgerIngestionReceipt;
  /** true = selection row exists with userId=NULL; false = no selection row */
  readonly hasExistingSelection: boolean;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface EpochLedgerStore {
  // Epochs
  createEpoch(params: {
    nodeId: string;
    scopeId: string;
    periodStart: Date;
    periodEnd: Date;
    weightConfig: Record<string, number>;
  }): Promise<LedgerEpoch>;
  getOpenEpoch(nodeId: string, scopeId: string): Promise<LedgerEpoch | null>;
  getEpochByWindow(
    nodeId: string,
    scopeId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<LedgerEpoch | null>;
  getEpoch(id: bigint): Promise<LedgerEpoch | null>;
  listEpochs(nodeId: string): Promise<LedgerEpoch[]>;
  /** Transition epoch open → review (INGESTION_STOPS_AT_REVIEW).
   *  Pins approverSetHash, allocationAlgoRef, and weightConfigHash. */
  closeIngestion(
    epochId: bigint,
    approverSetHash: string,
    allocationAlgoRef: string,
    weightConfigHash: string
  ): Promise<LedgerEpoch>;

  /** Transition epoch review → finalized. Sets poolTotalCredits and closedAt. */
  finalizeEpoch(epochId: bigint, poolTotal: bigint): Promise<LedgerEpoch>;

  /** Transition epoch open → review with locked evaluations in a single transaction (EVALUATION_FINAL_ATOMIC).
   *  Inserts locked evaluations + sets artifacts_hash + pins approverSetHash, allocationAlgoRef, weightConfigHash.
   *  Rejects if epoch is not open. */
  closeIngestionWithEvaluations(
    params: CloseIngestionWithEvaluationsParams
  ): Promise<LedgerEpoch>;

  // Evaluations
  /** Upsert draft evaluation — overwrites on (epoch_id, evaluation_ref, status='draft'). */
  upsertDraftEvaluation(params: UpsertEvaluationParams): Promise<void>;
  /** Get all evaluations for an epoch, optionally filtered by status. */
  getEvaluationsForEpoch(
    epochId: bigint,
    status?: "draft" | "locked"
  ): Promise<LedgerEpochEvaluation[]>;
  /** Get single evaluation by ref and optional status. */
  getEvaluation(
    epochId: bigint,
    evaluationRef: string,
    status?: "draft" | "locked"
  ): Promise<LedgerEpochEvaluation | null>;
  /** Get selected receipts with raw metadata and payload hash for enricher consumption. */
  getSelectedReceiptsWithMetadata(
    epochId: bigint
  ): Promise<SelectedReceiptWithMetadata[]>;

  // Ingestion receipts (append-only, epoch-agnostic raw log)
  insertIngestionReceipts(
    receipts: InsertIngestionReceiptParams[]
  ): Promise<void>;
  getReceiptsForWindow(
    nodeId: string,
    since: Date,
    until: Date
  ): Promise<LedgerIngestionReceipt[]>;

  // Allocation computation (joined query)
  /**
   * Returns selected receipts with resolved user IDs for allocation computation.
   * Joined query: epoch_selection JOIN ingestion_receipts, filtered to userId IS NOT NULL.
   */
  getSelectedReceiptsForAllocation(
    epochId: bigint
  ): Promise<SelectedReceiptForAllocation[]>;

  // Selection (mutable while epoch open)
  upsertSelection(params: UpsertSelectionParams[]): Promise<void>;
  /**
   * Insert selection rows with ON CONFLICT DO NOTHING semantics.
   * Used by auto-population (SELECTION_AUTO_POPULATE) to avoid overwriting
   * admin-set fields if a row is created between getUnselectedReceipts and insert.
   */
  insertSelectionDoNothing(params: InsertSelectionAutoParams[]): Promise<void>;
  getSelectionForEpoch(epochId: bigint): Promise<LedgerSelection[]>;
  getUnresolvedSelection(epochId: bigint): Promise<LedgerSelection[]>;

  // Allocations
  insertAllocations(allocations: InsertAllocationParams[]): Promise<void>;
  /**
   * Upsert allocations — ON CONFLICT (epoch_id, user_id) UPDATE proposed_units and activity_count.
   * Never touches final_units or override_reason (ALLOCATION_PRESERVES_OVERRIDES).
   */
  upsertAllocations(allocations: InsertAllocationParams[]): Promise<void>;
  /**
   * Delete allocation rows where user_id NOT IN activeUserIds AND final_units IS NULL.
   * Admin-overridden allocations (final_units set) are never auto-deleted.
   */
  deleteStaleAllocations(
    epochId: bigint,
    activeUserIds: string[]
  ): Promise<void>;
  updateAllocationFinalUnits(
    epochId: bigint,
    userId: string,
    finalUnits: bigint,
    overrideReason?: string
  ): Promise<void>;
  getAllocationsForEpoch(epochId: bigint): Promise<LedgerAllocation[]>;

  // Ingestion cursors (one stream per call)
  upsertCursor(
    nodeId: string,
    scopeId: string,
    source: string,
    stream: string,
    sourceRef: string,
    cursorValue: string
  ): Promise<void>;
  getCursor(
    nodeId: string,
    scopeId: string,
    source: string,
    stream: string,
    sourceRef: string
  ): Promise<LedgerIngestionCursor | null>;

  // Pool components
  insertPoolComponent(
    params: InsertPoolComponentParams
  ): Promise<LedgerPoolComponent>;
  getPoolComponentsForEpoch(epochId: bigint): Promise<LedgerPoolComponent[]>;

  // Epoch statements
  insertEpochStatement(
    params: InsertEpochStatementParams
  ): Promise<LedgerEpochStatement>;
  getStatementForEpoch(epochId: bigint): Promise<LedgerEpochStatement | null>;

  /**
   * Atomic finalize: epoch transition + statement upsert + signature upsert in one DB transaction.
   * Handles all states:
   * - review → finalized: insert statement + signature, return both
   * - already finalized: repair missing statement/signature, assert hash match
   * - open or missing: throw domain error
   * Uses ON CONFLICT for retry safety.
   */
  finalizeEpochAtomic(params: {
    epochId: bigint;
    poolTotal: bigint;
    statement: Omit<InsertEpochStatementParams, "epochId">;
    signature: Omit<InsertStatementSignatureParams, "statementId">;
    expectedAllocationSetHash: string;
  }): Promise<{ epoch: LedgerEpoch; statement: LedgerEpochStatement }>;

  // Statement signatures
  insertStatementSignature(
    params: InsertStatementSignatureParams
  ): Promise<void>;
  getSignaturesForStatement(
    statementId: string
  ): Promise<LedgerStatementSignature[]>;

  // Identity resolution (cross-domain convenience — V0 on ledger port)
  /**
   * Resolves platform IDs to user UUIDs via user_bindings.
   * V0: GitHub only. Extend provider union for discord etc.
   */
  resolveIdentities(
    provider: "github",
    externalIds: string[]
  ): Promise<Map<string, string>>;

  /**
   * Returns receipts in the epoch window that need selection work:
   * - No selection row exists (new receipts)
   * - Selection row exists but user_id IS NULL (unresolved)
   */
  getUnselectedReceipts(
    nodeId: string,
    epochId: bigint,
    periodStart: Date,
    periodEnd: Date
  ): Promise<UnselectedReceipt[]>;

  /**
   * Update user_id on a selection row ONLY when existing user_id IS NULL.
   * Never touches included, weight_override_milli, or note (SELECTION_AUTO_POPULATE).
   */
  updateSelectionUserId(
    epochId: bigint,
    receiptId: string,
    userId: string
  ): Promise<void>;
}
