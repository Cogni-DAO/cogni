// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/w/[addr]/page`
 * Purpose: Dynamic per-wallet analysis page — server component that fans out to the three wallet-analysis slice services and renders WalletAnalysisView.
 * Scope: Auth-gated server shell. Calls service-layer helpers directly (no loopback HTTP). Does not fetch via React Query — that's the next iteration.
 * Invariants:
 *   - Any 0x address is accepted (lowercased). Bad addr → notFound().
 *   - Three slices fetched in parallel; partial failures surface as missing fields, not 5xx.
 *   - Snapshot metrics may be null (insufficient resolved positions) — molecules render insufficient-data state.
 * Side-effects: IO (Polymarket Data API + CLOB public via service module).
 * Links: docs/design/wallet-analysis-components.md, nodes/poly/app/src/features/wallet-analysis/
 * @public
 */

import { PolyAddressSchema } from "@cogni/node-contracts";
import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";
import { fetchOperatorExtras } from "@/app/_lib/poly/operator-extras";
import {
  type WalletAnalysisData,
  WalletAnalysisView,
} from "@/features/wallet-analysis";
import {
  getBalanceSlice,
  getSnapshotSlice,
  getTradesSlice,
} from "@/features/wallet-analysis/server/wallet-analysis-service";
import { getServerSessionUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ addr: string }>;
};

function inferCategory(topMarkets: ReadonlyArray<string>): string | undefined {
  const t = topMarkets.join(" ").toLowerCase();
  if (t.includes("temperature") || t.includes("high temp")) return "Weather";
  if (t.includes("nba") || t.includes("nfl") || t.includes("mlb"))
    return "Sports";
  if (t.includes("election") || t.includes("trump") || t.includes("biden"))
    return "Politics";
  if (t.includes("btc") || t.includes("eth") || t.includes("bitcoin"))
    return "Crypto";
  return undefined;
}

export default async function WalletAnalysisPage({
  params,
}: PageProps): Promise<ReactElement> {
  const user = await getServerSessionUser();
  if (!user) redirect("/");

  const { addr: rawAddr } = await params;
  const parsed = PolyAddressSchema.safeParse(rawAddr);
  if (!parsed.success) notFound();
  const addr = parsed.data;

  const [snapR, tradesR, balanceR] = await Promise.all([
    getSnapshotSlice(addr),
    getTradesSlice(addr),
    getBalanceSlice(addr, fetchOperatorExtras),
  ]);

  const snapshot = snapR.kind === "ok" ? snapR.value : undefined;
  const trades = tradesR.kind === "ok" ? tradesR.value : undefined;
  const balance = balanceR.kind === "ok" ? balanceR.value : undefined;

  const inferredCategory = trades
    ? inferCategory(trades.topMarkets)
    : undefined;
  const isOperator = balance?.isOperator === true;
  const displayName = isOperator
    ? "Operator Wallet"
    : `Wallet ${addr.slice(0, 6)}…${addr.slice(-4)}`;
  const data: WalletAnalysisData = {
    address: addr,
    identity: {
      name: displayName,
      ...(inferredCategory && { category: inferredCategory }),
      isPrimaryTarget: false,
    },
    ...(snapshot && {
      snapshot: {
        n: snapshot.resolvedPositions,
        // Nulls preserved: StatGrid renders "—" for insufficient-data state.
        // Silent 0 coercion misreads "1 resolved position" as "0% WR".
        wr: snapshot.trueWinRatePct,
        roi: snapshot.realizedRoiPct,
        pnl:
          snapshot.realizedPnlUsdc !== null
            ? formatUsd(snapshot.realizedPnlUsdc)
            : "—",
        dd: snapshot.maxDrawdownPctOfPeak,
        medianDur:
          snapshot.medianDurationHours !== null
            ? formatDuration(snapshot.medianDurationHours)
            : "—",
        avgPerDay:
          snapshot.tradesPerDay30d > 0
            ? Math.round(snapshot.tradesPerDay30d)
            : null,
        ...(inferredCategory && { category: inferredCategory }),
      },
    }),
    ...(trades && {
      trades: {
        last: trades.recent.slice(0, 5).map((t) => ({
          ts: formatTs(t.timestampSec),
          side: t.side,
          size: t.size.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          }),
          px: t.price.toFixed(3),
          mkt: t.marketTitle ?? `(market ${t.conditionId.slice(0, 6)}…)`,
        })),
        dailyCounts: trades.dailyCounts.map((d) => ({
          d: d.day.slice(5),
          n: d.n,
        })),
        topMarkets: trades.topMarkets.slice(0, 4),
      },
    }),
    ...(balance && {
      balance: {
        available: balance.available ?? 0,
        locked: balance.locked ?? 0,
        positions: balance.positions,
        total: balance.total,
      },
    }),
  };

  return (
    <main className="px-4 py-6 md:px-8 md:py-10">
      <WalletAnalysisView
        data={data}
        variant="page"
        size="default"
        capturedAt={new Date().toISOString().slice(0, 16).replace("T", " ")}
      />
    </main>
  );
}

function formatUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000)
    return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)
    return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1_000).toFixed(1)}k`;
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(0)}`;
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatTs(sec: number): string {
  return new Date(sec * 1_000)
    .toISOString()
    .slice(5, 16)
    .replace("T", " ")
    .concat("Z");
}
