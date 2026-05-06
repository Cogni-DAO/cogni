// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/current-position-staleness`
 * Purpose: Single source of truth for the "fresh active position" predicate
 *          applied to `poly_trader_current_positions` reads on user-facing
 *          surfaces. Replaces ad-hoc `WHERE active = true` clauses that were
 *          summing phantom rows accumulated when /positions pagination caps
 *          out for big wallets and the writer skips its complete-only
 *          deactivation path (trader-observation-service.ts:656-658).
 * Scope: Pure SQL fragment helpers. No DB IO. Both raw `sql` callers and
 *        Drizzle ORM callers need a way to apply this; export both shapes.
 * Invariants:
 *   - FRESH_OBSERVATION_ONLY: rows whose `last_observed_at` is older than
 *     STALE_POSITION_TTL are excluded from user-facing aggregations and lists.
 *   - SINGLE_PREDICATE: every consumer of `poly_trader_current_positions`
 *     that renders a user-visible number routes through this module.
 *     Internal-only enumerations (price-history asset list, market-outcome
 *     condition list, metadata projector) intentionally do NOT apply this
 *     filter — they want the full universe of observed assets, not just the
 *     fresh subset.
 * Side-effects: none
 * Links: work/items/bug.5020 (read-time mitigation), work/items/bug.5025
 *        (writer-side fix), work/items/bug.5026 (cross-surface consistency)
 * @public
 */

import { polyTraderCurrentPositions } from "@cogni/poly-db-schema/trader-activity";
import { type SQL, and, eq, gte, sql } from "drizzle-orm";

/**
 * Maximum age of a `last_observed_at` timestamp before a row is considered
 * stale on user-facing reads. Calibrated against the trader-observation
 * tick cadence — see `bootstrap/jobs/trader-observation.job.ts`. Bump if
 * the tick cadence slows.
 */
export const STALE_POSITION_TTL = "6 hours";

/**
 * Drizzle WHERE-clause builder for "fresh + active" current positions.
 * Use in `.where(...)` calls.
 */
export function freshActiveCurrentPositions(): SQL | undefined {
  return and(
    eq(polyTraderCurrentPositions.active, true),
    gte(
      polyTraderCurrentPositions.lastObservedAt,
      sql`NOW() - INTERVAL '6 hours'`
    )
  );
}

/**
 * Raw-SQL fragment for "fresh + active" — for templates that build their
 * own WHERE clause via `sql\`\``. Pass `tableAlias` matching the FROM clause.
 *
 * Example: `WHERE ${freshActiveSql("p")} AND p.trader_wallet_id = ...`
 */
export function freshActiveSql(tableAlias: string): SQL {
  return sql.raw(
    `${tableAlias}.active = true AND ${tableAlias}.last_observed_at >= NOW() - INTERVAL '6 hours'`
  );
}
