// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/decide`
 * Purpose: Pure copy-trade decision function — given a normalized Fill, the target config, and a runtime-state snapshot, return either `place` with a concrete OrderIntent or `skip` with a bounded reason code. Survives every future phase — poll, WS ingester, Temporal workflow all call the same function.
 * Scope: Pure function. Does not perform I/O, does not read env, does not import adapters. All runtime state (caps, idempotency set, kill-switch) is supplied by the caller.
 * Invariants:
 *   - FAIL_CLOSED — kill-switch disabled OR unreadable → the caller must synthesize `{enabled: false}` and decide() returns skip/kill_switch_off. Caller MUST NOT default to enabled on read failure.
 *   - INTENT_BASED_CAPS — `today_spent_usdc` and `fills_last_hour` are counted against INTENT submissions, not realized fills. Strict `>` comparison: a submission that lands at exactly `max_daily_usdc` is allowed; the NEXT submission is skipped. Revisit in P3 with paper-PnL evidence.
 *   - IDEMPOTENT_BY_CLIENT_ID — repeat of the same `(target_id, fill_id)` is silently dropped via `already_placed_ids`. Matches the DB PK on `poly_copy_trade_fills`.
 *   - DECIDE_IS_PURE — no side effects; same input → same output.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.1 — stable-boundary decide())
 * @public
 */

import type { OrderIntent } from "@cogni/market-provider";

import type { DecideInput, MirrorDecision } from "./types.js";

/**
 * Cogni's "should we mirror this fill?" function.
 *
 * Order of checks (short-circuits on the first skip reason):
 *   1. kill-switch off          → skip/kill_switch_off
 *   2. already placed (PK+cid)  → skip/already_placed
 *   3. daily USDC cap hit       → skip/daily_cap_hit
 *   4. rate cap hit             → skip/rate_cap_hit
 *   5. mode === 'paper'         → place (paper adapter; P3 body)
 *   6. otherwise                → place (live)
 *
 * The `mode==='paper'` branch still returns `place` so the executor decides
 * which adapter to route to; only the `provider` on `OrderIntent` differs.
 */
export function decide(input: DecideInput): MirrorDecision {
  const { fill, config, state, client_order_id } = input;

  if (!config.enabled) return { action: "skip", reason: "kill_switch_off" };

  if (state.already_placed_ids.includes(client_order_id)) {
    return { action: "skip", reason: "already_placed" };
  }

  // Intent-based cap check — adds THIS intent's mirror_usdc against today's spent.
  if (state.today_spent_usdc + config.mirror_usdc > config.max_daily_usdc) {
    return { action: "skip", reason: "daily_cap_hit" };
  }

  if (state.fills_last_hour >= config.max_fills_per_hour) {
    return { action: "skip", reason: "rate_cap_hit" };
  }

  const intent = buildIntent(fill, config, client_order_id);

  return {
    action: "place",
    reason: config.mode === "paper" ? "mode_paper" : "ok",
    intent,
  };
}

/**
 * Build a canonical `OrderIntent` from the fill + target config.
 * Mirror size is a FIXED `mirror_usdc` notional, not proportional to the
 * target's size — keeps caps deterministic and the math auditable.
 *
 * The `token_id` attribute (Polymarket ERC-1155 asset id) is lifted from
 * the normalized `Fill.attributes.asset`. Failing that, the executor
 * rejects with a clear error — we don't fabricate a token id.
 */
function buildIntent(
  fill: DecideInput["fill"],
  config: DecideInput["config"],
  client_order_id: `0x${string}`
): OrderIntent {
  const tokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";

  // `OrderIntent.provider` always = "polymarket" for these fills. The
  // live-vs-paper routing is a runtime concern on the executor (driven by
  // `config.mode`), not a property of the intent — the intent describes
  // the market, not the execution venue.
  return {
    provider: "polymarket",
    market_id: fill.market_id,
    outcome: fill.outcome,
    side: fill.side,
    size_usdc: config.mirror_usdc,
    // Copy the target's fill price verbatim. Executor may adjust per book
    // microstructure (tick / best_ask) before signing; decide() stays pure.
    limit_price: fill.price,
    client_order_id,
    attributes: {
      token_id: tokenId,
      source_fill_id: fill.fill_id,
      target_wallet: fill.target_wallet,
    },
  };
}
