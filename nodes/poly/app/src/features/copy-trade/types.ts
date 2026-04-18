// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/types`
 * Purpose: Port-level types for the copy-trade decide/execute boundary — `TargetConfig`, `RuntimeState`, `MirrorDecision`, skip-reason enum.
 * Scope: Pure type surface consumed by `decide.ts`, `clob-executor.ts`, and the poll job. Does not contain logic, does not import adapters.
 * Invariants: MIRROR_REASON_BOUNDED — reason codes are an enum (bounded Prom label cardinality); DECISION_IS_PURE_INPUT — all runtime state is handed to decide() explicitly, never read at decide-time.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.1)
 * @public
 */

import type { Fill, OrderIntent } from "@cogni/market-provider";
import { z } from "zod";

/**
 * Per-target configuration. P1 sources from env and constructs one per boot;
 * P2 sources from `poly_copy_trade_targets` rows. Shape is frozen across phases.
 */
export const TargetConfigSchema = z.object({
  /** Synthetic UUID for P1 (one per env target wallet); FK into `poly_copy_trade_targets` in P2. */
  target_id: z.string().uuid(),
  /** The wallet being copied. 0x-prefixed 40-hex. */
  target_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** `live` → PolymarketClobAdapter; `paper` → paper adapter (P3). */
  mode: z.enum(["live", "paper"]),
  /** Notional USDC to mirror per fill (fixed size, not proportional). */
  mirror_usdc: z.number().positive(),
  /** Intent-based USDC cap per UTC day (see decide.ts header). */
  max_daily_usdc: z.number().positive(),
  /** Rate cap per rolling-1-hour window, intent-based. */
  max_fills_per_hour: z.number().int().positive(),
  /** Global kill-switch state (read from `poly_copy_trade_config.enabled`). */
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
]);
export type MirrorReason = z.infer<typeof MirrorReasonSchema>;

/**
 * Outcome of `decide()`. `action: "place"` carries an `OrderIntent` ready
 * for the executor; `action: "skip"` just carries the reason.
 */
export type MirrorDecision =
  | { action: "place"; reason: "ok" | "mode_paper"; intent: OrderIntent }
  | { action: "skip"; reason: Exclude<MirrorReason, "ok"> };

/** Inputs to `decide()` — bundled for clarity + testability. */
export interface DecideInput {
  fill: Fill;
  config: TargetConfig;
  state: RuntimeState;
  /** Pre-computed idempotency key via `clientOrderIdFor(target_id, fill_id)`. */
  client_order_id: `0x${string}`;
}
