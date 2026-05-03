// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/copy-trade-reconciler`
 * Purpose: Ticks `CopyTradeTargetSource.listAllActive()` on a 30s cadence, diffs
 *          the returned set against the currently-running per-target polls, and
 *          starts/stops `startMirrorPoll` handles to match. Replaces the
 *          boot-time enumerator in `container.ts` so POSTed targets begin
 *          copy-trading without a pod restart (bug.0338 / POLL_RECONCILES_PER_TICK).
 * Scope: Diff orchestration only. Does not know about Data-API clients,
 *        operator wallets, or ledgers — those live in the injected
 *        `startPollForTarget` factory. Target-set reconciliation, distinct from
 *        the ledger-order reconciler (startOrderReconciler) which walks CLOB
 *        order status and happens to share the word "reconciler".
 * Invariants:
 *   - POLL_RECONCILES_PER_TICK — every tick re-enumerates and diffs; handles
 *     for targets no longer in the active set are invoked (stop) and dropped.
 *   - KEY_STABILITY — running polls are keyed by
 *     `${billingAccountId}:${targetWallet.toLowerCase()}`. Same tenant + wallet
 *     across ticks hits the same slot; case differences in target_wallet are
 *     collapsed so RLS writes and DB reads agree.
 *   - FIRST_TICK_IMMEDIATE — the first tick fires synchronously on `start()` so
 *     startup targets begin polling without waiting 30s.
 *   - SELF_HEALING — tick errors (DB failure, factory throw) are caught, logged
 *     under `poly.mirror.targets.reconcile.tick_error`, and do not tear down
 *     the interval. The next tick reattempts enumeration from scratch.
 * Side-effects: `setInterval` + per-target `MirrorJobStopFn` handles.
 * Links: docs/spec/poly-multi-tenant-auth.md § POLL_RECONCILES_PER_TICK,
 *        work/items/bug.0338.poly-phase-a-drops-system-tenant-target-wallets.md,
 *        nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts (MirrorJobStopFn),
 *        work/items/task.0332.poly-mirror-shared-poller.md (scale successor)
 *
 * @scaffolding
 * Deleted-in-phase: 4 (task.0332 shared poller supersedes both the per-target
 *   setInterval and this target-set reconciler).
 *
 * @internal
 */

import { EVENT_NAMES } from "@cogni/node-shared";
import type { LoggerPort } from "@cogni/poly-market-provider";
import type {
  CopyTradeTargetSource,
  EnumeratedTarget,
} from "@/features/copy-trade/target-source";

/** Stop handle returned by `startMirrorPoll`. Re-declared here to avoid the
 *  reconciler importing from the job shim (keeps module cohesion one-way). */
export type StopFn = () => void;

/** Factory that builds per-target dependencies (source, etc.) and starts the
 *  poll. The reconciler treats this as opaque — it receives the stop handle. */
export type StartPollForTarget = (target: EnumeratedTarget) => StopFn;

export interface CopyTradeReconcilerDeps {
  targetSource: Pick<CopyTradeTargetSource, "listAllActive">;
  startPollForTarget: StartPollForTarget;
  logger: LoggerPort;
  /** Tick cadence. Defaults to 30_000ms to match the per-target poll cadence. */
  intervalMs?: number;
  /** Injectable for tests. Defaults to the global `setInterval`/`clearInterval`. */
  timers?: {
    setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
    clearInterval: (h: ReturnType<typeof setInterval>) => void;
  };
}

/** Stop the reconciler — clears the interval and invokes every running
 *  target's stop handle. Idempotent. */
export type ReconcilerStopFn = () => void;

interface RunningPoll {
  stop: StopFn;
  fingerprint: string;
}

/** Key a running poll by `${billingAccountId}:${targetWallet.toLowerCase()}`. */
function keyFor(t: EnumeratedTarget): string {
  return `${t.billingAccountId}:${t.targetWallet.toLowerCase()}`;
}

function policyFingerprint(t: EnumeratedTarget): string {
  return [
    t.mirrorFilterPercentile,
    Number(t.mirrorMaxUsdcPerTrade).toFixed(2),
  ].join(":");
}

/**
 * Start the target-set reconciler. First tick fires immediately; thereafter
 * runs under `setInterval(intervalMs)`. Returns a stop handle.
 *
 * @public
 */
export function startCopyTradeReconciler(
  deps: CopyTradeReconcilerDeps
): ReconcilerStopFn {
  const intervalMs = deps.intervalMs ?? 30_000;
  const timers = deps.timers ?? {
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };
  const log = deps.logger.child({ component: "copy-trade-reconciler" });

  const running = new Map<string, RunningPoll>();
  let stopped = false;

  async function tick(): Promise<void> {
    let enumerated: readonly EnumeratedTarget[];
    try {
      enumerated = await deps.targetSource.listAllActive();
    } catch (err: unknown) {
      log.error(
        {
          event: EVENT_NAMES.POLY_MIRROR_TARGETS_RECONCILE_TICK_ERROR,
          errorCode: "list_failed",
          err: err instanceof Error ? err.message : String(err),
        },
        "reconciler tick: listAllActive threw (continuing)"
      );
      return;
    }

    const desired = new Map<string, EnumeratedTarget>();
    for (const t of enumerated) {
      desired.set(keyFor(t), t);
    }

    let added = 0;
    let removed = 0;

    // Stop polls for keys no longer in the desired set.
    for (const [key, poll] of running.entries()) {
      const desiredTarget = desired.get(key);
      if (
        desiredTarget === undefined ||
        poll.fingerprint !== policyFingerprint(desiredTarget)
      ) {
        try {
          poll.stop();
        } catch (err: unknown) {
          log.error(
            {
              event: EVENT_NAMES.POLY_MIRROR_TARGETS_RECONCILE_TICK_ERROR,
              errorCode: "stop_failed",
              key,
              err: err instanceof Error ? err.message : String(err),
            },
            "reconciler tick: stop handle threw (continuing)"
          );
        }
        running.delete(key);
        removed += 1;
      }
    }

    // Start polls for keys in desired but not running. If `startPollForTarget`
    // throws, log + skip — next tick retries.
    for (const [key, target] of desired.entries()) {
      if (running.has(key)) continue;
      try {
        const stop = deps.startPollForTarget(target);
        running.set(key, {
          stop,
          fingerprint: policyFingerprint(target),
        });
        added += 1;
      } catch (err: unknown) {
        log.error(
          {
            event: EVENT_NAMES.POLY_MIRROR_TARGETS_RECONCILE_TICK_ERROR,
            errorCode: "start_failed",
            key,
            err: err instanceof Error ? err.message : String(err),
          },
          "reconciler tick: start handle threw (continuing)"
        );
      }
    }

    log.info(
      {
        event: EVENT_NAMES.POLY_MIRROR_TARGETS_RECONCILE_TICK,
        active_targets: desired.size,
        added,
        removed,
        total_running: running.size,
      },
      "mirror targets reconciled"
    );
  }

  // FIRST_TICK_IMMEDIATE — don't wait 30s to pick up startup targets.
  void tick();

  const handle = timers.setInterval(() => {
    if (stopped) return;
    void tick();
  }, intervalMs);

  return function stop(): void {
    if (stopped) return;
    stopped = true;
    timers.clearInterval(handle);
    for (const [key, poll] of running.entries()) {
      try {
        poll.stop();
      } catch {
        // Best-effort cleanup; nothing to do beyond dropping the handle.
      }
      running.delete(key);
    }
    log.info(
      { event: EVENT_NAMES.POLY_MIRROR_TARGETS_RECONCILE_STOPPED },
      "mirror targets reconciler stopped"
    );
  };
}
