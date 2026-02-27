// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core/store`
 * Purpose: Port interface for the activity ledger store. Shared by app and scheduler-worker.
 * Scope: Type definitions only. Does not contain implementations or I/O.
 * Invariants:
 * - ACTIVITY_APPEND_ONLY: insertActivityEvents never updates existing rows.
 * - CURATION_FREEZE_ON_FINALIZE: upsertCuration rejects writes when epoch is finalized.
 * - CURATION_AUTO_POPULATE: insertCurationDoNothing + updateCurationUserId never overwrite admin-set fields.
 * - IDENTITY_BEST_EFFORT: resolveIdentities is best-effort; unresolved events get userId=null.
 * - ONE_OPEN_EPOCH: createEpoch enforced by DB constraint.
 * - NODE_SCOPED: all operations are scoped to a node_id.
 * - ARTIFACT_FINAL_ATOMIC: locked artifact writes + artifacts_hash + epoch open→review in one transaction.
 * - PAYOUT_FROM_FINAL_ONLY: allocation for payouts consumes only status='locked' artifacts.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

import type { CuratedEventForAllocation } from "./allocation";
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

export interface LedgerActivityEvent {
  readonly id: string;
  readonly nodeId: string;
  readonly scopeId: string;
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

export interface LedgerCuration {
  readonly id: string;
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly eventId: string;
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

export interface LedgerSourceCursor {
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

export interface LedgerPayoutStatement {
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

export interface LedgerEpochArtifact {
  readonly id: string;
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly artifactRef: string;
  readonly status: "draft" | "locked";
  readonly algoRef: string;
  readonly inputsHash: string;
  readonly payloadHash: string;
  readonly payloadJson: Record<string, unknown> | null;
  readonly payloadRef: string | null;
  readonly createdAt: Date;
}

/** Curated event with raw event metadata, for enricher consumption. */
export interface CuratedEventWithMetadata extends CuratedEventForAllocation {
  readonly metadata: Record<string, unknown> | null;
  readonly payloadHash: string;
}

// ---------------------------------------------------------------------------
// Write-side parameter types
// ---------------------------------------------------------------------------

export interface InsertActivityEventParams {
  readonly id: string;
  readonly nodeId: string;
  readonly scopeId: string;
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

export interface UpsertCurationParams {
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly eventId: string;
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

export interface InsertPayoutStatementParams {
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

export interface InsertSignatureParams {
  readonly nodeId: string;
  readonly statementId: string;
  readonly signerWallet: string;
  readonly signature: string;
  readonly signedAt: Date;
}

export interface UpsertArtifactParams {
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly artifactRef: string;
  readonly status: "draft" | "locked";
  readonly algoRef: string;
  readonly inputsHash: string;
  readonly payloadHash: string;
  readonly payloadJson: Record<string, unknown>;
}

export interface CloseIngestionWithArtifactsParams {
  readonly epochId: bigint;
  readonly approverSetHash: string;
  readonly allocationAlgoRef: string;
  readonly weightConfigHash: string;
  readonly artifacts: ReadonlyArray<UpsertArtifactParams>;
  readonly artifactsHash: string;
}

/**
 * Narrowed params for auto-population INSERT (CURATION_AUTO_POPULATE).
 * Intentionally excludes weightOverrideMilli and note to prevent accidental overwrites.
 */
export interface InsertCurationAutoParams {
  readonly nodeId: string;
  readonly epochId: bigint;
  readonly eventId: string;
  readonly userId: string | null;
  readonly included: boolean;
}

// ---------------------------------------------------------------------------
// Identity resolution types
// ---------------------------------------------------------------------------

/**
 * An event that needs curation work — either no curation row exists,
 * or the curation row has user_id IS NULL (unresolved).
 */
export interface UncuratedEvent {
  readonly event: LedgerActivityEvent;
  /** true = curation row exists with userId=NULL; false = no curation row */
  readonly hasExistingCuration: boolean;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface ActivityLedgerStore {
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
  /** Transition epoch open → review (INGESTION_CLOSED_ON_REVIEW).
   *  Pins approverSetHash, allocationAlgoRef, and weightConfigHash. */
  closeIngestion(
    epochId: bigint,
    approverSetHash: string,
    allocationAlgoRef: string,
    weightConfigHash: string
  ): Promise<LedgerEpoch>;

  /** Transition epoch review → finalized. Sets poolTotalCredits and closedAt. */
  finalizeEpoch(epochId: bigint, poolTotal: bigint): Promise<LedgerEpoch>;

  /** Transition epoch open → review with locked artifacts in a single transaction (ARTIFACT_FINAL_ATOMIC).
   *  Inserts locked artifacts + sets artifacts_hash + pins approverSetHash, allocationAlgoRef, weightConfigHash.
   *  Rejects if epoch is not open. */
  closeIngestionWithArtifacts(
    params: CloseIngestionWithArtifactsParams
  ): Promise<LedgerEpoch>;

  // Artifacts
  /** Upsert draft artifact — overwrites on (epoch_id, artifact_ref, status='draft'). */
  upsertDraftArtifact(params: UpsertArtifactParams): Promise<void>;
  /** Get all artifacts for an epoch, optionally filtered by status. */
  getArtifactsForEpoch(
    epochId: bigint,
    status?: "draft" | "locked"
  ): Promise<LedgerEpochArtifact[]>;
  /** Get single artifact by ref and optional status. */
  getArtifact(
    epochId: bigint,
    artifactRef: string,
    status?: "draft" | "locked"
  ): Promise<LedgerEpochArtifact | null>;
  /** Get curated events with raw metadata and payload hash for enricher consumption. */
  getCuratedEventsWithMetadata(
    epochId: bigint
  ): Promise<CuratedEventWithMetadata[]>;

  // Activity events (append-only, epoch-agnostic raw log)
  insertActivityEvents(events: InsertActivityEventParams[]): Promise<void>;
  getActivityForWindow(
    nodeId: string,
    since: Date,
    until: Date
  ): Promise<LedgerActivityEvent[]>;

  // Allocation computation (joined query)
  /**
   * Returns curated events with resolved user IDs for allocation computation.
   * Joined query: activity_curation JOIN activity_events, filtered to userId IS NOT NULL.
   */
  getCuratedEventsForAllocation(
    epochId: bigint
  ): Promise<CuratedEventForAllocation[]>;

  // Curation (mutable while epoch open)
  upsertCuration(params: UpsertCurationParams[]): Promise<void>;
  /**
   * Insert curation rows with ON CONFLICT DO NOTHING semantics.
   * Used by auto-population (CURATION_AUTO_POPULATE) to avoid overwriting
   * admin-set fields if a row is created between getUncuratedEvents and insert.
   */
  insertCurationDoNothing(params: InsertCurationAutoParams[]): Promise<void>;
  getCurationForEpoch(epochId: bigint): Promise<LedgerCuration[]>;
  getUnresolvedCuration(epochId: bigint): Promise<LedgerCuration[]>;

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

  // Cursors (one stream per call)
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
  ): Promise<LedgerSourceCursor | null>;

  // Pool components
  insertPoolComponent(
    params: InsertPoolComponentParams
  ): Promise<LedgerPoolComponent>;
  getPoolComponentsForEpoch(epochId: bigint): Promise<LedgerPoolComponent[]>;

  // Payout statements
  insertPayoutStatement(
    params: InsertPayoutStatementParams
  ): Promise<LedgerPayoutStatement>;
  getStatementForEpoch(epochId: bigint): Promise<LedgerPayoutStatement | null>;

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
    statement: Omit<InsertPayoutStatementParams, "epochId">;
    signature: Omit<InsertSignatureParams, "statementId">;
    expectedAllocationSetHash: string;
  }): Promise<{ epoch: LedgerEpoch; statement: LedgerPayoutStatement }>;

  // Statement signatures (schema only — signing flow is a follow-up)
  insertStatementSignature(params: InsertSignatureParams): Promise<void>;
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
   * Returns events in the epoch window that need curation work:
   * - No curation row exists (new events)
   * - Curation row exists but user_id IS NULL (unresolved)
   */
  getUncuratedEvents(
    nodeId: string,
    epochId: bigint,
    periodStart: Date,
    periodEnd: Date
  ): Promise<UncuratedEvent[]>;

  /**
   * Update user_id on a curation row ONLY when existing user_id IS NULL.
   * Never touches included, weight_override_milli, or note (CURATION_AUTO_POPULATE).
   */
  updateCurationUserId(
    epochId: bigint,
    eventId: string,
    userId: string
  ): Promise<void>;
}
