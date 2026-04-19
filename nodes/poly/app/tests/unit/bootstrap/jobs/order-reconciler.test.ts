// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/jobs/order-reconciler`
 * Purpose: Unit tests for `runReconcileOnce` — pure tick logic with
 * FakeOrderLedger + controllable fake `getOrder`. Validates CLOB status sync,
 * skipping rows without order_id, error isolation, and no-op when unchanged.
 * Scope: Does not touch DB or CLOB. Uses `FakeOrderLedger` + `noopMetrics`.
 * Side-effects: none
 * Links: src/bootstrap/jobs/order-reconciler.job.ts
 * @internal
 */

import type { OrderReceipt } from "@cogni/market-provider";
import { noopMetrics } from "@cogni/market-provider";
import { describe, expect, it, vi } from "vitest";

import { FakeOrderLedger } from "@/adapters/test/trading/fake-order-ledger";
import {
  RECONCILER_METRICS,
  runReconcileOnce,
} from "@/bootstrap/jobs/order-reconciler.job";
import type { LedgerRow } from "@/features/trading";
import { makeNoopLogger } from "@/shared/observability/server";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const OPERATOR = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as `0x${string}`;
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
    created_at: now,
    updated_at: now,
    ...overrides,
  };
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
      .mockResolvedValue(makeReceipt({ status: "filled" }));

    await runReconcileOnce({
      ledger,
      getOrder,
      getOperatorPositions: async () => [],
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
      metrics: noopMetrics,
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
        makeReceipt({ status: "canceled", order_id: "order-xyz" })
      );

    await runReconcileOnce({
      ledger,
      getOrder,
      getOperatorPositions: async () => [],
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
      metrics: noopMetrics,
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
      getOrder,
      getOperatorPositions: async () => [],
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
      metrics: noopMetrics,
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
        makeReceipt({
          status: "filled",
          order_id: "order-2",
          client_order_id: "coid-2",
        })
      );

    await runReconcileOnce({
      ledger,
      getOrder,
      getOperatorPositions: async () => [],
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
      metrics,
    });

    // First row errored — status unchanged
    expect(
      ledger.rows.find((r) => r.client_order_id === "coid-1")?.status
    ).toBe("pending");
    // Second row succeeded
    expect(
      ledger.rows.find((r) => r.client_order_id === "coid-2")?.status
    ).toBe("filled");
    expect(counts[RECONCILER_METRICS.errorsTotal]).toBe(1);
    expect(counts[RECONCILER_METRICS.ticksTotal]).toBe(1);
  });

  it("status unchanged → updateStatus not called (no extra updated_at churn)", async () => {
    const row = makeRow({ status: "open", order_id: "order-abc" });
    const originalUpdatedAt = row.updated_at;
    const ledger = new FakeOrderLedger({ initial: [row] });
    const getOrder = vi.fn().mockResolvedValue(makeReceipt({ status: "open" }));

    const updateSpy = vi.spyOn(ledger, "updateStatus");

    await runReconcileOnce({
      ledger,
      getOrder,
      getOperatorPositions: async () => [],
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
      metrics: noopMetrics,
    });

    expect(updateSpy).not.toHaveBeenCalled();
    // updated_at must not have changed
    expect(ledger.rows[0]?.updated_at).toEqual(originalUpdatedAt);
  });

  it("getOrder returns null → row skipped, status unchanged", async () => {
    const ledger = new FakeOrderLedger({
      initial: [makeRow({ status: "pending", order_id: "order-gone" })],
    });
    const getOrder = vi.fn().mockResolvedValue(null);

    await runReconcileOnce({
      ledger,
      getOrder,
      getOperatorPositions: async () => [],
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
      metrics: noopMetrics,
    });

    expect(ledger.rows[0]?.status).toBe("pending");
  });

  it("ticks total counter is incremented once per tick", async () => {
    const ledger = new FakeOrderLedger({ initial: [] });
    const { metrics, counts } = makeTrackingMetrics();

    await runReconcileOnce({
      ledger,
      getOrder: vi.fn(),
      getOperatorPositions: async () => [],
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
      metrics,
    });

    expect(counts[RECONCILER_METRICS.ticksTotal]).toBe(1);
  });
});
