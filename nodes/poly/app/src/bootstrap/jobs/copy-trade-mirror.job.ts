// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/copy-trade-mirror.job`
 * Purpose: Disposable 30s scheduler that drives `mirror-coordinator.runOnce()`. Boot-guarded by Polymarket-capability-bundle presence + a non-empty `CopyTradeTargetSource`. Uses `setInterval` (not `@cogni/scheduler-core` — that package is governance-schedule machinery, not a tick library). In-memory cursor + one-shot singleton claim. One poll instance per target wallet.
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

import type {
  LoggerPort,
  MetricsPort,
  OrderReceipt,
} from "@cogni/market-provider";
import { EVENT_NAMES } from "@cogni/node-shared";
import {
  type MirrorCoordinatorDeps,
  type OperatorPosition,
  runOnce,
} from "@/features/copy-trade/mirror-coordinator";
import { targetIdFromWallet } from "@/features/copy-trade/target-id";
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

/**
 * Hardcoded v0 scaffolding parameters. For a single-operator hardcoded
 * prototype, env-knobs-per-value buys nothing. Change the number in code,
 * redeploy. Deleted-in-phase: 4 alongside the rest of this file.
 *
 * Reasoning:
 * - 30s poll cadence = conservative for copy-trade latency goals; Phase 4
 *   moves to a WS push model and these numbers become irrelevant.
 * - $1 mirror, $10/day, 5/hour = matches the Phase 1 E2E validation scenario
 *   + keeps a misbehaving target from bankrupting the operator prototype.
 */
const MIRROR_POLL_MS = 30_000;
const MIRROR_USDC = 1;
/**
 * Per-intent spend ceiling. The mirror will scale a $1 desired bet UP to the
 * market's share-minimum (in USDC terms) only when the scaled notional still
 * fits under this ceiling; otherwise it skips with `below_market_min`. Sized
 * at $5 because top-volume Polymarket markets require 5 shares min, and 5
 * shares × max_price (1.0) = $5 worst case. bug.0342. Phase-B surfaces this
 * as a per-tenant column.
 */
const MIRROR_MAX_USDC_PER_TRADE = 5;
const MIRROR_MAX_DAILY_USDC = 10;
const MIRROR_MAX_FILLS_PER_HOUR = 5;

/**
 * Build a `TargetConfig` from an enumerated target wallet + tenant attribution.
 * All non-tenant fields (mode, mirror_usdc, caps) stay hardcoded scaffolding.
 * Phase B will source caps from the per-tenant `poly_wallet_grants` row.
 *
 * @public
 */
export function buildMirrorTargetConfig(params: {
  targetWallet: `0x${string}`;
  billingAccountId: string;
  createdByUserId: string;
}): TargetConfig {
  return {
    target_id: targetIdFromWallet(params.targetWallet),
    target_wallet: params.targetWallet,
    billing_account_id: params.billingAccountId,
    created_by_user_id: params.createdByUserId,
    mode: "live", // paper adapter body lands in P3; v0 only places live
    sizing: {
      kind: "fixed",
      mirror_usdc: MIRROR_USDC,
      max_usdc_per_trade: MIRROR_MAX_USDC_PER_TRADE,
    },
    max_daily_usdc: MIRROR_MAX_DAILY_USDC,
    max_fills_per_hour: MIRROR_MAX_FILLS_PER_HOUR,
    enabled: true, // overwritten per-tick by the runtime kill-switch snapshot
  };
}

export interface MirrorJobDeps {
  /** Target config — P1 builds via `buildMirrorTargetConfig`; P2 reads from DB. */
  target: TargetConfig;
  /** Injected source (Data-API adapter) — P4 swaps in WS. */
  source: WalletActivitySource;
  /** Order ledger (Drizzle-backed in prod, FakeOrderLedger in tests). */
  ledger: OrderLedger;
  /** Raw placement seam from `createPolyTradeCapability().placeIntent`. */
  placeIntent: MirrorCoordinatorDeps["placeIntent"];
  /** Optional market-constraints fetch; pipes into the coordinator. bug.0342. */
  getMarketConstraints?: MirrorCoordinatorDeps["getMarketConstraints"];
  /** Structured log sink. */
  logger: LoggerPort;
  /** Metrics sink. */
  metrics: MetricsPort;
  /**
   * Optional SELL-to-close path from `PolyTradeBundle.closePosition`.
   * When absent, SELL fills degrade to `skip/sell_without_position`.
   */
  closePosition?: (params: {
    tokenId: string;
    max_size_usdc: number;
    limit_price: number;
    client_order_id: `0x${string}`;
  }) => Promise<OrderReceipt>;
  /**
   * Optional position query from `PolyTradeBundle.getOperatorPositions`.
   * When absent, SELL fills degrade to `skip/sell_without_position`.
   */
  getOperatorPositions?: () => Promise<OperatorPosition[]>;
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

  // First-tick cursor — avoid replaying a target's historical activity at boot.
  let cursor: number | undefined =
    Math.floor(Date.now() / 1000) - WARMUP_BACKLOG_SEC;

  log.info(
    {
      event: EVENT_NAMES.POLY_MIRROR_POLL_SINGLETON_CLAIM,
      poll_ms: MIRROR_POLL_MS,
      initial_cursor: cursor,
      warmup_backlog_sec: WARMUP_BACKLOG_SEC,
    },
    "mirror poll starting (SINGLE_WRITER — alert on duplicate pods running this)"
  );

  const coordinatorDeps: MirrorCoordinatorDeps = {
    source: deps.source,
    ledger: deps.ledger,
    placeIntent: deps.placeIntent,
    getMarketConstraints: deps.getMarketConstraints,
    target: deps.target,
    getCursor: () => cursor,
    setCursor: (n) => {
      cursor = n;
    },
    logger: deps.logger,
    metrics: deps.metrics,
    // exactOptionalPropertyTypes: only spread when defined to avoid
    // assigning `undefined` to a property typed as `T` (not `T | undefined`).
    ...(deps.closePosition !== undefined
      ? { closePosition: deps.closePosition }
      : {}),
    ...(deps.getOperatorPositions !== undefined
      ? { getOperatorPositions: deps.getOperatorPositions }
      : {}),
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
          event: EVENT_NAMES.POLY_MIRROR_POLL_TICK_ERROR,
          errorCode: "tick_escaped_handler",
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
  }, MIRROR_POLL_MS);

  return function stop() {
    clearInterval(handle);
    log.info(
      { event: EVENT_NAMES.POLY_MIRROR_POLL_STOPPED },
      "mirror poll stopped"
    );
  };
}

// `targetIdFromWallet` moved to `@/features/copy-trade/target-id` so the env
// `CopyTradeTargetSource` impl can synthesize stable per-wallet ids without
// crossing the features → bootstrap layer boundary. Re-exported here for
// pre-existing import sites.
export { targetIdFromWallet };
