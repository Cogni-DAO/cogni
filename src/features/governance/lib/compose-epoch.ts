// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/lib/compose-epoch`
 * Purpose: Joins flat ledger API responses into EpochView view models for the UI.
 * Scope: Pure functions. Accepts typed API response fragments. Does not perform IO or access external services.
 * Invariants:
 *   - ALL_MATH_BIGINT: credit/unit values stay as strings; Number() only for sorting/display derivation
 *   - Avatar/color are static placeholders (no profile system yet)
 *   - Events with curation.userId=null are counted in unresolvedCount/unresolvedActivities, not silently dropped
 * Side-effects: none
 * Links: src/features/governance/types.ts
 * @public
 */

import type {
  ActivityEvent,
  EpochContributor,
  EpochView,
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

/** Minimal activity event shape expected from the epoch-activity API. */
export interface ApiActivityEvent {
  readonly id: string;
  readonly source: string;
  readonly eventType: string;
  readonly platformLogin: string | null;
  readonly artifactUrl: string | null;
  readonly eventTime: string;
  readonly curation: { readonly userId: string | null } | null;
}

/** Minimal payout line shape from the epoch-statement API. */
export interface PayoutLineDto {
  readonly user_id: string;
  readonly total_units: string;
  readonly share: string;
  readonly amount_credits: string;
}

/** Minimal statement shape from the epoch-statement API. */
export interface StatementDto {
  readonly poolTotalCredits: string;
  readonly payouts: readonly PayoutLineDto[];
}

/**
 * Partition events into resolved (grouped by userId) and unresolved (grouped by platformLogin+source).
 * Pure helper — no IO.
 */
function partitionEvents(events: readonly ApiActivityEvent[]): {
  eventsByUser: Map<string, ActivityEvent[]>;
  loginByUser: Map<string, string>;
  unresolvedCount: number;
  unresolvedActivities: UnresolvedActivity[];
} {
  const eventsByUser = new Map<string, ActivityEvent[]>();
  const loginByUser = new Map<string, string>();
  // Key: "source::platformLogin" → count
  const unresolvedMap = new Map<
    string,
    { login: string | null; source: string; count: number }
  >();
  let unresolvedCount = 0;

  for (const ev of events) {
    const resolvedUser = ev.curation?.userId;
    if (!resolvedUser) {
      unresolvedCount++;
      const key = `${ev.source}::${ev.platformLogin ?? "<unknown>"}`;
      const existing = unresolvedMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        unresolvedMap.set(key, {
          login: ev.platformLogin,
          source: ev.source,
          count: 1,
        });
      }
      continue;
    }
    const mapped: ActivityEvent = {
      id: ev.id,
      source: ev.source,
      eventType: ev.eventType,
      platformLogin: ev.platformLogin,
      artifactUrl: ev.artifactUrl,
      eventTime: ev.eventTime,
    };
    const list = eventsByUser.get(resolvedUser);
    if (list) {
      list.push(mapped);
    } else {
      eventsByUser.set(resolvedUser, [mapped]);
    }
    if (ev.platformLogin && !loginByUser.has(resolvedUser)) {
      loginByUser.set(resolvedUser, ev.platformLogin);
    }
  }

  const unresolvedActivities: UnresolvedActivity[] = [...unresolvedMap.values()]
    .map((v) => ({
      platformLogin: v.login,
      source: v.source,
      eventCount: v.count,
    }))
    .sort((a, b) => b.eventCount - a.eventCount);

  return { eventsByUser, loginByUser, unresolvedCount, unresolvedActivities };
}

/**
 * Compose an EpochView for a current (open/review) epoch from live allocations + activity.
 * Uses mutable allocations as source of truth (appropriate for in-progress data).
 */
export function composeEpochView(
  epoch: EpochDto,
  allocations: readonly AllocationDto[],
  events: readonly ApiActivityEvent[]
): EpochView {
  const { eventsByUser, loginByUser, unresolvedCount, unresolvedActivities } =
    partitionEvents(events);

  // Sum all proposed units for share calculation
  const totalProposed = allocations.reduce(
    (sum, a) => sum + Number(a.proposedUnits),
    0
  );

  const contributors: EpochContributor[] = allocations.map((alloc) => {
    const userEvents = eventsByUser.get(alloc.userId) ?? [];
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
      activities: userEvents,
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
 * Compose an EpochView for a finalized epoch from its frozen payout statement.
 * Uses statement.payouts as source of truth (immutable, deterministic).
 */
export function composeEpochViewFromStatement(
  epoch: EpochDto,
  statement: StatementDto,
  events: readonly ApiActivityEvent[]
): EpochView {
  const { eventsByUser, loginByUser, unresolvedCount, unresolvedActivities } =
    partitionEvents(events);

  const contributors: EpochContributor[] = statement.payouts.map((payout) => {
    const userEvents = eventsByUser.get(payout.user_id) ?? [];
    const login = loginByUser.get(payout.user_id) ?? null;
    // share from statement is a decimal string (e.g. "0.35"); convert to percentage
    const share = Math.round(Number(payout.share) * 1000) / 10;

    return {
      userId: payout.user_id,
      displayName: getDisplayName(login, payout.user_id),
      avatar: DEFAULT_AVATAR,
      color: DEFAULT_COLOR,
      proposedUnits: payout.total_units,
      finalUnits: payout.total_units,
      creditShare: share,
      activityCount: userEvents.length,
      activities: userEvents,
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
