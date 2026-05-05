// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/component/wallet-analysis/snapshot-distributions-db.int`
 * Purpose: Component coverage for the DB-backed snapshot + distributions
 *          slices (task.5012 CP4). Verifies `getSnapshotSlice` and
 *          `getDistributionsSlice` read from `poly_trader_fills` +
 *          `poly_market_outcomes` against real Postgres with no upstream HTTP.
 * Scope: Service-role DB; no Polymarket HTTP. Asserts metric shape, resolved
 *        vs open split, and that conditions missing from `poly_market_outcomes`
 *        remain unresolved.
 * Invariants: PAGE_LOAD_DB_ONLY (task.5012).
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: src/features/wallet-analysis/server/wallet-analysis-service.ts, work/items/task.5012
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
import { afterEach, describe, expect, it } from "vitest";
import { clearTtlCache } from "@/features/wallet-analysis/server/coalesce";
import {
  getDistributionsSlice,
  getSnapshotSlice,
} from "@/features/wallet-analysis/server/wallet-analysis-service";

const WALLET = "0x5012cccc00000000000000000000000000005012" as const;
const CID_RESOLVED = "cid-cp4-resolved";
const CID_PENDING = "cid-cp4-pending";
const TOKEN_WIN = "token-cp4-win";
const TOKEN_LOSS = "token-cp4-loss";
const TOKEN_PENDING = "token-cp4-pending";

async function seedFixture(db: ReturnType<typeof getSeedDb>): Promise<string> {
  const walletId = randomUUID();
  await db.insert(polyTraderWallets).values({
    id: walletId,
    walletAddress: WALLET,
    kind: "copy_target",
    label: "task-5012-cp4-fixture",
    activeForResearch: true,
  });

  // 3 fills across 2 conditions: resolved market (BUY winner + BUY loser) and
  // pending market (single BUY).
  await db.insert(polyTraderFills).values([
    {
      traderWalletId: walletId,
      source: "data-api",
      nativeId: "fill-cp4-1",
      conditionId: CID_RESOLVED,
      tokenId: TOKEN_WIN,
      side: "BUY",
      price: "0.40000000",
      shares: "10.00000000",
      sizeUsdc: "4.00000000",
      observedAt: new Date("2026-05-01T12:00:00.000Z"),
      raw: { outcome: "YES", attributes: { title: "Resolved Market" } },
    },
    {
      traderWalletId: walletId,
      source: "data-api",
      nativeId: "fill-cp4-2",
      conditionId: CID_RESOLVED,
      tokenId: TOKEN_LOSS,
      side: "BUY",
      price: "0.30000000",
      shares: "5.00000000",
      sizeUsdc: "1.50000000",
      observedAt: new Date("2026-05-01T18:00:00.000Z"),
      raw: { outcome: "NO", attributes: { title: "Resolved Market" } },
    },
    {
      traderWalletId: walletId,
      source: "data-api",
      nativeId: "fill-cp4-3",
      conditionId: CID_PENDING,
      tokenId: TOKEN_PENDING,
      side: "BUY",
      price: "0.25000000",
      shares: "20.00000000",
      sizeUsdc: "5.00000000",
      observedAt: new Date("2026-05-02T12:00:00.000Z"),
      raw: { outcome: "YES", attributes: { title: "Pending Market" } },
    },
  ]);

  // CID_RESOLVED has both outcomes recorded (winner + loser → closed).
  // CID_PENDING has no row in poly_market_outcomes → must remain open.
  await db.insert(polyMarketOutcomes).values([
    {
      conditionId: CID_RESOLVED,
      tokenId: TOKEN_WIN,
      outcome: "winner",
    },
    {
      conditionId: CID_RESOLVED,
      tokenId: TOKEN_LOSS,
      outcome: "loser",
    },
  ]);

  return walletId;
}

describe("getSnapshotSlice + getDistributionsSlice — DB-backed (task.5012 CP4)", () => {
  const db = getSeedDb();

  afterEach(async () => {
    clearTtlCache();
    await db
      .delete(polyMarketOutcomes)
      .where(
        inArray(polyMarketOutcomes.conditionId, [CID_RESOLVED, CID_PENDING])
      );
    await db
      .delete(polyTraderWallets)
      .where(eq(polyTraderWallets.walletAddress, WALLET));
  });

  it("getSnapshotSlice computes metrics from DB fills + outcomes", async () => {
    await seedFixture(db);

    const result = await getSnapshotSlice(db, WALLET);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // CID_RESOLVED is closed → both tokens resolved (TOKEN_WIN + TOKEN_LOSS).
    // CID_PENDING is unresolved (no outcomes row) → 1 open position.
    expect(result.value.resolvedPositions).toBe(2);
    expect(result.value.wins).toBe(1);
    expect(result.value.losses).toBe(1);
    expect(result.value.openPositions).toBe(1);
    // `uniqueMarkets` counts distinct token positions (per `computeWalletMetrics`):
    // 3 distinct tokens (TOKEN_WIN, TOKEN_LOSS, TOKEN_PENDING).
    expect(result.value.uniqueMarkets).toBe(3);
    expect(result.value.computedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
  });

  it("getDistributionsSlice builds histograms from DB fills + outcomes", async () => {
    await seedFixture(db);

    const result = await getDistributionsSlice(db, WALLET, "historical");

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.mode).toBe("historical");
    expect(result.value.range.n).toBe(3);
    // One pending fill (CID_PENDING) out of 3 → pendingShare ≈ 1/3.
    expect(result.value.pendingShare.byCount).toBeGreaterThan(0);
    const totalBucketed = result.value.tradeSize.buckets.reduce(
      (sum, bucket) =>
        sum +
        bucket.values.count.won +
        bucket.values.count.lost +
        bucket.values.count.pending,
      0
    );
    expect(totalBucketed).toBe(3);
  });

  it("returns empty/zero metrics for cold-start wallet (no DB rows)", async () => {
    const ABSENT_WALLET = "0x5012dddd00000000000000000000000000005012";

    const snap = await getSnapshotSlice(db, ABSENT_WALLET);
    expect(snap.kind).toBe("ok");
    if (snap.kind !== "ok") return;
    expect(snap.value.resolvedPositions).toBe(0);
    expect(snap.value.openPositions).toBe(0);
    expect(snap.value.uniqueMarkets).toBe(0);

    const dist = await getDistributionsSlice(db, ABSENT_WALLET, "historical");
    expect(dist.kind).toBe("ok");
    if (dist.kind !== "ok") return;
    expect(dist.value.range.n).toBe(0);
  });
});
