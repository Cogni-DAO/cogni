// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/jobs/order-reconciler`
 * Purpose: Unit tests for `runReconcileOnce` — pure tick logic with
 * FakeOrderLedger + controllable fake `getOrder`. Validates CLOB status sync,
 * skipping rows without order_id, error isolation, no-op when unchanged,
 * and not_found grace-window promotion (task.0328 CP2).
 * Scope: Does not touch DB or CLOB. Uses `FakeOrderLedger` + `noopMetrics`.
 * Side-effects: none
 * Links: src/bootstrap/jobs/order-reconciler.job.ts
 * @internal
 */

import type { GetOrderResult, OrderReceipt } from "@cogni/poly-market-provider";
import { noopMetrics } from "@cogni/poly-market-provider";
import { COGNI_SYSTEM_BILLING_ACCOUNT_ID } from "@tests/_fakes";
import { describe, expect, it, vi } from "vitest";
import { FakeOrderLedger } from "@/adapters/test/trading/fake-order-ledger";
import {
  ORDER_RECONCILER_METRICS,
  runReconcileOnce,
} from "@/bootstrap/jobs/order-reconciler.job";
import type { LedgerRow } from "@/features/trading";
import { makeNoopLogger } from "@/shared/observability/server";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const LOGGER = makeNoopLogger();

/** Build a minimal LedgerRow seeded into FakeOrderLedger. */
function makeRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  const now = new Date(Date.now() - 60_000); // older than 30s default
  return {
    target_id: "target-1",
    fill_id: "fill-1",
    observed_at: now,
    client_order_id: "coid-1",
    order_id: "order-abc",
    status: "pending",
    attributes: null,
    synced_at: null,
    created_at: now,
    updated_at: now,
    billing_account_id: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
    ...overrides,
  };
}

/**
 * Wrap a flat `(orderId) => Promise<GetOrderResult>` fn in the per-tenant
 * shape the reconciler expects. Assertions on `getOrder` still work — tests
 * typically don't care which tenant dispatched.
 */
function perTenant(
  fn: (
    orderId: string
  ) => Promise<import("@cogni/poly-market-provider").GetOrderResult>
) {
  return (_billingAccountId: string, orderId: string) => fn(orderId);
}

/** Build a minimal OrderReceipt. */
function makeReceipt(overrides: Partial<OrderReceipt> = {}): OrderReceipt {
  return {
    order_id: "order-abc",
    client_order_id: "coid-1",
    status: "filled",
    filled_size_usdc: 1.0,
    submitted_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Wrap a receipt in the GetOrderResult discriminated union. */
function found(receipt: OrderReceipt): GetOrderResult {
  return { found: receipt };
}

/** Sentinel for orders not found on CLOB. */
const NOT_FOUND: GetOrderResult = { status: "not_found" };

/** Tracking metrics adapter — counts incr calls per metric name. */
function makeTrackingMetrics() {
  const counts: Record<string, number> = {};
  return {
    metrics: {
      incr(name: string, _labels: Record<string, string>) {
        counts[name] = (counts[name] ?? 0) + 1;
      },
      observeDurationMs() {},
    },
    counts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("runReconcileOnce", () => {
  it("pending row + getOrder returns filled → status becomes filled", async () => {
    const ledger = new FakeOrderLedger({
      initial: [makeRow({ status: "pending", order_id: "order-abc" })],
    });
    const getOrder = vi
      .fn()
      .mockResolvedValue(found(makeReceipt({ status: "filled" })));

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(getOrder),
      logger: LOGGER,
      metrics: noopMetrics,
      notFoundGraceMs: 900_000,
    });

    expect(ledger.rows[0]?.status).toBe("filled");
    expect(getOrder).toHaveBeenCalledWith("order-abc");
  });

  it("open row + getOrder returns canceled → status becomes canceled", async () => {
    const ledger = new FakeOrderLedger({
      initial: [makeRow({ status: "open", order_id: "order-xyz" })],
    });
    const getOrder = vi
      .fn()
      .mockResolvedValue(
        found(makeReceipt({ status: "canceled", order_id: "order-xyz" }))
      );

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(getOrder),
      logger: LOGGER,
      metrics: noopMetrics,
      notFoundGraceMs: 900_000,
    });

    expect(ledger.rows[0]?.status).toBe("canceled");
  });

  it("row with no order_id is skipped — getOrder never called", async () => {
    const ledger = new FakeOrderLedger({
      initial: [makeRow({ status: "pending", order_id: null })],
    });
    const getOrder = vi.fn();

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(getOrder),
      logger: LOGGER,
      metrics: noopMetrics,
      notFoundGraceMs: 900_000,
    });

    expect(getOrder).not.toHaveBeenCalled();
    expect(ledger.rows[0]?.status).toBe("pending");
  });

  it("getOrder throws → tick continues, error counter increments, other rows processed", async () => {
    const row1 = makeRow({
      client_order_id: "coid-1",
      fill_id: "fill-1",
      order_id: "order-1",
      status: "pending",
    });
    const row2 = makeRow({
      client_order_id: "coid-2",
      fill_id: "fill-2",
      order_id: "order-2",
      status: "pending",
    });
    const ledger = new FakeOrderLedger({ initial: [row1, row2] });

    const { metrics, counts } = makeTrackingMetrics();

    const getOrder = vi
      .fn()
      .mockRejectedValueOnce(new Error("CLOB timeout"))
      .mockResolvedValueOnce(
        found(
          makeReceipt({
            status: "filled",
            order_id: "order-2",
            client_order_id: "coid-2",
          })
        )
      );

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(getOrder),
      logger: LOGGER,
      metrics,
      notFoundGraceMs: 900_000,
    });

    // First row errored — status unchanged
    expect(
      ledger.rows.find((r) => r.client_order_id === "coid-1")?.status
    ).toBe("pending");
    // Second row succeeded
    expect(
      ledger.rows.find((r) => r.client_order_id === "coid-2")?.status
    ).toBe("filled");
    expect(counts[ORDER_RECONCILER_METRICS.errorsTotal]).toBe(1);
    expect(counts[ORDER_RECONCILER_METRICS.ticksTotal]).toBe(1);
  });

  it("status unchanged → updateStatus not called (no extra updated_at churn)", async () => {
    const row = makeRow({ status: "open", order_id: "order-abc" });
    const originalUpdatedAt = row.updated_at;
    const ledger = new FakeOrderLedger({ initial: [row] });
    const getOrder = vi
      .fn()
      .mockResolvedValue(found(makeReceipt({ status: "open" })));

    const updateSpy = vi.spyOn(ledger, "updateStatus");

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(getOrder),
      logger: LOGGER,
      metrics: noopMetrics,
      notFoundGraceMs: 900_000,
    });

    expect(updateSpy).not.toHaveBeenCalled();
    // updated_at must not have changed
    expect(ledger.rows[0]?.updated_at).toEqual(originalUpdatedAt);
  });

  it("ticks total counter is incremented once per tick", async () => {
    const ledger = new FakeOrderLedger({ initial: [] });
    const { metrics, counts } = makeTrackingMetrics();

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(vi.fn()),
      logger: LOGGER,
      metrics,
      notFoundGraceMs: 900_000,
    });

    expect(counts[ORDER_RECONCILER_METRICS.ticksTotal]).toBe(1);
  });

  // ─── CP2: not_found grace-window promotion ────────────────────────────────

  it("not_found + stale row (age > grace) → promoted to canceled with reason=clob_not_found; counter incremented", async () => {
    // Row created 20 min ago; grace window is 10 min → stale.
    const createdAt = new Date(Date.now() - 20 * 60 * 1000);
    const row = makeRow({
      status: "pending",
      order_id: "order-gone",
      created_at: createdAt,
      updated_at: createdAt,
    });
    const ledger = new FakeOrderLedger({ initial: [row] });
    const { metrics, counts } = makeTrackingMetrics();

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(vi.fn().mockResolvedValue(NOT_FOUND)),
      logger: LOGGER,
      metrics,
      notFoundGraceMs: 10 * 60 * 1000, // 10 min grace
    });

    expect(ledger.rows[0]?.status).toBe("canceled");
    expect(
      (ledger.rows[0]?.attributes as Record<string, unknown> | null)?.reason
    ).toBe("clob_not_found");
    expect(counts[ORDER_RECONCILER_METRICS.notFoundUpgradesTotal]).toBe(1);
    // ticks counter still fires
    expect(counts[ORDER_RECONCILER_METRICS.ticksTotal]).toBe(1);
  });

  it("not_found + fresh row (age < grace) → no updateStatus call, no counter, status unchanged", async () => {
    // Row created 5 min ago; grace window is 15 min → still within grace.
    const createdAt = new Date(Date.now() - 5 * 60 * 1000);
    const row = makeRow({
      status: "open",
      order_id: "order-fresh",
      created_at: createdAt,
      updated_at: createdAt,
    });
    const ledger = new FakeOrderLedger({ initial: [row] });
    const { metrics, counts } = makeTrackingMetrics();
    const updateSpy = vi.spyOn(ledger, "updateStatus");

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(vi.fn().mockResolvedValue(NOT_FOUND)),
      logger: LOGGER,
      metrics,
      notFoundGraceMs: 15 * 60 * 1000, // 15 min grace
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(ledger.rows[0]?.status).toBe("open");
    expect(
      counts[ORDER_RECONCILER_METRICS.notFoundUpgradesTotal]
    ).toBeUndefined();
  });

  it("not_found + stale row: injected clock pins age deterministically", async () => {
    // Row whose created_at is exactly 1 ms before the pinned clock time.
    // Grace = 0 ms → any age > 0 is stale.
    const pinnedNow = new Date("2025-01-01T00:00:01.000Z");
    const createdAt = new Date("2025-01-01T00:00:00.999Z"); // 1 ms before pinnedNow
    const row = makeRow({
      status: "pending",
      order_id: "order-pinned",
      created_at: createdAt,
      updated_at: createdAt,
    });
    const ledger = new FakeOrderLedger({ initial: [row] });
    const { metrics, counts } = makeTrackingMetrics();

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(vi.fn().mockResolvedValue(NOT_FOUND)),
      logger: LOGGER,
      metrics,
      notFoundGraceMs: 0,
      clock: () => pinnedNow,
    });

    expect(ledger.rows[0]?.status).toBe("canceled");
    expect(counts[ORDER_RECONCILER_METRICS.notFoundUpgradesTotal]).toBe(1);
  });

  // ─── CP3: markSynced wiring ───────────────────────────────────────────────

  it("markSynced called with ids of rows that got a typed CLOB response; thrown rows excluded", async () => {
    // 3 rows with order_ids; row1 + row2 = typed response, row3 = throws.
    const row1 = makeRow({
      client_order_id: "coid-1",
      fill_id: "fill-1",
      order_id: "order-1",
      status: "open",
    });
    const row2 = makeRow({
      client_order_id: "coid-2",
      fill_id: "fill-2",
      order_id: "order-2",
      status: "open",
    });
    // row3 has order_id but getOrder throws — should NOT appear in markSynced.
    const row3 = makeRow({
      client_order_id: "coid-3",
      fill_id: "fill-3",
      order_id: "order-3",
      status: "pending",
    });
    const ledger = new FakeOrderLedger({ initial: [row1, row2, row3] });
    const markSyncedSpy = vi.spyOn(ledger, "markSynced");

    const getOrder = vi
      .fn()
      .mockResolvedValueOnce(
        found(
          makeReceipt({
            status: "open",
            order_id: "order-1",
            client_order_id: "coid-1",
          })
        )
      )
      .mockResolvedValueOnce(NOT_FOUND) // within-grace (notFoundGraceMs = 900s)
      .mockRejectedValueOnce(new Error("network timeout"));

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(getOrder),
      logger: LOGGER,
      metrics: noopMetrics,
      notFoundGraceMs: 900_000,
    });

    // markSynced was called once with the two ids that got typed responses.
    expect(markSyncedSpy).toHaveBeenCalledTimes(1);
    const calledWith = markSyncedSpy.mock.calls[0]?.[0] ?? [];
    expect(calledWith).toHaveLength(2);
    expect(calledWith).toContain("coid-1");
    expect(calledWith).toContain("coid-2");
    expect(calledWith).not.toContain("coid-3");
  });

  it("markSynced called with empty array when no rows had order_ids", async () => {
    // All rows lack order_id — no CLOB calls made, markSynced([]).
    const row = makeRow({ order_id: null, status: "pending" });
    const ledger = new FakeOrderLedger({ initial: [row] });
    const markSyncedSpy = vi.spyOn(ledger, "markSynced");

    await runReconcileOnce({
      ledger,
      getOrderForTenant: perTenant(vi.fn()),
      logger: LOGGER,
      metrics: noopMetrics,
      notFoundGraceMs: 900_000,
    });

    expect(markSyncedSpy).toHaveBeenCalledWith([]);
  });
});
