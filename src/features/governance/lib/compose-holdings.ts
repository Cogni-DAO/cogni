// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/lib/compose-holdings`
 * Purpose: Aggregates payout statements across finalized epochs into cumulative holdings.
 * Scope: Pure function. Does not perform IO or access external services.
 * Invariants:
 *   - ALL_MATH_BIGINT: credit values stay as strings until final display derivation
 *   - Source of truth is frozen payout statements (not mutable allocations)
 * Side-effects: none
 * Links: src/features/governance/types.ts
 * @public
 */

import type { HoldingsData, HoldingView } from "@/features/governance/types";

import type { EpochDto, StatementDto } from "./compose-epoch";

const DEFAULT_AVATAR = "👤";
const DEFAULT_COLOR = "220 15% 50%";

/**
 * Aggregate statement payouts across all finalized epochs into cumulative holdings.
 * Each entry in `statements` corresponds 1:1 with the epoch at the same index in `epochs`.
 * Statements may be null if not yet generated (skip those epochs).
 */
export function composeHoldings(
  epochs: readonly EpochDto[],
  statements: readonly (StatementDto | null)[]
): HoldingsData {
  const userMap = new Map<
    string,
    {
      userId: string;
      totalCredits: number;
      epochs: Set<string>;
    }
  >();

  let totalCreditsAll = 0;

  for (let i = 0; i < epochs.length; i++) {
    const epoch = epochs[i];
    const statement = statements[i];
    if (!(epoch && statement)) {
      continue;
    }

    for (const payout of statement.payouts) {
      const credits = Number(payout.amount_credits);
      totalCreditsAll += credits;

      const existing = userMap.get(payout.user_id);
      if (existing) {
        existing.totalCredits += credits;
        existing.epochs.add(epoch.id);
      } else {
        userMap.set(payout.user_id, {
          userId: payout.user_id,
          totalCredits: credits,
          epochs: new Set([epoch.id]),
        });
      }
    }
  }

  const entries = [...userMap.values()];

  const holdings: HoldingView[] = entries
    .sort((a, b) => b.totalCredits - a.totalCredits)
    .map((e) => ({
      userId: e.userId,
      displayName: e.userId.slice(0, 8),
      avatar: DEFAULT_AVATAR,
      color: DEFAULT_COLOR,
      totalCredits: String(e.totalCredits),
      ownershipPercent:
        totalCreditsAll > 0
          ? Math.round((e.totalCredits / totalCreditsAll) * 1000) / 10
          : 0,
      epochsContributed: e.epochs.size,
    }));

  const epochsWithStatements = statements.filter(Boolean).length;

  return {
    holdings,
    totalCreditsIssued: String(totalCreditsAll),
    totalContributors: entries.length,
    epochsCompleted: epochsWithStatements,
  };
}
