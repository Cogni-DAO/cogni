// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/mirror-pipeline`
 * Purpose: Thin pipeline that glues `features/wallet-watch/` → `planMirrorFromFill()` → `features/trading/`. Pure `runMirrorTick(deps)` — no `setInterval`, no env reads, no DB client construction. The ONLY file in the feature layer that imports from both sibling slices.
 * Scope: Sequencing + INSERT_BEFORE_PLACE enforcement. Does not own cadence (bootstrap job), does not own cursor persistence (deps supply `getCursor`/`setCursor`), does not construct adapters.
 * Invariants:
 *   - COPY_TRADE_ONLY_PIPES — the pipeline is the only slice file that imports both `trading/` and `wallet-watch/`.
 *   - INSERT_BEFORE_PLACE — `order-ledger.insertPending` runs BEFORE the placeIntent executor. `markOrderId` / `markError` run AFTER. Crash between insert and place leaves a pending row whose `client_order_id` will be in the next tick's `already_placed_ids`, so `planMirrorFromFill()` returns `skip/already_placed`.
 *   - IDEMPOTENT_BY_CLIENT_ID — `client_order_id = clientOrderIdFor(target.target_id, fill.fill_id)`, pinned helper. Deterministic from the PK pair so re-runs dedupe.
 *   - RECORD_EVERY_DECISION — `order-ledger.recordDecision` fires for EVERY planMirrorFromFill() outcome (placed, skipped, or error). Supports divergence analysis without the fills ledger.
 *   - DECISIONS_TOTAL_HAS_SOURCE — `poly_mirror_decisions_total{outcome, reason, source, placement}` always carries `source` (v0 = `"data-api"`) AND `placement` (`"limit"` | `"market_fok"`).
 *   - TENANT_INHERITED_FROM_TARGET — every `insertPending` and `recordDecision` writes `(billing_account_id, created_by_user_id)` taken from `deps.target` (`MirrorTargetConfig`). The pipeline never reads tenant from anywhere else.
 *   - CAPS_LIVE_IN_GRANT — daily / hourly caps are enforced by `authorizeIntent` inside the per-tenant `placeIntent` executor, not here.
 *   - ALREADY_RESTING_BEFORE_INSERT — BUY path runs `ledger.hasOpenForMarket` BEFORE `insertPending`. The DB partial unique index is the correctness backstop: a 23505 throws `AlreadyRestingError` which converts to the same `skip/already_resting` outcome. task.5001.
 *   - MIRROR_BUY_CANCELED_ON_TARGET_SELL — every SELL fill cancels open mirror orders on `(target, market)` BEFORE the position-close path. `cancelOrder` is optional in tests; production wiring always sets it. Pending rows (no `order_id`) are silently skipped — race with in-flight placement is acceptable for v0. task.5001.
 * Side-effects: delegated — DB I/O via `OrderLedger`, HTTP via `WalletActivitySource`, Polymarket CLOB via `placeIntent`/`cancelOrder`. Pipeline itself is pure sequencing + logger/metrics calls.
 * Links: work/items/task.0318 (Phase B3), work/items/task.5001, docs/spec/poly-copy-trade-phase1.md, docs/spec/poly-multi-tenant-auth.md
 * @public
 */

import { EVENT_NAMES } from "@cogni/node-shared";
import {
  clientOrderIdFor,
  type LoggerPort,
  type MetricsPort,
  type OrderIntent,
  type OrderReceipt,
} from "@cogni/poly-market-provider";

import {
  AlreadyRestingError,
  type OrderLedger,
  PositionCapReachedError,
} from "@/features/trading";
import type { WalletActivitySource } from "@/features/wallet-watch";

import { planMirrorFromFill } from "./plan-mirror";
import type {
  MirrorPositionView,
  MirrorReason,
  MirrorTargetConfig,
  PositionBranch,
  SizingPolicy,
  TargetConditionPositionView,
} from "./types";
import { aggregatePositionRows } from "./types";

type PlacementWire = "limit" | "market_fok";

/**
 * Representative per-intent USDC ceiling for a sizing policy. Used by SELL-close
 * caps and audit-log skip blobs. Per-fill size is computed in `plan-mirror`.
 */
function nominalSizeUsdc(sizing: SizingPolicy): number {
  return sizing.max_usdc_per_trade;
}

/** Minimal position shape needed by the pipeline — subset of PolymarketUserPosition. */
export interface OperatorPosition {
  asset: string;
  size: number;
}

/** Metric names emitted by the pipeline. */
export const MIRROR_PIPELINE_METRICS = {
  /** `poly_mirror_decisions_total{outcome, reason, source, placement}` — always fired, bounded labels. */
  decisionsTotal: "poly_mirror_decisions_total",
  /** `poly_mirror_placement_errors_total` — `placeIntent` throw after pending insert. */
  placementErrorsTotal: "poly_mirror_placement_errors_total",
} as const;

/** `Fill.source` values that land in `decisions_total{source}`. */
export type DecisionSource = "data-api" | "clob-ws";

export interface MirrorPipelineDeps {
  /** Fill source — v0 is the Polymarket Data-API adapter. */
  source: WalletActivitySource;
  /** Order ledger — reads state + writes pending/mark/decision rows. */
  ledger: OrderLedger;
  /**
   * Tenant-scoped placement seam. Delegates to the per-tenant
   * `PolyTradeExecutor.placeIntent`, which wraps `authorizeIntent` +
   * `PolymarketClobAdapter.placeOrder`. Must be constructed against
   * `deps.target.billing_account_id` by the caller.
   */
  placeIntent: (intent: OrderIntent) => Promise<OrderReceipt>;
  /**
   * Tenant-scoped cancel seam (task.5001). Delegates to
   * `PolyTradeExecutor.cancelOrder` → `PolymarketClobAdapter.cancelOrder`,
   * which is 404-idempotent (CANCEL_404_SWALLOWED_IN_ADAPTER). Used by the
   * SELL cancel pre-step when the target exits a market we still have a
   * resting BUY on. CANCEL_GOES_THROUGH_TENANT_EXECUTOR.
   *
   * Optional with a no-op fallback for tests that don't exercise the SELL
   * cancel pre-step. Production bootstrap (`copy-trade-mirror.job` →
   * `container.ts`) always wires it.
   */
  cancelOrder?: (order_id: string) => Promise<void>;
  /**
   * Market-constraint fetch seam — returns `{ minShares }` for a token id so
   * the sizing policy can avoid sub-min submissions (bug.0342). Optional.
   */
  getMarketConstraints?:
    | ((tokenId: string) => Promise<{
        minShares: number;
        minUsdcNotional?: number;
        tickSize?: number;
      }>)
    | undefined;
  /**
   * Optional target-position read seam. v0 production wiring uses Polymarket
   * Data API `/positions?user=<target>&market=<condition>&sizeThreshold=0`.
   * Planner remains pure; future Postgres-backed target activity can implement
   * this same shape.
   */
  getTargetConditionPosition?:
    | ((params: {
        targetWallet: string;
        conditionId: string;
      }) => Promise<TargetConditionPositionView | undefined>)
    | undefined;
  /** Per-target config. */
  target: MirrorTargetConfig;
  /** Cursor accessor — bootstrap closures hold the in-memory state. */
  getCursor: () => number | undefined;
  /** Cursor writeback — called once per tick with the `newSince` from the source. */
  setCursor: (since: number) => void;
  /** Structured log sink (pino-compatible). */
  logger: LoggerPort;
  /** Metrics sink. */
  metrics: MetricsPort;
  /** Clock injection — tests pin `Date`. Default = real `Date`. */
  clock?: () => Date;
  /**
   * Optional — SELL-to-close path. Routes through the per-tenant executor's
   * `closePosition` which authorizes + caps + signs. When absent, SELL fills
   * degrade to `skip/sell_without_position` (never open a short).
   */
  closePosition?: (params: {
    tokenId: string;
    max_size_usdc: number;
    limit_price: number;
    client_order_id: `0x${string}`;
  }) => Promise<OrderReceipt>;
  /**
   * Optional — position query used by the SELL branch. Per-tenant.
   * When absent (or no `closePosition`), SELL fills degrade to
   * `skip/sell_without_position`.
   */
  getOperatorPositions?: () => Promise<OperatorPosition[]>;
}

/**
 * One pipeline tick. Fully sequential — no concurrency across fills inside
 * one tick, so `planMirrorFromFill()`'s `already_placed_ids` snapshot stays
 * consistent.
 *
 * @public
 */
export async function runMirrorTick(deps: MirrorPipelineDeps): Promise<void> {
  const clock = deps.clock ?? (() => new Date());
  const log = deps.logger.child({
    component: "mirror-pipeline",
    target_id: deps.target.target_id,
    target_wallet: deps.target.target_wallet,
  });

  const cursor = deps.getCursor();

  let result: {
    fills: import("@cogni/poly-market-provider").Fill[];
    newSince: number;
  };
  try {
    result = await deps.source.fetchSince(cursor);
  } catch (err: unknown) {
    log.warn(
      {
        event: EVENT_NAMES.POLY_MIRROR_SOURCE_ERROR,
        errorCode: "source_fetch_failed",
        cursor,
        err: err instanceof Error ? err.message : String(err),
      },
      "mirror pipeline: source fetch failed; skipping tick"
    );
    return;
  }

  deps.setCursor(result.newSince);

  for (const fill of result.fills) {
    await processFill(fill, deps, clock, log);
  }
}

async function processFill(
  fill: import("@cogni/poly-market-provider").Fill,
  deps: MirrorPipelineDeps,
  clock: () => Date,
  log: LoggerPort
): Promise<void> {
  const client_order_id = clientOrderIdFor(deps.target.target_id, fill.fill_id);
  const placement: PlacementWire =
    deps.target.placement.kind === "mirror_limit" ? "limit" : "market_fok";

  const snapshot = await deps.ledger.snapshotState(
    deps.target.target_id,
    deps.target.billing_account_id
  );

  const source: DecisionSource = fill.source as DecisionSource;
  const decisionBase = {
    target_id: deps.target.target_id,
    fill_id: fill.fill_id,
    billing_account_id: deps.target.billing_account_id,
    created_by_user_id: deps.target.created_by_user_id,
    decided_at: clock(),
  };

  if (fill.side === "SELL") {
    await processSellFill({
      fill,
      deps,
      client_order_id,
      placement,
      source,
      decisionBase,
      log,
    });
    return;
  }

  let min_shares: number | undefined;
  let min_usdc_notional: number | undefined;
  let tick_size: number | undefined;
  if (deps.getMarketConstraints) {
    const tokenId =
      typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";
    if (tokenId) {
      try {
        const constraints = await deps.getMarketConstraints(tokenId);
        min_shares = constraints.minShares;
        min_usdc_notional = constraints.minUsdcNotional;
        tick_size = constraints.tickSize;
      } catch (err) {
        log.warn(
          {
            event: "poly.mirror.constraints.fetch_error",
            fill_id: fill.fill_id,
            client_order_id,
            err: err instanceof Error ? err.message : String(err),
          },
          "mirror pipeline: getMarketConstraints threw; planMirrorFromFill will run without market floors"
        );
      }
    }
  }

  const cumulative_intent_usdc_for_market =
    snapshot.already_placed_ids.includes(client_order_id)
      ? undefined
      : await deps.ledger.cumulativeIntentForMarket(
          deps.target.billing_account_id,
          fill.market_id
        );

  const positions_by_condition = aggregatePositionRows(
    snapshot.position_aggregates
  );
  const position = positions_by_condition.get(fill.market_id);
  const targetPosition = await fetchTargetConditionPosition({
    deps,
    fill,
    log,
  });

  const plan = planMirrorFromFill({
    fill,
    config: deps.target,
    state: {
      already_placed_ids: snapshot.already_placed_ids,
      cumulative_intent_usdc_for_market,
      position,
      ...(targetPosition !== undefined
        ? { target_position: targetPosition }
        : {}),
    },
    client_order_id,
    min_shares,
    min_usdc_notional,
    tick_size,
  });

  const decisionLogFields = buildDecisionLogFields({
    branch: plan.position_branch,
    fill,
    position,
    target: deps.target,
    targetPosition,
  });

  if (plan.kind === "skip") {
    emitDecisionMetric(deps.metrics, "skipped", plan.reason, source, placement);
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "skipped",
      reason: plan.reason,
      intent: buildDecisionIntentBlob(
        fill,
        deps.target,
        client_order_id,
        decisionLogFields
      ),
      receipt: null,
    });
    log.info(
      {
        event: EVENT_NAMES.POLY_MIRROR_DECISION,
        outcome: "skipped",
        reason: plan.reason,
        source,
        fill_id: fill.fill_id,
        client_order_id,
        ...decisionLogFields,
      },
      "mirror pipeline: skip"
    );
    return;
  }

  // Fast-path dedupe; the DB partial unique index is the backstop. task.5001.
  const alreadyResting = await deps.ledger.hasOpenForMarket({
    billing_account_id: deps.target.billing_account_id,
    target_id: deps.target.target_id,
    market_id: fill.market_id,
  });
  if (alreadyResting) {
    emitDecisionMetric(
      deps.metrics,
      "skipped",
      "already_resting",
      source,
      placement
    );
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "skipped",
      reason: "already_resting",
      intent: buildDecisionIntentBlob(
        fill,
        deps.target,
        client_order_id,
        decisionLogFields
      ),
      receipt: null,
    });
    log.info(
      {
        event: EVENT_NAMES.POLY_MIRROR_DECISION,
        outcome: "skipped",
        reason: "already_resting",
        source,
        fill_id: fill.fill_id,
        client_order_id,
        market_id: fill.market_id,
        ...decisionLogFields,
      },
      "mirror pipeline: skip (already resting on market)"
    );
    return;
  }

  await executeMirrorOrder(
    deps,
    fill,
    client_order_id,
    decisionBase,
    source,
    placement,
    plan.intent,
    plan.reason,
    log,
    undefined,
    decisionLogFields
  );
}

async function fetchTargetConditionPosition(args: {
  deps: MirrorPipelineDeps;
  fill: import("@cogni/poly-market-provider").Fill;
  log: LoggerPort;
}): Promise<TargetConditionPositionView | undefined> {
  const { deps, fill, log } = args;
  if (!needsTargetPosition(deps.target)) return undefined;
  if (!deps.getTargetConditionPosition) return undefined;
  if (fill.side !== "BUY") return undefined;
  if (typeof fill.attributes?.asset !== "string") return undefined;
  const conditionId = targetConditionIdForFill(fill);
  if (!conditionId) return undefined;
  try {
    return await deps.getTargetConditionPosition({
      targetWallet: deps.target.target_wallet,
      conditionId,
    });
  } catch (err) {
    log.warn(
      {
        event: "poly.mirror.target_position.fetch_error",
        fill_id: fill.fill_id,
        market_id: fill.market_id,
        err: err instanceof Error ? err.message : String(err),
      },
      "mirror pipeline: target position fetch failed; follow-up branch will fail closed"
    );
    return undefined;
  }
}

function needsTargetPosition(target: MirrorTargetConfig): boolean {
  return (
    target.position_followup?.enabled === true ||
    target.sizing.kind !== "min_bet"
  );
}

function targetConditionIdForFill(
  fill: import("@cogni/poly-market-provider").Fill
): string | undefined {
  if (typeof fill.attributes?.condition_id === "string") {
    return fill.attributes.condition_id;
  }
  const prefix = "prediction-market:polymarket:";
  if (fill.market_id.startsWith(prefix)) {
    return fill.market_id.slice(prefix.length);
  }
  return fill.market_id || undefined;
}

function buildDecisionLogFields(args: {
  branch: PositionBranch;
  fill: import("@cogni/poly-market-provider").Fill;
  position: MirrorPositionView | undefined;
  target: MirrorTargetConfig;
  targetPosition: TargetConditionPositionView | undefined;
}): Record<string, unknown> {
  const { branch, fill, position, target, targetPosition } = args;
  const tokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";
  return {
    position_branch: branch,
    position_qty_shares: position?.our_qty_shares ?? 0,
    position_token_id: position?.our_token_id ?? null,
    target_token_cost_usdc: targetTokenCostUsdc(targetPosition, tokenId),
    target_position_usdc: targetPositionTotalUsdc(targetPosition),
    target_hedge_ratio: targetHedgeRatio(position, targetPosition),
    sizing_policy_kind: target.sizing.kind,
    mirror_max_usdc_per_trade: target.sizing.max_usdc_per_trade,
    sizing_percentile:
      "statistic" in target.sizing ? target.sizing.statistic.percentile : null,
    sizing_min_target_usdc:
      "statistic" in target.sizing
        ? target.sizing.statistic.min_target_usdc
        : null,
    sizing_max_target_usdc:
      "statistic" in target.sizing
        ? target.sizing.statistic.max_target_usdc
        : null,
  };
}

function targetPositionTotalUsdc(
  targetPosition: TargetConditionPositionView | undefined
): number | null {
  if (!targetPosition) return null;
  return Number(
    targetPosition.tokens
      .reduce((sum, token) => sum + token.cost_usdc, 0)
      .toFixed(2)
  );
}

function targetTokenCostUsdc(
  targetPosition: TargetConditionPositionView | undefined,
  tokenId: string | undefined
): number | null {
  if (!targetPosition || !tokenId) return null;
  return Number(
    targetPosition.tokens
      .filter((token) => token.token_id === tokenId)
      .reduce((sum, token) => sum + token.cost_usdc, 0)
      .toFixed(2)
  );
}

function targetHedgeRatio(
  position: MirrorPositionView | undefined,
  targetPosition: TargetConditionPositionView | undefined
): number | null {
  if (
    !position?.our_token_id ||
    !position.opposite_token_id ||
    !targetPosition
  ) {
    return null;
  }
  const primary = targetPosition.tokens
    .filter((token) => token.token_id === position.our_token_id)
    .reduce((sum, token) => sum + token.cost_usdc, 0);
  const hedge = targetPosition.tokens
    .filter((token) => token.token_id === position.opposite_token_id)
    .reduce((sum, token) => sum + token.cost_usdc, 0);
  if (primary <= 0) return null;
  return Number((hedge / primary).toFixed(4));
}

/** Handles a SELL fill: position-check then close, or skip. */
async function processSellFill(args: {
  fill: import("@cogni/poly-market-provider").Fill;
  deps: MirrorPipelineDeps;
  client_order_id: `0x${string}`;
  placement: PlacementWire;
  source: DecisionSource;
  decisionBase: {
    target_id: string;
    fill_id: string;
    billing_account_id: string;
    created_by_user_id: string;
    decided_at: Date;
  };
  log: LoggerPort;
}): Promise<void> {
  const { fill, deps, client_order_id, placement, source, decisionBase, log } =
    args;
  const { closePosition, getOperatorPositions } = deps;

  // Cancel resting mirror BUYs before position-close. task.5001.
  await cancelOpenMirrorOrdersForMarket({
    deps,
    fill,
    log,
    reason: "target_exited_market",
  });

  if (!closePosition || !getOperatorPositions) {
    emitDecisionMetric(
      deps.metrics,
      "skipped",
      "sell_without_position",
      source,
      placement
    );
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "skipped",
      reason: "sell_without_position",
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
        close: false,
        position_branch: "sell_close",
      }),
      receipt: null,
    });
    log.info(
      {
        event: EVENT_NAMES.POLY_MIRROR_DECISION,
        outcome: "skipped",
        reason: "sell_without_position",
        source,
        fill_id: fill.fill_id,
        client_order_id,
        detail: "closePosition/getOperatorPositions deps absent",
        position_branch: "sell_close",
      },
      "mirror pipeline: skip (no close deps)"
    );
    return;
  }

  const tokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";

  let positions: OperatorPosition[];
  try {
    positions = await getOperatorPositions();
  } catch {
    emitDecisionMetric(
      deps.metrics,
      "skipped",
      "sell_without_position",
      source,
      placement
    );
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "skipped",
      reason: "sell_without_position",
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
        close: false,
        position_branch: "sell_close",
      }),
      receipt: null,
    });
    log.warn(
      {
        event: EVENT_NAMES.POLY_MIRROR_DECISION,
        outcome: "skipped",
        reason: "sell_without_position",
        source,
        fill_id: fill.fill_id,
        client_order_id,
        detail: "getOperatorPositions threw; skipping to avoid short",
        position_branch: "sell_close",
      },
      "mirror pipeline: skip (position query failed)"
    );
    return;
  }

  const position = positions.find((p) => p.asset === tokenId);
  const hasPosition = position !== undefined && position.size > 0;

  if (!hasPosition) {
    emitDecisionMetric(
      deps.metrics,
      "skipped",
      "sell_without_position",
      source,
      placement
    );
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "skipped",
      reason: "sell_without_position",
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
        close: false,
        position_branch: "sell_close",
      }),
      receipt: null,
    });
    log.info(
      {
        event: EVENT_NAMES.POLY_MIRROR_DECISION,
        outcome: "skipped",
        reason: "sell_without_position",
        source,
        fill_id: fill.fill_id,
        client_order_id,
        token_id: tokenId,
        position_branch: "sell_close",
      },
      "mirror pipeline: skip (no position to close)"
    );
    return;
  }

  const boundClose = deps.closePosition;
  if (!boundClose) return;
  const closeExecutor = (intent: OrderIntent): Promise<OrderReceipt> =>
    boundClose({
      tokenId: intent.attributes?.token_id as string,
      max_size_usdc: nominalSizeUsdc(deps.target.sizing),
      limit_price: fill.price,
      client_order_id,
    });

  const closeIntent: OrderIntent = {
    provider: "polymarket",
    market_id: fill.market_id,
    outcome: fill.outcome,
    side: "SELL",
    size_usdc: nominalSizeUsdc(deps.target.sizing),
    limit_price: fill.price,
    client_order_id,
    attributes: {
      token_id: tokenId,
      source_fill_id: fill.fill_id,
      target_wallet: fill.target_wallet,
      position_branch: "sell_close",
    },
  };

  await executeMirrorOrder(
    deps,
    fill,
    client_order_id,
    decisionBase,
    source,
    placement,
    closeIntent,
    "sell_closed_position",
    log,
    closeExecutor,
    {
      position_branch: "sell_close",
      position_qty_shares: position.size,
      position_token_id: tokenId,
    }
  );
}

/**
 * Cancel any open mirror orders for this (target, market). SELL-fill
 * pre-step. Idempotent: pending rows (no `order_id` yet) are skipped; the
 * adapter swallows CLOB 404 so concurrent cancels from the TTL sweeper are
 * harmless. `cancelOrder` is optional; tests omit it and the loop no-ops.
 */
async function cancelOpenMirrorOrdersForMarket(args: {
  deps: MirrorPipelineDeps;
  fill: import("@cogni/poly-market-provider").Fill;
  log: LoggerPort;
  reason: "target_exited_market";
}): Promise<void> {
  const { deps, fill, log, reason } = args;
  const cancelOrder = deps.cancelOrder;
  if (!cancelOrder) return;
  const open = await deps.ledger.findOpenForMarket({
    billing_account_id: deps.target.billing_account_id,
    target_id: deps.target.target_id,
    market_id: fill.market_id,
  });
  for (const row of open) {
    if (row.order_id === null) continue;
    try {
      await cancelOrder(row.order_id);
      await deps.ledger.markCanceled({
        client_order_id: row.client_order_id,
        reason,
      });
      log.info(
        {
          event: EVENT_NAMES.POLY_MIRROR_DECISION,
          phase: "buy_canceled_on_target_sell",
          client_order_id: row.client_order_id,
          order_id: row.order_id,
          market_id: row.market_id,
        },
        "mirror pipeline: canceled resting BUY on target SELL"
      );
    } catch (err: unknown) {
      log.error(
        {
          event: EVENT_NAMES.POLY_MIRROR_DECISION,
          phase: "cancel_failed",
          client_order_id: row.client_order_id,
          order_id: row.order_id,
          err: err instanceof Error ? err.message : String(err),
        },
        "mirror pipeline: cancel failed; row stays open for sweeper"
      );
    }
  }
}

/**
 * Shared INSERT_BEFORE_PLACE + mark/record sequence used by both the BUY path
 * and the SELL-close path.
 */
async function executeMirrorOrder(
  deps: MirrorPipelineDeps,
  fill: import("@cogni/poly-market-provider").Fill,
  client_order_id: `0x${string}`,
  decisionBase: {
    target_id: string;
    fill_id: string;
    billing_account_id: string;
    created_by_user_id: string;
    decided_at: Date;
  },
  source: DecisionSource,
  placement: PlacementWire,
  intent: OrderIntent,
  reason: MirrorReason,
  log: LoggerPort,
  intentExecutor?: (intent: OrderIntent) => Promise<OrderReceipt>,
  decisionLogFields?: Record<string, unknown>
): Promise<void> {
  const executor = intentExecutor ?? deps.placeIntent;

  try {
    await deps.ledger.insertPending({
      billing_account_id: deps.target.billing_account_id,
      created_by_user_id: deps.target.created_by_user_id,
      target_id: deps.target.target_id,
      fill_id: fill.fill_id,
      observed_at: new Date(fill.observed_at),
      intent,
      ...(intent.side === "BUY"
        ? { max_market_intent_usdc: deps.target.sizing.max_usdc_per_trade }
        : {}),
    });
  } catch (err: unknown) {
    // DB partial unique index races past the app-level gate → same skip outcome.
    if (err instanceof AlreadyRestingError) {
      emitDecisionMetric(
        deps.metrics,
        "skipped",
        "already_resting",
        source,
        placement
      );
      await deps.ledger.recordDecision({
        ...decisionBase,
        outcome: "skipped",
        reason: "already_resting",
        intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
          ...decisionLogFields,
          position_branch: decisionLogFields?.position_branch ?? "new_entry",
        }),
        receipt: null,
      });
      log.info(
        {
          event: EVENT_NAMES.POLY_MIRROR_DECISION,
          outcome: "skipped",
          reason: "already_resting",
          source,
          fill_id: fill.fill_id,
          client_order_id,
          market_id: fill.market_id,
          detail: "DB unique-index backstop fired (race past app-level gate)",
          ...decisionLogFields,
        },
        "mirror pipeline: skip (already resting; DB index backstop)"
      );
      return;
    }
    if (err instanceof PositionCapReachedError) {
      emitDecisionMetric(
        deps.metrics,
        "skipped",
        "position_cap_reached",
        source,
        placement
      );
      await deps.ledger.recordDecision({
        ...decisionBase,
        outcome: "skipped",
        reason: "position_cap_reached",
        intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
          ...decisionLogFields,
          position_branch: decisionLogFields?.position_branch ?? "new_entry",
          current_intent_usdc: err.current_intent_usdc,
          proposed_intent_usdc: err.proposed_intent_usdc,
          max_intent_usdc: err.max_intent_usdc,
        }),
        receipt: null,
      });
      log.info(
        {
          event: EVENT_NAMES.POLY_MIRROR_DECISION,
          outcome: "skipped",
          reason: "position_cap_reached",
          source,
          fill_id: fill.fill_id,
          client_order_id,
          market_id: fill.market_id,
          current_intent_usdc: err.current_intent_usdc,
          proposed_intent_usdc: err.proposed_intent_usdc,
          max_intent_usdc: err.max_intent_usdc,
          detail: "DB tenant-market intent cap backstop fired",
          ...decisionLogFields,
        },
        "mirror pipeline: skip (position cap reached; DB backstop)"
      );
      return;
    }
    emitDecisionMetric(
      deps.metrics,
      "error",
      "pending_insert_failed",
      source,
      placement
    );
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "error",
      reason: "pending_insert_failed",
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
        ...decisionLogFields,
        position_branch: decisionLogFields?.position_branch ?? "new_entry",
      }),
      receipt: null,
    });
    log.error(
      {
        event: EVENT_NAMES.POLY_MIRROR_DECISION,
        outcome: "error",
        errorCode: "pending_insert_failed",
        reason: "pending_insert_failed",
        source,
        fill_id: fill.fill_id,
        ...decisionLogFields,
      },
      "mirror pipeline: pending insert failed; skipping placement"
    );
    return;
  }

  try {
    const receipt = await executor(intent);
    await deps.ledger.markOrderId({
      client_order_id,
      receipt,
    });
    emitDecisionMetric(deps.metrics, "placed", reason, source, placement);
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "placed",
      reason,
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
        ...decisionLogFields,
        side: intent.side,
        close: intent.side === "SELL",
        position_branch: decisionLogFields?.position_branch ?? "new_entry",
      }),
      receipt: {
        order_id: receipt.order_id,
        client_order_id: receipt.client_order_id,
        status: receipt.status,
        filled_size_usdc: receipt.filled_size_usdc ?? 0,
        submitted_at: receipt.submitted_at,
      },
    });
    log.info(
      {
        event: EVENT_NAMES.POLY_MIRROR_DECISION,
        outcome: "placed",
        reason,
        source,
        fill_id: fill.fill_id,
        client_order_id,
        order_id: receipt.order_id,
        ...decisionLogFields,
      },
      "mirror pipeline: placed"
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const adapterErrorCode =
      typeof (err as { details?: { error_code?: unknown } } | null)?.details
        ?.error_code === "string"
        ? (err as { details: { error_code: string } }).details.error_code
        : undefined;
    deps.metrics.incr(MIRROR_PIPELINE_METRICS.placementErrorsTotal, {});
    await deps.ledger.markError({ client_order_id, error: msg });
    emitDecisionMetric(
      deps.metrics,
      "error",
      "placement_failed",
      source,
      placement
    );
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "error",
      reason: "placement_failed",
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
        ...decisionLogFields,
        position_branch: decisionLogFields?.position_branch ?? "new_entry",
      }),
      receipt: null,
    });
    const isFokNoMatch = adapterErrorCode === "fok_no_match";
    const logLevel = isFokNoMatch ? "info" : "error";
    log[logLevel](
      {
        event: EVENT_NAMES.POLY_MIRROR_DECISION,
        outcome: "error",
        errorCode: adapterErrorCode ?? "placement_failed",
        reason: "placement_failed",
        source,
        fill_id: fill.fill_id,
        client_order_id,
        ...decisionLogFields,
      },
      isFokNoMatch
        ? "mirror pipeline: FOK no-match — clean skip, no retry"
        : "mirror pipeline: placement error"
    );
  }
}

function emitDecisionMetric(
  metrics: MetricsPort,
  outcome: "placed" | "skipped" | "error",
  reason: MirrorReason | "pending_insert_failed" | "placement_failed",
  source: DecisionSource,
  placement: PlacementWire
): void {
  metrics.incr(MIRROR_PIPELINE_METRICS.decisionsTotal, {
    outcome,
    reason,
    source,
    placement,
  });
}

function buildDecisionIntentBlob(
  fill: import("@cogni/poly-market-provider").Fill,
  target: MirrorTargetConfig,
  client_order_id: `0x${string}`,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    target_wallet: target.target_wallet,
    market_id: fill.market_id,
    outcome: fill.outcome,
    side: fill.side,
    fill_size_usdc_target: fill.size_usdc,
    fill_price_target: fill.price,
    mirror_usdc: nominalSizeUsdc(target.sizing),
    mode: target.mode,
    client_order_id,
    ...extra,
  };
}
