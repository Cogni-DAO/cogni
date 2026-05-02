// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WalletAnalysisView`
 * Purpose: Organism that composes the wallet-analysis molecules into a layout for the chosen variant.
 * Scope: Pure component. Accepts `data` + `isLoading`; no fetching.
 * Invariants:
 *   - `variant="page"` renders the full layout (identity + stats + balance + chart + trades + markets + hypothesis).
 *   - `size="hero"` enlarges typography on the page variant; layout is identical.
 *   - Other variants (`drawer`, `compact`) ship in later checkpoints — fall back to `page` for now.
 * Side-effects: none
 * @public
 */

"use client";

import type { PolyWalletOverviewInterval } from "@cogni/poly-node-contracts";
import type { ReactElement, ReactNode } from "react";

import { Card, CardContent, CardHeader } from "@/components";
import type {
  WalletAnalysisData,
  WalletAnalysisSize,
  WalletAnalysisVariant,
} from "../types/wallet-analysis";
import { BalanceBar } from "./BalanceBar";
import { DistributionsBlock } from "./DistributionsBlock";
import { EdgeHypothesis } from "./EdgeHypothesis";
import { RecentTradesTable } from "./RecentTradesTable";
import { StatGrid } from "./StatGrid";
import { TimeWindowHeader } from "./TimeWindowHeader";
import { TopMarketsList } from "./TopMarketsList";
import { TradesPerDayChart } from "./TradesPerDayChart";
import { WalletIdentityHeader } from "./WalletIdentityHeader";
import { WalletProfitLossCard } from "./WalletProfitLossCard";

export type WalletAnalysisLoadingState = {
  snapshot?: boolean | undefined;
  trades?: boolean | undefined;
  balance?: boolean | undefined;
  pnl?: boolean | undefined;
  distributions?: boolean | undefined;
};

export type WalletAnalysisViewProps = {
  data: WalletAnalysisData;
  variant?: WalletAnalysisVariant | undefined;
  size?: WalletAnalysisSize | undefined;
  isLoading?: WalletAnalysisLoadingState | undefined;
  capturedAt?: string | undefined;
  rankBadge?: string | undefined;
  pnlInterval?: PolyWalletOverviewInterval | undefined;
  onPnlIntervalChange?:
    | ((interval: PolyWalletOverviewInterval) => void)
    | undefined;
  /** Inline actions rendered next to the wallet's Polymarket / Polygonscan links. */
  headerActions?: ReactNode | undefined;
};

export function WalletAnalysisView({
  data,
  variant = "page",
  size = "default",
  isLoading,
  capturedAt,
  rankBadge,
  pnlInterval,
  onPnlIntervalChange,
  headerActions,
}: WalletAnalysisViewProps): ReactElement {
  // variant fallback while drawer/compact land in later checkpoints
  if (variant !== "page") {
    return (
      <PageVariant
        data={data}
        size="default"
        isLoading={isLoading}
        capturedAt={capturedAt}
        pnlInterval={pnlInterval}
        onPnlIntervalChange={onPnlIntervalChange}
        headerActions={headerActions}
      />
    );
  }
  return (
    <PageVariant
      data={data}
      size={size}
      isLoading={isLoading}
      capturedAt={capturedAt}
      rankBadge={rankBadge}
      pnlInterval={pnlInterval}
      onPnlIntervalChange={onPnlIntervalChange}
      headerActions={headerActions}
    />
  );
}

function PageVariant({
  data,
  size,
  isLoading,
  capturedAt,
  rankBadge,
  pnlInterval,
  onPnlIntervalChange,
  headerActions,
}: {
  data: WalletAnalysisData;
  size: WalletAnalysisSize;
  isLoading?: WalletAnalysisLoadingState | undefined;
  capturedAt?: string | undefined;
  rankBadge?: string | undefined;
  pnlInterval?: PolyWalletOverviewInterval | undefined;
  onPnlIntervalChange?:
    | ((interval: PolyWalletOverviewInterval) => void)
    | undefined;
  headerActions?: ReactNode | undefined;
}): ReactElement {
  const isHero = size === "hero";
  return (
    <Card
      className={
        isHero
          ? "relative overflow-hidden border-primary/30"
          : "relative overflow-hidden"
      }
    >
      {rankBadge && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-4 right-6 select-none font-black text-8xl text-primary/5 leading-none tracking-tighter"
        >
          {rankBadge}
        </span>
      )}

      <CardHeader className="gap-3">
        <WalletIdentityHeader
          address={data.address}
          identity={data.identity}
          size={size}
          resolvedCount={data.snapshot?.n}
          actions={headerActions}
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-6 pt-0">
        <StatGrid snapshot={data.snapshot} isLoading={isLoading?.snapshot} />

        {(data.balance || isLoading?.balance) && (
          <BalanceBar balance={data.balance} isLoading={isLoading?.balance} />
        )}

        {pnlInterval && onPnlIntervalChange ? (
          <TimeWindowHeader
            interval={pnlInterval}
            onIntervalChange={onPnlIntervalChange}
            pnlHistory={data.pnl?.history}
            isLoading={isLoading?.pnl}
          />
        ) : null}

        {(data.pnl || isLoading?.pnl || pnlInterval) && (
          <WalletProfitLossCard
            history={data.pnl?.history}
            interval={pnlInterval ?? data.pnl?.interval ?? "ALL"}
            isLoading={isLoading?.pnl}
          />
        )}

        <div className="grid gap-8 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <TradesPerDayChart
              daily={data.trades?.dailyCounts}
              isLoading={isLoading?.trades}
            />
          </div>
          <div className="lg:col-span-2">
            <TopMarketsList
              markets={data.trades?.topMarkets}
              isLoading={isLoading?.trades}
              // TODO(task.0333): replace with Dolt-stored AI analyst summary.
              // Lorem Cognison until the wallet-analyst graph can author this.
              caption="Lorem Cognison — a Dolt-stored AI analysis will describe this wallet's playbook here: why they win, which markets they favour, which patterns repeat."
            />
          </div>
        </div>

        <RecentTradesTable
          trades={data.trades?.last}
          limit={5}
          isLoading={isLoading?.trades}
          capturedAt={capturedAt}
        />

        {(data.distributions || isLoading?.distributions) && (
          <DistributionsBlock
            data={data.distributions}
            isLoading={isLoading?.distributions}
          />
        )}

        <EdgeHypothesis text={data.snapshot?.hypothesisMd} />
      </CardContent>
    </Card>
  );
}
