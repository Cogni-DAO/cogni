// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/components/EpochCard`
 * Purpose: Collapsible card for an epoch in the history view.
 * Scope: Governance feature component. Shows epoch summary with contributor breakdown. Does not perform data fetching or server-side logic.
 * Invariants: BigInt credits displayed via Number() for presentation only. No credit math in UI.
 * Side-effects: none
 * Links: src/features/governance/types.ts
 * @public
 */

"use client";

import { CheckCircle, Clock, Eye } from "lucide-react";
import type { ReactElement } from "react";
import { Badge, Card, CardContent } from "@/components";
import type { EpochView } from "@/features/governance/types";

interface EpochCardProps {
  readonly epoch: EpochView;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

function StatusBadge({
  status,
}: {
  status: EpochView["status"];
}): ReactElement {
  switch (status) {
    case "finalized":
      return (
        <Badge
          intent="outline"
          size="sm"
          className="gap-1 border-success/40 text-success"
        >
          <CheckCircle className="h-3 w-3" />
          Finalized
        </Badge>
      );
    case "review":
      return (
        <Badge
          intent="outline"
          size="sm"
          className="gap-1 border-warning/40 text-warning"
        >
          <Eye className="h-3 w-3" />
          Review
        </Badge>
      );
    default:
      return (
        <Badge intent="default" size="sm" className="animate-pulse gap-1">
          <Clock className="h-3 w-3" />
          Active
        </Badge>
      );
  }
}

export function EpochCard({
  epoch,
  expanded,
  onToggle,
}: EpochCardProps): ReactElement {
  const credits = epoch.poolTotalCredits
    ? Number(epoch.poolTotalCredits)
    : null;
  const sorted = [...epoch.contributors].sort(
    (a, b) => Number(b.proposedUnits) - Number(a.proposedUnits)
  );

  return (
    <Card
      className="cursor-pointer border-border/50 bg-card/50 transition-all hover:bg-card/70"
      onClick={onToggle}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="font-bold text-2xl text-foreground/60">
              #{epoch.id}
            </div>
            <div>
              <div className="font-medium">
                {new Date(epoch.periodStart).toLocaleDateString()} —{" "}
                {new Date(epoch.periodEnd).toLocaleDateString()}
              </div>
              <div className="mt-0.5 text-muted-foreground text-xs">
                {epoch.contributors.length} contributors
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {credits != null && (
              <div className="text-right">
                <div className="font-bold text-accent text-lg">
                  {credits.toLocaleString()}
                </div>
                <div className="text-muted-foreground text-xs">
                  credits distributed
                </div>
              </div>
            )}
            <StatusBadge status={epoch.status} />
          </div>
        </div>

        {expanded && (
          <div className="mt-4 space-y-3">
            {sorted.map((c, i) => {
              const totalScore = Math.round(Number(c.proposedUnits) / 1000);
              const userCredits =
                credits != null
                  ? Math.round((credits * c.creditShare) / 100)
                  : null;

              return (
                <div
                  key={c.claimantKey}
                  className="flex items-center justify-between rounded-lg bg-secondary/30 p-3"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: `hsl(${c.color} / 0.15)`,
                      }}
                    >
                      {c.avatar}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 font-medium text-sm">
                        <span>
                          #{i + 1} · {c.displayName ?? "Contributor"}
                        </span>
                        {!c.isLinked && (
                          <Badge
                            intent="outline"
                            size="sm"
                            className="h-5 px-1.5"
                          >
                            Unlinked
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {c.creditShare}% share · {c.activityCount} contributions
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="font-bold"
                      style={{ color: `hsl(${c.color})` }}
                    >
                      {totalScore} pts
                    </div>
                    {userCredits != null && (
                      <div className="text-accent text-xs">
                        {userCredits} credits
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
