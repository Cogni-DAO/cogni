// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/copy-trade-mirror.job`
 * Purpose: Disposable 30s scheduler that drives `mirror-pipeline.runMirrorTick()`. Boot-guarded by per-tenant executor factory presence + a non-empty `CopyTradeTargetSource`. Uses `setInterval` (not `@cogni/scheduler-core` — that package is governance-schedule machinery, not a tick library). In-memory cursor + one-shot singleton claim. One poll instance per (tenant × target wallet) pair.
 * Scope: Wiring + cadence only. Does not build adapters (container injects), does not own decision logic, does not touch DB directly. One function: `startMirrorPoll(deps) → stop()`.
 * Invariants:
 *   - SCAFFOLDING_LABELED — this file and its wiring are `@scaffolding` / `Deleted-in-phase: 4`. P4's cutover PR deletes this file + the env-based target config.
 *   - SINGLE_WRITER — exactly one process runs the poll. Enforced by caller (POLY_ROLE=trader + replicas=1 is the joint invariant). Boot logs `event:poly.mirror.poll.singleton_claim` so a second pod running this code is Loki-visible.
 *   - TICK_IS_SELF_HEALING — the pipeline already swallows per-fill + per-source errors; the tick wrapper catches anything that escapes, logs, and keeps the interval going.
 *   - NO_CURSOR_PERSISTENCE_V0 — cursor lives in-memory and resets on boot. On startup the initial cursor is `Math.floor(now/1000) - WARMUP_BACKLOG_SEC` so we don't replay a target's months-deep history through `planMirrorFromFill()`.
 *   - CAPS_LIVE_IN_GRANT — daily / hourly USDC caps are enforced downstream by `authorizeIntent` inside the per-tenant `placeIntent` executor (see `bootstrap/capabilities/poly-trade-executor.ts`). Mirror-sizing here is notional only.
 * Side-effects: starts a `setInterval`, emits logs + metrics.
 * Links: work/items/task.0318 (Phase B3), docs/spec/poly-multi-tenant-auth.md
 *
 * @scaffolding
 * Deleted-in-phase: 4 (replaced by Temporal-hosted WS ingester workflow; see
 *   work/items/task.0322.poly-copy-trade-phase4-design-prep.md).
 *
 * @internal
 */

import { EVENT_NAMES } from "@cogni/node-shared";
import type {
  LoggerPort,
  MetricsPort,
  OrderReceipt,
} from "@cogni/poly-market-provider";
import {
  type MirrorPipelineDeps,
  type OperatorPosition,
  runMirrorTick,
} from "@/features/copy-trade/mirror-pipeline";
import { targetIdFromWallet } from "@/features/copy-trade/target-id";
import type { MirrorTargetConfig } from "@/features/copy-trade/types";
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
 * Hardcoded v0 scaffolding parameters for mirror sizing. Caps ($/day, fills/hr)
 * moved to the tenant's `poly_wallet_grants` row in Phase B3 and are enforced
 * by `authorizeIntent`.
 */
const MIRROR_POLL_MS = 30_000;
/**
 * Per-intent spend ceiling on the `min_bet` policy. The mirror bets the
 * market's `minUsdcNotional` (clamped to share-floor) up to this cap; markets
 * above it skip at `plan-mirror` with `below_market_min`. Sized at $5 because
 * top-volume Polymarket markets require 5 shares min, and 5 shares × max_price
 * (1.0) = $5 worst case. Should match the operator wallet's grant
 * `perOrderUsdcCap` so cap-exceed cases are not duplicated as
 * `placement_failed` decisions at the `authorizeIntent` boundary. bug.0342.
 */
const MIRROR_MAX_USDC_PER_TRADE = 5;

/**
 * Build a `MirrorTargetConfig` from an enumerated target wallet + tenant
 * attribution. All non-tenant fields stay hardcoded scaffolding. Daily /
 * hourly caps now live on the tenant's `poly_wallet_grants` row and are
 * enforced by `authorizeIntent`.
 *
 * @public
 */
export function buildMirrorTargetConfig(params: {
  targetWallet: `0x${string}`;
  billingAccountId: string;
  createdByUserId: string;
}): MirrorTargetConfig {
  return {
    target_id: targetIdFromWallet(params.targetWallet),
    target_wallet: params.targetWallet,
    billing_account_id: params.billingAccountId,
    created_by_user_id: params.createdByUserId,
    mode: "live", // paper adapter body lands in P3; v0 only places live
    sizing: {
      kind: "min_bet",
      max_usdc_per_trade: MIRROR_MAX_USDC_PER_TRADE,
    },
  };
}

export interface MirrorJobDeps {
  /** Target config — built via `buildMirrorTargetConfig`; Phase 4 reads from a tenant-aware table. */
  target: MirrorTargetConfig;
  /** Injected source (Data-API adapter) — P4 swaps in WS. */
  source: WalletActivitySource;
  /** Order ledger (Drizzle-backed in prod, FakeOrderLedger in tests). */
  ledger: OrderLedger;
  /**
   * Tenant-scoped placement seam. Delegates to the per-tenant
   * `PolyTradeExecutor.placeIntent`, which wraps `authorizeIntent` + adapter
   * `placeOrder`. Must be constructed against `params.billingAccountId`.
   */
  placeIntent: MirrorPipelineDeps["placeIntent"];
  /** Optional market-constraints fetch; pipes into the pipeline. bug.0342. */
  getMarketConstraints?: MirrorPipelineDeps["getMarketConstraints"];
  /** Structured log sink. */
  logger: LoggerPort;
  /** Metrics sink. */
  metrics: MetricsPort;
  /**
   * Optional SELL-to-close path from `PolyTradeExecutor.closePosition`.
   * When absent, SELL fills degrade to `skip/sell_without_position`.
   */
  closePosition?: (params: {
    tokenId: string;
    max_size_usdc: number;
    limit_price: number;
    client_order_id: `0x${string}`;
  }) => Promise<OrderReceipt>;
  /**
   * Optional position query from `PolyTradeExecutor.listPositions`.
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
    billing_account_id: deps.target.billing_account_id,
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

  const pipelineDeps: MirrorPipelineDeps = {
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
      await runMirrorTick(pipelineDeps);
      deps.metrics.incr(MIRROR_JOB_METRICS.pollTicksTotal, {});
    } catch (err: unknown) {
      // Belt-and-suspenders: the pipeline already catches per-fill errors
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
