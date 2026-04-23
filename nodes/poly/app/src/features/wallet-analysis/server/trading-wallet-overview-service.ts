// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/trading-wallet-overview-service`
 * Purpose: Read Polymarket's native user P/L history for the dashboard wallet
 *          card without implying wallet NAV history.
 * Scope: Read-only I/O only. No auth or HTTP concerns.
 * Invariants:
 *   - PNL_NOT_NAV: the returned series is Polymarket P/L, not reconstructed
 *     wallet balance.
 *   - EMPTY_IS_HONEST: an empty upstream array is preserved as-is.
 * Side-effects: IO (Polymarket user-pnl API).
 * @public
 */

import {
  PolymarketUserPnlClient,
  type PolymarketUserPnlPoint,
} from "@cogni/market-provider/adapters/polymarket";
import type {
  PolyWalletOverviewInterval,
  PolyWalletOverviewPnlPoint,
} from "@cogni/node-contracts";

let userPnlClient: PolymarketUserPnlClient | undefined;

function getUserPnlClient(): PolymarketUserPnlClient {
  if (!userPnlClient) userPnlClient = new PolymarketUserPnlClient();
  return userPnlClient;
}

export function __setTradingWalletOverviewUserPnlClientForTests(
  client: PolymarketUserPnlClient | undefined
): void {
  userPnlClient = client;
}

export async function getTradingWalletPnlHistory(input: {
  address: `0x${string}`;
  interval: PolyWalletOverviewInterval;
  capturedAt?: string;
}): Promise<PolyWalletOverviewPnlPoint[]> {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const points = await getUserPnlClient().getUserPnl(input.address, {
    interval: toUserPnlInterval(input.interval),
    fidelity: toUserPnlFidelity(input.interval),
  });

  return filterPnlHistory(points, input.interval, capturedAt).map((point) => ({
    ts: new Date(point.t * 1_000).toISOString(),
    pnl: roundUsd(point.p),
  }));
}

function toUserPnlInterval(
  interval: PolyWalletOverviewInterval
): "1d" | "1w" | "1m" | "all" {
  switch (interval) {
    case "1D":
      return "1d";
    case "1W":
      return "1w";
    case "1M":
      return "1m";
    case "1Y":
    case "YTD":
    case "ALL":
      return "all";
  }
}

function toUserPnlFidelity(
  interval: PolyWalletOverviewInterval
): "1h" | "3h" | "18h" | "1d" {
  switch (interval) {
    case "1D":
      return "1h";
    case "1W":
      return "3h";
    case "1M":
      return "18h";
    case "1Y":
    case "YTD":
    case "ALL":
      return "1d";
  }
}

function filterPnlHistory(
  points: readonly PolymarketUserPnlPoint[],
  interval: PolyWalletOverviewInterval,
  capturedAtIso: string
): PolymarketUserPnlPoint[] {
  if (
    interval === "ALL" ||
    interval === "1D" ||
    interval === "1W" ||
    interval === "1M"
  ) {
    return [...points];
  }

  const capturedAtMs = new Date(capturedAtIso).getTime();
  if (!Number.isFinite(capturedAtMs)) return [...points];

  if (interval === "1Y") {
    const startMs = capturedAtMs - 365 * 86_400_000;
    return points.filter((point) => point.t * 1_000 >= startMs);
  }

  const now = new Date(capturedAtMs);
  const yearStartMs = Date.UTC(now.getUTCFullYear(), 0, 1);
  return points.filter((point) => point.t * 1_000 >= yearStartMs);
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
