// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/lib/copy-trade-derivations`
 * Purpose: Derive reusable wallet-analysis slices from copy-trade order rows.
 * Scope: Pure helpers only. No fetching, no React, no storage.
 * Invariants:
 *   - Position rows remain first-class `WalletPosition` values before they reach UI components.
 *   - Balance history stays conservative and only renders when there is enough signal to show a trend.
 *   - Consumers can pass `nowIso` for deterministic tests without changing runtime behavior.
 * Side-effects: none
 * @public
 */

import type { PolyCopyTradeOrderRow } from "@cogni/node-contracts";
import type {
  WalletBalanceHistoryPoint,
  WalletPosition,
} from "../types/wallet-analysis";

export function derivePositionsFromCopyTradeOrders(
  orders: readonly PolyCopyTradeOrderRow[],
  nowIso = new Date().toISOString()
): WalletPosition[] {
  const groups = new Map<string, PolyCopyTradeOrderRow[]>();

  for (const order of orders) {
    if (order.status === "canceled" || order.status === "error") continue;
    if (!order.side) continue;
    const notional = order.filled_size_usdc ?? order.size_usdc;
    if (notional === null || notional <= 0) continue;

    const groupKey = [
      order.market_id ?? order.market_title ?? order.fill_id,
      order.outcome ?? "outcome",
    ].join("::");
    const group = groups.get(groupKey) ?? [];
    group.push(order);
    groups.set(groupKey, group);
  }

  const positions: WalletPosition[] = [];

  for (const [groupKey, group] of groups.entries()) {
    const rows = [...group].sort((left, right) =>
      left.observed_at.localeCompare(right.observed_at)
    );
    const first = rows[0];
    const last = rows.at(-1);

    if (!first || !last) continue;

    const buyRows = rows.filter((row) => row.side === "BUY");
    const sellRows = rows.filter((row) => row.side === "SELL");
    const buyNotional = sumNotional(buyRows);
    const sellNotional = sumNotional(sellRows);

    if (buyNotional <= 0 && sellNotional <= 0) continue;

    const entryPrice =
      weightedAveragePrice(buyRows) ??
      weightedAveragePrice(rows) ??
      first.limit_price ??
      0.5;
    const exitPrice =
      weightedAveragePrice(sellRows) ?? last.limit_price ?? entryPrice;
    const openNotional = Math.max(0, buyNotional - sellNotional);
    const referencePrice = last.limit_price ?? exitPrice ?? entryPrice;
    const currentValue =
      openNotional > 0
        ? openNotional * (referencePrice / Math.max(entryPrice, 0.01))
        : 0;
    const pnlUsd = sellNotional + currentValue - buyNotional;
    const pnlPct = buyNotional > 0 ? (pnlUsd / buyNotional) * 100 : 0;
    const status: WalletPosition["status"] =
      openNotional > 0.01 ? "open" : "closed";
    const openedAt = first.observed_at;
    const closedAt = status === "closed" ? last.observed_at : undefined;
    const heldMinutes = minutesBetween(openedAt, closedAt ?? nowIso);

    let runningExposure = 0;
    const timeline = rows.map((row) => {
      const notional = row.filled_size_usdc ?? row.size_usdc ?? 0;
      if (row.side === "BUY") {
        runningExposure += notional;
      } else {
        runningExposure = Math.max(0, runningExposure - notional);
      }
      const price = row.limit_price ?? entryPrice;
      const value =
        runningExposure > 0
          ? runningExposure * (price / Math.max(entryPrice, 0.01))
          : 0;
      return {
        ts: row.observed_at,
        value,
      };
    });

    if (timeline.length === 1) {
      timeline.push({
        ts: status === "open" ? nowIso : last.observed_at,
        value: status === "open" ? currentValue : 0,
      });
    } else if (status === "open") {
      timeline.push({
        ts: nowIso,
        value: currentValue,
      });
    }

    const intermediateRows = rows.slice(1, -1).slice(-3);
    const markers: WalletPosition["markers"] = [
      { ts: openedAt, kind: "entry", tone: "neutral" },
      ...intermediateRows.map((row) => ({
        ts: row.observed_at,
        kind: "scale" as const,
        tone: "neutral" as const,
      })),
      {
        ts: closedAt ?? nowIso,
        kind: status === "open" ? "current" : "close",
        tone: pnlUsd > 0 ? "positive" : pnlUsd < 0 ? "negative" : "neutral",
      },
    ];

    positions.push({
      positionId: `${groupKey}:${openedAt}`,
      conditionId: first.market_id ?? groupKey,
      asset: first.market_id ?? first.fill_id,
      marketTitle: first.market_title ?? "Untitled market",
      outcome: first.outcome ?? "Outcome",
      side: buyNotional >= sellNotional ? "BUY" : "SELL",
      status,
      openedAt,
      ...(closedAt ? { closedAt } : {}),
      heldMinutes,
      currentValue,
      pnlUsd,
      pnlPct,
      timeline,
      markers,
    });
  }

  return positions.sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "open" ? -1 : 1;
    }
    const leftTs = left.closedAt ?? left.openedAt;
    const rightTs = right.closedAt ?? right.openedAt;
    return rightTs.localeCompare(leftTs);
  });
}

export function deriveBalanceHistoryFromCopyTradeOrders(
  orders: readonly PolyCopyTradeOrderRow[],
  currentTotal: number | undefined
): WalletBalanceHistoryPoint[] {
  if (currentTotal === undefined) return [];

  const relevant = orders
    .filter((order) => {
      if (order.status === "canceled" || order.status === "error") return false;
      if (!order.side) return false;
      const notional = order.filled_size_usdc ?? order.size_usdc;
      return notional !== null && notional > 0;
    })
    .sort((left, right) => left.observed_at.localeCompare(right.observed_at))
    .slice(-18);

  if (relevant.length < 2) return [];

  let runningTotal = 0;
  const points = relevant.map((order) => {
    runningTotal += estimateBalanceImpact(order);
    return {
      ts: order.observed_at,
      total: runningTotal,
    };
  });

  const last = points.at(-1);
  if (!last) return [];

  const shift = currentTotal - last.total;
  return points.map((point) => ({
    ts: point.ts,
    total: Math.max(0, point.total + shift),
  }));
}

function sumNotional(rows: readonly PolyCopyTradeOrderRow[]): number {
  return rows.reduce(
    (sum, row) => sum + (row.filled_size_usdc ?? row.size_usdc ?? 0),
    0
  );
}

function weightedAveragePrice(
  rows: readonly PolyCopyTradeOrderRow[]
): number | null {
  let weighted = 0;
  let total = 0;

  for (const row of rows) {
    const price = row.limit_price;
    const notional = row.filled_size_usdc ?? row.size_usdc;
    if (price === null || notional === null || notional <= 0) continue;
    weighted += price * notional;
    total += notional;
  }

  if (total <= 0) return null;
  return weighted / total;
}

function minutesBetween(startIso: string, endIso: string): number {
  return Math.max(
    0,
    Math.round(
      (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000
    )
  );
}

function estimateBalanceImpact(order: PolyCopyTradeOrderRow): number {
  const notional = order.filled_size_usdc ?? order.size_usdc ?? 0;
  const price = order.limit_price ?? 0.5;
  const direction = order.side === "BUY" ? 1 : -1;
  const executionWeight =
    order.status === "filled" ? 1 : order.status === "partial" ? 0.7 : 0.45;
  const priceDrift = Math.abs(price - 0.5) * 0.6 + 0.03;

  return direction * notional * priceDrift * executionWeight;
}
