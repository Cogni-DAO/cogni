// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/WalletAnalysisView`
 * Purpose: Organism that composes the wallet-analysis molecules into a layout for the chosen variant.
 * Scope: Pure component. Accepts `data` + `isLoading`; no fetching.
 * Invariants:
 *   - `variant="page"` renders the full wallet dossier without recent-trade or top-market samples.
 *   - `variant="compact"` renders the research deep dive used by `/research`: benchmark, all saved distributions, P/L, and cadence.
 *   - `size="hero"` enlarges typography on the page variant; layout is identical.
 *   - Other variants (`drawer`) use the page layout without the compact research treatment.
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
import { StatGrid } from "./StatGrid";
import { TimeWindowHeader } from "./TimeWindowHeader";
import { TradesPerDayChart } from "./TradesPerDayChart";
import { WalletIdentityHeader } from "./WalletIdentityHeader";
import { WalletProfitLossCard } from "./WalletProfitLossCard";

export type WalletAnalysisLoadingState = {
  snapshot?: boolean | undefined;
  trades?: boolean | undefined;
  balance?: boolean | undefined;
  pnl?: boolean | undefined;
  distributions?: boolean | undefined;
  benchmark?: boolean | undefined;
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
  if (variant === "compact") {
    return (
      <ResearchDeepDiveVariant
        data={data}
        isLoading={isLoading}
        capturedAt={capturedAt}
        pnlInterval={pnlInterval}
        onPnlIntervalChange={onPnlIntervalChange}
        headerActions={headerActions}
      />
    );
  }

  // Drawer stays concise; the dedicated research page owns the heavy exploration.
  if (variant !== "page") {
    return (
      <PageVariant
        data={data}
        size="default"
        isLoading={isLoading}
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
  rankBadge,
  pnlInterval,
  onPnlIntervalChange,
  headerActions,
}: {
  data: WalletAnalysisData;
  size: WalletAnalysisSize;
  isLoading?: WalletAnalysisLoadingState | undefined;
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

        {(data.benchmark || isLoading?.benchmark) && (
          <CopyTargetBenchmarkBlock
            benchmark={data.benchmark}
            isLoading={isLoading?.benchmark}
          />
        )}

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

function ResearchDeepDiveVariant({
  data,
  isLoading,
  capturedAt,
  pnlInterval,
  onPnlIntervalChange,
  headerActions,
}: {
  data: WalletAnalysisData;
  isLoading?: WalletAnalysisLoadingState | undefined;
  capturedAt?: string | undefined;
  pnlInterval?: PolyWalletOverviewInterval | undefined;
  onPnlIntervalChange?:
    | ((interval: PolyWalletOverviewInterval) => void)
    | undefined;
  headerActions?: ReactNode | undefined;
}): ReactElement {
  return (
    <Card className="relative overflow-hidden border-primary/20">
      <CardHeader className="gap-3">
        <WalletIdentityHeader
          address={data.address}
          identity={data.identity}
          size="default"
          resolvedCount={data.snapshot?.n}
          actions={headerActions}
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-6 pt-0">
        <StatGrid snapshot={data.snapshot} isLoading={isLoading?.snapshot} />

        {(data.benchmark || isLoading?.benchmark) && (
          <CopyTargetBenchmarkBlock
            benchmark={data.benchmark}
            isLoading={isLoading?.benchmark}
          />
        )}

        {(data.distributions || isLoading?.distributions) && (
          <DistributionsBlock
            data={data.distributions}
            isLoading={isLoading?.distributions}
          />
        )}

        <div className="grid gap-6 xl:grid-cols-3">
          {(data.pnl || isLoading?.pnl || pnlInterval) && (
            <div className="flex flex-col gap-4 xl:col-span-2">
              {pnlInterval && onPnlIntervalChange ? (
                <TimeWindowHeader
                  interval={pnlInterval}
                  onIntervalChange={onPnlIntervalChange}
                  pnlHistory={data.pnl?.history}
                  isLoading={isLoading?.pnl}
                />
              ) : null}
              <WalletProfitLossCard
                history={data.pnl?.history}
                interval={pnlInterval ?? data.pnl?.interval ?? "ALL"}
                isLoading={isLoading?.pnl}
              />
            </div>
          )}

          <div className="flex flex-col gap-4">
            {(data.balance || isLoading?.balance) && (
              <BalanceBar
                balance={data.balance}
                isLoading={isLoading?.balance}
              />
            )}
            <TradesPerDayChart
              daily={data.trades?.dailyCounts}
              isLoading={isLoading?.trades}
            />
            {capturedAt ? (
              <p className="text-muted-foreground text-xs">
                Captured {capturedAt}
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyTargetBenchmarkBlock({
  benchmark,
  isLoading,
}: {
  benchmark: WalletAnalysisData["benchmark"] | undefined;
  isLoading?: boolean | undefined;
}): ReactNode {
  if (isLoading && !benchmark) {
    return (
      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }
  if (!benchmark?.isObserved) return null;

  const capture =
    benchmark.summary.copyCaptureRatio !== null
      ? formatPct(benchmark.summary.copyCaptureRatio)
      : "—";
  const observedSpan = formatObservedSpan(
    benchmark.coverage.observedSince,
    benchmark.coverage.lastSuccessAt
  );
  return (
    <section className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Copy Benchmark</h3>
          <p className="text-muted-foreground text-xs">
            {benchmark.label ?? "Observed wallet"} · {benchmark.window} saved
            window · {benchmark.coverage.status ?? "pending"}
          </p>
        </div>
        <p className="text-muted-foreground text-xs">
          Last observed {formatCoverageTime(benchmark.coverage.lastSuccessAt)}
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Target notional"
          value={formatUsd(benchmark.summary.targetSizeUsdc)}
          detail={`${benchmark.coverage.targetTrades.toLocaleString()} fills`}
        />
        <MetricTile
          label="Cogni notional"
          value={formatUsd(benchmark.summary.cogniSizeUsdc)}
          detail={`${benchmark.coverage.cogniTrades.toLocaleString()} fills`}
        />
        <MetricTile
          label="Capture"
          value={capture}
          detail={`${benchmark.activeGaps.length.toLocaleString()} active gaps`}
        />
        <MetricTile
          label="Observed span"
          value={observedSpan.value}
          detail={observedSpan.detail}
        />
      </div>
    </section>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
}): ReactElement {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-lg">{value}</p>
      {detail ? (
        <p className="mt-1 text-muted-foreground text-xs">{detail}</p>
      ) : null}
    </div>
  );
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatCoverageTime(value: string | null): string {
  if (!value) return "pending";
  return new Date(value).toISOString().slice(5, 16).replace("T", " ");
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatObservedSpan(
  fromIso: string | null,
  toIso: string | null
): { value: string; detail: string } {
  if (!fromIso || !toIso) return { value: "—", detail: "pending" };
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const days = Math.max(
    0,
    Math.round((to.getTime() - from.getTime()) / 86_400_000)
  );
  return {
    value: days === 1 ? "1 day" : `${days.toLocaleString()} days`,
    detail: `${from.toISOString().slice(5, 10)} → ${to
      .toISOString()
      .slice(5, 10)}`,
  };
}
