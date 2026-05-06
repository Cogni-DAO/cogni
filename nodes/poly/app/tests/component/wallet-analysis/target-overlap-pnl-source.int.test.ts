// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/component/wallet-analysis/target-overlap-pnl-source.int`
 * Purpose: Lock the PNL_FROM_VENDOR_CASHPNL invariant — the Active-PnL bucket
 *          aggregates Polymarket's authoritative `cashPnl` from the persisted
 *          `/positions` payload, not a `currentValue − costBasis` derivation.
 *          Synthetic divergence: `current_value=10, cost_basis=100` ⇒ derived
 *          PnL would be −90, but Polymarket-reported `cashPnl=50` is correct.
 *          Failing this test ⇒ the aggregation regressed to subtraction (bug.5020).
 * Scope: Service-role DB. No network.
 * Invariants: PNL_FROM_VENDOR_CASHPNL.
 * Side-effects: IO (testcontainers PostgreSQL).
 * Links: nodes/poly/app/src/features/wallet-analysis/server/target-overlap-service.ts, work/items/bug.5020
 * @internal
 */

import { randomUUID } from "node:crypto";
import {
  polyTraderCurrentPositions,
  polyTraderWallets,
} from "@cogni/poly-db-schema";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
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

function rawPosition(cashPnl: number): Record<string, unknown> {
  return { cashPnl, percentPnl: 0, redeemable: false };
}

describe("getTargetOverlapSlice — PnL source (bug.5020)", () => {
  const db = getSeedDb();

  afterEach(async () => {
    await db
      .delete(polyTraderWallets)
      .where(inArray(polyTraderWallets.walletAddress, [RN1, SWISSTONY]));
  });

  it("aggregates per-position PnL from raw.cashPnl, not currentValue − costBasis", async () => {
    const rn1Id = randomUUID();
    const swissId = randomUUID();
    await db.insert(polyTraderWallets).values([
      {
        id: rn1Id,
        walletAddress: RN1,
        kind: "copy_target",
        label: "RN1-bug5020",
        activeForResearch: true,
      },
      {
        id: swissId,
        walletAddress: SWISSTONY,
        kind: "copy_target",
        label: "swisstony-bug5020",
        activeForResearch: true,
      },
    ]);

    // Each row's currentValue − costBasis = −90 (the wrong derivation).
    // Polymarket's authoritative cashPnl in `raw` says +50 (RN1 rows) and
    // +25 (swisstony rows). Aggregation must read the latter.
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
        raw: rawPosition(25),
      },
    ]);

    const result = await getTargetOverlapSlice(db, "ALL");

    const byKey = Object.fromEntries(result.buckets.map((b) => [b.key, b]));

    expect(byKey.rn1_only?.pnlUsdc).toBe(50);
    expect(byKey.rn1_only?.rn1.pnlUsdc).toBe(50);
    expect(byKey.swisstony_only?.pnlUsdc).toBe(25);
    expect(byKey.swisstony_only?.swisstony.pnlUsdc).toBe(25);
    // Shared bucket sums both wallets' cashPnl: 50 + 25 = 75.
    expect(byKey.shared?.pnlUsdc).toBe(75);
    expect(byKey.shared?.rn1.pnlUsdc).toBe(50);
    expect(byKey.shared?.swisstony.pnlUsdc).toBe(25);
  });

  it("falls back to currentValue − costBasis when raw lacks cashPnl (defensive)", async () => {
    const rn1Id = randomUUID();
    const swissId = randomUUID();
    await db.insert(polyTraderWallets).values([
      {
        id: rn1Id,
        walletAddress: RN1,
        kind: "copy_target",
        label: "RN1-bug5020-fallback",
        activeForResearch: true,
      },
      {
        id: swissId,
        walletAddress: SWISSTONY,
        kind: "copy_target",
        label: "swisstony-bug5020-fallback",
        activeForResearch: true,
      },
    ]);
    await db.insert(polyTraderCurrentPositions).values([
      {
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
      },
    ]);

    const result = await getTargetOverlapSlice(db, "ALL");
    const rn1Bucket = result.buckets.find((b) => b.key === "rn1_only");
    expect(rn1Bucket?.pnlUsdc).toBe(-18);
  });
});
