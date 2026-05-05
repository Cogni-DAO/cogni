// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/component/wallet-analysis/trader-comparison-resolution.int`
 * Purpose: Component coverage for CP6 (task.5012) — trader-comparison's default resolution reader
 *          now reads `poly_market_outcomes` instead of fanning out CLOB calls. Validates that
 *          win/loss/pending classification matches DB-resolved outcomes for a real wallet's
 *          fill set, including the missing-outcome case (returns `null` ⇒ pending).
 * Scope: Service-role DB + mocked `getPnlSlice`. No network.
 * Invariants: PAGE_LOAD_DB_ONLY (no CLOB call when default resolution reader is used).
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: nodes/poly/app/src/features/wallet-analysis/server/trader-comparison-service.ts, work/items/task.5012
 * @internal
 */

import { randomUUID } from "node:crypto";
import {
  polyMarketOutcomes,
  polyTraderFills,
  polyTraderWallets,
} from "@cogni/poly-db-schema";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTraderComparison } from "@/features/wallet-analysis/server/trader-comparison-service";

vi.mock("@/features/wallet-analysis/server/wallet-analysis-service", () => ({
  getPnlSlice: vi.fn().mockResolvedValue({
    kind: "ok",
    value: {
      interval: "ALL",
      computedAt: "2026-05-04T00:00:00.000Z",
      history: [
        { ts: "2026-04-01T00:00:00.000Z", pnl: 0 },
        { ts: "2026-05-01T00:00:00.000Z", pnl: 50 },
      ],
    },
  }),
}));

const WALLET = "0x5012cb6000000000000000000000000000005012" as const;
const COND_WIN = "cond-cp6-win";
const COND_LOSE = "cond-cp6-lose";
const COND_PENDING = "cond-cp6-pending";
const TOKEN_WIN_YES = "token-cp6-win-yes";
const TOKEN_WIN_NO = "token-cp6-win-no";
const TOKEN_LOSE_YES = "token-cp6-lose-yes";
const TOKEN_LOSE_NO = "token-cp6-lose-no";
const TOKEN_PENDING = "token-cp6-pending";

describe("getTraderComparison default DB resolution reader (component)", () => {
  const db = getSeedDb();

  afterEach(async () => {
    await db
      .delete(polyTraderWallets)
      .where(eq(polyTraderWallets.walletAddress, WALLET));
    await db
      .delete(polyMarketOutcomes)
      .where(
        inArray(polyMarketOutcomes.conditionId, [
          COND_WIN,
          COND_LOSE,
          COND_PENDING,
        ])
      );
  });

  it("classifies fills using poly_market_outcomes (winner/loser/missing)", async () => {
    const walletId = randomUUID();
    await db.insert(polyTraderWallets).values({
      id: walletId,
      walletAddress: WALLET,
      kind: "copy_target",
      label: "cp6-component",
      activeForResearch: true,
    });

    const observedAt = new Date("2026-05-01T00:00:00.000Z");
    await db.insert(polyTraderFills).values([
      {
        traderWalletId: walletId,
        source: "data-api",
        nativeId: "fill-cp6-win",
        conditionId: COND_WIN,
        tokenId: TOKEN_WIN_YES,
        side: "BUY",
        price: "0.10000000",
        shares: "100.00000000",
        sizeUsdc: "10.00000000",
        observedAt,
      },
      {
        traderWalletId: walletId,
        source: "data-api",
        nativeId: "fill-cp6-lose",
        conditionId: COND_LOSE,
        tokenId: TOKEN_LOSE_YES,
        side: "BUY",
        price: "0.50000000",
        shares: "20.00000000",
        sizeUsdc: "10.00000000",
        observedAt,
      },
      {
        traderWalletId: walletId,
        source: "data-api",
        nativeId: "fill-cp6-pending",
        conditionId: COND_PENDING,
        tokenId: TOKEN_PENDING,
        side: "BUY",
        price: "0.30000000",
        shares: "33.33333333",
        sizeUsdc: "10.00000000",
        observedAt,
      },
    ]);

    await db.insert(polyMarketOutcomes).values([
      { conditionId: COND_WIN, tokenId: TOKEN_WIN_YES, outcome: "winner" },
      { conditionId: COND_WIN, tokenId: TOKEN_WIN_NO, outcome: "loser" },
      { conditionId: COND_LOSE, tokenId: TOKEN_LOSE_YES, outcome: "loser" },
      { conditionId: COND_LOSE, tokenId: TOKEN_LOSE_NO, outcome: "winner" },
      // COND_PENDING intentionally has no row — reader returns null ⇒ pending.
    ]);

    const result = await getTraderComparison(
      db,
      [{ address: WALLET, label: "cp6" }],
      "ALL"
    );

    const stats = result.traders[0]?.tradeSizePnl;
    expect(stats).toBeDefined();
    expect(stats?.sampleBuyCount).toBe(3);
    expect(stats?.resolvedCount).toBe(2);
    expect(stats?.pendingCount).toBe(1);
    expect(stats?.winCount).toBe(1);
    expect(stats?.lossCount).toBe(1);
  });

  it("returns all-pending when no outcomes exist (cold-start before CP3 backfill)", async () => {
    const walletId = randomUUID();
    await db.insert(polyTraderWallets).values({
      id: walletId,
      walletAddress: WALLET,
      kind: "copy_target",
      label: "cp6-cold-start",
      activeForResearch: true,
    });
    await db.insert(polyTraderFills).values({
      traderWalletId: walletId,
      source: "data-api",
      nativeId: "fill-cp6-cold",
      conditionId: COND_PENDING,
      tokenId: TOKEN_PENDING,
      side: "BUY",
      price: "0.40000000",
      shares: "25.00000000",
      sizeUsdc: "10.00000000",
      observedAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    const result = await getTraderComparison(db, [{ address: WALLET }], "ALL");

    const stats = result.traders[0]?.tradeSizePnl;
    expect(stats?.sampleBuyCount).toBe(1);
    expect(stats?.resolvedCount).toBe(0);
    expect(stats?.pendingCount).toBe(1);
    expect(stats?.pnlUsdc).toBe(0);
  });
});
