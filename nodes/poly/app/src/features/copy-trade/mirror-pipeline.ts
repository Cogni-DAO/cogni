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
 *   - DECISIONS_TOTAL_HAS_SOURCE — `poly_mirror_decisions_total{outcome, reason, source}` always carries `source` (v0 = `"data-api"`).
 *   - TENANT_INHERITED_FROM_TARGET — every `insertPending` and `recordDecision` writes `(billing_account_id, created_by_user_id)` taken from `deps.target` (`MirrorTargetConfig`). The pipeline never reads tenant from anywhere else.
 *   - CAPS_LIVE_IN_GRANT — daily / hourly caps are enforced by `authorizeIntent` inside the per-tenant `placeIntent` executor, not here.
 * Side-effects: delegated — DB I/O via `OrderLedger`, HTTP via `WalletActivitySource`, Polymarket CLOB via `placeIntent`. Pipeline itself is pure sequencing + logger/metrics calls.
 * Links: work/items/task.0318 (Phase B3), docs/spec/poly-multi-tenant-auth.md
 * @public
 */

import {
  clientOrderIdFor,
  type LoggerPort,
  type MetricsPort,
  type OrderIntent,
  type OrderReceipt,
} from "@cogni/market-provider";
import { EVENT_NAMES } from "@cogni/node-shared";

import type { OrderLedger } from "@/features/trading";
import type { WalletActivitySource } from "@/features/wallet-watch";

import { planMirrorFromFill } from "./plan-mirror";
import type { MirrorReason, MirrorTargetConfig, SizingPolicy } from "./types";

/**
 * Extract a representative USDC notional from a sizing policy for uses that
 * predate per-fill sizing math — SELL-close caps and audit-log skip blobs.
 */
function nominalSizeUsdc(sizing: SizingPolicy): number {
  switch (sizing.kind) {
    case "fixed":
      return sizing.mirror_usdc;
  }
}

/** Minimal position shape needed by the pipeline — subset of PolymarketUserPosition. */
export interface OperatorPosition {
  asset: string;
  size: number;
}

/** Metric names emitted by the pipeline. */
export const MIRROR_PIPELINE_METRICS = {
  /** `poly_mirror_decisions_total{outcome, reason, source}` — always fired, bounded labels. */
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
   * Market-constraint fetch seam — returns `{ minShares }` for a token id so
   * the sizing policy can avoid sub-min submissions (bug.0342). Optional.
   */
  getMarketConstraints?:
    | ((
        tokenId: string
      ) => Promise<{ minShares: number; minUsdcNotional?: number }>)
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
    fills: import("@cogni/market-provider").Fill[];
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
  fill: import("@cogni/market-provider").Fill,
  deps: MirrorPipelineDeps,
  clock: () => Date,
  log: LoggerPort
): Promise<void> {
  const client_order_id = clientOrderIdFor(deps.target.target_id, fill.fill_id);

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
      source,
      decisionBase,
      log,
    });
    return;
  }

  let min_shares: number | undefined;
  let min_usdc_notional: number | undefined;
  if (deps.getMarketConstraints) {
    const tokenId =
      typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";
    if (tokenId) {
      try {
        const constraints = await deps.getMarketConstraints(tokenId);
        min_shares = constraints.minShares;
        min_usdc_notional = constraints.minUsdcNotional;
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

  const plan = planMirrorFromFill({
    fill,
    config: { ...deps.target, enabled: snapshot.enabled },
    state: {
      already_placed_ids: snapshot.already_placed_ids,
    },
    client_order_id,
    min_shares,
    min_usdc_notional,
  });

  if (plan.kind === "skip") {
    emitDecisionMetric(deps.metrics, "skipped", plan.reason, source);
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "skipped",
      reason: plan.reason,
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id),
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
      },
      "mirror pipeline: skip"
    );
    return;
  }

  await executeMirrorOrder(
    deps,
    fill,
    client_order_id,
    decisionBase,
    source,
    plan.intent,
    plan.reason,
    log
  );
}

/** Handles a SELL fill: position-check then close, or skip. */
async function processSellFill(args: {
  fill: import("@cogni/market-provider").Fill;
  deps: MirrorPipelineDeps;
  client_order_id: `0x${string}`;
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
  const { fill, deps, client_order_id, source, decisionBase, log } = args;
  const { closePosition, getOperatorPositions } = deps;

  if (!closePosition || !getOperatorPositions) {
    emitDecisionMetric(
      deps.metrics,
      "skipped",
      "sell_without_position",
      source
    );
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "skipped",
      reason: "sell_without_position",
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
        close: false,
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
      source
    );
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "skipped",
      reason: "sell_without_position",
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
        close: false,
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
      source
    );
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "skipped",
      reason: "sell_without_position",
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
        close: false,
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
    },
  };

  await executeMirrorOrder(
    deps,
    fill,
    client_order_id,
    decisionBase,
    source,
    closeIntent,
    "sell_closed_position",
    log,
    closeExecutor
  );
}

/**
 * Shared INSERT_BEFORE_PLACE + mark/record sequence used by both the BUY path
 * and the SELL-close path.
 */
async function executeMirrorOrder(
  deps: MirrorPipelineDeps,
  fill: import("@cogni/market-provider").Fill,
  client_order_id: `0x${string}`,
  decisionBase: {
    target_id: string;
    fill_id: string;
    billing_account_id: string;
    created_by_user_id: string;
    decided_at: Date;
  },
  source: DecisionSource,
  intent: OrderIntent,
  reason: MirrorReason,
  log: LoggerPort,
  intentExecutor?: (intent: OrderIntent) => Promise<OrderReceipt>
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
    });
  } catch {
    emitDecisionMetric(deps.metrics, "error", "pending_insert_failed", source);
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "error",
      reason: "pending_insert_failed",
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id),
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
    emitDecisionMetric(deps.metrics, "placed", reason, source);
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "placed",
      reason,
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id, {
        side: intent.side,
        close: intent.side === "SELL",
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
      },
      "mirror pipeline: placed"
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.metrics.incr(MIRROR_PIPELINE_METRICS.placementErrorsTotal, {});
    await deps.ledger.markError({ client_order_id, error: msg });
    emitDecisionMetric(deps.metrics, "error", "placement_failed", source);
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "error",
      reason: "placement_failed",
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id),
      receipt: null,
    });
    log.error(
      {
        event: EVENT_NAMES.POLY_MIRROR_DECISION,
        outcome: "error",
        errorCode: "placement_failed",
        reason: "placement_failed",
        source,
        fill_id: fill.fill_id,
        client_order_id,
      },
      "mirror pipeline: placement error"
    );
  }
}

function emitDecisionMetric(
  metrics: MetricsPort,
  outcome: "placed" | "skipped" | "error",
  reason: MirrorReason | "pending_insert_failed" | "placement_failed",
  source: DecisionSource
): void {
  metrics.incr(MIRROR_PIPELINE_METRICS.decisionsTotal, {
    outcome,
    reason,
    source,
  });
}

function buildDecisionIntentBlob(
  fill: import("@cogni/market-provider").Fill,
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
