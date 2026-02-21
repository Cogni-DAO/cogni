// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/gov/epoch/view`
 * Purpose: Client component displaying the current open epoch — countdown, contributors, and scoring.
 * Scope: Renders epoch data fetched via useCurrentEpoch hook. Does not perform server-side logic.
 * Invariants: BigInt units displayed via Number() for presentation only. No credit math in UI.
 * Side-effects: IO (via useCurrentEpoch hook)
 * Links: docs/spec/epoch-ledger.md, src/contracts/governance.epoch.v1.contract.ts
 * @public
 */

"use client";

import type { ReactElement } from "react";

import { ContributorCard } from "@/features/governance/components/ContributorCard";
import { EpochCountdown } from "@/features/governance/components/EpochCountdown";
import { useCurrentEpoch } from "@/features/governance/hooks/useCurrentEpoch";

export function CurrentEpochView(): ReactElement {
  const { data, isLoading, error } = useCurrentEpoch();

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h2 className="font-semibold text-destructive text-lg">
            Error loading epoch data
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
          <div className="h-40 rounded-lg bg-muted" />
          <div className="space-y-3">
            <div className="h-32 rounded-lg bg-muted" />
            <div className="h-32 rounded-lg bg-muted" />
            <div className="h-32 rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  const { epoch } = data;

  if (!epoch) {
    return (
      <div className="flex flex-col gap-8">
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No active epoch</p>
          <p className="mt-2 text-muted-foreground text-sm">
            A new epoch will appear here when one is opened.
          </p>
        </div>
      </div>
    );
  }

  const sorted = [...epoch.contributors].sort(
    (a, b) => Number(b.proposedUnits) - Number(a.proposedUnits)
  );
  const totalPoints = sorted.reduce(
    (s, c) => s + Math.round(Number(c.proposedUnits) / 1000),
    0
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 font-bold text-3xl tracking-tight">
          Epoch <span className="text-primary">#{epoch.id}</span>
        </h1>
        <p className="text-muted-foreground">
          {new Date(epoch.periodStart).toLocaleDateString()} —{" "}
          {new Date(epoch.periodEnd).toLocaleDateString()}
        </p>
      </div>

      <EpochCountdown
        periodStart={epoch.periodStart}
        periodEnd={epoch.periodEnd}
        status={epoch.status}
        contributorCount={sorted.length}
        totalPoints={totalPoints}
      />

      <div>
        <h2 className="mb-4 font-semibold text-lg">Contributions & Scoring</h2>
        <div className="space-y-3">
          {sorted.map((c, i) => (
            <ContributorCard key={c.userId} contributor={c} rank={i + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}
