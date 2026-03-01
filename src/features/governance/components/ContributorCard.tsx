// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/components/ContributorCard`
 * Purpose: Card displaying a contributor's rank, score, share, and activity breakdown.
 * Scope: Governance feature component for epoch detail pages. Does not perform data fetching or server-side logic.
 * Invariants: Colors applied via inline style (runtime HSL values). BigInt units displayed as Number for presentation.
 * Side-effects: none
 * Links: src/features/governance/types.ts
 * @public
 */

"use client";

import type { ReactElement } from "react";

import { Badge, Card, CardContent } from "@/components";
import type { EpochContributor } from "@/features/governance/types";

import { ContributionRow } from "./ContributionRow";

interface ContributorCardProps {
  readonly contributor: EpochContributor;
  readonly rank: number;
}

export function ContributorCard({
  contributor,
  rank,
}: ContributorCardProps): ReactElement {
  const totalScore = Math.round(Number(contributor.proposedUnits) / 1000);

  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-lg"
              style={{
                backgroundColor: `hsl(${contributor.color} / 0.15)`,
              }}
            >
              {contributor.avatar}
            </div>
            <div>
              <span className="text-muted-foreground text-sm">#{rank}</span>
              <div className="flex items-center gap-2 font-medium text-sm">
                <span>{contributor.displayName ?? "Contributor"}</span>
                {!contributor.isLinked && (
                  <Badge intent="outline" size="sm" className="h-5 px-1.5">
                    Unlinked
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground text-xs">
                {contributor.creditShare}% share · {contributor.activityCount}{" "}
                contributions
              </div>
            </div>
          </div>
          <div className="text-right">
            <div
              className="font-bold text-lg"
              style={{ color: `hsl(${contributor.color})` }}
            >
              {totalScore}
            </div>
            <div className="text-muted-foreground text-xs">points</div>
          </div>
        </div>
        <div className="space-y-1.5">
          {contributor.receipts.map((receipt) => (
            <ContributionRow key={receipt.receiptId} receipt={receipt} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
