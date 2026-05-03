// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/types`
 * Purpose: Port-level types for the copy-trade plan/execute boundary — `MirrorTargetConfig`, `SizingPolicy`, `RuntimeState`, `MirrorPlan`, skip-reason enum.
 * Scope: Pure type surface consumed by `plan-mirror.ts`, `clob-executor.ts`, and the mirror pipeline. Does not contain logic, does not import adapters.
 * Invariants:
 *   - MIRROR_REASON_BOUNDED — reason codes are an enum (bounded Prom label cardinality).
 *   - DECISION_IS_PURE_INPUT — all runtime state is handed to planMirrorFromFill() explicitly, never read at plan-time.
 *   - TARGET_CONFIG_CARRIES_TENANT — every MirrorTargetConfig carries `billing_account_id` (data) + `created_by_user_id` (RLS key) so downstream fills/decisions writes inherit tenant attribution.
 *   - SIZING_POLICY_IS_DISCRIMINATED — MirrorTargetConfig.sizing is a discriminated union on `kind`; future policies (proportional, percentile) add variants, never flat fields.
 *   - CAPS_LIVE_IN_GRANT — daily + hourly caps are enforced by `PolyTraderWalletPort.authorizeIntent` against the per-tenant `poly_wallet_grants` row. `planMirrorFromFill` no longer owns those checks; this config surface no longer carries them.
 * Side-effects: none
 * Links: docs/spec/poly-multi-tenant-auth.md, work/items/task.0318, work/items/task.0404
 * @public
 */

import type { Fill, OrderIntent } from "@cogni/poly-market-provider";
import { z } from "zod";

/**
 * Sizing policy — how the pipeline derives `OrderIntent.size_usdc` from a
 * target's fill. Always-min-bet semantics: bet size is the market's
 * `minUsdcNotional` (clamped to `minShares × price` per SHARE_SPACE_MATH).
 * When the floor exceeds `max_usdc_per_trade`, the pipeline skips with
 * `below_market_min` BEFORE the `INSERT_BEFORE_PLACE` row lands — so
 * cap-exceed cases are not duplicated at the `authorizeIntent` boundary as
 * `placement_failed` decisions.
 *
 * FCFS budget gating across multi-target copy-trading is handled downstream by
 * `authorizeIntent` against the tenant's `poly_wallet_grants` row
 * (`CAPS_LIVE_IN_GRANT`); this policy intentionally does not read grant state.
 *
 * Discriminated union retained so future policies (allocation, bankroll-aware
 * fractional Kelly) plug in by adding a new `kind` without touching the
 * adapter or the port. Legacy `kind: "fixed"` was deleted in task.5001 — no
 * persisted rows existed (sizing config is default-in-code; persistence
 * deferred to task.0347).
 */
export const MinBetSizingPolicySchema = z.object({
  kind: z.literal("min_bet"),
  /** Hard per-intent ceiling. Skip at plan-mirror when floor exceeds this. */
  max_usdc_per_trade: z.number().positive(),
});
export type MinBetSizingPolicy = z.infer<typeof MinBetSizingPolicySchema>;

export const WalletSizeStatisticSchema = z.object({
  /** 0x-prefixed 40-hex wallet the snapshot was computed from. */
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Human label for audit logs and config diffs. */
  label: z.string().min(1),
  /** UTC ISO timestamp for the Data-API sample window. */
  captured_at: z.string().min(1),
  /** Number of target token positions in the snapshot. */
  sample_size: z.number().int().positive(),
  /** Target-wallet position cost-basis threshold; positions below this skip. */
  min_target_usdc: z.number().positive(),
  /** High-water percentile used as the top of the mirror scaling range. */
  max_target_usdc: z.number().positive(),
  /** Percentile slider that produced `min_target_usdc`, e.g. 75 = p75. */
  percentile: z.number().min(0).max(100),
});
export type WalletSizeStatistic = z.infer<typeof WalletSizeStatisticSchema>;

/**
 * Filter-low-position policy for conviction-aware copy trading. A target
 * condition/token position must be at or above the configured wallet-stat
 * percentile before we mirror it.
 * Accepted triggers use the same min-bet sizing as `kind: "min_bet"`; relative
 * sizing is a future policy, not an implicit fallback here. Tenant
 * daily/hourly caps still live downstream in `authorizeIntent`.
 */
export const TargetPercentileSizingPolicySchema = z.object({
  kind: z.literal("target_percentile"),
  max_usdc_per_trade: z.number().positive(),
  statistic: WalletSizeStatisticSchema,
});
export type TargetPercentileSizingPolicy = z.infer<
  typeof TargetPercentileSizingPolicySchema
>;

/**
 * Percentile-filtered relative sizing. Positions below
 * `statistic.min_target_usdc` skip. Accepted positions map linearly from
 * market min bet at pXX to `max_usdc_per_trade` at the configured snapshot
 * high-water percentile. This is intentionally a distinct policy from
 * `target_percentile`; there is no silent fallback between min-bet and scaled
 * sizing.
 */
export const TargetPercentileScaledSizingPolicySchema = z.object({
  kind: z.literal("target_percentile_scaled"),
  max_usdc_per_trade: z.number().positive(),
  statistic: WalletSizeStatisticSchema,
});
export type TargetPercentileScaledSizingPolicy = z.infer<
  typeof TargetPercentileScaledSizingPolicySchema
>;

export const SizingPolicySchema = z.discriminatedUnion("kind", [
  MinBetSizingPolicySchema,
  TargetPercentileSizingPolicySchema,
  TargetPercentileScaledSizingPolicySchema,
]);
export type SizingPolicy = z.infer<typeof SizingPolicySchema>;

/**
 * Placement policy — how the pipeline lands a mirrored intent on the CLOB.
 * - `mirror_limit` (default): GTC limit at the target's entry price; one
 *   resting order per (target, market). Exits via fill, cancel-on-SELL, or
 *   TTL sweep. Relaxes `FILL_NEVER_BELOW_FLOOR` for the `limit` wire value.
 * - `market_fok` (legacy): `createAndPostMarketOrder(FOK)` per fill. Used by
 *   parity testing + agent-tool path.
 *
 * Wire value (`"limit"` | `"market_fok"`) lands on
 * `OrderIntent.attributes.placement` and is read by the adapter.
 */
export const PlacementPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mirror_limit") }),
  z.object({ kind: z.literal("market_fok") }),
]);
export type PlacementPolicy = z.infer<typeof PlacementPolicySchema>;

/**
 * Position-aware follow-up policy. pXX remains the target-position conviction
 * gate for every BUY branch; this policy adds the mirror-position safety gates
 * that decide whether market-min layers or hedges are too chunky for our
 * current exposure.
 */
export const PositionFollowupPolicySchema = z.object({
  enabled: z.boolean(),
  /** Minimum mirror exposure before a market-floor follow-up is considered. */
  min_mirror_position_usdc: z.number().positive(),
  /** Also require `marketFloor × N` exposure so high-floor markets do not over-adjust. */
  market_floor_multiple: z.number().positive(),
  /** Target hedge/primary ratio required before mirroring an opposite-token hedge. */
  min_target_hedge_ratio: z.number().min(0).max(1),
  /** Minimum target-side opposite-token cost basis before a hedge is meaningful. */
  min_target_hedge_usdc: z.number().nonnegative(),
  /** Max single hedge as a fraction of our primary mirror exposure. */
  max_hedge_fraction_of_position: z.number().min(0).max(1),
  /** Max same-token layer as a fraction of our current mirror exposure. */
  max_layer_fraction_of_position: z.number().min(0).max(1),
});
export type PositionFollowupPolicy = z.infer<
  typeof PositionFollowupPolicySchema
>;

/**
 * Per-target configuration. Populated from `poly_copy_trade_targets` rows +
 * per-tenant scaffolding defaults; daily / hourly caps now live on the
 * tenant's `poly_wallet_grants` row and are enforced by `authorizeIntent`.
 */
export const MirrorTargetConfigSchema = z.object({
  /** Synthetic UUID (deterministic from target wallet) for `client_order_id` correlation. */
  target_id: z.string().uuid(),
  /** The wallet being copied. 0x-prefixed 40-hex. */
  target_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Tenant data column. FK → billing_accounts.id. */
  billing_account_id: z.string(),
  /** RLS key column. FK → users.id — owner of this tracked target. */
  created_by_user_id: z.string(),
  /** `live` → PolymarketClobAdapter; `paper` → paper adapter. */
  mode: z.enum(["live", "paper"]),
  /** Per-target sizing policy. See SizingPolicySchema. */
  sizing: SizingPolicySchema,
  /**
   * Per-target placement policy. Default `mirror_limit` (task.5001). Bootstrap
   * sets it when hydrating from `poly_copy_trade_targets`; persistence to a
   * DB column is deferred to task.0347.
   */
  placement: PlacementPolicySchema,
  /**
   * Optional position-aware follow-up policy. When absent, every BUY uses the
   * configured entry sizing policy exactly as before.
   */
  position_followup: PositionFollowupPolicySchema.optional(),
});
export type MirrorTargetConfig = z.infer<typeof MirrorTargetConfigSchema>;

/**
 * Mirror's local-DB cache view of our own exposure on a single Polymarket
 * `condition_id`. **Authority #4 only** (per `docs/design/poly-positions.md`).
 * Used as a *signal* input for mirror policy decisions (hedge-followup,
 * layering, SELL-routing pre-check). Never authority for "do we still hold
 * shares on chain?" — that path goes through `getOperatorPositions` (#3 →
 * #1) as today.
 *
 * Quantities are intent-based (computed from fills' `size_usdc / limit_price`)
 * and include rows in `pending | open | filled | partial`. Excludes
 * `canceled | error | closed` and lifecycles past `closing`. Fail-safe upward —
 * follow-on sizing under-shoots rather than over-shoots.
 *
 * Single source of truth — trading-slice only emits generic
 * `PositionIntentAggregate` rows; this type is the mirror-vocabulary overlay
 * that copy-trade computes via `aggregatePositionRows()`.
 */
export const MirrorPositionViewSchema = z.object({
  condition_id: z.string(),
  our_token_id: z.string().optional(),
  our_qty_shares: z.number(),
  our_vwap_usdc: z.number().optional(),
  opposite_token_id: z.string().optional(),
  opposite_qty_shares: z.number(),
});
export type MirrorPositionView = z.infer<typeof MirrorPositionViewSchema>;

export const TargetConditionTokenPositionSchema = z.object({
  token_id: z.string(),
  size_shares: z.number().nonnegative(),
  cost_usdc: z.number().nonnegative(),
  current_value_usdc: z.number().nonnegative(),
});
export type TargetConditionTokenPosition = z.infer<
  typeof TargetConditionTokenPositionSchema
>;

/**
 * Live target-wallet position context for the current condition. v0 reads this
 * from Polymarket Data API `/positions?user=<target>&market=<conditionId>`.
 * It is not persisted yet; future target-fill/position storage should feed
 * this exact shape so the planner remains pure.
 */
export const TargetConditionPositionViewSchema = z.object({
  condition_id: z.string(),
  tokens: z.array(TargetConditionTokenPositionSchema),
});
export type TargetConditionPositionView = z.infer<
  typeof TargetConditionPositionViewSchema
>;

export const PositionBranchSchema = z.enum([
  "none",
  "new_entry",
  "layer",
  "hedge",
  "sell_close",
]);
export type PositionBranch = z.infer<typeof PositionBranchSchema>;

/**
 * Pure aggregator: collapse generic per-(market, token) intent aggregates
 * into a `Map<condition_id, MirrorPositionView>` keyed by the fill's
 * `condition_id` (== `market_id` in the trading vocabulary).
 *
 * For binary markets (≤2 token_ids per condition_id) we surface both
 * `our_token_id` (larger long leg) and `opposite_token_id` (the other leg).
 * For multi-outcome markets (>2 token_ids), `opposite_token_id` is left
 * undefined — hedge predicate downstream no-ops, per
 * HEDGE_PREDICATE_NOOPS_ON_UNKNOWN_OPPOSITE.
 *
 * Pure — no I/O. Designed to be called once per snapshot; output is read by
 * the planner per-fill via `state.position`.
 */
export function aggregatePositionRows(
  rows: Array<{
    market_id: string;
    token_id: string;
    net_shares: number;
    gross_usdc_in: number;
    gross_shares_in: number;
  }>
): Map<string, MirrorPositionView> {
  const byCondition = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byCondition.get(row.market_id);
    if (bucket) bucket.push(row);
    else byCondition.set(row.market_id, [row]);
  }

  const out = new Map<string, MirrorPositionView>();
  for (const [condition_id, group] of byCondition) {
    const sorted = [...group].sort((a, b) => b.net_shares - a.net_shares);
    const longLeg = sorted[0];
    const otherLeg = group.length === 2 ? sorted[1] : undefined;
    const longShares = longLeg ? longLeg.net_shares : 0;

    if (longShares <= 0 && (!otherLeg || otherLeg.net_shares <= 0)) {
      // No active exposure either leg — skip empty entry.
      continue;
    }

    const view: MirrorPositionView = {
      condition_id,
      our_qty_shares: longShares > 0 ? longShares : 0,
      opposite_qty_shares:
        otherLeg && otherLeg.net_shares > 0 ? otherLeg.net_shares : 0,
    };
    if (longShares > 0 && longLeg?.token_id) {
      view.our_token_id = longLeg.token_id;
      if (longLeg.gross_shares_in > 0) {
        view.our_vwap_usdc = longLeg.gross_usdc_in / longLeg.gross_shares_in;
      }
    }
    if (group.length === 2 && otherLeg?.token_id) {
      view.opposite_token_id = otherLeg.token_id;
    }
    out.set(condition_id, view);
  }
  return out;
}

/**
 * Snapshot of runtime state at plan-time. The pipeline computes this via a
 * SELECT over `poly_copy_trade_fills` and hands it to `planMirrorFromFill()`
 * — the pure function does NOT reach into the DB. Cap-window state has moved
 * to `authorizeIntent` and is no longer part of this snapshot.
 */
export const RuntimeStateSchema = z.object({
  /** client_order_id values that already exist in poly_copy_trade_fills — idempotency gate. */
  already_placed_ids: z.array(z.string()),
  /**
   * Sum of `intent` `size_usdc` for non-canceled rows for this tenant ×
   * market (includes `error` rows; bug.0430). Drives the per-position cap
   * check in `applySizingPolicy`. Intent-based, not filled-based — see
   * `OrderLedger.cumulativeIntentForMarket` for the rationale. Optional:
   * when omitted (`undefined`), the
   * per-position cap is skipped — preserves the SELL path and any caller
   * that hasn't opted in.
   */
  cumulative_intent_usdc_for_market: z.number().optional(),
  /**
   * Mirror cache view for this fill's `condition_id`, derived from
   * `poly_copy_trade_fills` at snapshot time. Undefined ⇒ no prior
   * mirror exposure on this condition. Cache view, not authority — see
   * `MirrorPositionViewSchema`.
   *
   * v0 surfaces the field but follow-on planner branches (hedge-followup,
   * SELL-mirror, layering, bankroll sizer) land in subsequent PRs as
   * predicates against this field.
   */
  position: MirrorPositionViewSchema.optional(),
  /**
   * Target wallet's current position on the same condition. v0 is a live
   * Data-API read; vNext should hydrate from persisted target activity.
   */
  target_position: TargetConditionPositionViewSchema.optional(),
});
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

/**
 * Bounded enum of skip / success reasons. Used verbatim as a Prometheus label
 * (`poly_mirror_decisions_total{outcome, reason}`). Keep small + stable.
 */
export const MirrorReasonSchema = z.enum([
  "already_placed",
  "mode_paper",
  "market_unknown",
  "ok",
  /** SELL fill where the operator holds no position — skip, do not open a short. */
  "sell_without_position",
  /** SELL fill routed through closePosition — recorded as the reason on the `placed` row. */
  "sell_closed_position",
  /**
   * task.5001 — a resting mirror order already exists for this
   * (tenant, target, market). Fill arrived from a subsequent target trade on
   * the same market while our prior limit is still pending/open/partial.
   */
  "already_resting",
  /**
   * Target fill × current limit_price × market share-min exceeds the user's
   * `max_usdc_per_trade` ceiling — skip rather than scale past the ceiling.
   * bug.0342.
   */
  "below_market_min",
  /**
   * Tenant's existing committed exposure to this market plus the proposed
   * intent's `size_usdc` would exceed `max_usdc_per_trade`. v0 reuses the
   * per-trade cap field as a per-position bound (one knob, both checks).
   * task.0424.
   */
  "position_cap_reached",
  /**
   * Target token position is below the configured wallet-stat percentile
   * threshold, so the mirror treats the trigger as low-conviction noise and
   * does not place.
   */
  "below_target_percentile",
  /** Existing same-token mirror position is being scaled in after the token-position pXX gate. */
  "layer_scale_in",
  /** Existing mirror position is being hedged with the binary opposite token after the token-position pXX gate. */
  "hedge_followup",
  /** Market-min follow-up would be too chunky for the current mirror position. */
  "followup_position_too_small",
  /** Target total condition/token position is not large enough to override pXX. */
  "target_position_below_threshold",
  /** Target position ratio says no additional mirror follow-up is needed. */
  "followup_not_needed",
]);
export type MirrorReason = z.infer<typeof MirrorReasonSchema>;

/**
 * Outcome of `planMirrorFromFill()`. `kind: "place"` carries an `OrderIntent`
 * ready for the executor; `kind: "skip"` just carries the reason.
 */
export type MirrorPlan =
  | {
      kind: "place";
      reason: "ok" | "mode_paper" | "layer_scale_in" | "hedge_followup";
      position_branch: PositionBranch;
      intent: OrderIntent;
    }
  | {
      kind: "skip";
      reason: Exclude<MirrorReason, "ok" | "sell_closed_position">;
      position_branch: PositionBranch;
    };

/** Inputs to `planMirrorFromFill()` — bundled for clarity + testability. */
export interface PlanMirrorInput {
  fill: Fill;
  config: MirrorTargetConfig;
  state: RuntimeState;
  /** Pre-computed idempotency key via `clientOrderIdFor(target_id, fill_id)`. */
  client_order_id: `0x${string}`;
  /**
   * Market-enforced minimum share count for this fill's token. Used by the
   * sizing policy to compute effective notional in share-space. Optional:
   * when absent, the market-min guard is skipped (legacy behavior). bug.0342.
   */
  min_shares?: number | undefined;
  /**
   * Platform-enforced USDC-notional floor for a marketable BUY (e.g.
   * Polymarket = $1). Applies orthogonally to `min_shares`.
   */
  min_usdc_notional?: number | undefined;
}

/**
 * Result of applying `MirrorTargetConfig.sizing` to a fill — either a concrete
 * notional to submit, or a bounded skip reason.
 */
export type SizingResult =
  | { ok: true; size_usdc: number }
  | {
      ok: false;
      reason:
        | "below_market_min"
        | "position_cap_reached"
        | "below_target_percentile"
        | "followup_position_too_small"
        | "target_position_below_threshold"
        | "followup_not_needed";
    };
