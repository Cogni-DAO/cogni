// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/trading/order-ledger-sync-health`
 * Purpose: Unit tests for `FakeOrderLedger.syncHealthSummary` — empty table,
 *   mix of synced/never-synced/stale rows. Verifies all three aggregate fields.
 * Scope: In-memory FakeOrderLedger only. No DB or CLOB.
 * Side-effects: none
 * Links: src/adapters/test/trading/fake-order-ledger.ts (task.0328 CP4)
 * @internal
 */

import { COGNI_SYSTEM_BILLING_ACCOUNT_ID } from "@tests/_fakes";
import { describe, expect, it } from "vitest";
import { FakeOrderLedger } from "@/adapters/test/trading/fake-order-ledger";
import type { LedgerRow } from "@/features/trading";

function makeRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  const now = new Date(Date.now() - 120_000); // older than 60s by default
  return {
    target_id: "target-1",
    fill_id: "fill-1",
    observed_at: now,
    client_order_id: "coid-1",
    order_id: "order-abc",
    status: "open",
    position_lifecycle: null,
    attributes: null,
    synced_at: null,
    created_at: now,
    updated_at: now,
    billing_account_id: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
    ...overrides,
  };
}

describe("FakeOrderLedger.syncHealthSummary", () => {
  it("empty table → all zeros and null", async () => {
    const ledger = new FakeOrderLedger({ initial: [] });
    const result = await ledger.syncHealthSummary();
    expect(result.oldest_synced_row_age_ms).toBeNull();
    expect(result.rows_stale_over_60s).toBe(0);
    expect(result.rows_never_synced).toBe(0);
  });

  it("one never-synced row → oldest_ms null, never_synced = 1", async () => {
    const row = makeRow({
      client_order_id: "coid-1",
      fill_id: "fill-1",
      synced_at: null,
    });
    const ledger = new FakeOrderLedger({ initial: [row] });
    const result = await ledger.syncHealthSummary();
    expect(result.oldest_synced_row_age_ms).toBeNull();
    expect(result.rows_never_synced).toBe(1);
    expect(result.rows_stale_over_60s).toBe(0);
  });

  it("one recently-synced row → oldest_ms >= 0, stale = 0, never = 0", async () => {
    const recentSyncedAt = new Date(Date.now() - 5_000); // 5s ago — not stale
    const row = makeRow({
      client_order_id: "coid-1",
      fill_id: "fill-1",
      synced_at: recentSyncedAt,
    });
    const ledger = new FakeOrderLedger({ initial: [row] });
    const result = await ledger.syncHealthSummary();
    expect(result.oldest_synced_row_age_ms).not.toBeNull();
    expect(result.oldest_synced_row_age_ms).toBeGreaterThanOrEqual(0);
    expect(result.rows_stale_over_60s).toBe(0);
    expect(result.rows_never_synced).toBe(0);
  });

  it("stale row (synced_at > 60s ago) → stale = 1", async () => {
    const staleSyncedAt = new Date(Date.now() - 90_000); // 90s ago
    const row = makeRow({
      client_order_id: "coid-1",
      fill_id: "fill-1",
      synced_at: staleSyncedAt,
    });
    const ledger = new FakeOrderLedger({ initial: [row] });
    const result = await ledger.syncHealthSummary();
    expect(result.rows_stale_over_60s).toBe(1);
    expect(result.rows_never_synced).toBe(0);
  });

  it("mix of synced + stale + never-synced rows → correct counts", async () => {
    const freshSyncedAt = new Date(Date.now() - 10_000); // 10s ago
    const staleSyncedAt = new Date(Date.now() - 120_000); // 2 min ago

    const rowFresh = makeRow({
      client_order_id: "coid-fresh",
      fill_id: "fill-1",
      synced_at: freshSyncedAt,
    });
    const rowStale1 = makeRow({
      client_order_id: "coid-stale-1",
      fill_id: "fill-2",
      synced_at: staleSyncedAt,
    });
    const rowStale2 = makeRow({
      client_order_id: "coid-stale-2",
      fill_id: "fill-3",
      synced_at: new Date(Date.now() - 200_000), // even older
    });
    const rowNever = makeRow({
      client_order_id: "coid-never",
      fill_id: "fill-4",
      synced_at: null,
    });

    const ledger = new FakeOrderLedger({
      initial: [rowFresh, rowStale1, rowStale2, rowNever],
    });
    const result = await ledger.syncHealthSummary();

    // Two stale rows (> 60s)
    expect(result.rows_stale_over_60s).toBe(2);
    // One never-synced
    expect(result.rows_never_synced).toBe(1);
    // oldest_ms = age of the oldest synced row (rowStale2 at ~200s)
    expect(result.oldest_synced_row_age_ms).not.toBeNull();
    expect(result.oldest_synced_row_age_ms).toBeGreaterThanOrEqual(190_000);
  });

  it("oldest_synced_row_age_ms reflects the MIN synced_at (least recent)", async () => {
    // Two synced rows; the older one should determine oldest_ms.
    const older = new Date(Date.now() - 300_000); // 5 min ago
    const newer = new Date(Date.now() - 30_000); // 30s ago

    const rowOld = makeRow({
      client_order_id: "coid-old",
      fill_id: "fill-1",
      synced_at: older,
    });
    const rowNew = makeRow({
      client_order_id: "coid-new",
      fill_id: "fill-2",
      synced_at: newer,
    });

    const ledger = new FakeOrderLedger({ initial: [rowOld, rowNew] });
    const result = await ledger.syncHealthSummary();

    // oldest_ms must be >= age of the older row (>=270s after test clock drift)
    expect(result.oldest_synced_row_age_ms).toBeGreaterThanOrEqual(270_000);
  });
});
