// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/mirror-coordinator`
 * Purpose: Thin coordinator that glues `features/wallet-watch/` → `decide()` → `features/trading/`. Pure `runOnce(deps)` — no `setInterval`, no env reads, no DB client construction. The ONLY file in the feature layer that imports from both sibling slices.
 * Scope: Sequencing + INSERT_BEFORE_PLACE enforcement. Does not own cadence (job shim in `bootstrap/jobs/copy-trade-mirror.job.ts`), does not own cursor persistence (deps supply `getCursor`/`setCursor`), does not construct adapters (bootstrap injects them).
 * Invariants:
 *   - COPY_TRADE_ONLY_COORDINATES — the coordinator is the only slice file that imports both `trading/` and `wallet-watch/`.
 *   - INSERT_BEFORE_PLACE — `order-ledger.insertPending` runs BEFORE `placeIntent`. `markOrderId` / `markError` run AFTER. Crash between insert and place leaves a pending row whose `client_order_id` will be in the next tick's `already_placed_ids`, so `decide()` returns `skip/already_placed`.
 *   - IDEMPOTENT_BY_CLIENT_ID — `client_order_id = clientOrderIdFor(target.target_id, fill.fill_id)`, pinned helper. Deterministic from the PK pair so re-runs dedupe.
 *   - RECORD_EVERY_DECISION — `order-ledger.recordDecision` fires for EVERY decide() outcome (placed, skipped, or error). Supports P4 divergence analysis without the fills ledger.
 *   - DECISIONS_TOTAL_HAS_SOURCE — `poly_mirror_decisions_total{outcome, reason, source}` always carries `source` (v0 = `"data-api"`, P4 adds `"clob-ws"`).
 * Side-effects: delegated — DB I/O via `OrderLedger`, HTTP via `WalletActivitySource`, Polymarket CLOB via `placeIntent`. Coordinator itself is pure sequencing + logger/metrics calls.
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (CP4.3d), docs/spec/poly-copy-trade-phase1.md
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

import { decide } from "./decide";
import type { MirrorReason, TargetConfig } from "./types";

/** Minimal position shape needed by the coordinator — subset of PolymarketUserPosition. */
export interface OperatorPosition {
  asset: string;
  size: number;
}

/** Metric names emitted by the coordinator. */
export const MIRROR_COORDINATOR_METRICS = {
  /** `poly_mirror_decisions_total{outcome, reason, source}` — always fired, bounded labels. */
  decisionsTotal: "poly_mirror_decisions_total",
  /** `poly_mirror_placement_errors_total` — `placeIntent` throw after pending insert. */
  placementErrorsTotal: "poly_mirror_placement_errors_total",
} as const;

/** `Fill.source` values that land in `decisions_total{source}`. */
export type DecisionSource = "data-api" | "clob-ws";

export interface MirrorCoordinatorDeps {
  /** Fill source — v0 is the Polymarket Data-API adapter; P4 swaps in WS. */
  source: WalletActivitySource;
  /** Order ledger — reads state + writes pending/mark/decision rows. */
  ledger: OrderLedger;
  /** Raw placement seam from `createPolyTradeCapability().placeIntent`. */
  placeIntent: (intent: OrderIntent) => Promise<OrderReceipt>;
  /** Static target config for v0 — P2 swaps for a per-tick DB resolver. */
  target: TargetConfig;
  /** Cursor accessor — bootstrap closures hold the in-memory state for v0. */
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
   * Optional — SELL-to-close path. When present, SELL fills route through
   * this after a position check. When absent, SELL fills degrade to
   * `skip/sell_without_position` (safe: we never open a short).
   * Signature matches `PolyTradeBundle.closePosition` exactly.
   */
  closePosition?: (params: {
    tokenId: string;
    max_size_usdc: number;
    limit_price: number;
    client_order_id: `0x${string}`;
  }) => Promise<OrderReceipt>;
  /**
   * Optional — position query used by the SELL branch. When absent (or no
   * `closePosition`), SELL fills degrade to `skip/sell_without_position`.
   * Returns a minimal position list; the coordinator only needs `asset` + `size`.
   */
  getOperatorPositions?: () => Promise<OperatorPosition[]>;
}

/**
 * One coordinator tick. Fully sequential — no concurrency across fills inside
 * one tick, so `decide()`'s `already_placed_ids` snapshot stays consistent.
 *
 * Ordering per fill:
 *   1. compute `client_order_id`
 *   2. snapshot state (kill-switch + caps + placed ids)
 *   3. `decide()`
 *   4. `recordDecision` (always)
 *   5. if `place`: `insertPending` → `placeIntent` → `markOrderId` / `markError`
 *
 * Errors inside a single fill's path are logged + recorded as `outcome:"error"`
 * in the decisions ledger but do NOT halt the tick — the coordinator continues
 * with the next fill so one broken market doesn't stall the mirror loop.
 *
 * @public
 */
export async function runOnce(deps: MirrorCoordinatorDeps): Promise<void> {
  const clock = deps.clock ?? (() => new Date());
  const log = deps.logger.child({
    component: "mirror-coordinator",
    target_id: deps.target.target_id,
    target_wallet: deps.target.target_wallet,
  });

  // Tick-start + empty-page logs intentionally dropped — low signal, high
  // volume (1/tick × N targets). The decision + source-error events below
  // carry the same debugging value without flooding Loki.
  const cursor = deps.getCursor();

  let result: {
    fills: import("@cogni/market-provider").Fill[];
    newSince: number;
  };
  try {
    result = await deps.source.fetchSince(cursor);
  } catch (err: unknown) {
    // Source-level failure — log + skip this tick. Keep cursor unchanged so
    // next tick re-tries from the same point. Do NOT halt the job.
    log.warn(
      {
        event: EVENT_NAMES.POLY_MIRROR_SOURCE_ERROR,
        errorCode: "source_fetch_failed",
        cursor,
        err: err instanceof Error ? err.message : String(err),
      },
      "mirror coordinator: source fetch failed; skipping tick"
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
  deps: MirrorCoordinatorDeps,
  clock: () => Date,
  log: LoggerPort
): Promise<void> {
  const client_order_id = clientOrderIdFor(deps.target.target_id, fill.fill_id);

  // Snapshot is per-fill — simple, slightly more DB reads but correct when
  // caps tighten mid-tick (e.g. first fill tips over the daily cap).
  const snapshot = await deps.ledger.snapshotState(deps.target.target_id);

  const source: DecisionSource = fill.source as DecisionSource;
  const decisionBase = {
    target_id: deps.target.target_id,
    fill_id: fill.fill_id,
    decided_at: clock(),
  };

  // ── SELL branch: close-vs-short discrimination ──────────────────────────────
  // Must run BEFORE decide() so we never pass a bare SELL through the BUY-only
  // decide() path. If deps are missing or operator has no position, skip safely
  // (never open a short — CLOB would reject it and semantically it's wrong).
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

  // ── BUY branch: existing path unchanged ─────────────────────────────────────
  const decision = decide({
    fill,
    config: { ...deps.target, enabled: snapshot.enabled },
    state: {
      today_spent_usdc: snapshot.today_spent_usdc,
      fills_last_hour: snapshot.fills_last_hour,
      already_placed_ids: snapshot.already_placed_ids,
    },
    client_order_id,
  });

  if (decision.action === "skip") {
    emitDecisionMetric(deps.metrics, "skipped", decision.reason, source);
    await deps.ledger.recordDecision({
      ...decisionBase,
      outcome: "skipped",
      reason: decision.reason,
      intent: buildDecisionIntentBlob(fill, deps.target, client_order_id),
      receipt: null,
    });
    log.info(
      {
        event: EVENT_NAMES.POLY_MIRROR_DECISION,
        outcome: "skipped",
        reason: decision.reason,
        source,
        fill_id: fill.fill_id,
        client_order_id,
      },
      "mirror coordinator: skip"
    );
    return;
  }

  // action === "place" — delegate to shared insert+execute helper.
  await executePlacement(
    deps,
    fill,
    client_order_id,
    decisionBase,
    source,
    decision.intent,
    decision.reason,
    log
  );
}

/** Handles a SELL fill: position-check then close, or skip. */
async function processSellFill(args: {
  fill: import("@cogni/market-provider").Fill;
  deps: MirrorCoordinatorDeps;
  client_order_id: `0x${string}`;
  source: DecisionSource;
  decisionBase: {
    target_id: string;
    fill_id: string;
    decided_at: Date;
  };
  log: LoggerPort;
}): Promise<void> {
  const { fill, deps, client_order_id, source, decisionBase, log } = args;
  const { closePosition, getOperatorPositions } = deps;

  // Degrade-gracefully: if either dep is absent, skip safely.
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
      "mirror coordinator: skip (no close deps)"
    );
    return;
  }

  const tokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";

  // Query operator positions for the token.
  let positions: OperatorPosition[];
  try {
    positions = await getOperatorPositions();
  } catch {
    // Position-query failure: skip safely, do not open a short.
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
      "mirror coordinator: skip (position query failed)"
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
      "mirror coordinator: skip (no position to close)"
    );
    return;
  }

  // Operator holds a position — route through closePosition.
  // The bundle's closePosition caps size at position value; no double-capping here.
  // Both deps are guaranteed non-undefined here (checked above). Capture into
  // a narrowed const so TypeScript tracks the non-optional type.
  const boundClose = deps.closePosition;
  if (!boundClose) return; // narrowing — guard above already proved this
  const closeExecutor = (intent: OrderIntent): Promise<OrderReceipt> =>
    boundClose({
      tokenId: intent.attributes?.token_id as string,
      max_size_usdc: deps.target.mirror_usdc,
      limit_price: fill.price,
      client_order_id,
    });

  // Build a synthetic SELL intent for the INSERT_BEFORE_PLACE ledger record.
  const closeIntent: OrderIntent = {
    provider: "polymarket",
    market_id: fill.market_id,
    outcome: fill.outcome,
    side: "SELL",
    size_usdc: deps.target.mirror_usdc,
    limit_price: fill.price,
    client_order_id,
    attributes: {
      token_id: tokenId,
      source_fill_id: fill.fill_id,
      target_wallet: fill.target_wallet,
    },
  };

  await executePlacement(
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
 * and the SELL-close path. The only difference between the two callers is:
 *   - `intent` (what goes in the ledger's pending row)
 *   - `intentExecutor` (BUY = `deps.placeIntent`; SELL-close = `closePosition` wrapper)
 *   - `reason` (BUY = from `decide()`; SELL = `"sell_closed_position"`)
 */
async function executePlacement(
  deps: MirrorCoordinatorDeps,
  fill: import("@cogni/market-provider").Fill,
  client_order_id: `0x${string}`,
  decisionBase: { target_id: string; fill_id: string; decided_at: Date },
  source: DecisionSource,
  intent: OrderIntent,
  reason: MirrorReason,
  log: LoggerPort,
  intentExecutor?: (intent: OrderIntent) => Promise<OrderReceipt>
): Promise<void> {
  const executor = intentExecutor ?? deps.placeIntent;

  try {
    await deps.ledger.insertPending({
      target_id: deps.target.target_id,
      fill_id: fill.fill_id,
      observed_at: new Date(fill.observed_at),
      intent,
    });
  } catch {
    // Pending-insert failure is fatal for this fill — cannot prove
    // INSERT_BEFORE_PLACE without it. Log + record error, do not place.
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
      "mirror coordinator: pending insert failed; skipping placement"
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
      "mirror coordinator: placed"
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.metrics.incr(MIRROR_COORDINATOR_METRICS.placementErrorsTotal, {});
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
      "mirror coordinator: placement error"
    );
  }
}

function emitDecisionMetric(
  metrics: MetricsPort,
  outcome: "placed" | "skipped" | "error",
  reason: MirrorReason | "pending_insert_failed" | "placement_failed",
  source: DecisionSource
): void {
  metrics.incr(MIRROR_COORDINATOR_METRICS.decisionsTotal, {
    outcome,
    reason,
    source,
  });
}

/**
 * Snapshot of the fill + config context for the `decisions.intent` jsonb
 * column. Used across skip/place/error branches so the audit log has the
 * full decision context regardless of outcome.
 *
 * `extra` may carry `{ side, close }` for SELL-close decisions so the
 * audit log clearly distinguishes a position-close from a BUY.
 */
function buildDecisionIntentBlob(
  fill: import("@cogni/market-provider").Fill,
  target: TargetConfig,
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
    mirror_usdc: target.mirror_usdc,
    mode: target.mode,
    client_order_id,
    ...extra,
  };
}
