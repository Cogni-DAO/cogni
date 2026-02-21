// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/gov/history/view`
 * Purpose: Client component displaying past epoch history with expandable contributor details.
 * Scope: Renders epoch history data fetched via useEpochHistory hook. Does not perform server-side logic or direct DB access.
 * Invariants: BigInt credits displayed via Number() for presentation only. Expand/collapse via local state.
 * Side-effects: IO (via useEpochHistory hook)
 * Links: docs/spec/epoch-ledger.md, src/contracts/governance.epoch.v1.contract.ts
 * @public
 */

"use client";

import type { ReactElement } from "react";
import { useState } from "react";

import { EpochCard } from "@/features/governance/components/EpochCard";
import { useEpochHistory } from "@/features/governance/hooks/useEpochHistory";

export function EpochHistoryView(): ReactElement {
  const { data, isLoading, error } = useEpochHistory();
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
          <div className="space-y-4">
            <div className="h-24 rounded-lg bg-muted" />
            <div className="h-24 rounded-lg bg-muted" />
            <div className="h-24 rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
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
        <div className="space-y-4">
          {data.epochs.map((epoch) => (
            <EpochCard
              key={epoch.id}
              epoch={epoch}
              expanded={expandedId === epoch.id}
              onToggle={() =>
                setExpandedId(expandedId === epoch.id ? null : epoch.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
