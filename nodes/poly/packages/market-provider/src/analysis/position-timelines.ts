// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/analysis/position-timelines`
 * Purpose: Maps Polymarket positions, trades, and public CLOB history into chart-ready execution rows.
 * Scope: Pure analysis helper only; does not perform I/O, load env, or mutate inputs.
 * Invariants:
 *   - Timeline is a market-price trace, not an inferred balance curve.
 *   - Open rows never synthesize a close marker.
 *   - Market URLs only come from upstream slug fields.
 * Side-effects: none
 * Links: docs/design/poly-dashboard-balance-and-positions.md
 * @public
 */

import type {
  ClobPriceHistoryPoint,
  PolymarketUserPosition,
  PolymarketUserTrade,
} from "../adapters/polymarket/index.js";

const EPSILON = 1e-6;

export type ExecutionPositionStatus = "open" | "closed" | "redeemable";
export type ExecutionEventKind =
  | "entry"
  | "add"
  | "reduce"
  | "close"
  | "redeemable";

export type ExecutionTimelinePoint = {
  readonly ts: string;
  readonly price: number;
  readonly size: number;
};

export type ExecutionEvent = {
  readonly ts: string;
  readonly kind: ExecutionEventKind;
  readonly price: number;
  readonly shares: number;
};

export type ExecutionPosition = {
  readonly positionId: string;
  readonly conditionId: string;
  readonly asset: string;
  readonly marketTitle: string;
  readonly marketSlug: string | null;
  readonly eventSlug: string | null;
  readonly marketUrl: string | null;
  readonly outcome: string;
  readonly status: ExecutionPositionStatus;
  readonly openedAt: string;
  readonly closedAt?: string;
  readonly resolvesAt?: string;
  readonly heldMinutes: number;
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly size: number;
  readonly currentValue: number;
  readonly pnlUsd: number;
  readonly pnlPct: number;
  readonly timeline: readonly ExecutionTimelinePoint[];
  readonly events: readonly ExecutionEvent[];
};

export type MapExecutionPositionsInput = {
  readonly positions: readonly PolymarketUserPosition[];
  readonly trades: readonly PolymarketUserTrade[];
  readonly priceHistoryByAsset?: ReadonlyMap<
    string,
    readonly ClobPriceHistoryPoint[]
  >;
  readonly asOfIso?: string;
  readonly assets?: readonly string[];
};

export function mapExecutionPositions({
  positions,
  trades,
  priceHistoryByAsset,
  asOfIso = new Date().toISOString(),
  assets,
}: MapExecutionPositionsInput): ExecutionPosition[] {
  const asOfSec = Math.floor(new Date(asOfIso).getTime() / 1000);
  const positionsByAsset = new Map(
    positions.map((position) => [position.asset, position] as const)
  );
  const tradesByAsset = new Map<string, PolymarketUserTrade[]>();

  for (const trade of trades) {
    if (!trade.asset) continue;
    const rows = tradesByAsset.get(trade.asset) ?? [];
    rows.push(trade);
    tradesByAsset.set(trade.asset, rows);
  }

  const allowedAssets = assets ? new Set(assets) : null;
  const assetIds = new Set<string>([
    ...positionsByAsset.keys(),
    ...tradesByAsset.keys(),
  ]);
  const mapped: ExecutionPosition[] = [];

  for (const asset of assetIds) {
    if (allowedAssets && !allowedAssets.has(asset)) continue;

    const snapshot = positionsByAsset.get(asset);
    const assetTrades = [...(tradesByAsset.get(asset) ?? [])].sort(
      (left, right) => left.timestamp - right.timestamp
    );

    if (!snapshot && assetTrades.length === 0) continue;

    const buyShares = sumShares(assetTrades, "BUY");
    const sellShares = sumShares(assetTrades, "SELL");
    const buyUsdc = sumUsdc(assetTrades, "BUY");
    const sellUsdc = sumUsdc(assetTrades, "SELL");
    const fallbackSize = Math.max(0, buyShares - sellShares);
    const size = sanitizeNumber(snapshot?.size) ?? fallbackSize;
    const status: ExecutionPositionStatus = snapshot?.redeemable
      ? "redeemable"
      : size > EPSILON
        ? "open"
        : "closed";

    const firstTrade = assetTrades[0];
    const lastTrade = assetTrades.at(-1);
    const openedAtTs = firstTrade?.timestamp ?? asOfSec;
    const closedAtTs =
      status === "closed" ? (lastTrade?.timestamp ?? asOfSec) : null;
    const entryPrice =
      sanitizePositive(snapshot?.avgPrice) ??
      averageTradePrice(assetTrades, "BUY") ??
      sanitizePositive(firstTrade?.price) ??
      0;
    const currentPrice =
      status === "closed"
        ? (sanitizePositive(lastTrade?.price) ?? entryPrice)
        : (sanitizePositive(snapshot?.curPrice) ??
          sanitizePositive(lastTrade?.price) ??
          entryPrice);
    const currentValue =
      status === "closed"
        ? 0
        : (sanitizeNumber(snapshot?.currentValue) ?? size * currentPrice);
    const pnlUsd =
      snapshot && status !== "closed"
        ? snapshot.cashPnl
        : sellUsdc + currentValue - buyUsdc;
    const pnlPct =
      snapshot && status !== "closed"
        ? snapshot.percentPnl
        : buyUsdc > EPSILON
          ? (pnlUsd / buyUsdc) * 100
          : 0;

    const marketTitle =
      cleanText(snapshot?.title) ??
      cleanText(firstTrade?.title) ??
      marketFallback(snapshot?.conditionId ?? firstTrade?.conditionId ?? asset);
    const marketSlug = cleanText(snapshot?.slug) ?? cleanText(firstTrade?.slug);
    const eventSlug =
      cleanText(snapshot?.eventSlug) ?? cleanText(firstTrade?.eventSlug);
    const conditionId =
      cleanText(snapshot?.conditionId) ??
      cleanText(firstTrade?.conditionId) ??
      asset;
    const outcome =
      cleanText(snapshot?.outcome) ??
      cleanText(firstTrade?.outcome) ??
      "Outcome";
    const marketUrl = buildPolymarketEventUrl(eventSlug, marketSlug);
    const timeline = buildTimeline({
      trades: assetTrades,
      history: priceHistoryByAsset?.get(asset) ?? [],
      currentPrice,
      size,
      status,
      asOfSec,
    });
    const events = buildEvents(assetTrades, status, asOfSec, currentPrice);

    mapped.push({
      positionId: `${conditionId}:${asset}`,
      conditionId,
      asset,
      marketTitle,
      marketSlug,
      eventSlug,
      marketUrl,
      outcome,
      status,
      openedAt: toIso(openedAtTs),
      ...(closedAtTs ? { closedAt: toIso(closedAtTs) } : {}),
      ...(sanitizeIso(snapshot?.endDate) !== null
        ? { resolvesAt: sanitizeIso(snapshot?.endDate) as string }
        : {}),
      heldMinutes: minutesBetween(
        openedAtTs,
        closedAtTs ?? Math.max(asOfSec, openedAtTs)
      ),
      entryPrice,
      currentPrice,
      size,
      currentValue,
      pnlUsd,
      pnlPct,
      timeline,
      events,
    });
  }

  return mapped.sort((left, right) => {
    const rank = statusRank(left.status) - statusRank(right.status);
    if (rank !== 0) return rank;
    const leftTs = left.closedAt ?? left.openedAt;
    const rightTs = right.closedAt ?? right.openedAt;
    return rightTs.localeCompare(leftTs);
  });
}

export function buildPolymarketEventUrl(
  eventSlug: string | null | undefined,
  marketSlug: string | null | undefined
): string | null {
  const eventPart = cleanText(eventSlug);
  if (!eventPart) return null;
  const marketPart = cleanText(marketSlug);
  if (marketPart) {
    return `https://polymarket.com/event/${eventPart}/${marketPart}`;
  }
  return `https://polymarket.com/event/${eventPart}`;
}

function buildTimeline({
  trades,
  history,
  currentPrice,
  size,
  status,
  asOfSec,
}: {
  trades: readonly PolymarketUserTrade[];
  history: readonly ClobPriceHistoryPoint[];
  currentPrice: number;
  size: number;
  status: ExecutionPositionStatus;
  asOfSec: number;
}): ExecutionTimelinePoint[] {
  const priceByTs = new Map<number, number>();

  for (const point of history) {
    if (!Number.isFinite(point.t) || !Number.isFinite(point.p)) continue;
    priceByTs.set(Math.floor(point.t), point.p);
  }

  for (const trade of trades) {
    priceByTs.set(trade.timestamp, trade.price);
  }

  const firstTrade = trades[0];
  const lastTrade = trades.at(-1);
  if (firstTrade) priceByTs.set(firstTrade.timestamp, firstTrade.price);
  if (status === "closed" && lastTrade) {
    priceByTs.set(lastTrade.timestamp, lastTrade.price);
  } else {
    priceByTs.set(asOfSec, currentPrice);
  }

  if (priceByTs.size === 0) {
    priceByTs.set(asOfSec, currentPrice);
  }

  const ordered = [...priceByTs.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([ts, price]) => ({
      ts: toIso(ts),
      price,
      size: exposureAtTs(trades, ts, size),
    }));

  if (ordered.length === 1) {
    const anchorTs =
      status === "closed"
        ? toSec(ordered[0]?.ts ?? toIso(asOfSec))
        : Math.max(asOfSec, toSec(ordered[0]?.ts ?? toIso(asOfSec)));
    ordered.push({
      ts: toIso(anchorTs + (status === "closed" ? 60 : 300)),
      price: ordered[0]?.price ?? currentPrice,
      size: ordered[0]?.size ?? size,
    });
  }

  return ordered;
}

function buildEvents(
  trades: readonly PolymarketUserTrade[],
  status: ExecutionPositionStatus,
  asOfSec: number,
  currentPrice: number
): ExecutionEvent[] {
  if (trades.length === 0) {
    if (status === "redeemable") {
      return [
        {
          ts: toIso(asOfSec),
          kind: "redeemable",
          price: currentPrice,
          shares: 0,
        },
      ];
    }
    return [];
  }

  const events = trades.map((trade, index) => ({
    ts: toIso(trade.timestamp),
    kind:
      index === 0
        ? ("entry" as const)
        : trade.side === "BUY"
          ? ("add" as const)
          : ("reduce" as const),
    price: trade.price,
    shares: trade.size,
  }));

  const last = events.at(-1);
  if (!last) return events;

  if (status === "closed") {
    return [...events.slice(0, -1), { ...last, kind: "close" }];
  }
  if (status === "redeemable") {
    return [
      ...events,
      {
        ts: toIso(asOfSec),
        kind: "redeemable",
        price: currentPrice,
        shares: 0,
      },
    ];
  }
  return events;
}

function exposureAtTs(
  trades: readonly PolymarketUserTrade[],
  ts: number,
  fallbackSize: number
): number {
  if (trades.length === 0) return fallbackSize;

  let running = 0;
  let seen = false;
  for (const trade of trades) {
    if (trade.timestamp > ts) break;
    seen = true;
    running += trade.side === "BUY" ? trade.size : -trade.size;
  }
  if (!seen) return 0;
  return Math.max(0, running);
}

function sumShares(
  trades: readonly PolymarketUserTrade[],
  side: "BUY" | "SELL"
): number {
  return trades.reduce(
    (sum, trade) => sum + (trade.side === side ? trade.size : 0),
    0
  );
}

function sumUsdc(
  trades: readonly PolymarketUserTrade[],
  side: "BUY" | "SELL"
): number {
  return trades.reduce(
    (sum, trade) => sum + (trade.side === side ? trade.size * trade.price : 0),
    0
  );
}

function averageTradePrice(
  trades: readonly PolymarketUserTrade[],
  side: "BUY" | "SELL"
): number | null {
  let totalShares = 0;
  let weighted = 0;
  for (const trade of trades) {
    if (trade.side !== side) continue;
    totalShares += trade.size;
    weighted += trade.size * trade.price;
  }
  if (totalShares <= EPSILON) return null;
  return weighted / totalShares;
}

function statusRank(status: ExecutionPositionStatus): number {
  if (status === "open") return 0;
  if (status === "redeemable") return 1;
  return 2;
}

function marketFallback(value: string): string {
  return `Market ${value.slice(0, 8)}`;
}

function sanitizeNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return value;
}

function sanitizePositive(value: number | null | undefined): number | null {
  const numeric = sanitizeNumber(value);
  if (numeric === null || numeric < 0) return null;
  return numeric;
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeIso(value: string | null | undefined): string | null {
  const trimmed = cleanText(value);
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function minutesBetween(startSec: number, endSec: number): number {
  return Math.max(0, Math.round((endSec - startSec) / 60));
}

function toIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

function toSec(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}
