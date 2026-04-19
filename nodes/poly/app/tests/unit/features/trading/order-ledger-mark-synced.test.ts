// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/trading/order-ledger-mark-synced`
 * Purpose: Unit tests for `FakeOrderLedger.markSynced` — verifies that
 *   synced_at is stamped on the correct rows and that empty-array is a no-op.
 * Scope: In-memory FakeOrderLedger only. No DB or CLOB.
 * Side-effects: none
 * Links: src/adapters/test/trading/fake-order-ledger.ts (task.0328 CP3)
 * @internal
 */

import { describe, expect, it } from "vitest";

import { FakeOrderLedger } from "@/adapters/test/trading/fake-order-ledger";
import type { LedgerRow } from "@/features/trading";

function makeRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  const now = new Date(Date.now() - 60_000);
  return {
    target_id: "target-1",
    fill_id: "fill-1",
    observed_at: now,
    client_order_id: "coid-1",
    order_id: "order-abc",
    status: "open",
    attributes: null,
    synced_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("FakeOrderLedger.markSynced", () => {
  it("stamps synced_at on targeted rows; leaves others as null", async () => {
    const row1 = makeRow({ client_order_id: "coid-1", fill_id: "fill-1" });
    const row2 = makeRow({ client_order_id: "coid-2", fill_id: "fill-2" });
    const row3 = makeRow({ client_order_id: "coid-3", fill_id: "fill-3" });
    const ledger = new FakeOrderLedger({ initial: [row1, row2, row3] });

    const before = Date.now();
    await ledger.markSynced(["coid-1", "coid-3"]);
    const after = Date.now();

    const r1 = ledger.rows.find((r) => r.client_order_id === "coid-1");
    const r2 = ledger.rows.find((r) => r.client_order_id === "coid-2");
    const r3 = ledger.rows.find((r) => r.client_order_id === "coid-3");

    expect(r1?.synced_at).not.toBeNull();
    expect(r1?.synced_at?.getTime()).toBeGreaterThanOrEqual(before);
    expect(r1?.synced_at?.getTime()).toBeLessThanOrEqual(after);

    expect(r2?.synced_at).toBeNull(); // not in the ids list

    expect(r3?.synced_at).not.toBeNull();
    expect(r3?.synced_at?.getTime()).toBeGreaterThanOrEqual(before);
    expect(r3?.synced_at?.getTime()).toBeLessThanOrEqual(after);
  });

  it("empty array is a no-op — no rows modified", async () => {
    const row = makeRow({ client_order_id: "coid-1", fill_id: "fill-1" });
    const ledger = new FakeOrderLedger({ initial: [row] });

    await ledger.markSynced([]);

    expect(ledger.rows[0]?.synced_at).toBeNull();
  });

  it("calling markSynced twice updates synced_at to the latest time", async () => {
    const row = makeRow({ client_order_id: "coid-1", fill_id: "fill-1" });
    const ledger = new FakeOrderLedger({ initial: [row] });

    await ledger.markSynced(["coid-1"]);
    const first = ledger.rows[0]?.synced_at?.getTime() ?? 0;

    // Minimal delay to ensure wall-clock advances
    await new Promise((r) => setTimeout(r, 5));

    await ledger.markSynced(["coid-1"]);
    const second = ledger.rows[0]?.synced_at?.getTime() ?? 0;

    expect(second).toBeGreaterThanOrEqual(first);
  });
});
