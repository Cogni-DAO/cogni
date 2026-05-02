// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/trading/fake-order-ledger-position-snapshot`
 * Purpose: Unit tests for `FakeOrderLedger.snapshotState().position_aggregates` (generic intent aggregates) + `aggregatePositionRows()` (mirror-vocabulary overlay) — verifies the SQL semantics: intent-based shares, pending+open+filled+partial only, lifecycle filter, binary opposite_token_id, multi-outcome graceful, fail-closed empty array.
 * Scope: In-memory FakeOrderLedger + pure aggregator. No DB.
 * Side-effects: none
 * Links: docs/design/poly-mirror-position-projection.md, src/adapters/test/trading/fake-order-ledger.ts, src/features/copy-trade/types.ts
 * @internal
 */

import { describe, expect, it } from "vitest";
import { FakeOrderLedger } from "@/adapters/test/trading/fake-order-ledger";
import { aggregatePositionRows } from "@/features/copy-trade/types";
import type { LedgerRow } from "@/features/trading";

const TENANT = "00000000-0000-4000-b000-00000000000a";
const TARGET = "00000000-0000-4000-a000-00000000000a";
const CONDITION_X = "prediction-market:polymarket:0xCONDX";
const CONDITION_Y = "prediction-market:polymarket:0xCONDY";
const TOKEN_YES = "1111111111";
const TOKEN_NO = "2222222222";
const TOKEN_3 = "3333333333";

function makeRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  const now = new Date();
  return {
    target_id: TARGET,
    fill_id: `fill-${Math.random()}`,
    observed_at: now,
    client_order_id: `coid-${Math.random()}`,
    order_id: null,
    status: "filled",
    position_lifecycle: "open",
    attributes: {
      market_id: CONDITION_X,
      token_id: TOKEN_YES,
      side: "BUY",
      size_usdc: 10,
      limit_price: 0.5,
    },
    synced_at: null,
    created_at: now,
    updated_at: now,
    billing_account_id: TENANT,
    ...overrides,
  };
}

async function snapshotPositions(ledger: FakeOrderLedger) {
  const snap = await ledger.snapshotState(TARGET, TENANT);
  return {
    snap,
    positions: aggregatePositionRows(snap.position_aggregates),
  };
}

describe("FakeOrderLedger.snapshotState — position_aggregates + aggregatePositionRows", () => {
  it("returns empty aggregates + empty Map when target has no fills", async () => {
    const ledger = new FakeOrderLedger({ initial: [] });
    const { snap, positions } = await snapshotPositions(ledger);
    expect(snap.position_aggregates).toEqual([]);
    expect(positions.size).toBe(0);
  });

  it("aggregates a single BUY into our_token_id + qty + vwap", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 10,
            limit_price: 0.5,
          },
        }),
      ],
    });
    const { positions } = await snapshotPositions(ledger);
    const view = positions.get(CONDITION_X);
    expect(view).toBeDefined();
    expect(view?.our_token_id).toBe(TOKEN_YES);
    expect(view?.our_qty_shares).toBeCloseTo(20); // 10 / 0.5
    expect(view?.our_vwap_usdc).toBeCloseTo(0.5);
    expect(view?.opposite_token_id).toBeUndefined();
    expect(view?.opposite_qty_shares).toBe(0);
  });

  it("VWAP averages across multiple BUYs at different prices", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "fA",
          client_order_id: "ca",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 4,
            limit_price: 0.4,
          },
        }),
        makeRow({
          fill_id: "fB",
          client_order_id: "cb",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 6,
            limit_price: 0.6,
          },
        }),
      ],
    });
    const { positions } = await snapshotPositions(ledger);
    const view = positions.get(CONDITION_X);
    // shares = 4/0.4 + 6/0.6 = 10 + 10 = 20; gross_usdc = 10
    // vwap = 10 / 20 = 0.5
    expect(view?.our_qty_shares).toBeCloseTo(20);
    expect(view?.our_vwap_usdc).toBeCloseTo(0.5);
  });

  it("surfaces opposite_token_id when both binary legs traded (hedge state)", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "fA",
          client_order_id: "ca",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 10,
            limit_price: 0.5,
          },
        }),
        makeRow({
          fill_id: "fB",
          client_order_id: "cb",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_NO,
            side: "BUY",
            size_usdc: 4,
            limit_price: 0.5,
          },
        }),
      ],
    });
    const { positions } = await snapshotPositions(ledger);
    const view = positions.get(CONDITION_X);
    expect(view).toBeDefined();
    // YES leg is larger (20 shares vs 8 shares) → our_token_id = YES.
    expect(view?.our_token_id).toBe(TOKEN_YES);
    expect(view?.our_qty_shares).toBeCloseTo(20);
    expect(view?.opposite_token_id).toBe(TOKEN_NO);
    expect(view?.opposite_qty_shares).toBeCloseTo(8);
  });

  it("net-shares math: SELL shares subtract", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "fA",
          client_order_id: "ca",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 10,
            limit_price: 0.5,
          },
        }),
        makeRow({
          fill_id: "fB",
          client_order_id: "cb",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "SELL",
            size_usdc: 2,
            limit_price: 0.5,
          },
        }),
      ],
    });
    const { positions } = await snapshotPositions(ledger);
    const view = positions.get(CONDITION_X);
    // 20 BUY - 4 SELL = 16 net; vwap is BUY-side only = 0.5
    expect(view?.our_qty_shares).toBeCloseTo(16);
    expect(view?.our_vwap_usdc).toBeCloseTo(0.5);
  });

  it("excludes canceled and error rows", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "fA",
          client_order_id: "ca",
          status: "canceled",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 100,
            limit_price: 0.5,
          },
        }),
        makeRow({
          fill_id: "fB",
          client_order_id: "cb",
          status: "error",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 100,
            limit_price: 0.5,
          },
        }),
      ],
    });
    const { snap, positions } = await snapshotPositions(ledger);
    expect(snap.position_aggregates).toEqual([]);
    expect(positions.size).toBe(0);
  });

  it("excludes rows past 'closing' lifecycle (closed / redeemed / loser)", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({ position_lifecycle: "closed" }),
        makeRow({
          fill_id: "fB",
          client_order_id: "cb",
          position_lifecycle: "redeemed",
        }),
        makeRow({
          fill_id: "fC",
          client_order_id: "cc",
          position_lifecycle: "loser",
        }),
      ],
    });
    const { positions } = await snapshotPositions(ledger);
    expect(positions.size).toBe(0);
  });

  it("excludes rows with attributes.closed_at present", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 10,
            limit_price: 0.5,
            closed_at: new Date().toISOString(),
          },
        }),
      ],
    });
    const { positions } = await snapshotPositions(ledger);
    expect(positions.size).toBe(0);
  });

  it("includes pending rows (within-tick freshness — fill #N+1 sees fill #N's pending insert)", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          status: "pending",
          position_lifecycle: null,
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 5,
            limit_price: 0.5,
          },
        }),
      ],
    });
    const { positions } = await snapshotPositions(ledger);
    const view = positions.get(CONDITION_X);
    expect(view?.our_qty_shares).toBeCloseTo(10);
  });

  it("multi-outcome (>2 token_ids on same condition) leaves opposite_token_id undefined", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "fA",
          client_order_id: "ca",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 10,
            limit_price: 0.5,
          },
        }),
        makeRow({
          fill_id: "fB",
          client_order_id: "cb",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_NO,
            side: "BUY",
            size_usdc: 4,
            limit_price: 0.5,
          },
        }),
        makeRow({
          fill_id: "fC",
          client_order_id: "cc",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_3,
            side: "BUY",
            size_usdc: 2,
            limit_price: 0.5,
          },
        }),
      ],
    });
    const { positions } = await snapshotPositions(ledger);
    const view = positions.get(CONDITION_X);
    expect(view).toBeDefined();
    expect(view?.our_token_id).toBe(TOKEN_YES); // largest leg
    expect(view?.opposite_token_id).toBeUndefined(); // multi-outcome ⇒ no binary "opposite"
  });

  it("scopes by target_id (other targets' fills are not counted)", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          target_id: "other-target",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 100,
            limit_price: 0.5,
          },
        }),
      ],
    });
    const { positions } = await snapshotPositions(ledger);
    expect(positions.size).toBe(0);
  });

  it("multiple conditions surface as separate Map entries", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "fA",
          client_order_id: "ca",
          attributes: {
            market_id: CONDITION_X,
            token_id: TOKEN_YES,
            side: "BUY",
            size_usdc: 10,
            limit_price: 0.5,
          },
        }),
        makeRow({
          fill_id: "fB",
          client_order_id: "cb",
          attributes: {
            market_id: CONDITION_Y,
            token_id: TOKEN_NO,
            side: "BUY",
            size_usdc: 6,
            limit_price: 0.3,
          },
        }),
      ],
    });
    const { positions } = await snapshotPositions(ledger);
    expect(positions.size).toBe(2);
    expect(positions.get(CONDITION_X)?.our_token_id).toBe(TOKEN_YES);
    expect(positions.get(CONDITION_Y)?.our_token_id).toBe(TOKEN_NO);
  });

  it("FAIL_CLOSED — failConfigRead=true returns empty position_aggregates", async () => {
    const ledger = new FakeOrderLedger({
      failConfigRead: true,
      initial: [makeRow()],
    });
    const { snap, positions } = await snapshotPositions(ledger);
    expect(snap.position_aggregates).toEqual([]);
    expect(positions.size).toBe(0);
    expect(snap.already_placed_ids).toEqual([]);
  });
});
