// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/attribution/claimants.server`
 * Purpose: Server-only facade helpers for claimant-aware attribution reads.
 * Scope: Loads canonical claimant-share evaluations, applies resolved-user overrides, and maps results to contract output. Does not handle HTTP transport.
 * Invariants:
 * - FINALIZED_ATTRIBUTION_PREFERS_LOCKED_EVALUATIONS: finalized reads use locked claimant-share evaluations when available
 * - FALLBACK_SAFE: missing/invalid evaluation payloads fall back to deterministic receipt-backed claimant shares
 * - ALLOCATION_OVERRIDES_OPTIONAL: final_units only override resolved user claimants, leaving unresolved identities intact
 * Side-effects: IO (database reads)
 * Links: src/contracts/attribution.epoch-claimants.v1.contract.ts
 * @public
 */

import {
  type AttributionClaimant,
  type AttributionEpoch,
  type AttributionStore,
  buildClaimantAllocations,
  buildDefaultReceiptClaimantSharesPayload,
  CLAIMANT_SHARES_EVALUATION_REF,
  type ClaimantSharesSubject,
  claimantKey,
  computeClaimantCreditLineItems,
  parseClaimantSharesPayload,
} from "@cogni/attribution-ledger";

import { getContainer } from "@/bootstrap/container";
import type {
  EpochClaimantLineItemDto,
  EpochClaimantsOutput,
} from "@/contracts/attribution.epoch-claimants.v1.contract";

export async function loadClaimantShareSubjectsForEpoch(
  store: AttributionStore,
  epoch: AttributionEpoch
): Promise<readonly ClaimantSharesSubject[]> {
  const evaluationStatus = epoch.status === "finalized" ? "locked" : "draft";
  const evaluation = await store.getEvaluation(
    epoch.id,
    CLAIMANT_SHARES_EVALUATION_REF,
    evaluationStatus
  );
  const parsed = parseClaimantSharesPayload(evaluation?.payloadJson ?? null);
  if (parsed) return parsed.subjects;

  const receipts = await store.getSelectedReceiptsForAttribution(epoch.id);
  return buildDefaultReceiptClaimantSharesPayload({
    receipts,
    weightConfig: epoch.weightConfig,
  }).subjects;
}

function toLineItemDto(params: {
  claimant: AttributionClaimant;
  totalUnits: bigint;
  share: string;
  amountCredits: bigint;
  receiptIds: readonly string[];
}): EpochClaimantLineItemDto {
  return {
    claimantKey: claimantKey(params.claimant),
    claimant: params.claimant,
    totalUnits: params.totalUnits.toString(),
    share: params.share,
    amountCredits: params.amountCredits.toString(),
    receiptIds: [...params.receiptIds],
  };
}

function parseClaimantItemsFromStatement(
  statementItems: ReadonlyArray<{
    user_id: string;
    total_units: string;
    share: string;
    amount_credits: string;
    claimant_key?: string;
    claimant?: AttributionClaimant;
    receipt_ids?: readonly string[];
  }>
): EpochClaimantLineItemDto[] | null {
  const parsedItems: EpochClaimantLineItemDto[] = [];

  for (const item of statementItems) {
    if (!item.claimant_key || !item.claimant) {
      return null;
    }

    let totalUnits: bigint;
    let amountCredits: bigint;
    try {
      totalUnits = BigInt(item.total_units);
      amountCredits = BigInt(item.amount_credits);
    } catch {
      return null;
    }

    parsedItems.push(
      toLineItemDto({
        claimant: item.claimant,
        totalUnits,
        share: item.share,
        amountCredits,
        receiptIds: item.receipt_ids ?? [],
      })
    );
  }

  return parsedItems;
}

export async function readFinalizedEpochClaimants(
  epochId: bigint
): Promise<EpochClaimantsOutput> {
  const store = getContainer().attributionStore;
  const epoch = await store.getEpoch(epochId);
  if (!epoch) {
    throw new Error(
      `readFinalizedEpochClaimants: epoch ${epochId.toString()} not found`
    );
  }
  if (epoch.status !== "finalized") {
    throw new Error(
      `readFinalizedEpochClaimants: epoch ${epochId.toString()} is '${epoch.status}', expected 'finalized'`
    );
  }
  if (epoch.poolTotalCredits === null) {
    throw new Error(
      `readFinalizedEpochClaimants: epoch ${epochId.toString()} missing poolTotalCredits`
    );
  }

  const statement = await store.getStatementForEpoch(epoch.id);
  const statementItems = statement
    ? parseClaimantItemsFromStatement(statement.statementItems)
    : null;
  if (statement && statementItems) {
    return {
      epochId: epoch.id.toString(),
      poolTotalCredits: statement.poolTotalCredits.toString(),
      items: statementItems,
    };
  }

  const [subjects, allocations] = await Promise.all([
    loadClaimantShareSubjectsForEpoch(store, epoch),
    store.getAllocationsForEpoch(epoch.id),
  ]);

  const claimantAllocations = buildClaimantAllocations(
    subjects,
    new Map(
      allocations
        .filter((allocation) => allocation.finalUnits !== null)
        .map((allocation) => [
          allocation.userId,
          allocation.finalUnits as bigint,
        ])
    )
  );

  const items = computeClaimantCreditLineItems(
    claimantAllocations,
    epoch.poolTotalCredits
  ).map(toLineItemDto);

  return {
    epochId: epoch.id.toString(),
    poolTotalCredits: epoch.poolTotalCredits.toString(),
    items,
  };
}
