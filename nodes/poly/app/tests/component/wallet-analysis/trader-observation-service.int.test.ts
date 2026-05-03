// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/component/wallet-analysis/trader-observation-service.int`
 * Purpose: Component coverage for observed-trader persistence against real Postgres.
 * Scope: Service-role DB + fake Polymarket Data API client. No external network.
 * Invariants: LIVE_FORWARD_COLLECTION, CURRENT_POSITION_STALE_DEACTIVATION.
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: src/features/wallet-analysis/server/trader-observation-service.ts, work/items/task.5005
 * @internal
 */

import { randomUUID } from "node:crypto";
import {
  polyTraderCurrentPositions,
  polyTraderWallets,
} from "@cogni/poly-db-schema";
import type {
  PolymarketDataApiClient,
  PolymarketUserPosition,
  PolymarketUserTrade,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { runTraderObservationTick } from "@/features/wallet-analysis/server/trader-observation-service";

const TARGET_WALLET = "0x5005000000000000000000000000000000005005";
const MARKET = "condition-5005";
const TOKEN = "token-5005";

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

function position(): PolymarketUserPosition {
  return {
    proxyWallet: TARGET_WALLET,
    asset: TOKEN,
    conditionId: MARKET,
    size: 2,
    avgPrice: 0.5,
    initialValue: 1,
    currentValue: 1,
    cashPnl: 0,
    percentPnl: 0,
    realizedPnl: 0,
    curPrice: 0.5,
    redeemable: false,
    mergeable: false,
    title: "Task 5005 component market",
  };
}

function clientWithPositions(
  positions: readonly PolymarketUserPosition[]
): PolymarketDataApiClient {
  return {
    async listUserActivity(): Promise<PolymarketUserTrade[]> {
      return [];
    },
    async listUserPositions(
      walletAddress: string
    ): Promise<PolymarketUserPosition[]> {
      return walletAddress.toLowerCase() === TARGET_WALLET.toLowerCase()
        ? [...positions]
        : [];
    },
  } as unknown as PolymarketDataApiClient;
}

describe("runTraderObservationTick (component)", () => {
  const db = getSeedDb();

  afterEach(async () => {
    await db
      .delete(polyTraderWallets)
      .where(eq(polyTraderWallets.walletAddress, TARGET_WALLET));
  });

  it("deactivates stale current positions after a complete position poll", async () => {
    const walletId = randomUUID();
    await db.insert(polyTraderWallets).values({
      id: walletId,
      walletAddress: TARGET_WALLET,
      kind: "copy_target",
      label: "task-5005-test-target",
      activeForResearch: true,
    });
    await db.insert(polyTraderCurrentPositions).values({
      traderWalletId: walletId,
      conditionId: MARKET,
      tokenId: TOKEN,
      active: true,
      shares: "2.00000000",
      costBasisUsdc: "1.00000000",
      currentValueUsdc: "1.00000000",
      avgPrice: "0.50000000",
      contentHash: "old-position-hash",
      lastObservedAt: new Date("2026-05-03T00:00:00.000Z"),
      raw: position() as unknown as Record<string, unknown>,
    });

    const result = await runTraderObservationTick({
      db,
      client: clientWithPositions([]),
      logger,
      metrics,
      positionPollMs: 0,
    });

    expect(result.errors).toBe(0);
    const [row] = await db
      .select()
      .from(polyTraderCurrentPositions)
      .where(eq(polyTraderCurrentPositions.traderWalletId, walletId));
    expect(row?.active).toBe(false);
    expect(row?.shares).toBe("0.00000000");
    expect(row?.currentValueUsdc).toBe("0.00000000");
  });

  it("upserts current positions and stores changed snapshots", async () => {
    const walletId = randomUUID();
    await db.insert(polyTraderWallets).values({
      id: walletId,
      walletAddress: TARGET_WALLET,
      kind: "copy_target",
      label: "task-5005-test-target",
      activeForResearch: true,
    });

    const result = await runTraderObservationTick({
      db,
      client: clientWithPositions([position()]),
      logger,
      metrics,
      positionPollMs: 0,
    });

    expect(result.errors).toBe(0);
    expect(result.positions).toBe(1);
    const [row] = await db
      .select()
      .from(polyTraderCurrentPositions)
      .where(eq(polyTraderCurrentPositions.traderWalletId, walletId));
    expect(row?.active).toBe(true);
    expect(row?.conditionId).toBe(MARKET);
    expect(row?.tokenId).toBe(TOKEN);
    expect(row?.shares).toBe("2.00000000");
  });
});
