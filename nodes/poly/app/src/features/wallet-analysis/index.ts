// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis`
 * Purpose: Public surface — `WalletAnalysisView` organism, supporting molecules, and shared types.
 * Scope: Re-exports only.
 * Side-effects: none
 * @public
 */

export { BalanceBar } from "./components/BalanceBar";
export { EdgeHypothesis } from "./components/EdgeHypothesis";
export { RecentTradesTable } from "./components/RecentTradesTable";
export { StatGrid } from "./components/StatGrid";
export { TopMarketsList } from "./components/TopMarketsList";
export { TradesPerDayChart } from "./components/TradesPerDayChart";
export { WalletAnalysisView } from "./components/WalletAnalysisView";
export { WalletIdentityHeader } from "./components/WalletIdentityHeader";
export { WalletQuickJump } from "./components/WalletQuickJump";
export type {
  WalletAnalysisData,
  WalletAnalysisSize,
  WalletAnalysisVariant,
  WalletBalance,
  WalletDailyCount,
  WalletIdentity,
  WalletSnapshot,
  WalletTrade,
  WalletTradeSide,
  WalletTrades,
} from "./types/wallet-analysis";
