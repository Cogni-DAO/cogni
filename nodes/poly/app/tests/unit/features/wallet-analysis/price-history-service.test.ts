// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/price-history-service` tests
 * Purpose: Unit coverage for the writer's two-fidelity ingest call sequence,
 *          outbound-logger forwarding, and dedupe shape (task.5018, CP7).
 *          DB-shape coverage lives in the component test under
 *          `tests/component/wallet-analysis/`.
 * @internal
 */

import type {
  ClobPriceHistoryParams,
  ClobPriceHistoryPoint,
  PriceHistoryOutboundLogger,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setPriceHistoryClobClientForTests,
  pickStoredPriceHistoryFidelity,
  runPriceHistoryTick,
} from "@/features/wallet-analysis/server/price-history-service";

const ASSET_A = "0xasset-a";
const ASSET_B = "0xasset-b";

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

function fakeDb(assets: readonly string[]) {
  // Track upsert calls so the test can assert per-(asset, fidelity) row counts.
  const upsertCalls: Array<{
    asset: string;
    fidelity: string;
    rowCount: number;
  }> = [];
  // selectDistinct is called twice per tick: once on current positions, once
  // on recent fills. The first returns the configured asset list; the second
  // returns empty so the union dedupes to `assets` only.
  let selectDistinctCallCount = 0;
  const db = {
    selectDistinct: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(async () => {
          selectDistinctCallCount += 1;
          if (selectDistinctCallCount === 1) {
            return assets.map((asset) => ({ asset }));
          }
          return [];
        }),
      }),
    })),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation(
        (
          rows: Array<{
            asset: string;
            fidelity: string;
          }>
        ) => ({
          onConflictDoUpdate: vi.fn().mockImplementation(async () => {
            const first = rows[0];
            if (first !== undefined) {
              upsertCalls.push({
                asset: first.asset,
                fidelity: first.fidelity,
                rowCount: rows.length,
              });
            }
            return { rowCount: rows.length };
          }),
        })
      ),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue({ rowCount: 0 }),
    })),
  } as unknown as Parameters<typeof runPriceHistoryTick>[0]["db"];
  return { db, upsertCalls };
}

describe("runPriceHistoryTick", () => {
  afterEach(() => {
    __setPriceHistoryClobClientForTests(undefined);
  });

  it("polls each asset at both fidelities (`1h@1m` then `1d@max`) and upserts dedupe rows", async () => {
    const fake = fakeDb([ASSET_A]);
    const calls: Array<{ asset: string; params: ClobPriceHistoryParams }> = [];
    const getPriceHistory = vi.fn(
      async (
        asset: string,
        params?: ClobPriceHistoryParams,
        _opts?: { logger?: PriceHistoryOutboundLogger; component?: string }
      ): Promise<ClobPriceHistoryPoint[]> => {
        calls.push({ asset, params: params ?? {} });
        if (params?.fidelity === 60) {
          return [
            { t: 1_745_280_000, p: 0.42 },
            { t: 1_745_283_600, p: 0.43 },
          ];
        }
        return [{ t: 1_700_000_000, p: 0.55 }];
      }
    );
    const fakeClient = { getPriceHistory } as unknown as Parameters<
      typeof runPriceHistoryTick
    >[0]["clobClient"];

    const result = await runPriceHistoryTick({
      db: fake.db,
      clobClient: fakeClient,
      logger,
      metrics,
    });

    expect(getPriceHistory).toHaveBeenCalledTimes(2);
    expect(calls[0]).toMatchObject({
      asset: ASSET_A,
      params: { fidelity: 60, interval: "1m" },
    });
    expect(calls[1]).toMatchObject({
      asset: ASSET_A,
      params: { fidelity: 1440, interval: "max" },
    });
    expect(fake.upsertCalls).toEqual([
      { asset: ASSET_A, fidelity: "1h", rowCount: 2 },
      { asset: ASSET_A, fidelity: "1d", rowCount: 1 },
    ]);
    expect(result.assets).toBe(1);
    expect(result.upserted).toBe(3);
    expect(result.errors).toBe(0);
  });

  it("dedupes upstream points sharing the same `t` (Polymarket returns current bucket twice)", async () => {
    // bug.5011 shape: PG ON CONFLICT DO UPDATE rejects a batch hitting the
    // same conflict target twice ("command cannot affect row a second time").
    // Mirrors CP1's user-pnl writer dedupe.
    const fake = fakeDb([ASSET_A]);
    const dupTs = 1_777_939_200;
    const getPriceHistory = vi.fn(
      async (_asset, params): Promise<ClobPriceHistoryPoint[]> => {
        if (params?.fidelity === 1440) {
          return [
            { t: dupTs - 86_400, p: 0.4 },
            { t: dupTs, p: 0.5 },
            { t: dupTs, p: 0.55 }, // duplicate — last wins
          ];
        }
        return [];
      }
    );
    const fakeClient = { getPriceHistory } as unknown as Parameters<
      typeof runPriceHistoryTick
    >[0]["clobClient"];

    const result = await runPriceHistoryTick({
      db: fake.db,
      clobClient: fakeClient,
      logger,
      metrics,
    });

    expect(fake.upsertCalls).toEqual([
      { asset: ASSET_A, fidelity: "1d", rowCount: 2 },
    ]);
    expect(result.upserted).toBe(2);
  });

  it("forwards the outbound logger so PAGE_LOAD_DB_ONLY violations are observable", async () => {
    const fake = fakeDb([ASSET_A]);
    const observed: Array<{ event: string; component: string; asset: string }> =
      [];
    const outboundLog = {
      info: vi.fn((payload) => {
        if (payload.event === "poly.market-price-history.outbound") {
          observed.push({
            event: payload.event,
            component: payload.component,
            asset: payload.asset,
          });
        }
      }),
    };
    const childLogger = {
      ...logger,
      child: () => childLogger,
      info: outboundLog.info,
    } as unknown as Parameters<typeof runPriceHistoryTick>[0]["logger"];

    const getPriceHistory = vi.fn(
      async (
        _asset: string,
        _params?: ClobPriceHistoryParams,
        opts?: { logger?: PriceHistoryOutboundLogger; component?: string }
      ): Promise<ClobPriceHistoryPoint[]> => {
        opts?.logger?.info({
          event: "poly.market-price-history.outbound",
          component: opts.component ?? "unknown",
          asset: _asset,
        });
        return [];
      }
    );
    const fakeClient = { getPriceHistory } as unknown as Parameters<
      typeof runPriceHistoryTick
    >[0]["clobClient"];

    await runPriceHistoryTick({
      db: fake.db,
      clobClient: fakeClient,
      logger: childLogger,
      metrics,
    });

    expect(observed.length).toBeGreaterThanOrEqual(2);
    expect(observed.every((o) => o.component === "trader-price-history")).toBe(
      true
    );
    expect(observed.every((o) => o.asset === ASSET_A)).toBe(true);
  });

  it("counts errors per asset×fidelity but keeps polling sibling assets", async () => {
    const fake = fakeDb([ASSET_A, ASSET_B]);
    const getPriceHistory = vi.fn(
      async (asset: string): Promise<ClobPriceHistoryPoint[]> => {
        if (asset === ASSET_A) throw new Error("boom-A");
        return [{ t: 1, p: 0.1 }];
      }
    );
    const fakeClient = { getPriceHistory } as unknown as Parameters<
      typeof runPriceHistoryTick
    >[0]["clobClient"];

    const result = await runPriceHistoryTick({
      db: fake.db,
      clobClient: fakeClient,
      logger,
      metrics,
    });

    // ASSET_A throws on both fidelities → 2 errors. ASSET_B succeeds twice.
    expect(result.errors).toBe(2);
    expect(result.assets).toBe(2);
    // ASSET_B's two upserts should still have happened.
    const assetBCalls = fake.upsertCalls.filter((c) => c.asset === ASSET_B);
    expect(assetBCalls).toHaveLength(2);
  });
});

describe("pickStoredPriceHistoryFidelity", () => {
  it("uses `1h` for windows up to ~30 days, `1d` for longer", () => {
    const now = 1_777_939_200;
    expect(pickStoredPriceHistoryFidelity(now - 86_400, now)).toBe("1h"); // 1 day
    expect(pickStoredPriceHistoryFidelity(now - 7 * 86_400, now)).toBe("1h"); // 1 week
    expect(pickStoredPriceHistoryFidelity(now - 30 * 86_400, now)).toBe("1h"); // ~1 month
    expect(pickStoredPriceHistoryFidelity(now - 60 * 86_400, now)).toBe("1d"); // 2 months
    expect(pickStoredPriceHistoryFidelity(now - 365 * 86_400, now)).toBe("1d"); // 1 year
  });
});
