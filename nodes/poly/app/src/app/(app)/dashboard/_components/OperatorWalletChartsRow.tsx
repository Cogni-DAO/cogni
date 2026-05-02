// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import type { ReactElement } from "react";
import { Card, CardContent } from "@/components";
import { TradesPerDayChart } from "@/features/wallet-analysis";
import { useDashboardExecution } from "../_hooks/useDashboardExecution";

export function OperatorWalletChartsRow(): ReactElement {
  const { data, isLoading, isError } = useDashboardExecution({
    includeLive: false,
  });

  const dailyCounts = (data?.dailyTradeCounts ?? []).map((point) => ({
    d: point.day.slice(5),
    n: point.n,
  }));

  return (
    <Card>
      <CardContent className="px-5 py-4">
        {isError ? (
          <div className="flex h-44 items-center justify-center text-center text-muted-foreground text-sm">
            Couldn&apos;t load trade volume. Will retry shortly.
          </div>
        ) : !isLoading && dailyCounts.length === 0 ? (
          <div className="flex h-44 items-center justify-center text-center text-muted-foreground text-sm">
            No trade history yet.
          </div>
        ) : (
          <TradesPerDayChart daily={dailyCounts} isLoading={isLoading} />
        )}
      </CardContent>
    </Card>
  );
}
