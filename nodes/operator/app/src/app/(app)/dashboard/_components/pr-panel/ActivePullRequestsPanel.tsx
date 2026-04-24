// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/pr-panel/ActivePullRequestsPanel`
 * Purpose: Active Pull Requests card for the operator dashboard. Renders a list
 *          of `PrPanelEntry` rows with summary counts in the header.
 * Scope: Presentational. Consumes the fetcher output verbatim.
 * Invariants: Summary counts derived from overall row status only.
 * Side-effects: none
 * Links:
 *   - [PrPanelRow](./PrPanelRow.tsx)
 *   - [pr-panel.types](./pr-panel.types.ts)
 * @public
 */

import type { ReactElement } from "react";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components";
import { groupChecks, overallStatus, type UiCheckStatus } from "./group-checks";
import { PrPanelRow } from "./PrPanelRow";
import type { PrPanelEntry } from "./pr-panel.types";
import { StatusDot } from "./StatusDot";

function rowOverall(entry: PrPanelEntry): UiCheckStatus {
  const groups = groupChecks(entry.ci.checks);
  return overallStatus({
    ci: groups.find((g) => g.id === "ci")?.status ?? "pending",
    flight: groups.find((g) => g.id === "flight")?.status,
    deployVerified: entry.flight?.deployVerified ?? false,
  });
}

function countByStatus(entries: PrPanelEntry[]): Record<UiCheckStatus, number> {
  const counts: Record<UiCheckStatus, number> = {
    passing: 0,
    running: 0,
    failed: 0,
    pending: 0,
  };
  for (const e of entries) counts[rowOverall(e)] += 1;
  return counts;
}

export function ActivePullRequestsPanel({
  entries,
}: {
  entries: PrPanelEntry[];
}): ReactElement {
  const counts = countByStatus(entries);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="font-semibold text-base">
            Active Pull Requests
          </CardTitle>
          <CardDescription>
            {entries.length} open PRs with CI + flight status
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {counts.passing > 0 && (
            <Badge intent="secondary" size="sm">
              <StatusDot status="passing" className="mr-1.5" />
              {counts.passing} Passing
            </Badge>
          )}
          {counts.running > 0 && (
            <Badge intent="default" size="sm">
              <StatusDot status="running" className="mr-1.5" />
              {counts.running} Running
            </Badge>
          )}
          {counts.failed > 0 && (
            <Badge intent="destructive" size="sm">
              <StatusDot status="failed" className="mr-1.5" />
              {counts.failed} Failed
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {entries.length > 0 ? (
          <div className="divide-y divide-border">
            {entries.map((entry) => (
              <PrPanelRow key={entry.pr.number} entry={entry} />
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">
            No open pull requests.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
