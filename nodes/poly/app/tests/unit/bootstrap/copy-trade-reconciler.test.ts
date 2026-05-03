// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/copy-trade-reconciler`
 * Purpose: Unit tests for the target-set reconciler — asserts FIRST_TICK_IMMEDIATE,
 *          POLL_RECONCILES_PER_TICK, KEY_STABILITY (tenant+wallet dedupe with
 *          case-normalisation), and SELF_HEALING around thrown deps.
 * Scope: Pure unit test. Stubs `CopyTradeTargetSource.listAllActive`,
 *        `startPollForTarget`, and injects deterministic fake timers so tick
 *        cadence is controlled by the test.
 * Invariants tested:
 *   - First tick fires synchronously (no 30s wait) — startup targets begin polling.
 *   - Sequence [] → [A] → [A,B] → [B] → [] produces exactly start(A), start(B), stop(A), stop(B).
 *   - Same (billingAccountId, targetWallet) across ticks is one running poll, not N.
 *   - Wallet-address case variance collapses to one key.
 *   - `listAllActive` throw is caught, tick_error logged, next tick recovers.
 *   - Returned stop handle clears the interval and invokes every live stop-fn.
 * @public
 */

import type { LoggerPort } from "@cogni/poly-market-provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CopyTradeReconcilerDeps,
  startCopyTradeReconciler,
} from "@/bootstrap/copy-trade-reconciler";
import type { EnumeratedTarget } from "@/features/copy-trade/target-source";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const USER_A = "11111111-1111-4111-1111-111111111111";
const USER_B = "22222222-2222-4222-2222-222222222222";

const WALLET_A = "0xAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbbAAAAbbbb" as const;
const WALLET_B = "0xCCCCddddCCCCddddCCCCddddCCCCddddCCCCdddd" as const;

function target(
  billingAccountId: string,
  createdByUserId: string,
  targetWallet: `0x${string}`,
  overrides?: Partial<
    Pick<EnumeratedTarget, "mirrorFilterPercentile" | "mirrorMaxUsdcPerTrade">
  >
): EnumeratedTarget {
  return {
    billingAccountId,
    createdByUserId,
    targetWallet,
    mirrorFilterPercentile: overrides?.mirrorFilterPercentile ?? 75,
    mirrorMaxUsdcPerTrade: overrides?.mirrorMaxUsdcPerTrade ?? 5,
  };
}

function makeLogger(): LoggerPort {
  // child() MUST return an object with the same shape — pino does this.
  const self: LoggerPort = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => self),
  };
  return self;
}

/**
 * Fake timer harness. We don't use vi.useFakeTimers because we want tight
 * control of when ticks run — and the reconciler is fully async inside each
 * tick, so we need a way to wait for them.
 */
function makeTimers() {
  const callbacks: Array<() => void> = [];
  let nextId = 1;
  const handles = new Map<ReturnType<typeof setInterval>, () => void>();
  const timers = {
    setInterval: ((fn: () => void, _ms: number) => {
      const id = nextId++ as unknown as ReturnType<typeof setInterval>;
      handles.set(id, fn);
      callbacks.push(fn);
      return id;
    }) as CopyTradeReconcilerDeps["timers"] extends infer T
      ? T extends { setInterval: infer S }
        ? S
        : never
      : never,
    clearInterval: ((h: ReturnType<typeof setInterval>) => {
      handles.delete(h);
    }) as CopyTradeReconcilerDeps["timers"] extends infer T
      ? T extends { clearInterval: infer C }
        ? C
        : never
      : never,
  };
  return {
    timers,
    async fireNextTick(): Promise<void> {
      for (const fn of handles.values()) fn();
      // Each tick is async inside — let microtasks flush.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("copy-trade-reconciler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("FIRST_TICK_IMMEDIATE — invokes startPollForTarget synchronously for startup targets", async () => {
    const startPollForTarget = vi.fn(() => vi.fn());
    const listAllActive = vi
      .fn()
      .mockResolvedValue([target(TENANT_A, USER_A, WALLET_A)]);
    const { timers } = makeTimers();

    const stop = startCopyTradeReconciler({
      targetSource: { listAllActive },
      startPollForTarget,
      logger: makeLogger(),
      timers,
    });

    // First tick is awaited via queued microtasks — flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(listAllActive).toHaveBeenCalledTimes(1);
    expect(startPollForTarget).toHaveBeenCalledTimes(1);
    expect(startPollForTarget).toHaveBeenCalledWith(
      target(TENANT_A, USER_A, WALLET_A)
    );
    stop();
  });

  it("diffs across ticks: [] → [A] → [A,B] → [B] → [] produces start(A), start(B), stop(A), stop(B)", async () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const startPollForTarget = vi
      .fn<(t: EnumeratedTarget) => () => void>()
      .mockImplementationOnce(() => stopA)
      .mockImplementationOnce(() => stopB);

    const listAllActive = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([target(TENANT_A, USER_A, WALLET_A)])
      .mockResolvedValueOnce([
        target(TENANT_A, USER_A, WALLET_A),
        target(TENANT_B, USER_B, WALLET_B),
      ])
      .mockResolvedValueOnce([target(TENANT_B, USER_B, WALLET_B)])
      .mockResolvedValueOnce([]);

    const { timers, fireNextTick } = makeTimers();

    const stopReconciler = startCopyTradeReconciler({
      targetSource: { listAllActive },
      startPollForTarget,
      logger: makeLogger(),
      timers,
    });

    // Initial tick: empty
    await Promise.resolve();
    await Promise.resolve();
    expect(startPollForTarget).toHaveBeenCalledTimes(0);

    // Tick 2: [A] → start(A)
    await fireNextTick();
    expect(startPollForTarget).toHaveBeenCalledTimes(1);
    expect(startPollForTarget).toHaveBeenLastCalledWith(
      target(TENANT_A, USER_A, WALLET_A)
    );
    expect(stopA).not.toHaveBeenCalled();

    // Tick 3: [A, B] → start(B), A still running
    await fireNextTick();
    expect(startPollForTarget).toHaveBeenCalledTimes(2);
    expect(startPollForTarget).toHaveBeenLastCalledWith(
      target(TENANT_B, USER_B, WALLET_B)
    );
    expect(stopA).not.toHaveBeenCalled();
    expect(stopB).not.toHaveBeenCalled();

    // Tick 4: [B] → stop(A)
    await fireNextTick();
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).not.toHaveBeenCalled();
    expect(startPollForTarget).toHaveBeenCalledTimes(2); // no new starts

    // Tick 5: [] → stop(B)
    await fireNextTick();
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);

    stopReconciler();
  });

  it("KEY_STABILITY — same tenant + wallet across ticks is one poll, not repeated starts", async () => {
    const startPollForTarget = vi.fn(() => vi.fn());
    const listAllActive = vi
      .fn()
      .mockResolvedValueOnce([target(TENANT_A, USER_A, WALLET_A)])
      .mockResolvedValueOnce([target(TENANT_A, USER_A, WALLET_A)])
      .mockResolvedValueOnce([target(TENANT_A, USER_A, WALLET_A)]);

    const { timers, fireNextTick } = makeTimers();
    const stopReconciler = startCopyTradeReconciler({
      targetSource: { listAllActive },
      startPollForTarget,
      logger: makeLogger(),
      timers,
    });

    await Promise.resolve();
    await Promise.resolve();
    await fireNextTick();
    await fireNextTick();

    expect(startPollForTarget).toHaveBeenCalledTimes(1);
    stopReconciler();
  });

  it("restarts a running poll when target policy changes", async () => {
    const stopP75 = vi.fn();
    const stopP85 = vi.fn();
    const startPollForTarget = vi
      .fn<(t: EnumeratedTarget) => () => void>()
      .mockImplementationOnce(() => stopP75)
      .mockImplementationOnce(() => stopP85);
    const p75 = target(TENANT_A, USER_A, WALLET_A, {
      mirrorFilterPercentile: 75,
      mirrorMaxUsdcPerTrade: 5,
    });
    const p85 = target(TENANT_A, USER_A, WALLET_A, {
      mirrorFilterPercentile: 85,
      mirrorMaxUsdcPerTrade: 20,
    });
    const listAllActive = vi
      .fn()
      .mockResolvedValueOnce([p75])
      .mockResolvedValueOnce([p85])
      .mockResolvedValueOnce([p85]);

    const { timers, fireNextTick } = makeTimers();
    const stopReconciler = startCopyTradeReconciler({
      targetSource: { listAllActive },
      startPollForTarget,
      logger: makeLogger(),
      timers,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(startPollForTarget).toHaveBeenCalledTimes(1);
    expect(startPollForTarget).toHaveBeenLastCalledWith(p75);
    expect(stopP75).not.toHaveBeenCalled();

    await fireNextTick();
    expect(stopP75).toHaveBeenCalledTimes(1);
    expect(startPollForTarget).toHaveBeenCalledTimes(2);
    expect(startPollForTarget).toHaveBeenLastCalledWith(p85);
    expect(stopP85).not.toHaveBeenCalled();

    await fireNextTick();
    expect(startPollForTarget).toHaveBeenCalledTimes(2);
    expect(stopP85).not.toHaveBeenCalled();

    stopReconciler();
    expect(stopP85).toHaveBeenCalledTimes(1);
  });

  it("KEY_STABILITY — wallet case variance collapses to one key", async () => {
    const startPollForTarget = vi.fn(() => vi.fn());
    // Same wallet, two case variants. DB returns checksummed; runtime
    // comparisons in fills/decisions land on lowercase — the reconciler must
    // see them as the same poll.
    const listAllActive = vi
      .fn()
      .mockResolvedValueOnce([target(TENANT_A, USER_A, WALLET_A)])
      .mockResolvedValueOnce([
        target(TENANT_A, USER_A, WALLET_A.toLowerCase() as `0x${string}`),
      ]);

    const { timers, fireNextTick } = makeTimers();
    const stopReconciler = startCopyTradeReconciler({
      targetSource: { listAllActive },
      startPollForTarget,
      logger: makeLogger(),
      timers,
    });

    await Promise.resolve();
    await Promise.resolve();
    await fireNextTick();

    expect(startPollForTarget).toHaveBeenCalledTimes(1);
    stopReconciler();
  });

  it("SELF_HEALING — listAllActive throw is caught, next tick recovers", async () => {
    const stopA = vi.fn();
    const startPollForTarget = vi
      .fn<(t: EnumeratedTarget) => () => void>()
      .mockReturnValue(stopA);

    const listAllActive = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce([target(TENANT_A, USER_A, WALLET_A)]);

    const logger = makeLogger();
    const { timers, fireNextTick } = makeTimers();

    const stopReconciler = startCopyTradeReconciler({
      targetSource: { listAllActive },
      startPollForTarget,
      logger,
      timers,
    });

    // First tick throws
    await Promise.resolve();
    await Promise.resolve();
    expect(startPollForTarget).toHaveBeenCalledTimes(0);
    // Logger surfaced tick_error
    const childLog = (logger.child as ReturnType<typeof vi.fn>).mock.results[0]
      ?.value as LoggerPort;
    expect(childLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "list_failed" }),
      expect.any(String)
    );

    // Second tick recovers
    await fireNextTick();
    expect(startPollForTarget).toHaveBeenCalledTimes(1);

    stopReconciler();
  });

  it("reconciler stop handle clears interval and invokes every running stop-fn", async () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const startPollForTarget = vi
      .fn<(t: EnumeratedTarget) => () => void>()
      .mockImplementationOnce(() => stopA)
      .mockImplementationOnce(() => stopB);

    const listAllActive = vi
      .fn()
      .mockResolvedValue([
        target(TENANT_A, USER_A, WALLET_A),
        target(TENANT_B, USER_B, WALLET_B),
      ]);

    const { timers } = makeTimers();
    const stopReconciler = startCopyTradeReconciler({
      targetSource: { listAllActive },
      startPollForTarget,
      logger: makeLogger(),
      timers,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(startPollForTarget).toHaveBeenCalledTimes(2);
    expect(stopA).not.toHaveBeenCalled();
    expect(stopB).not.toHaveBeenCalled();

    stopReconciler();

    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);

    // Stop is idempotent — second call is a no-op.
    stopReconciler();
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
  });
});
