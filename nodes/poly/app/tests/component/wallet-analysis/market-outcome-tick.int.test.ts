// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/component/wallet-analysis/market-outcome-tick.int`
 * Purpose: Component coverage for `runMarketOutcomeTick` against real Postgres.
 *          Seeds wallets/fills/positions for one wallet across 5 distinct
 *          conditions, runs the tick with a stub CLOB client, and verifies
 *          all 5 outcomes land in `poly_market_outcomes`. Re-tick verifies
 *          idempotency under TTL refresh.
 * Scope: Service-role DB + stub CLOB client. No external network.
 * Invariants: DEDUPE_BEFORE_UPSERT, BATCH_BOUNDED.
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: src/features/wallet-analysis/server/market-outcome-service.ts, work/items/task.5016
 * @internal
 */

import { randomUUID } from "node:crypto";
import {
  polyMarketOutcomes,
  polyTraderCurrentPositions,
  polyTraderFills,
  polyTraderWallets,
} from "@cogni/poly-db-schema";
import type { MarketResolutionInput } from "@cogni/poly-market-provider/analysis";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMarketOutcomeTick } from "@/features/wallet-analysis/server/market-outcome-service";

const WALLET = "0x5016000000000000000000000000000000005016";
const CONDITIONS = [
  "cond-5016-a",
  "cond-5016-b",
  "cond-5016-c",
  "cond-5016-d",
  "cond-5016-e",
] as const;
const TOKENS = CONDITIONS.map((c) => `${c}-tok`);

const logger = (() => {
  const make = (): {
    info: () => void;
    warn: () => void;
    error: () => void;
    debug: () => void;
    child: () => ReturnType<typeof make>;
  } => ({
    info() {},
    warn() {},
    error() {},
    debug() {},
    child() {
      return make();
    },
  });
  return make();
})();

const noopMetrics = {
  incr: () => {},
  observeDurationMs: () => {},
};

function resolutionFor(
  conditionId: string,
  tokenId: string
): MarketResolutionInput {
  return {
    closed: true,
    tokens: [{ token_id: tokenId, winner: conditionId.endsWith("a") }],
  };
}

async function seedWalletWithFills(
  db: ReturnType<typeof getSeedDb>
): Promise<string> {
  const walletId = randomUUID();
  await db.insert(polyTraderWallets).values({
    id: walletId,
    walletAddress: WALLET,
    kind: "copy_target",
    label: "task-5016-test-target",
    activeForResearch: true,
  });

  // 5 distinct (condition, token) — split across fills + current_positions
  const observedAt = new Date();
  await db.insert(polyTraderFills).values(
    CONDITIONS.map((conditionId, i) => ({
      traderWalletId: walletId,
      source: "data-api",
      nativeId: `fill-${conditionId}`,
      conditionId,
      tokenId: TOKENS[i] as string,
      side: "BUY",
      price: "0.50000000",
      shares: "2.00000000",
      sizeUsdc: "1.00000000",
      observedAt,
      raw: {} as Record<string, unknown>,
    }))
  );

  // The first 2 also live in current_positions to verify the UNION path.
  await db.insert(polyTraderCurrentPositions).values(
    [0, 1].map((i) => ({
      traderWalletId: walletId,
      conditionId: CONDITIONS[i] as string,
      tokenId: TOKENS[i] as string,
      active: true,
      shares: "2.00000000",
      costBasisUsdc: "1.00000000",
      currentValueUsdc: "1.00000000",
      avgPrice: "0.50000000",
      contentHash: `hash-${i}`,
      lastObservedAt: observedAt,
    }))
  );

  return walletId;
}

describe("runMarketOutcomeTick (component)", () => {
  const db = getSeedDb();

  afterEach(async () => {
    await db
      .delete(polyMarketOutcomes)
      .where(inArray(polyMarketOutcomes.conditionId, [...CONDITIONS]));
    await db
      .delete(polyTraderWallets)
      .where(eq(polyTraderWallets.walletAddress, WALLET));
  });

  it("populates poly_market_outcomes for all 5 conditions touched by an active wallet", async () => {
    await seedWalletWithFills(db);

    const getMarketResolution = vi.fn(async (conditionId: string) => {
      const idx = CONDITIONS.indexOf(
        conditionId as (typeof CONDITIONS)[number]
      );
      if (idx < 0) return null;
      return resolutionFor(conditionId, TOKENS[idx] as string);
    });

    const result = await runMarketOutcomeTick({
      db,
      clobClient: { getMarketResolution },
      logger,
      metrics: noopMetrics,
    });

    expect(result.errors).toBe(0);
    expect(result.conditions).toBe(5);
    expect(result.polled).toBe(5);
    expect(result.upserted).toBe(5);

    const rows = await db
      .select()
      .from(polyMarketOutcomes)
      .where(inArray(polyMarketOutcomes.conditionId, [...CONDITIONS]));
    expect(rows).toHaveLength(5);
    const a = rows.find((r) => r.conditionId === "cond-5016-a");
    expect(a?.outcome).toBe("winner");
    const b = rows.find((r) => r.conditionId === "cond-5016-b");
    expect(b?.outcome).toBe("loser");
  });

  it("re-tick is idempotent — same row count, no errors", async () => {
    await seedWalletWithFills(db);

    const getMarketResolution = vi.fn(async (conditionId: string) => {
      const idx = CONDITIONS.indexOf(
        conditionId as (typeof CONDITIONS)[number]
      );
      if (idx < 0) return null;
      return resolutionFor(conditionId, TOKENS[idx] as string);
    });

    await runMarketOutcomeTick({
      db,
      clobClient: { getMarketResolution },
      logger,
      metrics: noopMetrics,
    });

    // Second tick: TTL cap means the recently-updated rows are NOT stale → 0 polled.
    const second = await runMarketOutcomeTick({
      db,
      clobClient: { getMarketResolution },
      logger,
      metrics: noopMetrics,
    });

    expect(second.errors).toBe(0);
    expect(second.conditions).toBe(0);

    const rows = await db
      .select()
      .from(polyMarketOutcomes)
      .where(inArray(polyMarketOutcomes.conditionId, [...CONDITIONS]));
    expect(rows).toHaveLength(5);
  });

  it("respects batchSize cap and rolls remainder into next tick", async () => {
    await seedWalletWithFills(db);

    const getMarketResolution = vi.fn(async (conditionId: string) => {
      const idx = CONDITIONS.indexOf(
        conditionId as (typeof CONDITIONS)[number]
      );
      if (idx < 0) return null;
      return resolutionFor(conditionId, TOKENS[idx] as string);
    });

    const first = await runMarketOutcomeTick({
      db,
      clobClient: { getMarketResolution },
      logger,
      metrics: noopMetrics,
      batchSize: 2,
    });
    expect(first.conditions).toBe(2);
    expect(first.upserted).toBe(2);

    const second = await runMarketOutcomeTick({
      db,
      clobClient: { getMarketResolution },
      logger,
      metrics: noopMetrics,
      batchSize: 2,
    });
    expect(second.conditions).toBe(2);

    const third = await runMarketOutcomeTick({
      db,
      clobClient: { getMarketResolution },
      logger,
      metrics: noopMetrics,
      batchSize: 2,
    });
    expect(third.conditions).toBe(1);

    const rows = await db
      .select()
      .from(polyMarketOutcomes)
      .where(inArray(polyMarketOutcomes.conditionId, [...CONDITIONS]));
    expect(rows).toHaveLength(5);
  });
});
