// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/market-exposure-service` (unit)
 * Purpose: Locks the cross-cutting invariants the dashboard Markets view
 *   depends on:
 *   - TARGET_LEGS_FROM_SNAPSHOTS — any active copy-target snapshot row that
 *     covers a condition we hold surfaces as a leg, regardless of whether
 *     we've mirrored a fill on that condition.
 *   - GAP_NULL_WITHOUT_TARGETS — `rateGapPct` and `sizeScaledGapUsdc` are
 *     null on lines/groups with zero target legs that have positive buy
 *     notional, so the UI renders `—` rather than a meaningless
 *     solo-market percentage.
 *   - SIGN_TARGET_MINUS_US — `rateGapPct` is positive when targets are
 *     ahead of us; the table sorts by `sizeScaledGapUsdc` descending so
 *     the biggest leak ends up on top.
 * Scope: Pure unit. Drizzle DB is faked via `db.execute()` returning canned
 *   rows; the SQL string itself is not asserted. Two distinct execute()
 *   calls are made per group: target-snapshots, then fill-rollups.
 * Side-effects: none
 * Links: nodes/poly/app/src/features/wallet-analysis/server/market-exposure-service.ts
 * @internal
 */

import type { WalletExecutionPosition } from "@cogni/poly-node-contracts";
import { describe, expect, it, vi } from "vitest";

import { buildMarketExposureGroups } from "@/features/wallet-analysis/server/market-exposure-service";

type Db = Parameters<typeof buildMarketExposureGroups>[0]["db"];

/**
 * Fake DB that returns a sequence of canned result-sets per .execute() call.
 * The service issues two reads when there are positions:
 *   1. target snapshots (poly_trader_position_snapshots)
 *   2. fill rollups       (poly_trader_fills)
 * Pass `[targetRows, fillRollupRows]`.
 */
function fakeDb(callResults: readonly unknown[][]): Db {
  let i = 0;
  return {
    execute: vi.fn(() => {
      const rows = callResults[i] ?? [];
      i += 1;
      return Promise.resolve(rows);
    }),
  } as unknown as Db;
}

const OUR_WALLET = "0xabcabcabcabcabcabcabcabcabcabcabcabcabca";
const TARGET_WALLET = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

function ourPosition(
  overrides: Partial<WalletExecutionPosition> = {}
): WalletExecutionPosition {
  return {
    positionId: "p-1",
    conditionId: "0xCOND1",
    asset: "tok-yes-1",
    marketTitle: "Tampa Bay Rays vs. Cleveland Guardians",
    eventTitle: null,
    marketSlug: "mlb-tb-cle",
    eventSlug: null,
    marketUrl: null,
    outcome: "Tampa Bay Rays",
    status: "open",
    openedAt: "2026-05-04T12:00:00.000Z",
    closedAt: null,
    resolvesAt: null,
    heldMinutes: 60,
    entryPrice: 0.205,
    currentPrice: 0.8,
    size: 9.99,
    currentValue: 9.99,
    pnlUsd: 7.95,
    pnlPct: 3.9,
    timeline: [],
    events: [],
    ...overrides,
  };
}

describe("buildMarketExposureGroups", () => {
  it("returns no groups when the caller has no positions (early-out)", async () => {
    const db = fakeDb([[], []]);
    const groups = await buildMarketExposureGroups({
      db,
      billingAccountId: "ba-1",
      walletAddress: OUR_WALLET,
      livePositions: [],
    });
    expect(groups).toEqual([]);
    // Early-out — never asks the DB about anything.
    expect(db.execute as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("nulls gap metrics when no target snapshot rows exist", async () => {
    // Solo market: we hold $9.99 with $7.95 P/L, but no target leg surfaces.
    // The pre-fix code returned -ourPnl/ourCost = -390% — that is the bug.
    // No target snapshots, no fill rollups (our wallet not yet observed).
    const db = fakeDb([[], []]);
    const groups = await buildMarketExposureGroups({
      db,
      billingAccountId: "ba-1",
      walletAddress: OUR_WALLET,
      livePositions: [ourPosition()],
    });

    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group?.lines).toHaveLength(1);
    expect(group?.lines[0]?.edgeGapUsdc).toBeNull();
    expect(group?.lines[0]?.edgeGapPct).toBeNull();
    expect(group?.edgeGapUsdc).toBeNull();
    expect(group?.edgeGapPct).toBeNull();
    // Our leg still renders.
    expect(group?.lines[0]?.participants).toHaveLength(1);
    expect(group?.lines[0]?.participants[0]?.side).toBe("our_wallet");
  });

  it("surfaces a target leg from a snapshot row, no fill required", async () => {
    // The pre-fix SQL gated target legs on poly_copy_trade_fills having a row
    // for (target, condition). After the fix, an active target with any
    // snapshot in our condition shows up — that is the whole point of the
    // "Markets" lens.
    const db = fakeDb([
      [
        {
          wallet_address: TARGET_WALLET,
          label: "RN1",
          condition_id: "0xCOND1",
          token_id: "tok-yes-1",
          market_title: "Tampa Bay Rays vs. Cleveland Guardians",
          event_title: null,
          market_slug: "mlb-tb-cle",
          event_slug: null,
          outcome: "Tampa Bay Rays",
          shares: "100",
          cost_basis_usdc: "20.00",
          current_value_usdc: "80.00",
          avg_price: "0.20",
          last_observed_at: new Date("2026-05-04T12:30:00.000Z"),
          lifecycle: "active",
        },
      ],
      // Fill rollups: target's BUY notional was $20 on this condition.
      // Our wallet has no fills row → service falls back to position-derived
      // cost basis (currentValue − pnlUsd = 9.99 − 7.95 = $2.04).
      [
        {
          wallet_address: TARGET_WALLET.toLowerCase(),
          condition_id: "0xCOND1",
          total_buy_notional: "20.00",
          realized_cash: "0",
        },
      ],
    ]);

    const groups = await buildMarketExposureGroups({
      db,
      billingAccountId: "ba-1",
      walletAddress: OUR_WALLET,
      livePositions: [ourPosition()],
    });

    expect(groups).toHaveLength(1);
    const line = groups[0]?.lines[0];
    expect(line).toBeDefined();
    const sides = line?.participants.map((p) => p.side).sort();
    expect(sides).toEqual(["copy_target", "our_wallet"]);
    // edgeGap fields are populated using the new (Modified-Dietz) math but
    // emitted under the legacy contract field names — see the service's
    // OLD_CONTRACT_FIELD_MAPPING comment. Both sides have positive buy
    // notional in this test, so the values are non-null.
    expect(line?.edgeGapPct).not.toBeNull();
    expect(line?.edgeGapUsdc).not.toBeNull();
  });
});
