// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/current-position-staleness`
 * Purpose: Single source of truth for the "live current position" predicate
 *          applied to `poly_trader_current_positions` reads on user-facing
 *          surfaces. Replaces ad-hoc `WHERE active = true` clauses that
 *          summed (a) shares=0 closed positions Polymarket still returns when
 *          we poll with `sizeThreshold=0`, and (b) phantom rows accumulated
 *          when /positions pagination caps out for big wallets and the writer
 *          skips its complete-only deactivation path
 *          (trader-observation-service.ts:656-658).
 * Scope: Pure SQL fragment helpers. No DB IO. Both raw `sql` callers and
 *        Drizzle ORM callers need a way to apply this; export both shapes.
 * Invariants:
 *   - LIVE_POSITION_DEFINITION: a position is "live" iff
 *     `active = true AND shares > 0 AND last_observed_at >= NOW() - 6h`.
 *     `shares > 0` filters closed positions Polymarket still echoes back
 *     (sizeThreshold=0 returns them with size=0, frozen costBasis,
 *     currentValue=0); these would otherwise sum into derived PnL as the
 *     full historical cost. The 6h floor catches genuinely stale rows when
 *     the writer's complete-only deactivation path doesn't fire.
 *   - SINGLE_PREDICATE: every consumer of `poly_trader_current_positions`
 *     that renders a user-visible number routes through this module.
 *     Internal-only enumerations (price-history asset list, market-outcome
 *     condition list, metadata projector) intentionally do NOT apply this
 *     filter — they want the full universe of observed assets, not just the
 *     live subset.
 * Side-effects: none
 * Links: work/items/bug.5020 (read-time mitigation), work/items/bug.5025
 *        (writer-side fix), work/items/bug.5026 (cross-surface consistency)
 * @public
 */

import { polyTraderCurrentPositions } from "@cogni/poly-db-schema/trader-activity";
import { and, eq, gt, gte, type SQL, sql } from "drizzle-orm";

/**
 * Maximum age of a `last_observed_at` timestamp before a row is considered
 * stale on user-facing reads. Calibrated against the trader-observation
 * tick cadence — see `bootstrap/jobs/trader-observation.job.ts`. Bump if
 * the tick cadence slows.
 */
export const STALE_POSITION_TTL = "6 hours";

/**
 * Drizzle WHERE-clause builder for "live current position".
 * Use in `.where(...)` calls.
 */
export function liveCurrentPositions(): SQL | undefined {
  return and(
    eq(polyTraderCurrentPositions.active, true),
    gt(polyTraderCurrentPositions.shares, "0"),
    gte(
      polyTraderCurrentPositions.lastObservedAt,
      sql`NOW() - INTERVAL '6 hours'`
    )
  );
}

/**
 * Raw-SQL fragment for "live current position" — for templates that build
 * their own WHERE clause via `sql\`\``. Pass `tableAlias` matching the
 * FROM clause.
 *
 * Example: `WHERE ${liveCurrentPositionSql("p")} AND p.trader_wallet_id = ...`
 */
export function liveCurrentPositionSql(tableAlias: string): SQL {
  return sql.raw(
    `${tableAlias}.active = true AND ${tableAlias}.shares > 0 AND ${tableAlias}.last_observed_at >= NOW() - INTERVAL '6 hours'`
  );
}
