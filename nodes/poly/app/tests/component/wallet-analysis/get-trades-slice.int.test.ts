// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/wallet-analysis/get-trades-slice.int`
 * Purpose: Component coverage for the DB-backed `getTradesSlice` (task.5012 CP2).
 *          Validates: empty wallet → empty slice; populated wallet → mapped recent
 *          trades + dailyCounts + topMarkets; raw.attributes.title is recovered
 *          for marketTitle.
 * Scope: Service-role DB. No upstream HTTP.
 * Invariants: PAGE_LOAD_DB_ONLY for trades.
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: src/features/wallet-analysis/server/wallet-analysis-service.ts, work/items/task.5014
 * @internal
 */

import { randomUUID } from "node:crypto";
import { polyTraderFills, polyTraderWallets } from "@cogni/poly-db-schema";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getTradesSlice } from "@/features/wallet-analysis/server/wallet-analysis-service";

const WALLET = "0x5014000000000000000000000000000000005014" as const;

describe("getTradesSlice (DB-backed, component)", () => {
  const db = getSeedDb();

  afterEach(async () => {
    await db
      .delete(polyTraderWallets)
      .where(eq(polyTraderWallets.walletAddress, WALLET));
  });

  it("returns empty slice for an unobserved wallet", async () => {
    const result = await getTradesSlice(db, WALLET);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.recent).toEqual([]);
    expect(result.value.topMarkets).toEqual([]);
    expect(result.value.dailyCounts.length).toBe(14);
    for (const day of result.value.dailyCounts) expect(day.n).toBe(0);
  });

  it("maps `poly_trader_fills` rows to recent trades + recovers marketTitle from raw", async () => {
    const walletId = randomUUID();
    await db.insert(polyTraderWallets).values({
      id: walletId,
      walletAddress: WALLET,
      kind: "copy_target",
      label: "task-5014-test-target",
      activeForResearch: true,
    });
    const observedAt = new Date("2026-05-04T12:00:00.000Z");
    await db.insert(polyTraderFills).values([
      {
        traderWalletId: walletId,
        source: "data-api",
        nativeId: "0xabc:0",
        conditionId: "0xCOND_A",
        tokenId: "0xTOK_A",
        side: "BUY",
        price: "0.42000000",
        shares: "100.00000000",
        sizeUsdc: "42.00000000",
        observedAt,
        raw: {
          attributes: { title: "Will A win?", slug: "a-win" },
        } as Record<string, unknown>,
      },
      {
        traderWalletId: walletId,
        source: "data-api",
        nativeId: "0xabc:1",
        conditionId: "0xCOND_B",
        tokenId: "0xTOK_B",
        side: "SELL",
        price: "0.55000000",
        shares: "50.00000000",
        sizeUsdc: "27.50000000",
        observedAt: new Date(observedAt.getTime() - 60_000),
        raw: { attributes: { title: "Will B happen?" } } as Record<
          string,
          unknown
        >,
      },
    ]);

    const result = await getTradesSlice(db, WALLET);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.value.recent.length).toBe(2);
    // Newest first.
    expect(result.value.recent[0]?.conditionId).toBe("0xCOND_A");
    expect(result.value.recent[0]?.marketTitle).toBe("Will A win?");
    expect(result.value.recent[0]?.side).toBe("BUY");
    expect(result.value.recent[0]?.size).toBe(100);
    expect(result.value.recent[0]?.price).toBe(0.42);

    // topMarkets pulls market titles, newest-first dedupe by conditionId.
    expect(result.value.topMarkets.slice(0, 2)).toEqual([
      "Will A win?",
      "Will B happen?",
    ]);
  });

  it("recent[*].marketTitle is null when raw lacks attributes.title", async () => {
    const walletId = randomUUID();
    await db.insert(polyTraderWallets).values({
      id: walletId,
      walletAddress: WALLET,
      kind: "copy_target",
      label: "task-5014-test-target",
      activeForResearch: true,
    });
    await db.insert(polyTraderFills).values({
      traderWalletId: walletId,
      source: "data-api",
      nativeId: "0xabc:nullraw",
      conditionId: "0xCOND_X",
      tokenId: "0xTOK_X",
      side: "BUY",
      price: "0.10000000",
      shares: "1.00000000",
      sizeUsdc: "0.10000000",
      observedAt: new Date(),
      raw: null,
    });

    const result = await getTradesSlice(db, WALLET);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.recent[0]?.marketTitle).toBeNull();
  });

  it("address lookup is case-insensitive", async () => {
    const walletId = randomUUID();
    await db.insert(polyTraderWallets).values({
      id: walletId,
      walletAddress: WALLET,
      kind: "copy_target",
      label: "task-5014-test-target",
      activeForResearch: true,
    });
    await db.insert(polyTraderFills).values({
      traderWalletId: walletId,
      source: "data-api",
      nativeId: "0xabc:case",
      conditionId: "0xCOND_X",
      tokenId: "0xTOK_X",
      side: "BUY",
      price: "0.10000000",
      shares: "1.00000000",
      sizeUsdc: "0.10000000",
      observedAt: new Date(),
      raw: { attributes: { title: "case insensitive" } } as Record<
        string,
        unknown
      >,
    });

    const upper = `0x${WALLET.slice(2).toUpperCase()}` as `0x${string}`;
    const result = await getTradesSlice(db, upper);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.recent.length).toBe(1);
  });
});
