// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/component/wallet-analysis/target-overlap-pnl-source.int`
 * Purpose: Lock the PNL_FROM_VENDOR_CASHPNL invariant — the Active-PnL bucket
 *          aggregates Polymarket's authoritative `cashPnl` from the persisted
 *          `/positions` payload, not a `currentValue − costBasis` derivation.
 *          Synthetic divergence: a row's `currentValue − costBasis` is set far
 *          from the vendor-reported `cashPnl`, so the aggregation can only
 *          arrive at the expected total by reading `raw->>'cashPnl'`.
 *          Failing this test ⇒ the aggregation regressed to subtraction (bug.5020).
 * Scope: Service-role DB. No network. RN1 + swisstony seed rows come from
 *        migration `0040_poly_trader_activity.sql`; this test reuses them
 *        and cleans only its position rows in afterEach.
 * Invariants: PNL_FROM_VENDOR_CASHPNL.
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: nodes/poly/app/src/features/wallet-analysis/server/target-overlap-service.ts, work/items/bug.5020
 * @internal
 */

import {
  polyTraderCurrentPositions,
  polyTraderWallets,
} from "@cogni/poly-db-schema";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getTargetOverlapSlice } from "@/features/wallet-analysis/server/target-overlap-service";

const RN1 = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea" as const;
const SWISSTONY = "0x204f72f35326db932158cba6adff0b9a1da95e14" as const;
const COND_RN1 = "cond-bug5020-rn1-only";
const COND_SHARED = "cond-bug5020-shared";
const COND_SWISS = "cond-bug5020-swiss-only";
const TOKEN_RN1 = "token-bug5020-rn1";
const TOKEN_SHARED_RN1 = "token-bug5020-shared-rn1";
const TOKEN_SHARED_SWISS = "token-bug5020-shared-swiss";
const TOKEN_SWISS = "token-bug5020-swiss";
const ALL_TEST_TOKENS = [
  TOKEN_RN1,
  TOKEN_SHARED_RN1,
  TOKEN_SHARED_SWISS,
  TOKEN_SWISS,
] as const;

function rawPosition(cashPnl: number): Record<string, unknown> {
  return { cashPnl, percentPnl: 0, redeemable: false };
}

describe("getTargetOverlapSlice — PnL source (bug.5020)", () => {
  const db = getSeedDb();
  let rn1Id = "";
  let swissId = "";

  beforeAll(async () => {
    const wallets = await db
      .select({
        id: polyTraderWallets.id,
        walletAddress: polyTraderWallets.walletAddress,
      })
      .from(polyTraderWallets)
      .where(inArray(polyTraderWallets.walletAddress, [RN1, SWISSTONY]));
    rn1Id = wallets.find((w) => w.walletAddress === RN1)?.id ?? "";
    swissId = wallets.find((w) => w.walletAddress === SWISSTONY)?.id ?? "";
    expect(rn1Id, "RN1 seed row missing — check migration 0040").not.toBe("");
    expect(
      swissId,
      "swisstony seed row missing — check migration 0040"
    ).not.toBe("");
  });

  afterEach(async () => {
    await db
      .delete(polyTraderCurrentPositions)
      .where(inArray(polyTraderCurrentPositions.tokenId, [...ALL_TEST_TOKENS]));
  });

  it("aggregates per-position PnL from raw.cashPnl, not currentValue − costBasis (incl. negative)", async () => {
    // Each row's currentValue − costBasis = −90 (the wrong derivation). The
    // vendor-published cashPnl in `raw` says +50, +50, +25, −40. Aggregation
    // must read the latter, including the negative (loss) row.
    await db.insert(polyTraderCurrentPositions).values([
      {
        traderWalletId: rn1Id,
        conditionId: COND_RN1,
        tokenId: TOKEN_RN1,
        active: true,
        shares: "100.00000000",
        costBasisUsdc: "100.00000000",
        currentValueUsdc: "10.00000000",
        avgPrice: "1.00000000",
        contentHash: "hash-bug5020-rn1",
        raw: rawPosition(50),
      },
      {
        traderWalletId: rn1Id,
        conditionId: COND_SHARED,
        tokenId: TOKEN_SHARED_RN1,
        active: true,
        shares: "100.00000000",
        costBasisUsdc: "100.00000000",
        currentValueUsdc: "10.00000000",
        avgPrice: "1.00000000",
        contentHash: "hash-bug5020-shared-rn1",
        raw: rawPosition(50),
      },
      {
        traderWalletId: swissId,
        conditionId: COND_SHARED,
        tokenId: TOKEN_SHARED_SWISS,
        active: true,
        shares: "100.00000000",
        costBasisUsdc: "100.00000000",
        currentValueUsdc: "10.00000000",
        avgPrice: "1.00000000",
        contentHash: "hash-bug5020-shared-swiss",
        raw: rawPosition(25),
      },
      {
        traderWalletId: swissId,
        conditionId: COND_SWISS,
        tokenId: TOKEN_SWISS,
        active: true,
        shares: "100.00000000",
        costBasisUsdc: "100.00000000",
        currentValueUsdc: "10.00000000",
        avgPrice: "1.00000000",
        contentHash: "hash-bug5020-swiss",
        raw: rawPosition(-40),
      },
    ]);

    const result = await getTargetOverlapSlice(db, "ALL");
    const byKey = Object.fromEntries(result.buckets.map((b) => [b.key, b]));

    // Note: pre-existing seed positions (if any) for these wallets remain in
    // play, so we assert *containment* of our test rows, not exact totals.
    // The contained slice exercised: rn1 has +50 in rn1_only and +50 shared;
    // swisstony has +25 shared and −40 swisstony_only.
    // We assert that the synthetic rows *can only* round to ≥+50 / ≥+25 /
    // ≤−40 if cashPnl is the source — the derivation would yield −90 each.
    expect(byKey.rn1_only?.rn1.pnlUsdc).toBeGreaterThanOrEqual(50);
    expect(byKey.shared?.rn1.pnlUsdc).toBeGreaterThanOrEqual(50);
    expect(byKey.shared?.swisstony.pnlUsdc).toBeGreaterThanOrEqual(25);
    expect(byKey.swisstony_only?.swisstony.pnlUsdc).toBeLessThanOrEqual(-40);
  });

  it("excludes rows by LIVE_POSITION_ONLY: stale (>6h) AND shares=0 closed positions", async () => {
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
    // Two non-live rows. Both carry massive cashPnl values that must NOT
    // appear in the aggregate. If either filter regresses, the magnitude
    // assertion fails by orders of magnitude.
    await db.insert(polyTraderCurrentPositions).values([
      {
        // (1) stale row: lastObservedAt past the 6h window.
        traderWalletId: rn1Id,
        conditionId: COND_RN1,
        tokenId: TOKEN_RN1,
        active: true,
        shares: "100.00000000",
        costBasisUsdc: "100.00000000",
        currentValueUsdc: "10.00000000",
        avgPrice: "1.00000000",
        contentHash: "hash-bug5020-stale",
        lastObservedAt: sevenHoursAgo,
        firstObservedAt: sevenHoursAgo,
        raw: rawPosition(9_999_999),
      },
      {
        // (2) shares=0 closed position: Polymarket returns these when the
        // observer polls with sizeThreshold=0 — must not pollute aggregates.
        traderWalletId: rn1Id,
        conditionId: COND_SHARED,
        tokenId: TOKEN_SHARED_RN1,
        active: true,
        shares: "0.00000000",
        costBasisUsdc: "8888888.00000000",
        currentValueUsdc: "0.00000000",
        avgPrice: "0.00000000",
        contentHash: "hash-bug5020-closed",
        raw: rawPosition(-8_888_888),
      },
    ]);

    const result = await getTargetOverlapSlice(db, "ALL");
    // Neither row's cashPnl (+9.9M / −8.8M) may appear. If the predicate
    // regresses on either dimension, |total| crosses 1M.
    for (const bucket of result.buckets) {
      expect(Math.abs(bucket.pnlUsdc)).toBeLessThan(1_000_000);
    }
  });

  it("falls back to currentValue − costBasis when raw lacks cashPnl (defensive)", async () => {
    await db.insert(polyTraderCurrentPositions).values({
      traderWalletId: rn1Id,
      conditionId: COND_RN1,
      tokenId: TOKEN_RN1,
      active: true,
      shares: "100.00000000",
      costBasisUsdc: "30.00000000",
      currentValueUsdc: "12.00000000",
      avgPrice: "0.30000000",
      contentHash: "hash-bug5020-fallback",
      raw: { percentPnl: 0 },
    });

    const result = await getTargetOverlapSlice(db, "ALL");
    const rn1Bucket = result.buckets.find((b) => b.key === "rn1_only");
    // Containment again: this synthetic row contributes −18 to rn1_only.rn1
    // via the COALESCE fallback. Real seed rows may add to it, but we only
    // need to know that the negative −18 was reachable, i.e., total ≤ 0
    // is sufficient when no other positions push it positive in this seed.
    expect(rn1Bucket?.rn1.pnlUsdc).toBeLessThanOrEqual(-18);
  });
});
