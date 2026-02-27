// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/activities/ledger`
 * Purpose: Temporal Activities for the full ledger pipeline — ingestion, selection, allocation, pool, auto-close, and finalization.
 * Scope: Plain async functions that perform I/O (DB, GitHub API, EIP-191 verification). Called by CollectEpochWorkflow and FinalizeEpochWorkflow. Does not contain deterministic orchestration logic.
 * Invariants:
 *   - Per RECEIPT_IDEMPOTENT: All activities idempotent via PK constraints or upsert
 *   - Per CURSOR_STATE_PERSISTED: Cursors saved after each collect() call
 *   - Per NODE_SCOPED: All operations pass nodeId + scopeId from deps
 *   - Per TEMPORAL_DETERMINISM: Activities contain all I/O; workflows call only these proxies
 *   - Per SELECTION_AUTO_POPULATE: materializeSelection inserts new selections (DO NOTHING on conflict), updates only userId on unresolved rows
 *   - Per IDENTITY_BEST_EFFORT: Unresolved receipts get userId=null in selection rows, never dropped
 *   - Per ALLOCATION_PRESERVES_OVERRIDES: upsertAllocations never touches admin-set final_units
 *   - Per CONFIG_LOCKED_AT_REVIEW: autoCloseIngestion pins allocationAlgoRef + weightConfigHash
 *   - Per EVALUATION_FINAL_ATOMIC: autoCloseIngestion passes evaluations to closeIngestionWithEvaluations for atomic write
 *   - Per EPOCH_FINALIZE_IDEMPOTENT: finalizeEpoch returns existing statement if already finalized
 * Side-effects: IO (database, GitHub API, viem EIP-191 verification)
 * Links: docs/spec/epoch-ledger.md, docs/spec/temporal-patterns.md
 * @internal
 */

import type { UnselectedReceipt } from "@cogni/attribution-ledger";
import {
  buildCanonicalMessage,
  computeAllocationSetHash,
  computeApproverSetHash,
  computeProposedAllocations,
  computeStatementItems,
  computeWeightConfigHash,
  deriveAllocationAlgoRef,
  estimatePoolComponentsV0,
  validateWeightConfig,
} from "@cogni/attribution-ledger";
import type { ActivityEvent } from "@cogni/ingestion-core";

import { verifyMessage } from "viem";

import type { Logger } from "../observability/logger.js";
import type { AttributionStore, SourceAdapter } from "../ports/index.js";

/**
 * Dependencies injected into ledger activities at worker creation.
 */
export interface AttributionActivityDeps {
  readonly attributionStore: AttributionStore;
  readonly sourceAdapters: ReadonlyMap<string, SourceAdapter>;
  readonly nodeId: string;
  readonly scopeId: string;
  readonly logger: Logger;
}

/**
 * Input for ensureEpochForWindow activity.
 * scopeId is NOT in input — uses injected deps.scopeId only.
 */
export interface EnsureEpochInput {
  readonly periodStart: string; // ISO date
  readonly periodEnd: string; // ISO date
  readonly weightConfig: Record<string, number>;
}

/**
 * Output from ensureEpochForWindow activity.
 */
export interface EnsureEpochOutput {
  readonly epochId: string; // bigint serialized as string for Temporal
  readonly status: string;
  readonly isNew: boolean;
  readonly weightConfig: Record<string, number>;
}

/**
 * Input for loadCursor activity.
 */
export interface LoadCursorInput {
  readonly source: string;
  readonly stream: string;
  readonly sourceRef: string;
}

/**
 * Input for collectFromSource activity.
 */
export interface CollectFromSourceInput {
  readonly source: string;
  readonly streams: string[];
  readonly cursorValue: string | null;
  readonly periodStart: string; // ISO date
  readonly periodEnd: string; // ISO date
}

/**
 * Output from collectFromSource activity.
 */
export interface CollectFromSourceOutput {
  readonly events: ActivityEvent[];
  readonly nextCursorValue: string;
  readonly nextCursorStreamId: string;
  readonly producerVersion: string;
}

/**
 * Input for insertReceipts activity.
 */
export interface InsertReceiptsInput {
  readonly events: ActivityEvent[];
  readonly producerVersion: string;
}

/**
 * Input for saveCursor activity.
 */
export interface SaveCursorInput {
  readonly source: string;
  readonly stream: string;
  readonly sourceRef: string;
  readonly cursorValue: string;
}

/**
 * Input for materializeSelection activity.
 * epochId is the sole input — activity loads epoch row for period dates.
 */
export interface MaterializeSelectionInput {
  readonly epochId: string; // bigint serialized as string for Temporal
}

/**
 * Output from materializeSelection activity.
 */
export interface MaterializeSelectionOutput {
  readonly totalReceipts: number;
  readonly newSelections: number;
  readonly resolved: number;
  readonly unresolved: number;
}

/**
 * Input for computeAllocations activity.
 */
export interface ComputeAllocationsInput {
  readonly epochId: string; // bigint serialized
  readonly algorithmId: string;
  readonly weightConfig: Record<string, number>;
}

/**
 * Output from computeAllocations activity.
 */
export interface ComputeAllocationsOutput {
  readonly totalAllocations: number;
  readonly totalProposedUnits: string; // bigint serialized
}

/**
 * Input for ensurePoolComponents activity.
 */
export interface EnsurePoolComponentsInput {
  readonly epochId: string; // bigint serialized
  readonly baseIssuanceCredits: string; // bigint serialized
}

/**
 * Output from ensurePoolComponents activity.
 */
export interface EnsurePoolComponentsOutput {
  readonly componentsEnsured: number;
}

/**
 * Input for autoCloseIngestion activity.
 */
export interface AutoCloseIngestionInput {
  readonly epochId: string; // bigint serialized
  readonly periodEnd: string; // ISO date
  readonly gracePeriodMs: number;
  readonly weightConfig: Record<string, number>;
  readonly creditEstimateAlgo: string;
  readonly approvers: string[];
  readonly evaluations: ReadonlyArray<{
    readonly nodeId: string;
    readonly epochId: string; // bigint as decimal string for Temporal wire format
    readonly evaluationRef: string;
    readonly status: "draft" | "locked";
    readonly algoRef: string;
    readonly inputsHash: string;
    readonly payloadHash: string;
    readonly payloadJson: Record<string, unknown>;
  }>;
  readonly artifactsHash: string;
}

/**
 * Output from autoCloseIngestion activity.
 */
export interface AutoCloseIngestionOutput {
  readonly closed: boolean;
  readonly reason: string;
}

/**
 * Input for finalizeEpoch compound activity.
 */
export interface FinalizeEpochInput {
  readonly epochId: string; // bigint serialized
  readonly signature: string; // EIP-191 hex
  readonly signerAddress: string; // from SIWE session
  readonly approvers: string[]; // EVM addresses (lowercased)
}

/**
 * Output from finalizeEpoch compound activity.
 */
export interface FinalizeEpochOutput {
  readonly statementId: string;
  readonly poolTotalCredits: string; // bigint serialized
  readonly allocationSetHash: string;
  readonly statementItemCount: number;
}

/**
 * Creates ledger activity functions with injected dependencies.
 * Follows the same DI pattern as createActivities() in activities/index.ts.
 */
export function createAttributionActivities(deps: AttributionActivityDeps) {
  const { attributionStore, sourceAdapters, nodeId, scopeId, logger } = deps;

  /**
   * Creates or returns an existing epoch for the given time window.
   * Looks up by window (any status), not just open epochs — handles finalized epochs.
   * Pins weightConfig on first create; returns existing config if epoch already exists.
   */
  async function ensureEpochForWindow(
    input: EnsureEpochInput
  ): Promise<EnsureEpochOutput> {
    const { periodStart, periodEnd, weightConfig } = input;
    logger.info(
      { periodStart, periodEnd, scopeId },
      "Ensuring epoch for window"
    );

    // Check if an epoch already exists for this window (any status)
    const existing = await attributionStore.getEpochByWindow(
      nodeId,
      scopeId,
      new Date(periodStart),
      new Date(periodEnd)
    );
    if (existing) {
      // Weight config drift detection — log warning but use pinned config
      if (
        JSON.stringify(weightConfig) !== JSON.stringify(existing.weightConfig)
      ) {
        logger.warn(
          {
            epochId: existing.id.toString(),
            inputWeights: weightConfig,
            pinnedWeights: existing.weightConfig,
          },
          "Weight config drift detected — using pinned config from epoch creation"
        );
      }

      logger.info(
        { epochId: existing.id.toString(), status: existing.status },
        "Found existing epoch for window"
      );
      return {
        epochId: existing.id.toString(),
        status: existing.status,
        isNew: false,
        weightConfig: existing.weightConfig,
      };
    }

    // Create new epoch — DB constraint ensures EPOCH_WINDOW_UNIQUE.
    // Race: another worker may create the same epoch between our read and write.
    // On unique constraint violation, re-query and return the existing epoch.
    try {
      const epoch = await attributionStore.createEpoch({
        nodeId,
        scopeId,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        weightConfig,
      });

      logger.info(
        { epochId: epoch.id.toString(), status: epoch.status },
        "Created new epoch"
      );

      return {
        epochId: epoch.id.toString(),
        status: epoch.status,
        isNew: true,
        weightConfig: epoch.weightConfig,
      };
    } catch (err) {
      // Unique constraint violation — another worker created the epoch concurrently
      const raceEpoch = await attributionStore.getEpochByWindow(
        nodeId,
        scopeId,
        new Date(periodStart),
        new Date(periodEnd)
      );
      if (raceEpoch) {
        logger.info(
          { epochId: raceEpoch.id.toString(), status: raceEpoch.status },
          "Epoch created by concurrent worker — using existing"
        );
        return {
          epochId: raceEpoch.id.toString(),
          status: raceEpoch.status,
          isNew: false,
          weightConfig: raceEpoch.weightConfig,
        };
      }
      // Not a race condition — rethrow original error
      throw err;
    }
  }

  /**
   * Loads cursor from source_cursors for incremental sync.
   * Returns null if no cursor exists (first collection).
   */
  async function loadCursor(input: LoadCursorInput): Promise<string | null> {
    const { source, stream, sourceRef } = input;
    logger.info({ source, stream, sourceRef }, "Loading cursor");

    const cursor = await attributionStore.getCursor(
      nodeId,
      scopeId,
      source,
      stream,
      sourceRef
    );

    if (cursor) {
      logger.info(
        { source, stream, cursorValue: cursor.cursorValue },
        "Cursor loaded"
      );
      return cursor.cursorValue;
    }

    logger.info({ source, stream }, "No cursor found, starting fresh");
    return null;
  }

  /**
   * Calls adapter.collect() to fetch events from the external source.
   * Rate limit errors throw and Temporal retries with backoff.
   */
  async function collectFromSource(
    input: CollectFromSourceInput
  ): Promise<CollectFromSourceOutput> {
    const { source, streams, cursorValue, periodStart, periodEnd } = input;
    logger.info(
      { source, streams, hasCursor: !!cursorValue },
      "Collecting from source"
    );

    const adapter = sourceAdapters.get(source);
    if (!adapter) {
      logger.warn({ source }, "No adapter found for source, skipping");
      return {
        events: [],
        nextCursorValue: cursorValue ?? new Date(periodStart).toISOString(),
        nextCursorStreamId: streams[0] ?? source,
        producerVersion: "unknown",
      };
    }

    const result = await adapter.collect({
      streams,
      cursor: cursorValue
        ? {
            streamId: streams[0] ?? source,
            value: cursorValue,
            retrievedAt: new Date(),
          }
        : null,
      window: { since: new Date(periodStart), until: new Date(periodEnd) },
    });

    logger.info(
      {
        source,
        eventCount: result.events.length,
        nextCursor: result.nextCursor.value,
      },
      "Collection complete"
    );

    return {
      events: result.events as ActivityEvent[],
      nextCursorValue: result.nextCursor.value,
      nextCursorStreamId: result.nextCursor.streamId,
      producerVersion: adapter.version,
    };
  }

  /**
   * Stores receipts via attributionStore. Idempotent via onConflictDoNothing on PK.
   */
  async function insertReceipts(input: InsertReceiptsInput): Promise<void> {
    const { events, producerVersion } = input;
    if (events.length === 0) return;

    logger.info({ count: events.length }, "Inserting ingestion receipts");

    await attributionStore.insertIngestionReceipts(
      events.map((e) => ({
        receiptId: e.id,
        nodeId,
        source: e.source,
        eventType: e.eventType,
        platformUserId: e.platformUserId,
        platformLogin: e.platformLogin ?? null,
        artifactUrl: e.artifactUrl ?? null,
        metadata: e.metadata ?? null,
        payloadHash: e.payloadHash,
        producer: e.source,
        producerVersion,
        eventTime: e.eventTime,
        retrievedAt: new Date(),
      }))
    );

    logger.info({ count: events.length }, "Receipts inserted");
  }

  /**
   * Upserts cursor with monotonic advancement — never goes backwards.
   * cursor = max(existing, new) ensures crash-restart safety.
   */
  async function saveCursor(input: SaveCursorInput): Promise<void> {
    const { source, stream, sourceRef, cursorValue } = input;
    logger.info({ source, stream, cursorValue }, "Saving cursor");

    // Load existing to enforce monotonic advancement
    const existing = await attributionStore.getCursor(
      nodeId,
      scopeId,
      source,
      stream,
      sourceRef
    );

    // Lexicographic comparison works for ISO-8601 timestamps (all cursor values are ISO dates).
    // If cursor format changes (e.g., opaque pagination tokens), this comparison must be updated.
    const effectiveValue =
      existing && existing.cursorValue > cursorValue
        ? existing.cursorValue
        : cursorValue;

    await attributionStore.upsertCursor(
      nodeId,
      scopeId,
      source,
      stream,
      sourceRef,
      effectiveValue
    );

    logger.info(
      { source, stream, cursorValue: effectiveValue },
      "Cursor saved"
    );
  }

  /**
   * Materializes selection rows and resolves platform identities for an epoch.
   * Two-phase writes: INSERT new selection rows, UPDATE userId on existing unresolved rows.
   * SELECTION_AUTO_POPULATE: never overwrites admin-set included/weight_override_milli/note.
   * IDENTITY_BEST_EFFORT: unresolved receipts get userId=null, never dropped.
   */
  async function materializeSelection(
    input: MaterializeSelectionInput
  ): Promise<MaterializeSelectionOutput> {
    const epochId = BigInt(input.epochId);

    // 1. Load epoch → get period dates
    const epoch = await attributionStore.getEpoch(epochId);
    if (!epoch) {
      throw new Error(`materializeSelection: epoch ${input.epochId} not found`);
    }

    // 2. Get unselected receipts (delta: only receipts needing work)
    const unselected: UnselectedReceipt[] =
      await attributionStore.getUnselectedReceipts(
        nodeId,
        epochId,
        epoch.periodStart,
        epoch.periodEnd
      );

    if (unselected.length === 0) {
      logger.info(
        { epochId: input.epochId },
        "No unselected receipts — skipping"
      );
      return { totalReceipts: 0, newSelections: 0, resolved: 0, unresolved: 0 };
    }

    // 3. Collect unique platformUserIds by source
    const idsBySource = new Map<string, Set<string>>();
    for (const { receipt } of unselected) {
      const ids = idsBySource.get(receipt.source) ?? new Set();
      ids.add(receipt.platformUserId);
      idsBySource.set(receipt.source, ids);
    }

    // 4. Batch resolve identities per source
    // V0: only github provider supported
    const resolvedMap = new Map<string, string>();
    for (const [source, ids] of idsBySource) {
      if (source === "github") {
        const result = await attributionStore.resolveIdentities("github", [
          ...ids,
        ]);
        for (const [extId, userId] of result) {
          resolvedMap.set(extId, userId);
        }
      }
      // TODO: add discord etc. when sources expand
    }

    // 5. Two-phase writes
    let newSelections = 0;
    let resolved = 0;
    let unresolved = 0;

    for (const { receipt, hasExistingSelection } of unselected) {
      const resolvedUserId = resolvedMap.get(receipt.platformUserId) ?? null;

      if (!hasExistingSelection) {
        // Phase 1: INSERT new selection row (ON CONFLICT DO NOTHING for race safety)
        // Uses insertSelectionDoNothing — NOT upsertSelection which overwrites all fields
        await attributionStore.insertSelectionDoNothing([
          {
            nodeId,
            epochId,
            receiptId: receipt.receiptId,
            userId: resolvedUserId,
            included: true,
          },
        ]);
        newSelections++;
      } else if (resolvedUserId) {
        // Phase 2: UPDATE userId on existing unresolved row
        await attributionStore.updateSelectionUserId(
          epochId,
          receipt.receiptId,
          resolvedUserId
        );
      }

      if (resolvedUserId) {
        resolved++;
      } else {
        unresolved++;
      }
    }

    logger.info(
      {
        epochId: input.epochId,
        totalReceipts: unselected.length,
        newSelections,
        resolved,
        unresolved,
      },
      "Selection materialization and identity resolution complete"
    );

    return {
      totalReceipts: unselected.length,
      newSelections,
      resolved,
      unresolved,
    };
  }

  /**
   * Compute proposed allocations from selected receipts.
   * Upserts results (ALLOCATION_PRESERVES_OVERRIDES) and removes stale allocations.
   */
  async function computeAllocations(
    input: ComputeAllocationsInput
  ): Promise<ComputeAllocationsOutput> {
    const epochId = BigInt(input.epochId);
    const { algorithmId, weightConfig } = input;

    logger.info(
      { epochId: input.epochId, algorithmId },
      "Computing allocations"
    );

    // 1. Load selected receipts (resolved users only)
    const receipts =
      await attributionStore.getSelectedReceiptsForAllocation(epochId);

    if (receipts.length === 0) {
      logger.info(
        { epochId: input.epochId },
        "No selected receipts — skipping"
      );
      return { totalAllocations: 0, totalProposedUnits: "0" };
    }

    // 2. Compute proposed allocations (pure)
    const proposed = computeProposedAllocations(
      algorithmId,
      receipts,
      weightConfig
    );

    // 3. Upsert allocations (preserves admin final_units)
    await attributionStore.upsertAllocations(
      proposed.map((p) => ({
        nodeId,
        epochId,
        userId: p.userId,
        proposedUnits: p.proposedUnits,
        activityCount: p.activityCount,
      }))
    );

    // 4. Remove stale allocations (guard: skip if proposed is empty)
    if (proposed.length > 0) {
      const activeUserIds = proposed.map((p) => p.userId);
      await attributionStore.deleteStaleAllocations(epochId, activeUserIds);
    }

    const totalProposedUnits = proposed.reduce(
      (acc, p) => acc + p.proposedUnits,
      0n
    );

    logger.info(
      {
        epochId: input.epochId,
        totalAllocations: proposed.length,
        totalProposedUnits: totalProposedUnits.toString(),
      },
      "Allocations computed"
    );

    return {
      totalAllocations: proposed.length,
      totalProposedUnits: totalProposedUnits.toString(),
    };
  }

  /**
   * Ensure pool components exist for an epoch. Idempotent via POOL_UNIQUE_PER_TYPE.
   * Only inserts when epoch is open (POOL_LOCKED_AT_REVIEW enforced by adapter).
   */
  async function ensurePoolComponents(
    input: EnsurePoolComponentsInput
  ): Promise<EnsurePoolComponentsOutput> {
    const epochId = BigInt(input.epochId);
    const baseIssuanceCredits = BigInt(input.baseIssuanceCredits);

    logger.info(
      {
        epochId: input.epochId,
        baseIssuanceCredits: input.baseIssuanceCredits,
      },
      "Ensuring pool components"
    );

    // Check epoch is open before attempting inserts
    const epoch = await attributionStore.getEpoch(epochId);
    if (!epoch) {
      throw new Error(`ensurePoolComponents: epoch ${input.epochId} not found`);
    }
    if (epoch.status !== "open") {
      logger.info(
        { epochId: input.epochId, status: epoch.status },
        "Epoch not open — skipping pool component insert"
      );
      return { componentsEnsured: 0 };
    }

    const estimates = estimatePoolComponentsV0({ baseIssuanceCredits });
    let ensured = 0;

    for (const estimate of estimates) {
      try {
        await attributionStore.insertPoolComponent({
          nodeId,
          epochId,
          componentId: estimate.componentId,
          algorithmVersion: estimate.algorithmVersion,
          inputsJson: estimate.inputsJson,
          amountCredits: estimate.amountCredits,
          evidenceRef: estimate.evidenceRef,
        });
        ensured++;
      } catch (err) {
        // Idempotent: PK conflict means component already exists — skip
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("duplicate key") ||
          msg.includes("unique constraint")
        ) {
          logger.info(
            { componentId: estimate.componentId },
            "Pool component already exists — skipping"
          );
        } else {
          throw err;
        }
      }
    }

    logger.info(
      { epochId: input.epochId, componentsEnsured: ensured },
      "Pool components ensured"
    );

    return { componentsEnsured: ensured };
  }

  /**
   * Auto-close ingestion if epoch period has passed + grace period.
   * Locks config at review: pins allocationAlgoRef, weightConfigHash, approverSetHash.
   */
  async function autoCloseIngestion(
    input: AutoCloseIngestionInput
  ): Promise<AutoCloseIngestionOutput> {
    const epochId = BigInt(input.epochId);
    const periodEnd = new Date(input.periodEnd);
    const now = new Date();

    // Check if grace period has elapsed
    const graceDeadline = new Date(periodEnd.getTime() + input.gracePeriodMs);
    if (now < graceDeadline) {
      logger.info(
        {
          epochId: input.epochId,
          periodEnd: input.periodEnd,
          graceDeadline: graceDeadline.toISOString(),
        },
        "Grace period not elapsed — skipping auto-close"
      );
      return { closed: false, reason: "grace_period_not_elapsed" };
    }

    // Validate and compute config hashes
    validateWeightConfig(input.weightConfig);
    const weightConfigHash = await computeWeightConfigHash(input.weightConfig);
    const allocationAlgoRef = deriveAllocationAlgoRef(input.creditEstimateAlgo);
    const approverSetHash = computeApproverSetHash(input.approvers);

    logger.info(
      {
        epochId: input.epochId,
        allocationAlgoRef,
        weightConfigHash: `${weightConfigHash.slice(0, 12)}...`,
        evaluationCount: input.evaluations.length,
      },
      "Auto-closing ingestion with evaluations"
    );

    // Reconstruct bigint epochId from wire string for domain layer
    const evaluations = input.evaluations.map((e) => ({
      ...e,
      epochId: BigInt(e.epochId),
    }));

    const epoch = await attributionStore.closeIngestionWithEvaluations({
      epochId,
      approverSetHash,
      allocationAlgoRef,
      weightConfigHash,
      evaluations,
      artifactsHash: input.artifactsHash,
    });

    logger.info(
      { epochId: input.epochId, status: epoch.status },
      "Ingestion auto-closed with evaluations"
    );

    return { closed: true, reason: "auto_closed" };
  }

  /**
   * Compound activity: atomically finalize an epoch with signature verification.
   * EPOCH_FINALIZE_IDEMPOTENT: returns existing statement if already finalized.
   * CONFIG_LOCKED_AT_REVIEW: verifies allocation_algo_ref and weight_config_hash are set.
   */
  async function finalizeEpoch(
    input: FinalizeEpochInput
  ): Promise<FinalizeEpochOutput> {
    const epochId = BigInt(input.epochId);

    logger.info(
      { epochId: input.epochId, signerAddress: input.signerAddress },
      "Finalizing epoch"
    );

    // 1. Load epoch — verify exists and is review (or finalized for idempotency)
    const epoch = await attributionStore.getEpoch(epochId);
    if (!epoch) {
      throw new Error(`finalizeEpoch: epoch ${input.epochId} not found`);
    }

    // EPOCH_FINALIZE_IDEMPOTENT: already finalized → repair via atomic method
    if (epoch.status === "finalized") {
      logger.info(
        { epochId: input.epochId },
        "Epoch already finalized — repairing via finalizeEpochAtomic"
      );
      const existing = await attributionStore.getStatementForEpoch(epochId);
      if (!existing) {
        throw new Error(
          `finalizeEpoch: epoch ${input.epochId} is finalized but no statement found`
        );
      }

      // Repair: ensure this signer's signature exists via atomic method
      await attributionStore.finalizeEpochAtomic({
        epochId,
        poolTotal: existing.poolTotalCredits,
        statement: {
          nodeId,
          allocationSetHash: existing.allocationSetHash,
          poolTotalCredits: existing.poolTotalCredits,
          statementItems: existing.statementItems,
        },
        signature: {
          nodeId,
          signerWallet: input.signerAddress,
          signature: input.signature,
          signedAt: new Date(),
        },
        expectedAllocationSetHash: existing.allocationSetHash,
      });

      return {
        statementId: existing.id,
        poolTotalCredits: existing.poolTotalCredits.toString(),
        allocationSetHash: existing.allocationSetHash,
        statementItemCount: existing.statementItems.length,
      };
    }

    if (epoch.status !== "review") {
      throw new Error(
        `finalizeEpoch: epoch ${input.epochId} is '${epoch.status}', expected 'review'`
      );
    }

    // 2. CONFIG_LOCKED_AT_REVIEW: verify config is locked
    if (!epoch.allocationAlgoRef || !epoch.weightConfigHash) {
      throw new Error(
        `finalizeEpoch: epoch ${input.epochId} missing allocation_algo_ref or weight_config_hash (CONFIG_LOCKED_AT_REVIEW violated)`
      );
    }

    // 3. Verify signer is in approvers and matches pinned approverSetHash
    const signerLower = input.signerAddress.toLowerCase();
    const approversLower = input.approvers.map((a) => a.toLowerCase());
    if (!approversLower.includes(signerLower)) {
      throw new Error(
        `finalizeEpoch: signer ${input.signerAddress} not in approvers`
      );
    }
    const currentApproverSetHash = computeApproverSetHash(input.approvers);
    if (epoch.approverSetHash !== currentApproverSetHash) {
      throw new Error(
        `finalizeEpoch: approver set hash mismatch — epoch has ${epoch.approverSetHash}, current is ${currentApproverSetHash}`
      );
    }

    // 4. Load allocations — use final_units where set, fall back to proposed_units
    const allocations = await attributionStore.getAllocationsForEpoch(epochId);
    if (allocations.length === 0) {
      throw new Error(
        `finalizeEpoch: epoch ${input.epochId} has no allocations`
      );
    }

    const finalizedAllocations = allocations.map((a) => ({
      userId: a.userId,
      valuationUnits: a.finalUnits ?? a.proposedUnits,
    }));

    // 5. Load pool components → pool_total = SUM(amount_credits)
    const poolComponents =
      await attributionStore.getPoolComponentsForEpoch(epochId);
    if (poolComponents.length === 0) {
      throw new Error(
        `finalizeEpoch: epoch ${input.epochId} has no pool components (POOL_REQUIRES_BASE)`
      );
    }
    const hasBaseIssuance = poolComponents.some(
      (c) => c.componentId === "base_issuance"
    );
    if (!hasBaseIssuance) {
      throw new Error(
        `finalizeEpoch: epoch ${input.epochId} missing base_issuance component (POOL_REQUIRES_BASE)`
      );
    }

    const poolTotal = poolComponents.reduce(
      (sum, c) => sum + c.amountCredits,
      0n
    );

    // 6. Compute statement items (pure, deterministic)
    const items = computeStatementItems(finalizedAllocations, poolTotal);

    // 7. Compute allocation set hash (deterministic)
    const allocationSetHash =
      await computeAllocationSetHash(finalizedAllocations);

    // 8. Build canonical message and verify signature
    const canonicalMessage = buildCanonicalMessage({
      nodeId,
      scopeId,
      epochId: input.epochId,
      allocationSetHash,
      poolTotalCredits: poolTotal.toString(),
    });

    const isValid = await verifyMessage({
      address: input.signerAddress as `0x${string}`,
      message: canonicalMessage,
      signature: input.signature as `0x${string}`,
    });
    if (!isValid) {
      throw new Error(
        `finalizeEpoch: signature verification failed for signer ${input.signerAddress}`
      );
    }

    // 9. Atomic finalize — epoch transition + statement + signature in one transaction
    const { epoch: finalizedEpoch, statement } =
      await attributionStore.finalizeEpochAtomic({
        epochId,
        poolTotal,
        statement: {
          nodeId,
          allocationSetHash,
          poolTotalCredits: poolTotal,
          statementItems: items.map((li) => ({
            user_id: li.userId,
            total_units: li.totalUnits.toString(),
            share: li.share,
            amount_credits: li.amountCredits.toString(),
          })),
        },
        signature: {
          nodeId,
          signerWallet: input.signerAddress,
          signature: input.signature,
          signedAt: new Date(),
        },
        expectedAllocationSetHash: allocationSetHash,
      });

    logger.info(
      {
        epochId: input.epochId,
        statementId: statement.id,
        poolTotalCredits: poolTotal.toString(),
        allocationSetHash: `${allocationSetHash.slice(0, 12)}...`,
        statementItemCount: items.length,
        status: finalizedEpoch.status,
      },
      "Epoch finalized"
    );

    return {
      statementId: statement.id,
      poolTotalCredits: poolTotal.toString(),
      allocationSetHash,
      statementItemCount: items.length,
    };
  }

  return {
    ensureEpochForWindow,
    loadCursor,
    collectFromSource,
    insertReceipts,
    saveCursor,
    materializeSelection,
    computeAllocations,
    ensurePoolComponents,
    autoCloseIngestion,
    finalizeEpoch,
  };
}

/** Type alias for workflow proxy usage */
export type LedgerActivities = ReturnType<typeof createAttributionActivities>;
