// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@adapters/server/redeem/drizzle-market-outcomes`
 * Purpose: Drizzle/Postgres implementation of `MarketOutcomesPort`. Backs
 *   `poly_market_outcomes` (existing table; previously unpopulated). Idempotent
 *   UPSERT keyed on `(condition_id, token_id)`.
 * Scope: Persistence only.
 * Invariants:
 *   - UPSERT_IS_IDEMPOTENT — re-receiving the same chain log produces the
 *     same row state.
 * Side-effects: IO (database writes).
 * Links: docs/design/poly-redeem-chain-authority.md, bug.5008
 * @public
 */

import { sql } from "drizzle-orm";

import type { Database } from "@/adapters/server/db/client";
import type { MarketOutcomesPort, MarketOutcomeUpsertInput } from "@/ports";
import { polyMarketOutcomes } from "@/shared/db";

export class DrizzleMarketOutcomesAdapter implements MarketOutcomesPort {
  constructor(private readonly db: Database) {}

  async upsert(input: MarketOutcomeUpsertInput): Promise<void> {
    await this.db
      .insert(polyMarketOutcomes)
      .values({
        conditionId: input.conditionId,
        tokenId: input.tokenId,
        outcome: input.outcome,
        payout: input.payout,
        resolvedAt: input.resolvedAt,
        raw: input.raw,
      })
      .onConflictDoUpdate({
        target: [polyMarketOutcomes.conditionId, polyMarketOutcomes.tokenId],
        set: {
          outcome: sql`EXCLUDED.outcome`,
          payout: sql`EXCLUDED.payout`,
          resolvedAt: sql`EXCLUDED.resolved_at`,
          raw: sql`EXCLUDED.raw`,
          updatedAt: sql`now()`,
        },
      });
  }
}
