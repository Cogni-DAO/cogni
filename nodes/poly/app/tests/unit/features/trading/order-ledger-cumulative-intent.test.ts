// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/trading/order-ledger-cumulative-intent`
 * Purpose: Unit tests for `FakeOrderLedger.cumulativeIntentForMarket` — sum intent size_usdc by (billing_account_id, market_id) over non-canceled rows. Error rows are scoped to FOK only (bug.0430 broadcast race); limit-order errors don't count (CLOB rejected at API boundary, no on-chain effect).
 * Scope: In-memory FakeOrderLedger only. No DB.
 * Side-effects: none
 * Links: src/adapters/test/trading/fake-order-ledger.ts (task.0424)
 * @internal
 */

import { describe, expect, it } from "vitest";
import { FakeOrderLedger } from "@/adapters/test/trading/fake-order-ledger";
import { type LedgerRow, PositionCapReachedError } from "@/features/trading";

const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const TENANT_B = "00000000-0000-4000-b000-00000000000b";
const MARKET_X = "prediction-market:polymarket:0xMARKETX";
const MARKET_Y = "prediction-market:polymarket:0xMARKETY";

function makeRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  const now = new Date();
  return {
    target_id: "target-1",
    fill_id: "fill-1",
    observed_at: now,
    client_order_id: "coid-1",
    order_id: null,
    status: "pending",
    position_lifecycle: null,
    attributes: { market_id: MARKET_X, size_usdc: 1 },
    synced_at: null,
    created_at: now,
    updated_at: now,
    billing_account_id: TENANT_A,
    ...overrides,
  };
}

describe("FakeOrderLedger.cumulativeIntentForMarket", () => {
  it("empty ledger → 0", async () => {
    const ledger = new FakeOrderLedger({ initial: [] });
    const result = await ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X);
    expect(result).toBe(0);
  });

  it("sums intent across multiple non-failed rows for the same (tenant, market)", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "fill-1",
          attributes: { market_id: MARKET_X, size_usdc: 1.5 },
        }),
        makeRow({
          fill_id: "fill-2",
          status: "filled",
          attributes: { market_id: MARKET_X, size_usdc: 2.5 },
        }),
        makeRow({
          fill_id: "fill-3",
          status: "partial",
          attributes: { market_id: MARKET_X, size_usdc: 1 },
        }),
      ],
    });
    const result = await ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X);
    expect(result).toBe(5);
  });

  it("excludes canceled rows; FOK errors count (bug.0430 broadcast race), limit errors don't", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "fill-1",
          status: "filled",
          attributes: { market_id: MARKET_X, size_usdc: 2 },
        }),
        makeRow({
          fill_id: "fill-2",
          status: "canceled",
          attributes: { market_id: MARKET_X, size_usdc: 5 },
        }),
        // FOK error: counts (CLOB error doesn't preclude on-chain CTF mint)
        makeRow({
          fill_id: "fill-3",
          status: "error",
          attributes: {
            market_id: MARKET_X,
            size_usdc: 5,
            placement: "market_fok",
          },
        }),
        // Limit error: doesn't count (CLOB-rejected at API boundary)
        makeRow({
          fill_id: "fill-4",
          status: "error",
          attributes: {
            market_id: MARKET_X,
            size_usdc: 100,
            placement: "limit",
          },
        }),
      ],
    });
    const result = await ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X);
    expect(result).toBe(7);
  });

  it("excludes typed closed rows from active market intent", async () => {
    const closedAt = new Date().toISOString();
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "closed-partial",
          status: "partial",
          position_lifecycle: "closed",
          attributes: {
            market_id: MARKET_X,
            size_usdc: 5,
            filled_size_usdc: 2,
            closed_at: closedAt,
          },
        }),
        makeRow({
          fill_id: "active-partial",
          status: "partial",
          attributes: {
            market_id: MARKET_X,
            size_usdc: 1,
            filled_size_usdc: 0.5,
          },
        }),
      ],
    });

    await expect(
      ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X)
    ).resolves.toBe(1);
  });

  it("excludes typed terminal lifecycle rows from active market intent", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "closed-lifecycle",
          status: "partial",
          position_lifecycle: "closed",
          attributes: {
            market_id: MARKET_X,
            size_usdc: 5,
            filled_size_usdc: 2,
          },
        }),
        makeRow({
          fill_id: "active-lifecycle",
          status: "partial",
          position_lifecycle: "open",
          attributes: {
            market_id: MARKET_X,
            size_usdc: 1,
            filled_size_usdc: 0.5,
          },
        }),
      ],
    });

    await expect(
      ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X)
    ).resolves.toBe(1);
  });

  it("can stamp lifecycle by raw or normalized condition id", async () => {
    const updatedAt = new Date();
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "explicit-condition",
          status: "filled",
          position_lifecycle: "open",
          attributes: {
            market_id: MARKET_X,
            condition_id: "0xabc",
            size_usdc: 1,
          },
        }),
        makeRow({
          fill_id: "normalized-market",
          status: "filled",
          position_lifecycle: "open",
          attributes: {
            market_id: "prediction-market:polymarket:0xabc",
            size_usdc: 1,
          },
        }),
      ],
    });

    await expect(
      ledger.markPositionLifecycleByConditionId({
        billing_account_id: TENANT_A,
        condition_id: "0xabc",
        lifecycle: "winner",
        updated_at: updatedAt,
      })
    ).resolves.toBe(2);
    expect(ledger.rows.map((row) => row.position_lifecycle)).toEqual([
      "winner",
      "winner",
    ]);
  });

  it("stamps lifecycle on terminal order rows that still have filled exposure", async () => {
    const updatedAt = new Date();
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "canceled-with-fill",
          status: "canceled",
          position_lifecycle: null,
          attributes: {
            market_id: MARKET_X,
            condition_id: "0xabc",
            size_usdc: 5,
            filled_size_usdc: 2,
          },
        }),
        makeRow({
          fill_id: "canceled-without-fill",
          status: "canceled",
          position_lifecycle: null,
          attributes: {
            market_id: MARKET_X,
            condition_id: "0xabc",
            size_usdc: 5,
            filled_size_usdc: 0,
          },
        }),
      ],
    });

    await expect(
      ledger.markPositionLifecycleByConditionId({
        billing_account_id: TENANT_A,
        condition_id: "0xabc",
        lifecycle: "winner",
        updated_at: updatedAt,
      })
    ).resolves.toBe(1);
    expect(ledger.rows.map((row) => row.position_lifecycle)).toEqual([
      "winner",
      null,
    ]);
  });

  it("can close canceled and error rows that still have proven exposure", async () => {
    const closedAt = new Date();
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "canceled-filled",
          status: "canceled",
          attributes: {
            market_id: MARKET_X,
            token_id: "111",
            size_usdc: 5,
            filled_size_usdc: 2,
          },
        }),
        makeRow({
          fill_id: "error-lifecycle",
          status: "error",
          position_lifecycle: "open",
          attributes: {
            market_id: MARKET_X,
            token_id: "111",
            size_usdc: 5,
          },
        }),
        makeRow({
          fill_id: "error-no-exposure",
          status: "error",
          attributes: {
            market_id: MARKET_X,
            token_id: "111",
            size_usdc: 5,
          },
        }),
      ],
    });

    await expect(
      ledger.markPositionClosedByAsset({
        billing_account_id: TENANT_A,
        token_id: "111",
        reason: "refresh_no_position",
        closed_at: closedAt,
      })
    ).resolves.toBe(2);

    expect(ledger.rows.map((row) => row.position_lifecycle)).toEqual([
      "closed",
      "closed",
      null,
    ]);
  });

  it("stamps redeem lifecycle by token id without touching sibling outcomes", async () => {
    const updatedAt = new Date();
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "yes-outcome",
          status: "filled",
          position_lifecycle: "winner",
          attributes: {
            market_id: MARKET_X,
            condition_id: "0xabc",
            token_id: "111",
            size_usdc: 5,
            filled_size_usdc: 5,
          },
        }),
        makeRow({
          fill_id: "no-outcome",
          status: "filled",
          position_lifecycle: "loser",
          attributes: {
            market_id: MARKET_X,
            condition_id: "0xabc",
            token_id: "222",
            size_usdc: 5,
            filled_size_usdc: 5,
          },
        }),
      ],
    });

    await expect(
      ledger.markPositionLifecycleByAsset({
        billing_account_id: TENANT_A,
        token_id: "111",
        lifecycle: "redeemed",
        updated_at: updatedAt,
      })
    ).resolves.toBe(1);
    expect(ledger.rows.map((row) => row.position_lifecycle)).toEqual([
      "redeemed",
      "loser",
    ]);
  });

  it("does not reopen terminal lifecycle rows during order refresh", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "closed-partial",
          client_order_id: "closed-client",
          status: "partial",
          position_lifecycle: "closed",
          attributes: {
            market_id: MARKET_X,
            size_usdc: 5,
            filled_size_usdc: 2,
          },
        }),
      ],
    });

    await ledger.updateStatus({
      client_order_id: "closed-client",
      status: "partial",
      filled_size_usdc: 2,
    });

    expect(ledger.rows[0]?.position_lifecycle).toBe("closed");
  });

  it("does not downgrade terminal lifecycle rows during resolution replay", async () => {
    const updatedAt = new Date();
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "redeemed-row",
          status: "filled",
          position_lifecycle: "redeemed",
          attributes: {
            market_id: "prediction-market:polymarket:0xabc",
            size_usdc: 1,
          },
        }),
      ],
    });

    await expect(
      ledger.markPositionLifecycleByConditionId({
        billing_account_id: TENANT_A,
        condition_id: "0xabc",
        lifecycle: "winner",
        updated_at: updatedAt,
      })
    ).resolves.toBe(0);
    expect(ledger.rows[0]?.position_lifecycle).toBe("redeemed");
  });

  it("allows a redeem reorg correction from redeemed back to redeem_pending", async () => {
    const updatedAt = new Date();
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "redeemed-row",
          status: "filled",
          position_lifecycle: "redeemed",
          attributes: {
            market_id: MARKET_X,
            token_id: "111",
            size_usdc: 5,
            filled_size_usdc: 5,
          },
        }),
        makeRow({
          fill_id: "closed-row",
          status: "filled",
          position_lifecycle: "closed",
          attributes: {
            market_id: MARKET_X,
            token_id: "222",
            size_usdc: 5,
            filled_size_usdc: 5,
          },
        }),
      ],
    });

    await expect(
      ledger.markPositionLifecycleByAsset({
        billing_account_id: TENANT_A,
        token_id: "111",
        lifecycle: "redeem_pending",
        updated_at: updatedAt,
        terminal_correction: "redeem_reorg",
      })
    ).resolves.toBe(1);
    await expect(
      ledger.markPositionLifecycleByAsset({
        billing_account_id: TENANT_A,
        token_id: "222",
        lifecycle: "redeem_pending",
        updated_at: updatedAt,
        terminal_correction: "redeem_reorg",
      })
    ).resolves.toBe(0);

    expect(ledger.rows.map((row) => row.position_lifecycle)).toEqual([
      "redeem_pending",
      "closed",
    ]);
  });

  it("allows a new same-market insert after the previous row has typed closed lifecycle", async () => {
    const closedAt = new Date().toISOString();
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "closed-partial",
          status: "partial",
          position_lifecycle: "closed",
          attributes: {
            market_id: MARKET_X,
            size_usdc: 5,
            filled_size_usdc: 2,
            closed_at: closedAt,
          },
        }),
      ],
    });

    await expect(
      ledger.insertPending({
        billing_account_id: TENANT_A,
        created_by_user_id: "user-1",
        target_id: "target-1",
        fill_id: "new-fill",
        observed_at: new Date(),
        intent: {
          provider: "polymarket",
          market_id: MARKET_X,
          outcome: "YES",
          side: "BUY",
          size_usdc: 1,
          limit_price: 0.5,
          client_order_id: "0xnew",
          attributes: {},
        },
      })
    ).resolves.toBeUndefined();
    await expect(
      ledger.hasOpenForMarket({
        billing_account_id: TENANT_A,
        target_id: "target-1",
        market_id: MARKET_X,
      })
    ).resolves.toBe(true);
  });

  it("rejects same-market inserts across targets when the tenant cap is reached", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          target_id: "target-1",
          fill_id: "fill-existing",
          attributes: { market_id: MARKET_X, size_usdc: 4 },
        }),
      ],
    });

    await expect(
      ledger.insertPending({
        billing_account_id: TENANT_A,
        created_by_user_id: "user-1",
        target_id: "target-2",
        fill_id: "new-fill",
        observed_at: new Date(),
        max_market_intent_usdc: 5,
        intent: {
          provider: "polymarket",
          market_id: MARKET_X,
          outcome: "YES",
          side: "BUY",
          size_usdc: 2,
          limit_price: 0.5,
          client_order_id: "0xnew",
          attributes: {},
        },
      })
    ).rejects.toBeInstanceOf(PositionCapReachedError);
  });

  it("excludes rows for a different market", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "fill-1",
          attributes: { market_id: MARKET_X, size_usdc: 1 },
        }),
        makeRow({
          fill_id: "fill-2",
          attributes: { market_id: MARKET_Y, size_usdc: 99 },
        }),
      ],
    });
    const result = await ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X);
    expect(result).toBe(1);
  });

  it("excludes rows for a different tenant", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          fill_id: "fill-1",
          billing_account_id: TENANT_A,
          attributes: { market_id: MARKET_X, size_usdc: 1 },
        }),
        makeRow({
          fill_id: "fill-2",
          billing_account_id: TENANT_B,
          attributes: { market_id: MARKET_X, size_usdc: 99 },
        }),
      ],
    });
    const result = await ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X);
    expect(result).toBe(1);
  });

  it("regression: 5 FOK error rows × $1 reach the $5 cap (bug.0430 broadcast race)", async () => {
    const ledger = new FakeOrderLedger({
      initial: Array.from({ length: 5 }, (_, i) =>
        makeRow({
          fill_id: `err-${i}`,
          status: "error",
          attributes: {
            market_id: MARKET_X,
            size_usdc: 1,
            placement: "market_fok",
          },
        })
      ),
    });
    const result = await ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X);
    expect(result).toBe(5);
  });

  it("regression: limit-order errors do NOT block new placements (task.5001 prod incident)", async () => {
    // Mirrors the prod scenario where 43,688 historical FOK errors with no
    // placement attribute were pessimistically counting against the cap.
    // After this fix, errors without `placement: 'market_fok'` are ignored.
    const ledger = new FakeOrderLedger({
      initial: [
        ...Array.from({ length: 100 }, (_, i) =>
          makeRow({
            fill_id: `legacy-err-${i}`,
            status: "error",
            attributes: { market_id: MARKET_X, size_usdc: 5 }, // no placement key
          })
        ),
        ...Array.from({ length: 50 }, (_, i) =>
          makeRow({
            fill_id: `limit-err-${i}`,
            status: "error",
            attributes: {
              market_id: MARKET_X,
              size_usdc: 5,
              placement: "limit",
            },
          })
        ),
      ],
    });
    const result = await ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X);
    expect(result).toBe(0);
  });

  it("returns Infinity when failConfigRead is set (fail-closed)", async () => {
    const ledger = new FakeOrderLedger({
      initial: [
        makeRow({
          attributes: { market_id: MARKET_X, size_usdc: 1 },
        }),
      ],
      failConfigRead: true,
    });
    const result = await ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X);
    expect(result).toBe(Number.POSITIVE_INFINITY);
  });
});
