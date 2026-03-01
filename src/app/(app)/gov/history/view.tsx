// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/gov/history/view`
 * Purpose: Client component displaying past epoch history as expandable table rows with EpochDetail.
 * Scope: Renders epoch history data fetched via useEpochHistory hook. Does not perform server-side logic or direct DB access.
 * Invariants: BigInt credits displayed via Number() for presentation only. Expand/collapse via ExpandableTableRow.
 * Side-effects: IO (via useEpochHistory hook)
 * Links: docs/spec/epoch-ledger.md, src/features/governance/types.ts
 * @public
 */

"use client";

import { CheckCircle, Clock, Eye } from "lucide-react";
import type { ReactElement } from "react";

import {
  Badge,
  ExpandableTableRow,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components";
import { EpochDetail } from "@/features/governance/components/EpochDetail";
import { useEpochHistory } from "@/features/governance/hooks/useEpochHistory";
import type { EpochView } from "@/features/governance/types";

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

export function EpochHistoryView(): ReactElement {
  const { data, isLoading, error } = useEpochHistory();

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h2 className="font-semibold text-destructive text-lg">
            Error loading epoch history
          </h2>
          <p className="text-muted-foreground text-sm">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-8">
        <div className="animate-pulse space-y-8">
          <div className="h-8 w-48 rounded-md bg-muted" />
          <div className="h-64 rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 font-bold text-3xl tracking-tight">
          Epoch History
        </h1>
        <p className="text-muted-foreground">
          Past epochs with signed credit distributions
        </p>
      </div>

      {data.epochs.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No past epochs</p>
          <p className="mt-2 text-muted-foreground text-sm">
            Completed epochs will appear here after they are finalized.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-16">#</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Contributors</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.epochs.map((epoch) => {
                const credits = epoch.poolTotalCredits
                  ? Number(epoch.poolTotalCredits)
                  : null;
                return (
                  <ExpandableTableRow
                    key={epoch.id}
                    colSpan={7}
                    cellClassNames={[
                      undefined,
                      undefined,
                      "text-right",
                      "text-right",
                      "text-right",
                    ]}
                    expandedContent={<EpochDetail epoch={epoch} />}
                    cells={[
                      <span key="id" className="font-bold text-foreground/60">
                        {epoch.id}
                      </span>,
                      <span key="period" className="text-sm">
                        {new Date(epoch.periodStart).toLocaleDateString()} —{" "}
                        {new Date(epoch.periodEnd).toLocaleDateString()}
                      </span>,
                      <span key="contributors" className="text-right text-sm">
                        {epoch.contributors.length}
                      </span>,
                      <span
                        key="credits"
                        className="text-right font-mono text-xs"
                      >
                        {credits != null ? credits.toLocaleString() : "—"}
                      </span>,
                      <div key="status" className="flex justify-end">
                        <StatusBadge status={epoch.status} />
                      </div>,
                    ]}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
