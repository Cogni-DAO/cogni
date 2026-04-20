// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/types/wallet-analysis`
 * Purpose: Shared shape for `WalletAnalysisView` and its molecules.
 * Scope: Pure type definitions; no logic. Mirrors the v1 wallet-analysis HTTP contract (Checkpoint B).
 * Invariants: All slices independently optional — molecules render skeletons when their slice is absent.
 * Side-effects: none
 * @public
 */

export type WalletTradeSide = "BUY" | "SELL";

export type WalletTrade = {
  ts: string;
  side: WalletTradeSide;
  size: string;
  px: string;
  mkt: string;
};

export type WalletDailyCount = {
  d: string;
  n: number;
};

/**
 * Realized-outcome metrics are nullable when the resolved-position sample is
 * too small to be meaningful (< `minResolvedForMetrics` in
 * `packages/market-provider/src/analysis/wallet-metrics.ts`, default 5).
 * The UI must distinguish "0%" (real) from "not enough data" (null) —
 * molecules render an em-dash for null rather than a fake zero.
 */
export type WalletSnapshot = {
  n: number;
  wr: number | null;
  roi: number | null;
  pnl: string;
  dd: number | null;
  medianDur: string;
  avgPerDay: number | null;
  hypothesisMd?: string;
  takenAt?: string;
  category?: string;
};

export type WalletTrades = {
  last: readonly WalletTrade[];
  dailyCounts: readonly WalletDailyCount[];
  topMarkets: readonly string[];
};

export type WalletBalance = {
  available: number;
  locked: number;
  positions: number;
  total: number;
};

export type WalletIdentity = {
  name?: string;
  category?: string;
  isPrimaryTarget?: boolean;
};

export type WalletAnalysisData = {
  address: string;
  identity: WalletIdentity;
  snapshot?: WalletSnapshot;
  trades?: WalletTrades;
  balance?: WalletBalance;
};

export type WalletAnalysisVariant = "page" | "drawer" | "compact";
export type WalletAnalysisSize = "hero" | "default";
