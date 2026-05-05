// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/trading-wallet-overview-service` tests
 * Purpose: Unit coverage for the writer's two-fidelity ingest call sequence and
 *          outbound-logger forwarding (task.5012). DB-shape coverage lives in
 *          the component test under `tests/component/wallet-analysis/`.
 * @internal
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setTradingWalletOverviewUserPnlClientForTests,
  fetchAndPersistTradingWalletPnlHistory,
} from "@/features/wallet-analysis/server/trading-wallet-overview-service";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const TRADER_WALLET_ID = "00000000-0000-0000-0000-000000000001";

function fakeDbForInsertOnly() {
  const insertCalls: Array<{ fidelity: string; rowCount: number }> = [];
  const db = {
    insert: vi.fn().mockReturnValue({
      values: vi
        .fn()
        .mockImplementation((rows: Array<{ fidelity: string }>) => {
          const first = rows[0];
          if (first !== undefined) {
            insertCalls.push({
              fidelity: first.fidelity,
              rowCount: rows.length,
            });
          }
          return {
            onConflictDoUpdate: vi
              .fn()
              .mockResolvedValue({ rowCount: rows.length }),
          };
        }),
    }),
  } as unknown as Parameters<
    typeof fetchAndPersistTradingWalletPnlHistory
  >[0]["db"];
  return { db, insertCalls };
}

describe("fetchAndPersistTradingWalletPnlHistory", () => {
  afterEach(() => {
    __setTradingWalletOverviewUserPnlClientForTests(undefined);
  });

  it("ingests at both fidelities (`1h@1w` then `1d@all`)", async () => {
    const fake = fakeDbForInsertOnly();
    const getUserPnl = vi.fn(async (_wallet, params) => {
      if (params.fidelity === "1h") {
        return [
          { t: 1_745_280_000, p: 1.2 },
          { t: 1_745_283_600, p: 1.3 },
        ];
      }
      return [{ t: 1_700_000_000, p: -2.5 }];
    });
    const fakeClient = { getUserPnl } as unknown as Parameters<
      typeof fetchAndPersistTradingWalletPnlHistory
    >[0]["client"];

    const result = await fetchAndPersistTradingWalletPnlHistory({
      db: fake.db,
      traderWalletId: TRADER_WALLET_ID,
      walletAddress: WALLET,
      client: fakeClient,
    });

    expect(getUserPnl).toHaveBeenCalledTimes(2);
    expect(getUserPnl).toHaveBeenNthCalledWith(
      1,
      WALLET,
      expect.objectContaining({ interval: "1w", fidelity: "1h" }),
      undefined
    );
    expect(getUserPnl).toHaveBeenNthCalledWith(
      2,
      WALLET,
      expect.objectContaining({ interval: "all", fidelity: "1d" }),
      undefined
    );
    expect(fake.insertCalls).toEqual([
      { fidelity: "1h", rowCount: 2 },
      { fidelity: "1d", rowCount: 1 },
    ]);
    expect(result.inserted).toBe(3);
    expect(result.fidelities).toEqual(["1h", "1d"]);
  });

  it("forwards the outbound logger so PAGE_LOAD_DB_ONLY violations are observable", async () => {
    const fake = fakeDbForInsertOnly();
    const getUserPnl = vi.fn().mockResolvedValue([{ t: 1, p: 0 }]);
    const fakeClient = { getUserPnl } as unknown as Parameters<
      typeof fetchAndPersistTradingWalletPnlHistory
    >[0]["client"];
    const logger = { info: vi.fn() };

    await fetchAndPersistTradingWalletPnlHistory({
      db: fake.db,
      traderWalletId: TRADER_WALLET_ID,
      walletAddress: WALLET,
      client: fakeClient,
      logger,
      component: "trader-observation",
    });

    expect(getUserPnl).toHaveBeenCalledWith(
      WALLET,
      expect.any(Object),
      expect.objectContaining({
        logger,
        component: "trader-observation",
      })
    );
  });

  it("dedupes upstream points sharing the same t (Polymarket returns current bucket twice)", async () => {
    // bug.5011: Polymarket /user-pnl?interval=all returns the current day twice
    // (running-aggregate + final). Without dedup, INSERT ... ON CONFLICT DO UPDATE
    // throws "command cannot affect row a second time" and the whole writer fails.
    const fake = fakeDbForInsertOnly();
    const dupTs = 1_777_939_200;
    const getUserPnl = vi.fn(async (_wallet, params) => {
      if (params.fidelity === "1d") {
        return [
          { t: dupTs - 86_400, p: 1 },
          { t: dupTs, p: 2 },
          { t: dupTs, p: 3 }, // duplicate t — last wins
        ];
      }
      return [];
    });
    const fakeClient = { getUserPnl } as unknown as Parameters<
      typeof fetchAndPersistTradingWalletPnlHistory
    >[0]["client"];

    const result = await fetchAndPersistTradingWalletPnlHistory({
      db: fake.db,
      traderWalletId: TRADER_WALLET_ID,
      walletAddress: WALLET,
      client: fakeClient,
    });

    // Expect 2 rows (deduped from 3), all under fidelity '1d'.
    expect(fake.insertCalls).toEqual([{ fidelity: "1d", rowCount: 2 }]);
    expect(result.inserted).toBe(2);
  });

  it("skips a fidelity when upstream returns no points", async () => {
    const fake = fakeDbForInsertOnly();
    const getUserPnl = vi.fn(async (_wallet, params) => {
      return params.fidelity === "1h" ? [] : [{ t: 1, p: 0 }];
    });
    const fakeClient = { getUserPnl } as unknown as Parameters<
      typeof fetchAndPersistTradingWalletPnlHistory
    >[0]["client"];

    const result = await fetchAndPersistTradingWalletPnlHistory({
      db: fake.db,
      traderWalletId: TRADER_WALLET_ID,
      walletAddress: WALLET,
      client: fakeClient,
    });

    expect(fake.insertCalls).toEqual([{ fidelity: "1d", rowCount: 1 }]);
    expect(result.inserted).toBe(1);
    expect(result.fidelities).toEqual(["1d"]);
  });
});
