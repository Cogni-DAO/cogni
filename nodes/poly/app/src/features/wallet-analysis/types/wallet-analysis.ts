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

export type WalletBalanceHistoryPoint = {
  ts: string;
  total: number;
  available?: number;
  locked?: number;
  positions?: number;
};

export type WalletPositionStatus = "open" | "closed";

export type WalletPositionTimelinePoint = {
  ts: string;
  value: number;
};

export type WalletPositionMarkerKind = "entry" | "scale" | "current" | "close";

export type WalletPositionMarkerTone = "neutral" | "positive" | "negative";

export type WalletPositionMarker = {
  ts: string;
  kind: WalletPositionMarkerKind;
  tone?: WalletPositionMarkerTone;
};

export type WalletPosition = {
  positionId: string;
  conditionId: string;
  asset: string;
  marketTitle: string;
  outcome: string;
  side: WalletTradeSide;
  status: WalletPositionStatus;
  openedAt: string;
  closedAt?: string;
  heldMinutes: number;
  currentValue: number;
  pnlUsd: number;
  pnlPct: number;
  timeline: readonly WalletPositionTimelinePoint[];
  markers: readonly WalletPositionMarker[];
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
  balanceHistory?: readonly WalletBalanceHistoryPoint[];
  positions?: readonly WalletPosition[];
};

export type WalletAnalysisVariant = "page" | "drawer" | "compact";
export type WalletAnalysisSize = "hero" | "default";
