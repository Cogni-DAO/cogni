// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/copy-trade-mirror.job`
 * Purpose: Disposable 30s scheduler that drives `mirror-coordinator.runOnce()`. Boot-guarded by `POLY_ROLE === "trader"` + bundle/target presence. Uses `setInterval` (not `@cogni/scheduler-core` — that package is governance-schedule machinery, not a tick library). In-memory cursor + one-shot singleton claim.
 * Scope: Wiring + cadence only. Does not build adapters (container injects), does not own decision logic, does not touch DB directly. One function: `startMirrorPoll(deps) → stop()`.
 * Invariants:
 *   - SCAFFOLDING_LABELED — this file and its wiring are `@scaffolding` / `Deleted-in-phase: 4`. P4's cutover PR deletes this file + the env-based target config.
 *   - SINGLE_WRITER — exactly one process runs the poll. Enforced by caller (POLY_ROLE=trader + replicas=1 is the joint invariant). Boot logs `event:poly.mirror.poll.singleton_claim` so a second pod running this code is Loki-visible.
 *   - TICK_IS_SELF_HEALING — the coordinator already swallows per-fill + per-source errors; the tick wrapper catches anything that escapes, logs, and keeps the interval going.
 *   - NO_CURSOR_PERSISTENCE_V0 — cursor lives in-memory and resets on boot. On startup the initial cursor is `Math.floor(now/1000) - WARMUP_BACKLOG_SEC` so we don't replay a target's months-deep history through `decide()`.
 * Side-effects: starts a `setInterval`, emits logs + metrics.
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (CP4.3e), docs/spec/poly-copy-trade-phase1.md
 *
 * @scaffolding
 * Deleted-in-phase: 4 (replaced by Temporal-hosted WS ingester workflow; see
 *   work/items/task.0322.poly-copy-trade-phase4-design-prep.md).
 *
 * @internal
 */

import type { LoggerPort, MetricsPort } from "@cogni/market-provider";
import {
  type MirrorCoordinatorDeps,
  runOnce,
} from "@/features/copy-trade/mirror-coordinator";
import type { TargetConfig } from "@/features/copy-trade/types";
import type { OrderLedger } from "@/features/trading";
import type { WalletActivitySource } from "@/features/wallet-watch";

export const MIRROR_JOB_METRICS = {
  /** `poly_mirror_poll_ticks_total` — one per successful tick. Alertable on rate from >1 pod (SINGLE_WRITER canary). */
  pollTicksTotal: "poly_mirror_poll_ticks_total",
  /** `poly_mirror_poll_tick_errors_total` — tick wrapper catches an escape. */
  pollTickErrorsTotal: "poly_mirror_poll_tick_errors_total",
} as const;

/** How far back to initialize the first-tick cursor (seconds). */
const WARMUP_BACKLOG_SEC = 60;

export interface MirrorJobDeps {
  /** Target config — P1 builds from env; P2 reads from DB. */
  target: TargetConfig;
  /** Injected source (Data-API adapter) — P4 swaps in WS. */
  source: WalletActivitySource;
  /** Order ledger (Drizzle-backed in prod, FakeOrderLedger in tests). */
  ledger: OrderLedger;
  /** Raw placement seam from `createPolyTradeCapability().placeIntent`. */
  placeIntent: MirrorCoordinatorDeps["placeIntent"];
  /** Poll cadence (ms). Default 30_000. */
  pollMs?: number;
  /** Structured log sink. */
  logger: LoggerPort;
  /** Metrics sink. */
  metrics: MetricsPort;
}

/** Stops the poll. Returned so the container can call on SIGTERM (future). */
export type MirrorJobStopFn = () => void;

/**
 * Start the 30s mirror poll. Emits `poly.mirror.poll.singleton_claim` at
 * boot (ops alerts on absence or on duplicate rate). Returns a stop fn.
 *
 * @public
 */
export function startMirrorPoll(deps: MirrorJobDeps): MirrorJobStopFn {
  const log = deps.logger.child({
    component: "mirror-job",
    target_id: deps.target.target_id,
    target_wallet: deps.target.target_wallet,
    mode: deps.target.mode,
  });

  const pollMs = deps.pollMs ?? 30_000;

  // First-tick cursor — avoid replaying a target's historical activity at boot.
  let cursor: number | undefined =
    Math.floor(Date.now() / 1000) - WARMUP_BACKLOG_SEC;

  log.info(
    {
      event: "poly.mirror.poll.singleton_claim",
      poll_ms: pollMs,
      initial_cursor: cursor,
      warmup_backlog_sec: WARMUP_BACKLOG_SEC,
    },
    "mirror poll starting (SINGLE_WRITER — alert on duplicate pods running this)"
  );

  const coordinatorDeps: MirrorCoordinatorDeps = {
    source: deps.source,
    ledger: deps.ledger,
    placeIntent: deps.placeIntent,
    target: deps.target,
    getCursor: () => cursor,
    setCursor: (n) => {
      cursor = n;
    },
    logger: deps.logger,
    metrics: deps.metrics,
  };

  async function tick(): Promise<void> {
    try {
      await runOnce(coordinatorDeps);
      deps.metrics.incr(MIRROR_JOB_METRICS.pollTicksTotal, {});
    } catch (err: unknown) {
      // Belt-and-suspenders: the coordinator already catches per-fill errors
      // + source errors. Anything that escapes to here is a real bug, not
      // operational data. Log + counter + keep the interval going.
      deps.metrics.incr(MIRROR_JOB_METRICS.pollTickErrorsTotal, {});
      log.error(
        {
          event: "poly.mirror.poll.tick_error",
          err: err instanceof Error ? err.message : String(err),
        },
        "mirror poll: tick threw (continuing)"
      );
    }
  }

  // First tick fires immediately so ops sees activity without waiting 30s.
  // `void` keeps the promise from leaking back into the event loop error flow.
  void tick();

  const handle = setInterval(() => {
    void tick();
  }, pollMs);

  return function stop() {
    clearInterval(handle);
    log.info({ event: "poly.mirror.poll.stopped" }, "mirror poll stopped");
  };
}

/**
 * Derive a stable synthetic `target_id` (UUIDv5 shape) from the target wallet.
 * v0 single-tenant: one wallet ⇒ one id, deterministic across restarts so
 * `client_order_id = clientOrderIdFor(target_id, fill_id)` stays stable.
 *
 * Implementation: SHA-1 over the wallet address, format as UUIDv5. Avoids
 * adding a `uuid` runtime dep for a 6-line function. TODO(P2): replace with
 * a real `poly_copy_trade_targets.id` FK once the table exists.
 *
 * @public
 */
export function targetIdFromWallet(wallet: `0x${string}`): string {
  // UUIDv5 spec: RFC 4122 §4.3, namespace DNS = 6ba7b810-9dad-11d1-80b4-00c04fd430c8.
  // Implemented inline (single callsite, trivial) rather than pulling `uuid`.
  const nsBytes = [
    0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0,
    0x4f, 0xd4, 0x30, 0xc8,
  ];
  // Deterministic hash input: namespace bytes + wallet bytes.
  const walletBytes = Buffer.from(wallet.slice(2).toLowerCase(), "hex");
  const input = Buffer.concat([Buffer.from(nsBytes), walletBytes]);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  const hash = createHash("sha1").update(input).digest();
  // Set version (5) and variant (RFC 4122) per UUIDv5 spec.
  const bytes = hash.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
