// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/trading-wallet-overview-service`
 * Purpose: DB-backed read of saved Polymarket user-pnl points + writer that
 *          ingests live `/user-pnl` into the same table from the observation tick.
 * Scope: Read + write + retention helpers. Reader is page-load safe (no outbound
 *        HTTP). Writer runs in poll/refresh jobs only.
 * Invariants:
 *   - PNL_NOT_NAV: the returned series is Polymarket P/L, not reconstructed wallet balance.
 *   - EMPTY_IS_HONEST: zero stored points returns `[]` — readers do not fall back to live HTTP.
 *   - PAGE_LOAD_DB_ONLY: `getTradingWalletPnlHistory` is a pure DB read; only `fetchAndPersist*` calls `/user-pnl`.
 *   - INTERVAL_DERIVED_FROM_TIMESERIES: rows are stored at two fidelities; the reader picks the densest fidelity covering the requested window.
 *   - FIDELITY_PLAN: writer ingests `1h@1w` and `1d@all`. Reader maps `1D`/`1W` → `1h` rows and `1M`/`1Y`/`YTD`/`ALL` → `1d` rows.
 *   - DEDUPE_BY_TS: PK `(trader_wallet_id, fidelity, ts)`; re-poll upserts pnl + observed_at.
 *   - RETENTION_BOUNDED: `1h` rows >35d pruned by the same job; `1d` kept indefinitely.
 * Side-effects:
 *   - Reader: DB read.
 *   - Writer: IO (Polymarket user-pnl API) + DB upsert.
 * Links: nodes/poly/packages/db-schema/src/trader-activity.ts, work/items/task.5012
 * @public
 */

import {
  polyTraderUserPnlPoints,
  polyTraderWallets,
} from "@cogni/poly-db-schema/trader-activity";
import {
  PolymarketUserPnlClient,
  type PolymarketUserPnlPoint,
  type UserPnlOutboundLogger,
} from "@cogni/poly-market-provider/adapters/polymarket";
import type {
  PolyWalletOverviewInterval,
  PolyWalletOverviewPnlPoint,
} from "@cogni/poly-node-contracts";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { dedupeByKey } from "./observation-helpers";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

type Fidelity = "1h" | "1d";
const HOUR_FIDELITY: Fidelity = "1h";
const DAY_FIDELITY: Fidelity = "1d";

/** `1h` rows older than this are pruned by the writer's tick. */
const HOUR_FIDELITY_RETENTION_DAYS = 35;

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

/** DB-backed page-load read. Empty array when no rows are stored. */
export async function getTradingWalletPnlHistory(input: {
  db: Db;
  address: `0x${string}`;
  interval: PolyWalletOverviewInterval;
  capturedAt?: string;
}): Promise<PolyWalletOverviewPnlPoint[]> {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const fidelity = readFidelityForInterval(input.interval);
  const wallet = await input.db
    .select({ id: polyTraderWallets.id })
    .from(polyTraderWallets)
    .where(eq(polyTraderWallets.walletAddress, input.address.toLowerCase()))
    .limit(1);
  const traderWalletId = wallet[0]?.id;
  if (!traderWalletId) return [];

  const rows = await input.db
    .select({
      ts: polyTraderUserPnlPoints.ts,
      pnlUsdc: polyTraderUserPnlPoints.pnlUsdc,
    })
    .from(polyTraderUserPnlPoints)
    .where(
      and(
        eq(polyTraderUserPnlPoints.traderWalletId, traderWalletId),
        eq(polyTraderUserPnlPoints.fidelity, fidelity)
      )
    )
    .orderBy(asc(polyTraderUserPnlPoints.ts));

  const points: PolymarketUserPnlPoint[] = rows.map((row) => ({
    t: Math.floor(row.ts.getTime() / 1_000),
    p: Number(row.pnlUsdc),
  }));
  return filterPnlHistory(points, input.interval, capturedAt).map((point) => ({
    ts: new Date(point.t * 1_000).toISOString(),
    pnl: roundUsd(point.p),
  }));
}

/** Writer: fetch live `/user-pnl` at both fidelities for one wallet and upsert. */
export async function fetchAndPersistTradingWalletPnlHistory(input: {
  db: Db;
  traderWalletId: string;
  walletAddress: `0x${string}`;
  client?: PolymarketUserPnlClient;
  logger?: UserPnlOutboundLogger;
  component?: string;
}): Promise<{ inserted: number; fidelities: Fidelity[] }> {
  const client = input.client ?? getUserPnlClient();
  const plans: Array<{
    fidelity: Fidelity;
    interval: "1w" | "all";
    upstreamFidelity: "1h" | "1d";
  }> = [
    { fidelity: HOUR_FIDELITY, interval: "1w", upstreamFidelity: "1h" },
    { fidelity: DAY_FIDELITY, interval: "all", upstreamFidelity: "1d" },
  ];

  let inserted = 0;
  const fidelities: Fidelity[] = [];
  for (const plan of plans) {
    const points = await client.getUserPnl(
      input.walletAddress,
      {
        interval: plan.interval,
        fidelity: plan.upstreamFidelity,
      },
      input.logger
        ? {
            logger: input.logger,
            component: input.component ?? "trader-observation",
          }
        : undefined
    );
    if (points.length === 0) continue;
    // bug.5011: upstream returns the current bucket twice during the active
    // period; PG rejects ON CONFLICT batches that hit the same target twice.
    const deduped = dedupeByKey(points, (p) => p.t);
    const rows = deduped.map((point) => ({
      traderWalletId: input.traderWalletId,
      fidelity: plan.fidelity,
      ts: new Date(point.t * 1_000),
      pnlUsdc: roundUsd(point.p).toFixed(8),
    }));
    await input.db
      .insert(polyTraderUserPnlPoints)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          polyTraderUserPnlPoints.traderWalletId,
          polyTraderUserPnlPoints.fidelity,
          polyTraderUserPnlPoints.ts,
        ],
        set: {
          pnlUsdc: sql`excluded.pnl_usdc`,
          observedAt: sql`now()`,
        },
      });
    inserted += rows.length;
    fidelities.push(plan.fidelity);
  }
  return { inserted, fidelities };
}

/** Retention helper: prune `1h` rows older than 35 days. `1d` kept indefinitely. */
export async function pruneOldTradingWalletPnlPoints(
  db: Db
): Promise<{ deleted: number }> {
  const cutoff = new Date(
    Date.now() - HOUR_FIDELITY_RETENTION_DAYS * 86_400_000
  );
  const result = await db
    .delete(polyTraderUserPnlPoints)
    .where(
      and(
        eq(polyTraderUserPnlPoints.fidelity, HOUR_FIDELITY),
        lt(polyTraderUserPnlPoints.ts, cutoff)
      )
    );
  // drizzle returns driver-specific shapes; cast loosely for postgres-js / node-postgres parity.
  const rowCount =
    (result as unknown as { rowCount?: number; count?: number }).rowCount ??
    (result as unknown as { rowCount?: number; count?: number }).count ??
    0;
  return { deleted: rowCount };
}

function readFidelityForInterval(
  interval: PolyWalletOverviewInterval
): Fidelity {
  switch (interval) {
    case "1D":
    case "1W":
      return HOUR_FIDELITY;
    case "1M":
    case "1Y":
    case "YTD":
    case "ALL":
      return DAY_FIDELITY;
  }
}

function filterPnlHistory(
  points: readonly PolymarketUserPnlPoint[],
  interval: PolyWalletOverviewInterval,
  capturedAtIso: string
): PolymarketUserPnlPoint[] {
  if (interval === "ALL") return [...points];

  const capturedAtMs = new Date(capturedAtIso).getTime();
  if (!Number.isFinite(capturedAtMs)) return [...points];

  const startMs = windowStartMs(interval, capturedAtMs);
  return points.filter((point) => point.t * 1_000 >= startMs);
}

function windowStartMs(
  interval: Exclude<PolyWalletOverviewInterval, "ALL">,
  capturedAtMs: number
): number {
  switch (interval) {
    case "1D":
      return capturedAtMs - 86_400_000;
    case "1W":
      return capturedAtMs - 7 * 86_400_000;
    case "1M":
      return capturedAtMs - 30 * 86_400_000;
    case "1Y":
      return capturedAtMs - 365 * 86_400_000;
    case "YTD": {
      const now = new Date(capturedAtMs);
      return Date.UTC(now.getUTCFullYear(), 0, 1);
    }
  }
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
