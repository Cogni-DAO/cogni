// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/lib/compose-epoch`
 * Purpose: Joins flat ledger API responses into EpochView view models for the UI.
 * Scope: Pure functions. Accepts typed API response fragments. Does not perform IO or access external services.
 * Invariants:
 *   - ALL_MATH_BIGINT: credit/unit values stay as strings; Number() only for sorting/display derivation
 *   - Avatar/color are static placeholders (no profile system yet)
 *   - Receipts with selection.userId=null are counted in unresolvedCount/unresolvedActivities, not silently dropped
 * Side-effects: none
 * Links: src/features/governance/types.ts
 * @public
 */

import type {
  EpochContributor,
  EpochView,
  IngestionReceipt,
  UnresolvedActivity,
} from "@/features/governance/types";

const DEFAULT_AVATAR = "👤";
const DEFAULT_COLOR = "220 15% 50%";

function formatSourceName(source: string): string {
  switch (source) {
    case "github":
      return "GitHub";
    case "discord":
      return "Discord";
    case "google":
      return "Google";
    default:
      return source.charAt(0).toUpperCase() + source.slice(1);
  }
}

function resolveDisplayName(platformLogin: string | null): string | null {
  const trimmed = platformLogin?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function roundSharePercent(units: bigint, totalUnits: bigint): number {
  if (totalUnits <= 0n) return 0;
  return Math.round((Number(units) / Number(totalUnits)) * 1000) / 10;
}

function describeClaimant(params: {
  claimant: EpochClaimantDto;
  receipts: readonly IngestionReceipt[];
}): {
  claimantKind: "user" | "identity";
  displayName: string | null;
  claimantLabel: string;
} {
  const receiptLogin =
    params.receipts.find((receipt) => receipt.platformLogin)?.platformLogin ??
    null;

  if (params.claimant.kind === "user") {
    return {
      claimantKind: "user",
      displayName: resolveDisplayName(receiptLogin),
      claimantLabel: "Linked account",
    };
  }

  const fallback = params.claimant.providerLogin ?? receiptLogin;

  return {
    claimantKind: "identity",
    displayName: resolveDisplayName(fallback),
    claimantLabel: `${formatSourceName(params.claimant.provider)} account`,
  };
}

/** Minimal epoch shape expected from the list-epochs API. */
export interface EpochDto {
  readonly id: string;
  readonly status: "open" | "review" | "finalized";
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly weightConfig: Record<string, number>;
  readonly poolTotalCredits: string | null;
}

/** Minimal allocation shape expected from the epoch-allocations API. */
export interface AllocationDto {
  readonly userId: string;
  readonly proposedUnits: string;
  readonly finalUnits: string | null;
  readonly activityCount: number;
}

/** Minimal ingestion receipt shape expected from the epoch-activity API. */
export interface ApiIngestionReceipt {
  readonly receiptId: string;
  readonly source: string;
  readonly eventType: string;
  readonly platformUserId: string;
  readonly platformLogin: string | null;
  readonly artifactUrl: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly eventTime: string;
  readonly selection: {
    readonly userId: string | null;
    readonly included: boolean;
    readonly weightOverrideMilli: string | null;
  } | null;
}

/** Minimal claimant shape expected from the epoch-claimants API. */
export type EpochClaimantDto =
  | {
      readonly kind: "user";
      readonly userId: string;
    }
  | {
      readonly kind: "identity";
      readonly provider: string;
      readonly externalId: string;
      readonly providerLogin: string | null;
    };

/** Minimal claimant line item shape from the epoch-claimants API. */
export interface EpochClaimantLineItemDto {
  readonly claimantKey: string;
  readonly claimant: EpochClaimantDto;
  readonly displayName: string | null;
  readonly isLinked: boolean;
  readonly totalUnits: string;
  readonly share: string;
  readonly amountCredits: string;
  readonly receiptIds: readonly string[];
}

/** Minimal claimant-attribution response shape from the epoch-claimants API. */
export interface EpochClaimantsDto {
  readonly epochId: string;
  readonly poolTotalCredits: string;
  readonly items: readonly EpochClaimantLineItemDto[];
}

/**
 * Partition receipts into resolved (grouped by userId) and unresolved (grouped by platformLogin+source).
 * Pure helper — no IO.
 */
function partitionReceipts(receipts: readonly ApiIngestionReceipt[]): {
  receiptsById: Map<string, IngestionReceipt>;
  unresolvedCount: number;
  unresolvedActivities: UnresolvedActivity[];
} {
  const receiptsById = new Map<string, IngestionReceipt>();
  // Key: "source::platformLogin" → count
  const unresolvedMap = new Map<
    string,
    { login: string | null; source: string; count: number }
  >();
  let unresolvedCount = 0;

  for (const r of receipts) {
    const mapped: IngestionReceipt = {
      receiptId: r.receiptId,
      source: r.source,
      eventType: r.eventType,
      platformLogin: r.platformLogin,
      artifactUrl: r.artifactUrl,
      eventTime: r.eventTime,
      units: null,
      metadata: r.metadata ?? null,
    };
    receiptsById.set(r.receiptId, mapped);

    if (r.selection?.included === false) {
      continue;
    }

    const resolvedUser = r.selection?.userId;
    if (!resolvedUser) {
      unresolvedCount++;
      const key = `${r.source}::${r.platformLogin ?? "<unknown>"}`;
      const existing = unresolvedMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        unresolvedMap.set(key, {
          login: r.platformLogin,
          source: r.source,
          count: 1,
        });
      }
    }
  }

  const unresolvedActivities: UnresolvedActivity[] = [...unresolvedMap.values()]
    .map((v) => ({
      platformLogin: v.login,
      source: v.source,
      eventCount: v.count,
    }))
    .sort((a, b) => b.eventCount - a.eventCount);

  return {
    receiptsById,
    unresolvedCount,
    unresolvedActivities,
  };
}

/**
 * Compose an EpochView for a current (open/review) epoch from live allocations + receipts.
 * Uses mutable allocations as source of truth (appropriate for in-progress data).
 */
export function composeEpochView(
  epoch: EpochDto,
  allocations: readonly AllocationDto[],
  receipts: readonly ApiIngestionReceipt[]
): EpochView {
  const { receiptsById, unresolvedCount, unresolvedActivities } =
    partitionReceipts(receipts);
  const allocationByUser = new Map(
    allocations.map((alloc) => [alloc.userId, alloc])
  );
  const contributorMap = new Map<
    string,
    {
      claimantKey: string;
      claimantKind: "user" | "identity";
      displayName: string | null;
      claimantLabel: string;
      proposedUnits: bigint;
      finalUnits: string | null;
      receipts: IngestionReceipt[];
    }
  >();

  for (const receipt of receipts) {
    if (receipt.selection?.included === false) {
      continue;
    }

    const baseReceipt = receiptsById.get(receipt.receiptId);
    if (!baseReceipt) {
      continue;
    }

    const weight =
      receipt.selection?.weightOverrideMilli !== null &&
      receipt.selection?.weightOverrideMilli !== undefined
        ? BigInt(receipt.selection.weightOverrideMilli)
        : BigInt(
            epoch.weightConfig[`${receipt.source}:${receipt.eventType}`] ?? 0
          );

    if (weight <= 0n) {
      continue;
    }

    const mappedReceipt: IngestionReceipt = {
      ...baseReceipt,
      units: weight.toString(),
    };

    const userId = receipt.selection?.userId ?? null;
    if (userId) {
      const key = `user:${userId}`;
      const existing = contributorMap.get(key);
      if (existing) {
        existing.proposedUnits += weight;
        existing.receipts.push(mappedReceipt);
      } else {
        contributorMap.set(key, {
          claimantKey: key,
          claimantKind: "user",
          displayName: resolveDisplayName(receipt.platformLogin),
          claimantLabel: "Linked account",
          proposedUnits: weight,
          finalUnits: allocationByUser.get(userId)?.finalUnits ?? null,
          receipts: [mappedReceipt],
        });
      }
      continue;
    }

    const key = `identity:${receipt.source}:${receipt.platformUserId}`;
    const existing = contributorMap.get(key);
    if (existing) {
      existing.proposedUnits += weight;
      existing.receipts.push(mappedReceipt);
    } else {
      contributorMap.set(key, {
        claimantKey: key,
        claimantKind: "identity",
        displayName: resolveDisplayName(receipt.platformLogin),
        claimantLabel: `${formatSourceName(receipt.source)} account`,
        proposedUnits: weight,
        finalUnits: null,
        receipts: [mappedReceipt],
      });
    }
  }

  const totalProposed = [...contributorMap.values()].reduce(
    (sum, contributor) => sum + contributor.proposedUnits,
    0n
  );

  const contributors: EpochContributor[] = [...contributorMap.values()].map(
    (contributor) => ({
      claimantKey: contributor.claimantKey,
      claimantKind: contributor.claimantKind,
      isLinked: contributor.claimantKind === "user",
      displayName: contributor.displayName,
      claimantLabel: contributor.claimantLabel,
      avatar: DEFAULT_AVATAR,
      color: DEFAULT_COLOR,
      proposedUnits: contributor.proposedUnits.toString(),
      finalUnits: contributor.finalUnits,
      creditShare: roundSharePercent(contributor.proposedUnits, totalProposed),
      activityCount: contributor.receipts.length,
      receipts: contributor.receipts,
    })
  );

  // Sort by proposedUnits DESC
  contributors.sort(
    (a, b) => Number(b.proposedUnits) - Number(a.proposedUnits)
  );

  return {
    id: epoch.id,
    status: epoch.status,
    periodStart: epoch.periodStart,
    periodEnd: epoch.periodEnd,
    poolTotalCredits: epoch.poolTotalCredits,
    contributors,
    unresolvedCount,
    unresolvedActivities,
  };
}

/**
 * Compose an EpochView for a finalized epoch from claimant-based finalized attribution.
 */
export function composeEpochViewFromClaimants(
  epoch: EpochDto,
  claimants: Pick<EpochClaimantsDto, "poolTotalCredits" | "items">,
  receipts: readonly ApiIngestionReceipt[]
): EpochView {
  const { receiptsById, unresolvedCount, unresolvedActivities } =
    partitionReceipts(receipts);

  const contributors: EpochContributor[] = claimants.items.map((item) => {
    const claimantReceipts = item.receiptIds
      .map((receiptId) => receiptsById.get(receiptId) ?? null)
      .filter((receipt): receipt is IngestionReceipt => receipt !== null);
    const descriptor = describeClaimant({
      claimant: item.claimant,
      receipts: claimantReceipts,
    });
    const share = Math.round(Number(item.share) * 1000) / 10;

    return {
      claimantKey: item.claimantKey,
      claimantKind: descriptor.claimantKind,
      isLinked: item.isLinked,
      displayName: item.displayName ?? descriptor.displayName,
      claimantLabel: descriptor.claimantLabel,
      avatar: DEFAULT_AVATAR,
      color: DEFAULT_COLOR,
      proposedUnits: item.totalUnits,
      finalUnits: item.totalUnits,
      creditShare: share,
      activityCount: claimantReceipts.length,
      receipts: claimantReceipts,
    };
  });

  // Sort by amount_credits DESC
  contributors.sort(
    (a, b) => Number(b.proposedUnits) - Number(a.proposedUnits)
  );

  return {
    id: epoch.id,
    status: epoch.status,
    periodStart: epoch.periodStart,
    periodEnd: epoch.periodEnd,
    poolTotalCredits: claimants.poolTotalCredits,
    contributors,
    unresolvedCount,
    unresolvedActivities,
  };
}

/** Override entry shape matching useSubjectOverrides output. */
export interface OverrideEntry {
  readonly subjectRef: string;
  readonly overrideUnits: string | null;
}

/**
 * Recompute contributor sums after applying subject overrides client-side.
 * Override units are in display scale (e.g. "2"); receipt.units are milli-units (e.g. "8000").
 * Receipts are never mutated — only contributor-level proposedUnits and shares are recomputed.
 */
export function applyOverridesToEpochView(
  epoch: EpochView,
  overrides: ReadonlyMap<string, OverrideEntry>
): EpochView {
  if (overrides.size === 0) return epoch;

  const updatedContributors: EpochContributor[] = epoch.contributors.map(
    (contributor) => {
      let totalUnits = 0n;
      for (const receipt of contributor.receipts) {
        const override = overrides.get(receipt.receiptId);
        if (override?.overrideUnits != null) {
          totalUnits += BigInt(override.overrideUnits) * 1000n;
        } else {
          totalUnits += BigInt(receipt.units ?? "0");
        }
      }
      return { ...contributor, proposedUnits: totalUnits.toString() };
    }
  );

  // Recompute shares
  const grandTotal = updatedContributors.reduce(
    (sum, c) => sum + BigInt(c.proposedUnits),
    0n
  );
  const withShares: EpochContributor[] = updatedContributors.map((c) => ({
    ...c,
    creditShare: roundSharePercent(BigInt(c.proposedUnits), grandTotal),
  }));

  // Re-sort by proposedUnits DESC
  withShares.sort((a, b) => Number(b.proposedUnits) - Number(a.proposedUnits));

  return { ...epoch, contributors: withShares };
}
