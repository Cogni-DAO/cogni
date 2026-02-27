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

function getDisplayName(
  platformLogin: string | null,
  userId: string
): string | null {
  return platformLogin ?? userId.slice(0, 8);
}

/** Minimal epoch shape expected from the list-epochs API. */
export interface EpochDto {
  readonly id: string;
  readonly status: "open" | "review" | "finalized";
  readonly periodStart: string;
  readonly periodEnd: string;
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
  readonly platformLogin: string | null;
  readonly artifactUrl: string | null;
  readonly eventTime: string;
  readonly selection: { readonly userId: string | null } | null;
}

/** Minimal statement line item shape from the epoch-statement API. */
export interface StatementLineItemDto {
  readonly user_id: string;
  readonly total_units: string;
  readonly share: string;
  readonly amount_credits: string;
}

/** Minimal statement shape from the epoch-statement API. */
export interface StatementDto {
  readonly poolTotalCredits: string;
  readonly items: readonly StatementLineItemDto[];
}

/**
 * Partition receipts into resolved (grouped by userId) and unresolved (grouped by platformLogin+source).
 * Pure helper — no IO.
 */
function partitionReceipts(receipts: readonly ApiIngestionReceipt[]): {
  receiptsByUser: Map<string, IngestionReceipt[]>;
  loginByUser: Map<string, string>;
  unresolvedCount: number;
  unresolvedActivities: UnresolvedActivity[];
} {
  const receiptsByUser = new Map<string, IngestionReceipt[]>();
  const loginByUser = new Map<string, string>();
  // Key: "source::platformLogin" → count
  const unresolvedMap = new Map<
    string,
    { login: string | null; source: string; count: number }
  >();
  let unresolvedCount = 0;

  for (const r of receipts) {
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
      continue;
    }
    const mapped: IngestionReceipt = {
      receiptId: r.receiptId,
      source: r.source,
      eventType: r.eventType,
      platformLogin: r.platformLogin,
      artifactUrl: r.artifactUrl,
      eventTime: r.eventTime,
    };
    const list = receiptsByUser.get(resolvedUser);
    if (list) {
      list.push(mapped);
    } else {
      receiptsByUser.set(resolvedUser, [mapped]);
    }
    if (r.platformLogin && !loginByUser.has(resolvedUser)) {
      loginByUser.set(resolvedUser, r.platformLogin);
    }
  }

  const unresolvedActivities: UnresolvedActivity[] = [...unresolvedMap.values()]
    .map((v) => ({
      platformLogin: v.login,
      source: v.source,
      eventCount: v.count,
    }))
    .sort((a, b) => b.eventCount - a.eventCount);

  return { receiptsByUser, loginByUser, unresolvedCount, unresolvedActivities };
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
  const { receiptsByUser, loginByUser, unresolvedCount, unresolvedActivities } =
    partitionReceipts(receipts);

  // Sum all proposed units for share calculation
  const totalProposed = allocations.reduce(
    (sum, a) => sum + Number(a.proposedUnits),
    0
  );

  const contributors: EpochContributor[] = allocations.map((alloc) => {
    const userReceipts = receiptsByUser.get(alloc.userId) ?? [];
    const login = loginByUser.get(alloc.userId) ?? null;
    const proposed = Number(alloc.proposedUnits);
    const share =
      totalProposed > 0
        ? Math.round((proposed / totalProposed) * 1000) / 10
        : 0;

    return {
      userId: alloc.userId,
      displayName: getDisplayName(login, alloc.userId),
      avatar: DEFAULT_AVATAR,
      color: DEFAULT_COLOR,
      proposedUnits: alloc.proposedUnits,
      finalUnits: alloc.finalUnits,
      creditShare: share,
      activityCount: alloc.activityCount,
      receipts: userReceipts,
    };
  });

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
 * Compose an EpochView for a finalized epoch from its frozen statement.
 * Uses statement.items as source of truth (immutable, deterministic).
 */
export function composeEpochViewFromStatement(
  epoch: EpochDto,
  statement: StatementDto,
  receipts: readonly ApiIngestionReceipt[]
): EpochView {
  const { receiptsByUser, loginByUser, unresolvedCount, unresolvedActivities } =
    partitionReceipts(receipts);

  const contributors: EpochContributor[] = statement.items.map((item) => {
    const userReceipts = receiptsByUser.get(item.user_id) ?? [];
    const login = loginByUser.get(item.user_id) ?? null;
    // share from statement is a decimal string (e.g. "0.35"); convert to percentage
    const share = Math.round(Number(item.share) * 1000) / 10;

    return {
      userId: item.user_id,
      displayName: getDisplayName(login, item.user_id),
      avatar: DEFAULT_AVATAR,
      color: DEFAULT_COLOR,
      proposedUnits: item.total_units,
      finalUnits: item.total_units,
      creditShare: share,
      activityCount: userReceipts.length,
      receipts: userReceipts,
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
    poolTotalCredits: statement.poolTotalCredits,
    contributors,
    unresolvedCount,
    unresolvedActivities,
  };
}
