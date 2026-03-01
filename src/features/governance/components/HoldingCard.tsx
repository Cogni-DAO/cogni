// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/components/HoldingCard`
 * Purpose: Contributor row in the holdings view — avatar, credits, ownership bar.
 * Scope: Governance feature component. Shows credit balance and ownership percentage. Does not perform data fetching or server-side logic.
 * Invariants: BigInt credits displayed via Number() for presentation only. Progress bar maps to ownership%.
 * Side-effects: none
 * Links: src/features/governance/types.ts
 * @public
 */

"use client";

import type { ReactElement } from "react";

import { Badge, Card, CardContent, Progress } from "@/components";
import type { HoldingView } from "@/features/governance/types";

interface HoldingCardProps {
  readonly holding: HoldingView;
  readonly rank: number;
}

export function HoldingCard({ holding, rank }: HoldingCardProps): ReactElement {
  const credits = Number(holding.totalCredits);

  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-lg"
              style={{
                backgroundColor: `hsl(${holding.color} / 0.15)`,
              }}
            >
              {holding.avatar}
            </div>
            <div>
              <div className="flex items-center gap-2 font-medium text-sm">
                <span>
                  #{rank} · {holding.displayName ?? "Contributor"}
                </span>
                {!holding.isLinked && (
                  <Badge intent="outline" size="sm" className="h-5 px-1.5">
                    Unlinked
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground text-xs">
                {holding.epochsContributed} epochs
              </div>
            </div>
          </div>
          <div className="text-right">
            <div
              className="font-bold"
              style={{ color: `hsl(${holding.color})` }}
            >
              {credits.toLocaleString()} credits
            </div>
            <div className="font-mono text-accent text-sm">
              {holding.ownershipPercent}%
            </div>
          </div>
        </div>
        <Progress
          value={holding.ownershipPercent}
          className="h-1.5 bg-secondary"
        />
      </CardContent>
    </Card>
  );
}
