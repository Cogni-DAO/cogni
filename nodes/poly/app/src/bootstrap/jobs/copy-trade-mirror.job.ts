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
import type {
  MirrorTargetConfig,
  PositionFollowupPolicy,
  SizingPolicy,
  TargetConditionPositionView,
  WalletSizeStatistic,
} from "@/features/copy-trade/types";
import type { OrderLedger } from "@/features/trading";
import type { WalletActivitySource } from "@/features/wallet-watch";
import { EVENT_NAMES } from "@/shared/observability/events";

export const MIRROR_JOB_METRICS = {
  /** `poly_mirror_poll_ticks_total` — one per successful tick. Alertable on rate from >1 pod (SINGLE_WRITER canary). */
  pollTicksTotal: "poly_mirror_poll_ticks_total",
  /** `poly_mirror_poll_tick_errors_total` — tick wrapper catches an escape. */
  pollTickErrorsTotal: "poly_mirror_poll_tick_errors_total",
  /** `poly_mirror_ws_wake_ticks_total` — wake-driven tick fired (push-on-wake path). Push runs in addition to the safety-net `setInterval`. Use `rate(...)` to confirm push is producing signal in prod. */
  wsWakeTicksTotal: "poly_mirror_ws_wake_ticks_total",
  /** `poly_mirror_ws_wake_tick_errors_total` — wake IIFE wrapper caught an escape (paranoia counter; `tick()` already swallows). */
  wsWakeTickErrorsTotal: "poly_mirror_ws_wake_tick_errors_total",
} as const;

/** How far back to initialize the first-tick cursor (seconds). */
const WARMUP_BACKLOG_SEC = 60;

/**
 * Hardcoded v0 scaffolding parameters for mirror sizing. Caps ($/day, fills/hr)
 * moved to the tenant's `poly_wallet_grants` row in Phase B3 and are enforced
 * by `authorizeIntent`.
 */
const MIRROR_POLL_MS = 30_000;
const DEFAULT_MIRROR_MAX_USDC_PER_TRADE = 5;
const DEFAULT_CONVICTION_FILTER_PERCENTILE = 75;
const DEFAULT_POSITION_FOLLOWUP_POLICY: PositionFollowupPolicy = {
  enabled: true,
  min_mirror_position_usdc: 5,
  market_floor_multiple: 5,
  min_target_hedge_ratio: 0.02,
  min_target_hedge_usdc: 5,
  max_hedge_fraction_of_position: 0.25,
  max_layer_fraction_of_position: 0.5,
};
const RN1_WALLET = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea";
const SWISSTONY_WALLET = "0x204f72f35326db932158cba6adff0b9a1da95e14";

interface WalletSizeSnapshot {
  wallet: `0x${string}`;
  label: string;
  captured_at: string;
  sample_size: number;
  percentiles: Record<number, number>;
}

const TOP_TARGET_SIZE_SNAPSHOTS: Record<string, WalletSizeSnapshot> = {
  [RN1_WALLET]: {
    wallet: RN1_WALLET,
    label: "RN1",
    captured_at: "2026-05-03T02:34:00Z",
    sample_size: 3990,
    percentiles: {
      50: 40,
      75: 200,
      90: 733,
      95: 1811,
      99: 5659,
    },
  },
  [SWISSTONY_WALLET]: {
    wallet: SWISSTONY_WALLET,
    label: "swisstony",
    captured_at: "2026-05-03T02:34:00Z",
    sample_size: 1085,
    percentiles: {
      50: 31,
      75: 146,
      90: 665,
      95: 1394,
      99: 4809,
    },
  },
};

function interpolatePercentile(
  percentiles: Record<number, number>,
  percentile: number
): number {
  const points = Object.keys(percentiles)
    .map(Number)
    .sort((a, b) => a - b);
  const exact = percentiles[percentile];
  if (exact !== undefined) return exact;
  const lower = [...points].reverse().find((p) => p < percentile);
  const upper = points.find((p) => p > percentile);
  if (lower === undefined) {
    const minPoint = points[0];
    if (minPoint === undefined) {
      throw new Error("percentile snapshot is empty");
    }
    return percentiles[minPoint] ?? 0;
  }
  if (upper === undefined) {
    const maxPoint = points.at(-1);
    if (maxPoint === undefined) {
      throw new Error("percentile snapshot is empty");
    }
    return percentiles[maxPoint] ?? 0;
  }
  const lowerValue = percentiles[lower];
  const upperValue = percentiles[upper];
  if (lowerValue === undefined || upperValue === undefined) {
    throw new Error("percentile snapshot is sparse");
  }
  const t = (percentile - lower) / (upper - lower);
  return Number((lowerValue + (upperValue - lowerValue) * t).toFixed(2));
}

function buildWalletStatistic(
  snapshot: WalletSizeSnapshot,
  percentile: number
): WalletSizeStatistic {
  const maxTargetUsdc = snapshot.percentiles[99];
  if (maxTargetUsdc === undefined) {
    throw new Error(`missing p99 for ${snapshot.wallet}`);
  }
  return {
    wallet: snapshot.wallet,
    label: snapshot.label,
    captured_at: snapshot.captured_at,
    sample_size: snapshot.sample_size,
    percentile,
    min_target_usdc: interpolatePercentile(snapshot.percentiles, percentile),
    max_target_usdc: maxTargetUsdc,
  };
}

function buildSizingPolicy(params: {
  targetWallet: `0x${string}`;
  mirrorFilterPercentile: number;
  mirrorMaxUsdcPerTrade: number;
}): SizingPolicy {
  const snapshot = snapshotForTargetWallet(params.targetWallet);
  if (!snapshot) {
    return {
      kind: "min_bet",
      max_usdc_per_trade: params.mirrorMaxUsdcPerTrade,
    };
  }
  return {
    kind: "target_percentile_scaled",
    max_usdc_per_trade: params.mirrorMaxUsdcPerTrade,
    statistic: buildWalletStatistic(snapshot, params.mirrorFilterPercentile),
  };
}

function snapshotForTargetWallet(
  targetWallet: `0x${string}`
): WalletSizeSnapshot | undefined {
  return TOP_TARGET_SIZE_SNAPSHOTS[targetWallet.toLowerCase()];
}

export function sizingPolicyKindForTargetWallet(
  targetWallet: `0x${string}`
): "min_bet" | "target_percentile_scaled" {
  return snapshotForTargetWallet(targetWallet)
    ? "target_percentile_scaled"
    : "min_bet";
}

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
  mirrorFilterPercentile?: number;
  mirrorMaxUsdcPerTrade?: number;
}): MirrorTargetConfig {
  const mirrorFilterPercentile =
    params.mirrorFilterPercentile ?? DEFAULT_CONVICTION_FILTER_PERCENTILE;
  const mirrorMaxUsdcPerTrade =
    params.mirrorMaxUsdcPerTrade ?? DEFAULT_MIRROR_MAX_USDC_PER_TRADE;
  return {
    target_id: targetIdFromWallet(params.targetWallet),
    target_wallet: params.targetWallet,
    billing_account_id: params.billingAccountId,
    created_by_user_id: params.createdByUserId,
    mode: "live", // paper adapter body lands in P3; v0 only places live
    sizing: buildSizingPolicy({
      targetWallet: params.targetWallet,
      mirrorFilterPercentile,
      mirrorMaxUsdcPerTrade,
    }),
    // task.5001 — default to mirror_limit (resting GTC at target's entry).
    // Persistence to a per-target column is deferred to task.0347.
    placement: { kind: "mirror_limit" },
    ...(snapshotForTargetWallet(params.targetWallet) !== undefined
      ? { position_followup: DEFAULT_POSITION_FOLLOWUP_POLICY }
      : {}),
  };
}

export function targetConditionPositionFromDataApiPositions(
  conditionId: string,
  positions: Array<{
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    initialValue: number;
    currentValue: number;
  }>
): TargetConditionPositionView {
  return {
    condition_id: conditionId,
    tokens: positions
      .filter((position) => position.conditionId === conditionId)
      .map((position) => ({
        token_id: position.asset,
        size_shares: Math.max(0, position.size),
        cost_usdc: positionCostUsdc(position),
        current_value_usdc: Math.max(0, position.currentValue),
      })),
  };
}

function positionCostUsdc(position: {
  size: number;
  avgPrice: number;
  initialValue: number;
}): number {
  if (Number.isFinite(position.initialValue) && position.initialValue > 0) {
    return position.initialValue;
  }
  if (Number.isFinite(position.size) && Number.isFinite(position.avgPrice)) {
    return Math.max(0, position.size * position.avgPrice);
  }
  return 0;
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
  /**
   * Tenant-scoped cancel seam (task.5001). Delegates to
   * `PolyTradeExecutor.cancelOrder` → 404-idempotent
   * `PolymarketClobAdapter.cancelOrder`. Optional in tests; production wiring
   * always sets it so SELL fills cancel resting mirror BUYs.
   */
  cancelOrder?: MirrorPipelineDeps["cancelOrder"];
  /** Optional market-constraints fetch; pipes into the pipeline. bug.0342. */
  getMarketConstraints?: MirrorPipelineDeps["getMarketConstraints"];
  /** Optional target-position read; v0 production uses Polymarket Data API. */
  getTargetConditionPosition?: MirrorPipelineDeps["getTargetConditionPosition"];
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
    ...(deps.cancelOrder !== undefined
      ? { cancelOrder: deps.cancelOrder }
      : {}),
    getMarketConstraints: deps.getMarketConstraints,
    getTargetConditionPosition: deps.getTargetConditionPosition,
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

  // Push-on-wake: when the source supports `subscribeWake`, a watched-asset WS
  // frame fires the registered callback synchronously. We collapse fan-in with
  // a single-flight runner — at most one wake-tick in flight, plus at most one
  // queued follow-up — so a burst of frames coalesces into ≤2 ticks. The 30s
  // `setInterval` below is the safety-net for new-market discovery and zombie
  // WS recovery; it stays untouched. Push path is purely additive.
  let inFlightWakeTick: Promise<void> | null = null;
  let queuedWakeup = false;
  let unsubscribeWake: (() => void) | null = null;

  if (deps.source.subscribeWake) {
    unsubscribeWake = deps.source.subscribeWake(() => {
      if (inFlightWakeTick) {
        queuedWakeup = true;
        return;
      }
      inFlightWakeTick = (async () => {
        do {
          queuedWakeup = false;
          const t0 = Date.now();
          let threw = false;
          try {
            await tick();
          } catch (err: unknown) {
            // `tick()` already swallows everything; this is paranoia for a
            // future refactor that lets something escape.
            threw = true;
            deps.metrics.incr(MIRROR_JOB_METRICS.wsWakeTickErrorsTotal, {});
            log.error(
              {
                event: EVENT_NAMES.POLY_MIRROR_POLL_TICK_ERROR,
                errorCode: "wake_tick_threw",
                err: err instanceof Error ? err.message : String(err),
              },
              "push-on-wake tick threw (continuing)"
            );
          }
          if (!threw) {
            deps.metrics.incr(MIRROR_JOB_METRICS.wsWakeTicksTotal, {});
          }
          log.debug(
            {
              event: EVENT_NAMES.POLY_MIRROR_WAKE_TICK,
              duration_ms: Date.now() - t0,
              queued: queuedWakeup,
              threw,
            },
            "wake tick complete"
          );
        } while (queuedWakeup);
        inFlightWakeTick = null;
      })();
    });
  }

  const handle = setInterval(() => {
    void tick();
  }, MIRROR_POLL_MS);

  return function stop() {
    unsubscribeWake?.();
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
