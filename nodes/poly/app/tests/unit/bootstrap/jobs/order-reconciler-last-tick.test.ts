// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/jobs/order-reconciler-last-tick`
 * Purpose: Unit tests for `startOrderReconciler` last-tick-at tracking.
 *   Verifies getLastTickAt() returns null before first tick and a Date after.
 * Scope: Uses FakeOrderLedger + fake getOrder. Does not exercise setInterval.
 * Side-effects: none (timer cleared immediately)
 * Links: src/bootstrap/jobs/order-reconciler.job.ts (task.0328 CP4)
 * @internal
 */

import { noopMetrics } from "@cogni/market-provider";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeOrderLedger } from "@/adapters/test/trading/fake-order-ledger";
import { startOrderReconciler } from "@/bootstrap/jobs/order-reconciler.job";
import { makeNoopLogger } from "@/shared/observability/server";

const OPERATOR = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as `0x${string}`;
const LOGGER = makeNoopLogger();

describe("startOrderReconciler — getLastTickAt", () => {
  const handles: Array<{ stop: () => void }> = [];

  afterEach(() => {
    for (const h of handles) h.stop();
    handles.length = 0;
  });

  it("getLastTickAt() returns null before any tick completes", () => {
    // Ledger with no rows — tick will resolve immediately with no work.
    // But we test the *initial* state before the async tick resolves.
    const ledger = new FakeOrderLedger({ initial: [] });

    // Block the tick from completing to observe pre-tick state.
    let resolve!: () => void;
    const blocker = new Promise<void>((r) => {
      resolve = r;
    });
    const listSpy = vi
      .spyOn(ledger, "listOpenOrPending")
      .mockReturnValue(blocker.then(() => []));

    const handle = startOrderReconciler({
      ledger,
      getOrder: vi.fn(),
      getOperatorPositions: async () => [],
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
      metrics: noopMetrics,
      notFoundGraceMs: 900_000,
    });
    handles.push(handle);

    // Before the blocked tick resolves, lastTickAt must be null.
    expect(handle.getLastTickAt()).toBeNull();

    // Unblock to clean up
    resolve();
    listSpy.mockRestore();
  });

  it("getLastTickAt() returns a Date after a successful tick", async () => {
    const ledger = new FakeOrderLedger({ initial: [] });

    const handle = startOrderReconciler({
      ledger,
      getOrder: vi.fn(),
      getOperatorPositions: async () => [],
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
      metrics: noopMetrics,
      notFoundGraceMs: 900_000,
    });
    handles.push(handle);

    // The first tick fires immediately (void tick() in startOrderReconciler).
    // Drain microtask queue by awaiting a resolved promise a few times.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }

    const tickAt = handle.getLastTickAt();
    expect(tickAt).not.toBeNull();
    expect(tickAt).toBeInstanceOf(Date);
  });
});
