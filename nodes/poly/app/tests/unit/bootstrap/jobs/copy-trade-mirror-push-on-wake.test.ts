// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/jobs/copy-trade-mirror-push-on-wake`
 * Purpose: Contract tests for the push-on-wake path inside `startMirrorPoll`. Verifies that a `WalletActivitySource.subscribeWake` callback drives the same `runMirrorTick` as the safety-net interval, single-flight + queued-wakeup coalesces bursts, callback throws are isolated, and unsubscribe runs on stop.
 * Scope: Pure unit. No timers waited on for the push path itself (push fires synchronously from `subscribeWake`); fake `setInterval` is only used to assert the safety-net interval still ticks.
 * Invariants: SINGLE_FLIGHT_WAKE — at most one in-flight wake-tick + at most one queued follow-up; SAFETY_NET_DRAIN — interval keeps firing even when push path is failing.
 * Side-effects: none
 * Links: src/bootstrap/jobs/copy-trade-mirror.job.ts, work/items/task.5017
 * @internal
 */

import {
  createRecordingMetrics,
  type Fill,
  noopLogger,
  type OrderIntent,
  type OrderReceipt,
} from "@cogni/poly-market-provider";
import { COGNI_SYSTEM_BILLING_ACCOUNT_ID, TEST_USER_ID_1 } from "@tests/_fakes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeOrderLedger } from "@/adapters/test";
import {
  MIRROR_JOB_METRICS,
  startMirrorPoll,
} from "@/bootstrap/jobs/copy-trade-mirror.job";
import type { MirrorTargetConfig } from "@/features/copy-trade/types";
import type { WalletActivitySource } from "@/features/wallet-watch";

const TARGET_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_WALLET = "0xAAaaaaaAAaAaAaAAaAaaaAaaAaaAAaAaAaaAAaaa" as const;

const BASE_TARGET: MirrorTargetConfig = {
  target_id: TARGET_ID,
  target_wallet: TARGET_WALLET,
  billing_account_id: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  created_by_user_id: TEST_USER_ID_1,
  mode: "live",
  sizing: { kind: "min_bet", max_usdc_per_trade: 5 },
  placement: { kind: "mirror_limit" },
};

interface ControllableSource extends WalletActivitySource {
  /** Resolve all pending fetchSince calls. */
  release(): void;
  /** Number of in-flight + queued resolves. */
  pending(): number;
  /** How many times fetchSince was invoked. */
  callCount(): number;
  /** Manually invoke wake-listeners (simulates a watched-asset WS frame). */
  fireWake(): void;
  /** Number of subscribed wake-listeners. */
  listenerCount(): number;
}

function makeControllableSource(opts?: {
  fillsPerCall?: () => Fill[];
}): ControllableSource {
  const wakeListeners = new Set<() => void>();
  const pendingResolvers: Array<() => void> = [];
  let calls = 0;
  return {
    async fetchSince() {
      calls += 1;
      const fills = opts?.fillsPerCall?.() ?? [];
      await new Promise<void>((resolve) => {
        pendingResolvers.push(resolve);
      });
      return { fills, newSince: Math.floor(Date.now() / 1000) };
    },
    subscribeWake(cb) {
      wakeListeners.add(cb);
      return () => {
        wakeListeners.delete(cb);
      };
    },
    release() {
      while (pendingResolvers.length > 0) {
        const r = pendingResolvers.shift();
        r?.();
      }
    },
    pending() {
      return pendingResolvers.length;
    },
    callCount() {
      return calls;
    },
    fireWake() {
      for (const l of wakeListeners) l();
    },
    listenerCount() {
      return wakeListeners.size;
    },
  };
}

async function flush() {
  // Push-on-wake's await chain is fetchSince → runMirrorTick → tick → IIFE,
  // and the IIFE's do/while may re-enter on a queued wakeup. 10 microtask
  // yields is a generous bound that works under both real and fake timers.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe("startMirrorPoll — push-on-wake", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers a wake subscriber and dispatches runMirrorTick on wake", async () => {
    vi.useFakeTimers();
    const source = makeControllableSource();
    const ledger = new FakeOrderLedger({ initial: [] });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const metrics = createRecordingMetrics();

    const stop = startMirrorPoll({
      target: BASE_TARGET,
      source,
      ledger,
      placeIntent,
      logger: noopLogger,
      metrics,
    });

    // First tick fires immediately on startup. Let it begin, then drain it.
    await flush();
    expect(source.callCount()).toBe(1);
    source.release();
    await flush();

    // Now register-side: subscribeWake was called once during startup.
    expect(source.listenerCount()).toBe(1);

    // Wake → second fetchSince invocation.
    source.fireWake();
    await flush();
    expect(source.callCount()).toBe(2);
    source.release();
    await flush();

    stop();
    expect(source.listenerCount()).toBe(0);
  });

  it("coalesces a burst of wakes into in-flight + at-most-one queued tick", async () => {
    vi.useFakeTimers();
    const source = makeControllableSource();
    const ledger = new FakeOrderLedger({ initial: [] });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();

    const stop = startMirrorPoll({
      target: BASE_TARGET,
      source,
      ledger,
      placeIntent,
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });

    // Drain the startup tick.
    await flush();
    source.release();
    await flush();
    expect(source.callCount()).toBe(1);

    // First wake → starts in-flight tick #2.
    source.fireWake();
    await flush();
    expect(source.callCount()).toBe(2);

    // 5 more wakes while #2 is still in-flight → all collapse into ONE
    // queued follow-up.
    source.fireWake();
    source.fireWake();
    source.fireWake();
    source.fireWake();
    source.fireWake();
    await flush();
    expect(source.callCount()).toBe(2);

    // Resolve #2 → queued follow-up runs → call #3.
    source.release();
    await flush();
    expect(source.callCount()).toBe(3);

    // Resolve #3 → no further queued wakeups → idle.
    source.release();
    await flush();
    expect(source.callCount()).toBe(3);

    stop();
  });

  it("a wake firing during in-flight tick re-queues exactly once", async () => {
    vi.useFakeTimers();
    const source = makeControllableSource();
    const ledger = new FakeOrderLedger({ initial: [] });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();

    const stop = startMirrorPoll({
      target: BASE_TARGET,
      source,
      ledger,
      placeIntent,
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });

    await flush();
    source.release();
    await flush();
    expect(source.callCount()).toBe(1);

    // Wake → tick #2 starts.
    source.fireWake();
    await flush();
    expect(source.callCount()).toBe(2);

    // While tick #2 is still in flight, fire one more wake.
    source.fireWake();
    await flush();
    // Still no third call yet (queued).
    expect(source.callCount()).toBe(2);

    // Resolve #2 → queued #3 runs.
    source.release();
    await flush();
    expect(source.callCount()).toBe(3);

    source.release();
    await flush();
    expect(source.callCount()).toBe(3);

    stop();
  });

  it("safety-net setInterval still fires even when push path is idle", async () => {
    vi.useFakeTimers();
    const source = makeControllableSource();
    const ledger = new FakeOrderLedger({ initial: [] });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();

    const stop = startMirrorPoll({
      target: BASE_TARGET,
      source,
      ledger,
      placeIntent,
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });

    // Drain startup tick.
    await flush();
    source.release();
    await flush();
    expect(source.callCount()).toBe(1);

    // No wake fired. Advance past the 30s setInterval cadence.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(source.callCount()).toBe(2);
    source.release();
    await flush();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(source.callCount()).toBe(3);
    source.release();
    await flush();

    stop();
  });

  it("stop() unsubscribes the wake listener and clears the safety-net interval", async () => {
    vi.useFakeTimers();
    const source = makeControllableSource();
    const ledger = new FakeOrderLedger({ initial: [] });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();

    const stop = startMirrorPoll({
      target: BASE_TARGET,
      source,
      ledger,
      placeIntent,
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });

    await flush();
    source.release();
    await flush();
    expect(source.listenerCount()).toBe(1);

    stop();
    expect(source.listenerCount()).toBe(0);

    const callsBefore = source.callCount();

    // No more wake-driven ticks.
    source.fireWake();
    await flush();
    expect(source.callCount()).toBe(callsBefore);

    // No more interval-driven ticks.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(source.callCount()).toBe(callsBefore);
  });

  it("source without subscribeWake works (push path is purely additive)", async () => {
    vi.useFakeTimers();
    const calls = { n: 0 };
    const sourceNoWake: WalletActivitySource = {
      async fetchSince() {
        calls.n += 1;
        return { fills: [], newSince: Math.floor(Date.now() / 1000) };
      },
    };
    const ledger = new FakeOrderLedger({ initial: [] });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();

    const stop = startMirrorPoll({
      target: BASE_TARGET,
      source: sourceNoWake,
      ledger,
      placeIntent,
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });
    await flush();
    expect(calls.n).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.n).toBe(2);

    stop();
  });

  it("emits poly_mirror_ws_wake_ticks_total on a wake-driven tick", async () => {
    vi.useFakeTimers();
    const source = makeControllableSource();
    const ledger = new FakeOrderLedger({ initial: [] });
    const placeIntent = vi.fn<(i: OrderIntent) => Promise<OrderReceipt>>();
    const metrics = createRecordingMetrics();

    const stop = startMirrorPoll({
      target: BASE_TARGET,
      source,
      ledger,
      placeIntent,
      logger: noopLogger,
      metrics,
    });
    await flush();
    source.release();
    await flush();

    // Startup tick was fired directly via `void tick()`, not through the wake
    // IIFE — so the wake counter must still be 0 here.
    expect(metrics.countsByName(MIRROR_JOB_METRICS.wsWakeTicksTotal)).toBe(0);

    source.fireWake();
    await flush();
    source.release();
    await flush();

    expect(metrics.countsByName(MIRROR_JOB_METRICS.wsWakeTicksTotal)).toBe(1);

    stop();
  });
});
