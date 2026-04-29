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
 * target's fill. Discriminated union: `"fixed"` (legacy desired-notional with
 * scaling ceiling) and `"min_bet"` (always bet the market's min, clamped to a
 * configured ceiling). Future variants (proportional, percentile, allocation)
 * plug in by adding a new `kind` without touching the adapter or the port.
 */
export const FixedSizingPolicySchema = z.object({
  kind: z.literal("fixed"),
  /** Desired notional USDC per mirrored fill, before market-min adjustment. */
  mirror_usdc: z.number().positive(),
  /**
   * Hard ceiling on notional USDC per mirrored intent. When a market's
   * share-min forces the notional above this value, the pipeline skips with
   * `reason: "below_market_min"` rather than overspending. Default equals
   * `mirror_usdc` (opt-out of scaling); callers opt in by setting it higher.
   */
  max_usdc_per_trade: z.number().positive(),
});
export type FixedSizingPolicy = z.infer<typeof FixedSizingPolicySchema>;

/**
 * Always-min-bet policy. Bet size is the market's `minUsdcNotional` (clamped to
 * `minShares × price` per SHARE_SPACE_MATH). When the floor exceeds
 * `max_usdc_per_trade`, the pipeline skips with `below_market_min` BEFORE the
 * `INSERT_BEFORE_PLACE` row lands — so cap-exceed cases are not duplicated at
 * the `authorizeIntent` boundary as `placement_failed` decisions.
 *
 * FCFS budget gating across multi-target copy-trading is handled downstream by
 * `authorizeIntent` against the tenant's `poly_wallet_grants` row
 * (`CAPS_LIVE_IN_GRANT`); this policy intentionally does not read grant state.
 */
export const MinBetSizingPolicySchema = z.object({
  kind: z.literal("min_bet"),
  /** Hard per-intent ceiling. Skip at plan-mirror when floor exceeds this. */
  max_usdc_per_trade: z.number().positive(),
});
export type MinBetSizingPolicy = z.infer<typeof MinBetSizingPolicySchema>;

export const SizingPolicySchema = z.discriminatedUnion("kind", [
  FixedSizingPolicySchema,
  MinBetSizingPolicySchema,
]);
export type SizingPolicy = z.infer<typeof SizingPolicySchema>;

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
  /** Per-tenant kill-switch state (read from `poly_copy_trade_config.enabled`). */
  enabled: z.boolean(),
});
export type MirrorTargetConfig = z.infer<typeof MirrorTargetConfigSchema>;

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
   * Sum of `intent` `size_usdc` for non-failed rows for this tenant ×
   * market. Drives the per-position cap check in `applySizingPolicy`.
   * Intent-based, not filled-based — see `OrderLedger.cumulativeIntentForMarket`
   * for the v0 rationale. Optional: when omitted (`undefined`), the
   * per-position cap is skipped — preserves the SELL path and any caller
   * that hasn't opted in.
   */
  cumulative_intent_usdc_for_market: z.number().optional(),
});
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

/**
 * Bounded enum of skip / success reasons. Used verbatim as a Prometheus label
 * (`poly_mirror_decisions_total{outcome, reason}`). Keep small + stable.
 */
export const MirrorReasonSchema = z.enum([
  "kill_switch_off",
  "already_placed",
  "mode_paper",
  "market_unknown",
  "ok",
  /** SELL fill where the operator holds no position — skip, do not open a short. */
  "sell_without_position",
  /** SELL fill routed through closePosition — recorded as the reason on the `placed` row. */
  "sell_closed_position",
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
]);
export type MirrorReason = z.infer<typeof MirrorReasonSchema>;

/**
 * Outcome of `planMirrorFromFill()`. `kind: "place"` carries an `OrderIntent`
 * ready for the executor; `kind: "skip"` just carries the reason.
 */
export type MirrorPlan =
  | { kind: "place"; reason: "ok" | "mode_paper"; intent: OrderIntent }
  | {
      kind: "skip";
      reason: Exclude<MirrorReason, "ok" | "sell_closed_position">;
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
  | { ok: false; reason: "below_market_min" | "position_cap_reached" };
