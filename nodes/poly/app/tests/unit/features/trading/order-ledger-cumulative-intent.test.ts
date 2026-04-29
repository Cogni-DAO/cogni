// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/trading/order-ledger-cumulative-intent`
 * Purpose: Unit tests for `FakeOrderLedger.cumulativeIntentForMarket` — sum intent size_usdc by (billing_account_id, market_id) over non-failed rows.
 * Scope: In-memory FakeOrderLedger only. No DB.
 * Side-effects: none
 * Links: src/adapters/test/trading/fake-order-ledger.ts (task.0424)
 * @internal
 */

import { describe, expect, it } from "vitest";
import { FakeOrderLedger } from "@/adapters/test/trading/fake-order-ledger";
import type { LedgerRow } from "@/features/trading";

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

  it("excludes rows in failed status (canceled, error)", async () => {
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
        makeRow({
          fill_id: "fill-3",
          status: "error",
          attributes: { market_id: MARKET_X, size_usdc: 5 },
        }),
      ],
    });
    const result = await ledger.cumulativeIntentForMarket(TENANT_A, MARKET_X);
    expect(result).toBe(2);
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
