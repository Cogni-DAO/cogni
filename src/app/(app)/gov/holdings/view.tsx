// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/gov/holdings/view`
 * Purpose: Client component displaying cumulative credit holdings and ownership distribution.
 * Scope: Renders holdings data fetched via useHoldings hook. Does not perform server-side logic or direct DB access.
 * Invariants: BigInt credits displayed via Number() for presentation only. No credit math in UI.
 * Side-effects: IO (via useHoldings hook)
 * Links: docs/spec/epoch-ledger.md, src/contracts/governance.holdings.v1.contract.ts
 * @public
 */

"use client";

import { Coins, TrendingUp, Users } from "lucide-react";
import type { ReactElement } from "react";

import { Card, CardContent } from "@/components";
import { HoldingCard } from "@/features/governance/components/HoldingCard";
import { useHoldings } from "@/features/governance/hooks/useHoldings";

export function HoldingsView(): ReactElement {
  const { data, isLoading, error } = useHoldings();

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
          <h2 className="font-semibold text-destructive text-lg">
            Error loading holdings data
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="h-20 rounded-lg bg-muted" />
            <div className="h-20 rounded-lg bg-muted" />
            <div className="h-20 rounded-lg bg-muted" />
          </div>
          <div className="space-y-3">
            <div className="h-20 rounded-lg bg-muted" />
            <div className="h-20 rounded-lg bg-muted" />
            <div className="h-20 rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  const totalCredits = Number(data.totalCreditsIssued);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 font-bold text-3xl tracking-tight">
          Holdings & Ownership
        </h1>
        <p className="text-muted-foreground">
          Current credit and ownership distribution
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
              <Coins className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-bold text-2xl">
                {totalCredits.toLocaleString()}
              </div>
              <div className="text-muted-foreground text-xs">
                Total Credits Issued
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15">
              <Users className="h-5 w-5 text-accent" />
            </div>
            <div>
              <div className="font-bold text-2xl">{data.totalContributors}</div>
              <div className="text-muted-foreground text-xs">
                Total Contributors
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/15">
              <TrendingUp className="h-5 w-5 text-success" />
            </div>
            <div>
              <div className="font-bold text-2xl">{data.epochsCompleted}</div>
              <div className="text-muted-foreground text-xs">
                Epochs Completed
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-4 font-semibold text-lg">Ownership Distribution</h2>
        {data.holdings.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-muted-foreground">No holdings data</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.holdings.map((h, i) => (
              <HoldingCard key={h.userId} holding={h} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
