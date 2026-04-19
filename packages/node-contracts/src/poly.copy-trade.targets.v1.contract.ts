// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.copy-trade.targets.v1.contract`
 * Purpose: Contract for listing Polymarket wallets the operator is monitoring / copy-trading.
 * Scope: Defines response schema for GET /api/v1/poly/copy-trade/targets. Does not execute trades, does not modify state, does not own target-resolution logic.
 * Invariants:
 *   - V0_ENV_DERIVED: zero or more env-derived targets from `COPY_TRADE_TARGET_WALLETS` (comma-separated list).
 *   - P2_DB_BACKED: returns rows from `poly_copy_trade_targets` once the table exists.
 *   - GLOBAL_KILL_SWITCH_V0: all rows share `poly_copy_trade_config.enabled` in v0 — no per-target enable flag.
 * Side-effects: none
 * Notes: HARDCODED_USER — response is not user-scoped in v0 (single-operator prototype). Tracked as task.0315 P2 follow-up.
 * Links: work/items/task.0315.poly-copy-trade-prototype.md, docs/spec/poly-copy-trade-phase1.md
 * @public
 */

import { z } from "zod";

const targetSchema = z.object({
  /** Synthetic UUIDv5 derived from `target_wallet` in v0 (`targetIdFromWallet`). */
  target_id: z.string().uuid(),
  /** 0x-prefixed 40-hex — the wallet being watched / copied. */
  target_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** `"paper"` = shadow into paper_orders (P3); `"live"` = real Polymarket placement. */
  mode: z.enum(["paper", "live"]),
  /** Fixed mirror notional per fill (USDC). */
  mirror_usdc: z.number().positive(),
  /** Intent-based daily USDC cap. */
  max_daily_usdc: z.number().positive(),
  /** Intent-based rate cap per rolling hour. */
  max_fills_per_hour: z.number().int().positive(),
  /** Per-target enable flag. v0 uses the global kill-switch; this field is always true in v0. */
  enabled: z.boolean(),
  /** Provenance: `"env"` in v0 (env fallback); `"db"` in P2 when row is in `poly_copy_trade_targets`. */
  source: z.enum(["env", "db"]),
});

export const polyCopyTradeTargetsOperation = {
  id: "poly.copy-trade.targets.v1",
  summary: "List wallets the operator is monitoring / copy-trading",
  description:
    "Returns the active monitoring list. v0 returns env-derived targets parsed from COPY_TRADE_TARGET_WALLETS (comma-separated); empty when unset.",
  input: z.object({}),
  output: z.object({
    targets: z.array(targetSchema),
  }),
} as const;

export type PolyCopyTradeTarget = z.infer<typeof targetSchema>;
export type PolyCopyTradeTargetsOutput = z.infer<
  typeof polyCopyTradeTargetsOperation.output
>;
