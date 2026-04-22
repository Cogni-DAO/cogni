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
export { EdgeHypothesis } from "./components/EdgeHypothesis";
export { PositionsTable } from "./components/PositionsTable";
export { PositionTimelineSparkline } from "./components/PositionTimelineSparkline";
export { RecentTradesTable } from "./components/RecentTradesTable";
export { StatGrid } from "./components/StatGrid";
export { TopMarketsList } from "./components/TopMarketsList";
export { TradesPerDayChart } from "./components/TradesPerDayChart";
export { WalletAnalysisView } from "./components/WalletAnalysisView";
export { WalletDetailDrawer } from "./components/WalletDetailDrawer";
export { WalletIdentityHeader } from "./components/WalletIdentityHeader";
export { WalletQuickJump } from "./components/WalletQuickJump";
export {
  deriveBalanceHistoryFromCopyTradeOrders,
  derivePositionsFromCopyTradeOrders,
} from "./lib/copy-trade-derivations";
export type {
  WalletAnalysisData,
  WalletAnalysisSize,
  WalletAnalysisVariant,
  WalletBalance,
  WalletBalanceHistoryPoint,
  WalletDailyCount,
  WalletIdentity,
  WalletPosition,
  WalletPositionMarker,
  WalletPositionMarkerKind,
  WalletPositionMarkerTone,
  WalletPositionStatus,
  WalletPositionTimelinePoint,
  WalletSnapshot,
  WalletTrade,
  WalletTradeSide,
  WalletTrades,
} from "./types/wallet-analysis";
