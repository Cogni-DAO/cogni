// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/types`
 * Purpose: Port-level types for the copy-trade decide/execute boundary — `TargetConfig`, `SizingPolicy`, `RuntimeState`, `MirrorDecision`, skip-reason enum.
 * Scope: Pure type surface consumed by `decide.ts`, `clob-executor.ts`, and the poll job. Does not contain logic, does not import adapters.
 * Invariants:
 *   - MIRROR_REASON_BOUNDED — reason codes are an enum (bounded Prom label cardinality).
 *   - DECISION_IS_PURE_INPUT — all runtime state is handed to decide() explicitly, never read at decide-time.
 *   - TARGET_CONFIG_CARRIES_TENANT — every TargetConfig carries `billing_account_id` (data) + `created_by_user_id` (RLS key) so downstream fills/decisions writes inherit tenant attribution.
 *   - SIZING_POLICY_IS_DISCRIMINATED — TargetConfig.sizing is a discriminated union on `kind`; future policies (proportional, percentile) add variants, never flat fields.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.1), work/items/bug.0342.poly-clob-dynamic-min-order-size.md, docs/spec/poly-multi-tenant-auth.md
 * @public
 */

import type { Fill, OrderIntent } from "@cogni/market-provider";
import { z } from "zod";

/**
 * Sizing policy — how the coordinator derives `OrderIntent.size_usdc` from a
 * target's fill. Discriminated union: today one variant; future variants
 * (proportional, percentile, historical-distribution) plug in by adding a new
 * `kind` without touching the adapter or the port.
 */
export const FixedSizingPolicySchema = z.object({
  kind: z.literal("fixed"),
  /** Desired notional USDC per mirrored fill, before market-min adjustment. */
  mirror_usdc: z.number().positive(),
  /**
   * Hard ceiling on notional USDC per mirrored intent. When a market's
   * share-min forces the notional above this value, the coordinator skips with
   * `reason: "below_market_min"` rather than overspending. Default equals
   * `mirror_usdc` (opt-out of scaling); callers opt in by setting it higher.
   */
  max_usdc_per_trade: z.number().positive(),
});
export type FixedSizingPolicy = z.infer<typeof FixedSizingPolicySchema>;

export const SizingPolicySchema = z.discriminatedUnion("kind", [
  FixedSizingPolicySchema,
]);
export type SizingPolicy = z.infer<typeof SizingPolicySchema>;

/**
 * Per-target configuration. P1 sources from env and constructs one per boot;
 * P2 sources from `poly_copy_trade_targets` rows. Shape is frozen across phases.
 */
export const TargetConfigSchema = z.object({
  /** Synthetic UUID for P1 (one per env target wallet); FK into `poly_copy_trade_targets` in P2. */
  target_id: z.string().uuid(),
  /** The wallet being copied. 0x-prefixed 40-hex. */
  target_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Tenant data column. FK → billing_accounts.id. */
  billing_account_id: z.string(),
  /** RLS key column. FK → users.id — owner of this tracked target. */
  created_by_user_id: z.string(),
  /** `live` → PolymarketClobAdapter; `paper` → paper adapter (P3). */
  mode: z.enum(["live", "paper"]),
  /** Per-target sizing policy. See SizingPolicySchema. */
  sizing: SizingPolicySchema,
  /** Intent-based USDC cap per UTC day (see decide.ts header). */
  max_daily_usdc: z.number().positive(),
  /** Rate cap per rolling-1-hour window, intent-based. */
  max_fills_per_hour: z.number().int().positive(),
  /** Per-tenant kill-switch state (read from `poly_copy_trade_config.enabled`). */
  enabled: z.boolean(),
});
export type TargetConfig = z.infer<typeof TargetConfigSchema>;

/**
 * Snapshot of runtime state at decide-time. The poll computes this via a
 * SELECT over `poly_copy_trade_fills` / `poly_copy_trade_decisions` and
 * hands it to `decide()` — the pure function does NOT reach into the DB.
 */
export const RuntimeStateSchema = z.object({
  /** Intent-based USDC already committed today (UTC date) for this target. */
  today_spent_usdc: z.number().min(0),
  /** Intent count over the last rolling hour for this target. */
  fills_last_hour: z.number().int().min(0),
  /** client_order_id values that already exist in poly_copy_trade_fills — idempotency gate. */
  already_placed_ids: z.array(z.string()),
});
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

/**
 * Bounded enum of skip / success reasons. Used verbatim as a Prometheus label
 * (`poly_copy_trade_decide_total{outcome, reason}`). Keep small + stable.
 */
export const MirrorReasonSchema = z.enum([
  "kill_switch_off",
  "daily_cap_hit",
  "rate_cap_hit",
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
   * Covers both "target's fill was small" and "user's ceiling was tight".
   * bug.0342.
   */
  "below_market_min",
]);
export type MirrorReason = z.infer<typeof MirrorReasonSchema>;

/**
 * Outcome of `decide()`. `action: "place"` carries an `OrderIntent` ready
 * for the executor; `action: "skip"` just carries the reason.
 */
export type MirrorDecision =
  | { action: "place"; reason: "ok" | "mode_paper"; intent: OrderIntent }
  | {
      action: "skip";
      reason: Exclude<MirrorReason, "ok" | "sell_closed_position">;
    };

/** Inputs to `decide()` — bundled for clarity + testability. */
export interface DecideInput {
  fill: Fill;
  config: TargetConfig;
  state: RuntimeState;
  /** Pre-computed idempotency key via `clientOrderIdFor(target_id, fill_id)`. */
  client_order_id: `0x${string}`;
  /**
   * Market-enforced minimum share count for this fill's token, fetched by the
   * coordinator via `MarketProviderPort.getMarketConstraints`. Used by the
   * sizing policy to compute effective notional in share-space (avoids float-
   * associativity round-trips through USDC). Optional: when absent, the
   * sizing policy skips the market-min guard (legacy behavior). bug.0342.
   */
  min_shares?: number | undefined;
}

/**
 * Result of applying `TargetConfig.sizing` to a fill — either a concrete
 * notional to submit, or a bounded skip reason. Pure output of
 * `applySizingPolicy(sizing, price, minShares)`; decide() maps onto this.
 */
export type SizingResult =
  | { ok: true; size_usdc: number }
  | { ok: false; reason: "below_market_min" };
