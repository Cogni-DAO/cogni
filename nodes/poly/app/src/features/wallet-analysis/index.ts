// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis`
 * Purpose: Public surface — `WalletAnalysisView` organism, supporting molecules, and shared types.
 * Scope: Re-exports only.
 * Side-effects: none
 * @public
 */

export { useWalletAnalysis } from "./client/use-wallet-analysis";
export { BalanceBar } from "./components/BalanceBar";
export { BalanceOverTimeChart } from "./components/BalanceOverTimeChart";
export { CopyWalletButton } from "./components/CopyWalletButton";
export type { DistributionComparisonSeries } from "./components/DistributionsBlock";
export { DistributionComparisonBlock } from "./components/DistributionsBlock";
export { EdgeHypothesis } from "./components/EdgeHypothesis";
export { PositionTimelineChart } from "./components/PositionTimelineChart";
export { RecentTradesTable } from "./components/RecentTradesTable";
export { StatGrid } from "./components/StatGrid";
export { TimeWindowHeader } from "./components/TimeWindowHeader";
export { TopMarketsList } from "./components/TopMarketsList";
export { TraderComparisonBlock } from "./components/TraderComparisonBlock";
export { TradesPerDayChart } from "./components/TradesPerDayChart";
export { WalletAnalysisSurface } from "./components/WalletAnalysisSurface";
export { WalletAnalysisView } from "./components/WalletAnalysisView";
export { WalletDetailDrawer } from "./components/WalletDetailDrawer";
export { WalletIdentityHeader } from "./components/WalletIdentityHeader";
export { WalletProfitLossCard } from "./components/WalletProfitLossCard";
export { WalletQuickJump } from "./components/WalletQuickJump";
export type {
  WalletAnalysisData,
  WalletAnalysisSize,
  WalletAnalysisVariant,
  WalletBalance,
  WalletBalanceHistoryPoint,
  WalletDailyCount,
  WalletIdentity,
  WalletPnl,
  WalletPnlHistoryPoint,
  WalletPosition,
  WalletPositionEvent,
  WalletPositionEventKind,
  WalletPositionStatus,
  WalletPositionTimelinePoint,
  WalletSnapshot,
  WalletTrade,
  WalletTradeSide,
  WalletTrades,
} from "./types/wallet-analysis";
