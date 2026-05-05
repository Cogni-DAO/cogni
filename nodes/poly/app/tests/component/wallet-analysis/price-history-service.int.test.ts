// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/component/wallet-analysis/price-history-service.int`
 * Purpose: Component coverage for the per-asset price-history mirror against
 *          real Postgres. Exercises the writer (open-position enumeration +
 *          two-fidelity ingest + dedupe + idempotent re-tick) and the reader
 *          (`readPriceHistoryFromDb` returns rows in window).
 * Scope: Service-role DB + fake CLOB public client. No external network.
 * Invariants: PRICE_HISTORY_TIMESERIES_KEYED, WRITER_TARGETS_OPEN_AND_RECENT_CLOSED.
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: src/features/wallet-analysis/server/price-history-service.ts, work/items/task.5018
 * @internal
 */

import { randomUUID } from "node:crypto";
import {
  polyMarketPriceHistory,
  polyTraderCurrentPositions,
  polyTraderFills,
  polyTraderWallets,
} from "@cogni/poly-db-schema";
import type {
  ClobPriceHistoryParams,
  ClobPriceHistoryPoint,
  PolymarketClobPublicClient,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  readPriceHistoryFromDb,
  runPriceHistoryTick,
} from "@/features/wallet-analysis/server/price-history-service";

const TARGET_WALLET = "0x5018000000000000000000000000000000005018";
const ASSET_A = "asset-5018-a";
const ASSET_B = "asset-5018-b";
const ASSET_C = "asset-5018-c";
const CONDITION = "condition-5018";

const logger = {
  child: () => logger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const metrics = {
  incr: () => {},
  observeDurationMs: () => {},
};

function fakeClobClient(
  series: Record<
    string,
    { hour: ClobPriceHistoryPoint[]; day: ClobPriceHistoryPoint[] }
  >
): PolymarketClobPublicClient {
  return {
    async getMarketResolution() {
      return null;
    },
    async getPriceHistory(
      asset: string,
      params?: ClobPriceHistoryParams
    ): Promise<ClobPriceHistoryPoint[]> {
      const entry = series[asset];
      if (!entry) return [];
      return params?.fidelity === 60 ? entry.hour : entry.day;
    },
  } as unknown as PolymarketClobPublicClient;
}

describe("runPriceHistoryTick (component)", () => {
  const db = getSeedDb();
  const ASSETS = [ASSET_A, ASSET_B, ASSET_C];

  afterEach(async () => {
    await db
      .delete(polyMarketPriceHistory)
      .where(inArray(polyMarketPriceHistory.asset, ASSETS));
    await db
      .delete(polyTraderWallets)
      .where(eq(polyTraderWallets.walletAddress, TARGET_WALLET));
  });

  it("polls every distinct active-position asset, stores both fidelities, and is idempotent on re-tick", async () => {
    const walletId = randomUUID();
    await db.insert(polyTraderWallets).values({
      id: walletId,
      walletAddress: TARGET_WALLET,
      kind: "copy_target",
      label: "task-5018-test-target",
      activeForResearch: true,
    });
    // Three distinct active assets — writer should poll each twice (1h + 1d).
    for (const asset of [ASSET_A, ASSET_B]) {
      await db.insert(polyTraderCurrentPositions).values({
        traderWalletId: walletId,
        conditionId: CONDITION,
        tokenId: asset,
        active: true,
        shares: "2.00000000",
        costBasisUsdc: "1.00000000",
        currentValueUsdc: "1.00000000",
        avgPrice: "0.50000000",
        contentHash: `hash-${asset}`,
      });
    }
    // Asset C: not in current_positions but traded in last 7 days.
    await db.insert(polyTraderFills).values({
      traderWalletId: walletId,
      source: "data-api",
      nativeId: `native-${ASSET_C}`,
      conditionId: CONDITION,
      tokenId: ASSET_C,
      side: "BUY",
      price: "0.50000000",
      shares: "1.00000000",
      sizeUsdc: "0.50000000",
      observedAt: new Date(Date.now() - 86_400_000),
    });

    const baseTs = Math.floor(Date.now() / 1_000) - 3600;
    const series: Record<
      string,
      {
        hour: ClobPriceHistoryPoint[];
        day: ClobPriceHistoryPoint[];
      }
    > = {
      [ASSET_A]: {
        hour: [
          { t: baseTs, p: 0.4 },
          { t: baseTs + 3600, p: 0.42 },
        ],
        day: [{ t: baseTs - 7 * 86_400, p: 0.35 }],
      },
      [ASSET_B]: {
        hour: [{ t: baseTs, p: 0.6 }],
        day: [{ t: baseTs - 7 * 86_400, p: 0.55 }],
      },
      [ASSET_C]: {
        hour: [{ t: baseTs, p: 0.7 }],
        day: [{ t: baseTs - 7 * 86_400, p: 0.65 }],
      },
    };

    const result = await runPriceHistoryTick({
      db,
      clobClient: fakeClobClient(series),
      logger,
      metrics,
    });

    expect(result.errors).toBe(0);
    expect(result.assets).toBe(3);
    // 3 assets × (hour + day rows) = 2+1 + 1+1 + 1+1 = 7
    expect(result.upserted).toBe(7);

    const hourRowsA = await db
      .select()
      .from(polyMarketPriceHistory)
      .where(
        and(
          eq(polyMarketPriceHistory.asset, ASSET_A),
          eq(polyMarketPriceHistory.fidelity, "1h")
        )
      );
    expect(hourRowsA).toHaveLength(2);
    expect(hourRowsA.map((r) => Number(r.price)).sort()).toEqual([0.4, 0.42]);

    const dayRowsB = await db
      .select()
      .from(polyMarketPriceHistory)
      .where(
        and(
          eq(polyMarketPriceHistory.asset, ASSET_B),
          eq(polyMarketPriceHistory.fidelity, "1d")
        )
      );
    expect(dayRowsB).toHaveLength(1);
    expect(Number(dayRowsB[0]?.price)).toBe(0.55);

    // Re-tick is idempotent (PK on asset/fidelity/ts → upsert no-ops).
    const result2 = await runPriceHistoryTick({
      db,
      clobClient: fakeClobClient(series),
      logger,
      metrics,
    });
    expect(result2.errors).toBe(0);
    const allRows = await db
      .select()
      .from(polyMarketPriceHistory)
      .where(inArray(polyMarketPriceHistory.asset, ASSETS));
    // Same row count — re-tick upserts in place.
    expect(allRows).toHaveLength(7);
  });

  it("readPriceHistoryFromDb returns rows in the requested window for a (asset, fidelity)", async () => {
    const walletId = randomUUID();
    await db.insert(polyTraderWallets).values({
      id: walletId,
      walletAddress: TARGET_WALLET,
      kind: "copy_target",
      label: "task-5018-reader-test",
      activeForResearch: true,
    });
    await db.insert(polyTraderCurrentPositions).values({
      traderWalletId: walletId,
      conditionId: CONDITION,
      tokenId: ASSET_A,
      active: true,
      shares: "2.00000000",
      costBasisUsdc: "1.00000000",
      currentValueUsdc: "1.00000000",
      avgPrice: "0.50000000",
      contentHash: "hash-reader",
    });

    const startTs = Math.floor(Date.now() / 1_000) - 7200;
    const midTs = startTs + 3600;
    const endTs = startTs + 7200;
    const series: Record<
      string,
      {
        hour: ClobPriceHistoryPoint[];
        day: ClobPriceHistoryPoint[];
      }
    > = {
      [ASSET_A]: {
        hour: [
          { t: startTs - 86_400, p: 0.3 }, // outside the read window
          { t: startTs, p: 0.4 },
          { t: midTs, p: 0.45 },
          { t: endTs, p: 0.5 },
        ],
        day: [],
      },
    };
    await runPriceHistoryTick({
      db,
      clobClient: fakeClobClient(series),
      logger,
      metrics,
    });

    const points = await readPriceHistoryFromDb(
      db,
      ASSET_A,
      startTs,
      endTs,
      "1h"
    );
    expect(points.map((p) => p.t)).toEqual([startTs, midTs, endTs]);
    expect(points.map((p) => p.p)).toEqual([0.4, 0.45, 0.5]);
  });

  it("readPriceHistoryFromDb returns [] when no rows are stored (cold-start gap)", async () => {
    const points = await readPriceHistoryFromDb(
      db,
      ASSET_A,
      0,
      Math.floor(Date.now() / 1_000),
      "1h"
    );
    expect(points).toEqual([]);
  });
});
