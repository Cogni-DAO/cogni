// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/components/EpochCard`
 * Purpose: Collapsible card for an epoch in the history view.
 * Scope: Governance feature component. Shows epoch summary with unresolved-contributor warning, expandable to contributor breakdown with per-login detail. Does not perform data fetching or server-side logic.
 * Invariants: BigInt credits displayed via Number() for presentation only. No credit math in UI.
 * Side-effects: none
 * Links: src/features/governance/types.ts
 * @public
 */

"use client";

import { AlertTriangle, CheckCircle, Clock, Eye } from "lucide-react";
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
                {epoch.unresolvedCount > 0 && (
                  <span className="ml-1 text-warning">
                    ({epoch.unresolvedCount} unlinked)
                  </span>
                )}
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
            {epoch.unresolvedCount > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="text-sm">
                  <span className="font-medium text-warning">
                    {epoch.unresolvedCount} activity event
                    {epoch.unresolvedCount === 1 ? "" : "s"} from unlinked
                    accounts
                  </span>
                  <span className="text-muted-foreground">
                    {" — "}these contributors need to link their GitHub account
                    to receive credit.
                  </span>
                  {epoch.unresolvedActivities.length > 0 && (
                    <div className="mt-1 text-muted-foreground text-xs">
                      {epoch.unresolvedActivities.map((u) => (
                        <span
                          key={`${u.source}::${u.platformLogin}`}
                          className="mr-2"
                        >
                          {u.platformLogin ?? "unknown"} ({u.eventCount})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {sorted.map((c, i) => {
              const totalScore = Math.round(Number(c.proposedUnits) / 1000);
              const githubCount = c.activities.filter(
                (a) => a.source === "github"
              ).length;
              const discordCount = c.activities.filter(
                (a) => a.source === "discord"
              ).length;
              const userCredits =
                credits != null
                  ? Math.round((credits * c.creditShare) / 100)
                  : null;

              return (
                <div
                  key={c.userId}
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
                      <div className="font-medium text-sm">
                        #{i + 1} · {c.creditShare}% share
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {c.activityCount} contributions · {githubCount} GitHub ·{" "}
                        {discordCount} Discord
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
