// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/types/wallet-analysis`
 * Purpose: Shared shape for `WalletAnalysisView`, dashboard execution
 * positions, and their supporting molecules.
 * Scope: Pure type definitions; no logic. Broadly aligned with the wallet-analysis
 * contract, plus reusable position-trace fields used by the dashboard.
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

export type WalletBalanceHistoryPoint = {
  ts: string;
  total: number;
  available?: number;
  locked?: number;
  positions?: number;
};

export type WalletPnlHistoryPoint = {
  ts: string;
  pnl: number;
};

export type WalletPositionStatus = "open" | "closed" | "redeemable";

export type WalletPositionLifecycleState =
  | "unresolved"
  | "open"
  | "closing"
  | "closed"
  | "resolving"
  | "winner"
  | "redeem_pending"
  | "redeemed"
  | "loser"
  | "dust"
  | "abandoned";

export type WalletPositionTimelinePoint = {
  ts: string;
  price: number;
  size: number;
};

export type WalletPositionEventKind =
  | "entry"
  | "add"
  | "reduce"
  | "close"
  | "redeemable";

export type WalletPositionEvent = {
  ts: string;
  kind: WalletPositionEventKind;
  price: number;
  shares: number;
};

export type WalletPosition = {
  positionId: string;
  conditionId: string;
  asset: string;
  marketTitle: string;
  marketSlug?: string | null;
  eventSlug?: string | null;
  marketUrl?: string | null;
  outcome: string;
  status: WalletPositionStatus;
  lifecycleState?: WalletPositionLifecycleState | null | undefined;
  openedAt: string;
  closedAt?: string | null;
  heldMinutes: number;
  entryPrice: number;
  currentPrice: number;
  size: number;
  currentValue: number;
  pnlUsd: number;
  pnlPct: number;
  timeline: readonly WalletPositionTimelinePoint[];
  events: readonly WalletPositionEvent[];
};

/**
 * Trade-derived metrics. Nullable when the resolved-position sample is too
 * small to be meaningful (< `minResolvedForMetrics` in
 * `packages/market-provider/src/analysis/wallet-metrics.ts`, default 5).
 * The UI must distinguish "0%" (real) from "not enough data" (null) —
 * molecules render an em-dash for null rather than a fake zero.
 *
 * PnL lives on `WalletPnl`, not here. See task.0389.
 */
export type WalletSnapshot = {
  n: number;
  wr: number | null;
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

export type WalletPnl = {
  interval: "1D" | "1W" | "1M" | "1Y" | "YTD" | "ALL";
  history: readonly WalletPnlHistoryPoint[];
};

export type WalletAnalysisData = {
  address: string;
  identity: WalletIdentity;
  snapshot?: WalletSnapshot;
  trades?: WalletTrades;
  balance?: WalletBalance;
  balanceHistory?: readonly WalletBalanceHistoryPoint[];
  pnl?: WalletPnl;
  positions?: readonly WalletPosition[];
};

export type WalletAnalysisVariant = "page" | "drawer" | "compact";
export type WalletAnalysisSize = "hero" | "default";
