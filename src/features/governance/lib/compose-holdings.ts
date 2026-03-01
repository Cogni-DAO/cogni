// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/lib/compose-holdings`
 * Purpose: Aggregates finalized claimant attribution across epochs into cumulative holdings.
 * Scope: Pure function. Does not perform IO or access external services.
 * Invariants:
 *   - ALL_MATH_BIGINT: credit values stay as strings until final display derivation
 *   - Source of truth is finalized claimant attribution (not mutable allocations)
 * Side-effects: none
 * Links: src/features/governance/types.ts
 * @public
 */

import type { HoldingsData, HoldingView } from "@/features/governance/types";

import type {
  EpochClaimantDto,
  EpochClaimantsDto,
  EpochDto,
} from "./compose-epoch";

const DEFAULT_AVATAR = "👤";
const DEFAULT_COLOR = "220 15% 50%";

function describeClaimant(claimant: EpochClaimantDto): {
  claimantKind: "user" | "identity";
  displayName: string | null;
  claimantLabel: string;
} {
  if (claimant.kind === "user") {
    return {
      claimantKind: "user",
      displayName: claimant.userId.slice(0, 8),
      claimantLabel: claimant.userId.slice(0, 8),
    };
  }

  return {
    claimantKind: "identity",
    displayName:
      claimant.providerLogin ??
      `${claimant.provider}:${claimant.externalId.slice(0, 8)}`,
    claimantLabel: `Unclaimed ${claimant.provider} identity`,
  };
}

/**
 * Aggregate finalized claimant line items across all finalized epochs into cumulative holdings.
 * Each entry in `claimants` corresponds 1:1 with the epoch at the same index in `epochs`.
 */
export function composeHoldings(
  epochs: readonly EpochDto[],
  claimants: readonly EpochClaimantsDto[]
): HoldingsData {
  const claimantMap = new Map<
    string,
    {
      claimant: EpochClaimantDto;
      claimantKey: string;
      totalCredits: number;
      epochs: Set<string>;
    }
  >();

  let totalCreditsAll = 0;

  for (let i = 0; i < epochs.length; i++) {
    const epoch = epochs[i];
    const epochClaimants = claimants[i];
    if (!epoch || !epochClaimants) continue;

    for (const item of epochClaimants.items) {
      const credits = Number(item.amountCredits);
      totalCreditsAll += credits;

      const existing = claimantMap.get(item.claimantKey);
      if (existing) {
        existing.totalCredits += credits;
        existing.epochs.add(epoch.id);
      } else {
        claimantMap.set(item.claimantKey, {
          claimant: item.claimant,
          claimantKey: item.claimantKey,
          totalCredits: credits,
          epochs: new Set([epoch.id]),
        });
      }
    }
  }

  const entries = [...claimantMap.values()];

  const holdings: HoldingView[] = entries
    .sort((a, b) => b.totalCredits - a.totalCredits)
    .map((entry) => {
      const descriptor = describeClaimant(entry.claimant);
      return {
        claimantKey: entry.claimantKey,
        claimantKind: descriptor.claimantKind,
        displayName: descriptor.displayName,
        claimantLabel: descriptor.claimantLabel,
        avatar: DEFAULT_AVATAR,
        color: DEFAULT_COLOR,
        totalCredits: String(entry.totalCredits),
        ownershipPercent:
          totalCreditsAll > 0
            ? Math.round((entry.totalCredits / totalCreditsAll) * 1000) / 10
            : 0,
        epochsContributed: entry.epochs.size,
      };
    });

  return {
    holdings,
    totalCreditsIssued: String(totalCreditsAll),
    totalContributors: entries.length,
    epochsCompleted: claimants.length,
  };
}
