// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/attribution/claimants.server`
 * Purpose: Server-only facade helpers for claimant-aware attribution reads.
 * Scope: Loads canonical claimant-share evaluations, applies resolved-user overrides, and maps results to contract output. Does not handle HTTP transport.
 * Invariants:
 * - EVALUATION_STATUS_BY_EPOCH: open epochs read draft evaluations; review and finalized epochs read locked evaluations
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
  applySubjectOverrides,
  buildClaimantAllocations,
  buildDefaultReceiptClaimantSharesPayload,
  CLAIMANT_SHARES_EVALUATION_REF,
  type ClaimantSharesSubject,
  claimantKey,
  computeClaimantCreditLineItems,
  parseClaimantSharesPayload,
  type SubjectOverride,
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
  const evaluationStatus = epoch.status === "open" ? "draft" : "locked";
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
  displayName: string | null;
  isLinked: boolean;
  totalUnits: bigint;
  share: string;
  amountCredits: bigint;
  receiptIds: readonly string[];
}): EpochClaimantLineItemDto {
  return {
    claimantKey: claimantKey(params.claimant),
    claimant: params.claimant,
    displayName: params.displayName,
    isLinked: params.isLinked,
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

    parsedItems.push({
      claimantKey: claimantKey(item.claimant),
      claimant: item.claimant,
      displayName: null,
      isLinked: item.claimant.kind === "user",
      totalUnits: totalUnits.toString(),
      share: item.share,
      amountCredits: amountCredits.toString(),
      receiptIds: [...(item.receipt_ids ?? [])],
    });
  }

  return parsedItems;
}

async function enrichClaimantPresentation(
  store: AttributionStore,
  epoch: AttributionEpoch,
  items: readonly EpochClaimantLineItemDto[]
): Promise<EpochClaimantLineItemDto[]> {
  const receipts = await store.getReceiptsForWindow(
    epoch.nodeId,
    epoch.periodStart,
    epoch.periodEnd
  );
  const receiptsById = new Map(
    receipts.map((receipt) => [receipt.receiptId, receipt])
  );

  const githubIdentityIds = items
    .filter(
      (
        item
      ): item is EpochClaimantLineItemDto & {
        claimant: {
          kind: "identity";
          provider: "github";
          externalId: string;
          providerLogin: string | null;
        };
      } =>
        item.claimant.kind === "identity" && item.claimant.provider === "github"
    )
    .map((item) => item.claimant.externalId);

  const resolvedIdentities = await store.resolveIdentities(
    "github",
    githubIdentityIds
  );
  const userIds = new Set<string>();
  for (const item of items) {
    if (item.claimant.kind === "user") {
      userIds.add(item.claimant.userId);
      continue;
    }
    if (item.claimant.provider !== "github") continue;
    const resolvedUserId = resolvedIdentities.get(item.claimant.externalId);
    if (resolvedUserId) {
      userIds.add(resolvedUserId);
    }
  }

  const userDisplayNames = await store.getUserDisplayNames([...userIds]);

  return items.map((item) => {
    const receiptLogin =
      item.receiptIds
        .map(
          (receiptId) =>
            receiptsById.get(receiptId)?.platformLogin?.trim() ?? null
        )
        .find((login) => login && login.length > 0) ?? null;

    if (item.claimant.kind === "user") {
      return {
        ...item,
        displayName:
          userDisplayNames.get(item.claimant.userId) ?? receiptLogin ?? null,
        isLinked: true,
      };
    }

    if (item.claimant.provider !== "github") {
      return {
        ...item,
        displayName: item.claimant.providerLogin ?? receiptLogin ?? null,
        isLinked: false,
      };
    }

    const resolvedUserId = resolvedIdentities.get(item.claimant.externalId);
    if (!resolvedUserId) {
      return {
        ...item,
        displayName: item.claimant.providerLogin ?? receiptLogin ?? null,
        isLinked: false,
      };
    }

    return {
      ...item,
      displayName:
        userDisplayNames.get(resolvedUserId) ??
        item.claimant.providerLogin ??
        receiptLogin ??
        null,
      isLinked: true,
    };
  });
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
      items: await enrichClaimantPresentation(store, epoch, statementItems),
    };
  }

  const [subjects, overrideRecords] = await Promise.all([
    loadClaimantShareSubjectsForEpoch(store, epoch),
    store.getSubjectOverridesForEpoch(epoch.id),
  ]);

  const subjectOverrides: SubjectOverride[] = overrideRecords.map((r) => ({
    subjectRef: r.subjectRef,
    overrideUnits: r.overrideUnits,
    overrideShares: r.overrideSharesJson,
    overrideReason: r.overrideReason,
  }));

  const modifiedSubjects = applySubjectOverrides(subjects, subjectOverrides);
  const claimantAllocations = buildClaimantAllocations(modifiedSubjects);

  const items = computeClaimantCreditLineItems(
    claimantAllocations,
    epoch.poolTotalCredits
  ).map((item) =>
    toLineItemDto({
      claimant: item.claimant,
      displayName: null,
      isLinked: item.claimant.kind === "user",
      totalUnits: item.totalUnits,
      share: item.share,
      amountCredits: item.amountCredits,
      receiptIds: item.receiptIds,
    })
  );

  return {
    epochId: epoch.id.toString(),
    poolTotalCredits: epoch.poolTotalCredits.toString(),
    items: await enrichClaimantPresentation(store, epoch, items),
  };
}
