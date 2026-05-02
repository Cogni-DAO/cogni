---
id: design.poly-mirror-position-projection
type: design
status: needs_implement
created: 2026-05-02
updated: 2026-05-02
tags: [poly, copy-trading, mirror, position, primitive]
implements: bug.5003
---

# Poly Mirror — Position Projection

## Outcome

`planMirrorFromFill()` can branch on **"do we have an open position on this `condition_id`, and on which token?"** without reading the DB and without breaking `PLAN_IS_PURE`. This unblocks SELL-mirror, hedge-followup (story.5000), and bankroll-fractional sizing — none of which can be implemented cleanly today because the planner has no concept of position.

## Why now

`docs/research/poly/mirror-divergence-2026-05-01.md` Findings D + E show every mirror gap traces to the same missing primitive: per-`condition_id` position state. We've stacked three sizing variants and a SELL branch onto a model that only knows "this fill is the first time we've seen this market." Stop adding policies; add the missing data.

## Scope

**In:** Compute `Position` per `(target_id, condition_id)` from `poly_copy_trade_fills`, plumb into `RuntimeState`, surface via `OrderLedger.snapshotState`.
**Out:** New sizing policies, exit-trigger logic, layering policy, hedge-followup decision logic. Those follow-on designs reduce to predicates on this primitive.

## Approach

**One change in three small parts:**

1. Extend `OrderLedger.snapshotState` (existing per-tick read) to also return `positions_by_condition: Map<condition_id, Position>` derived in SQL from `poly_copy_trade_fills`. Already-tenant-scoped, already-RLS-safe, already-fail-closed.
2. Plumb the map into `RuntimeState`. Pipeline picks the entry for the fill's `condition_id` and passes it as a single optional field to the planner.
3. `planMirrorFromFill` reads `state.position` synchronously. Pure.

### `Position` shape

```ts
export const PositionSchema = z.object({
  condition_id: z.string(),
  /** Net long-share token we hold; undefined if both legs are zero. */
  our_token_id: z.string().optional(),
  /** Net shares (BUY − SELL accounting on `our_token_id`). */
  our_qty_shares: z.number(),
  /** Sum-of-USDC-in / sum-of-shares-in for `our_token_id`. */
  our_vwap_usdc: z.number().optional(),
  /** The complementary token in this binary market. Always derivable from market metadata. */
  opposite_token_id: z.string().optional(),
  /** Net shares we hold of `opposite_token_id` (usually 0; non-zero ⇒ we hedged earlier). */
  opposite_qty_shares: z.number(),
  /** Total USDC currently committed (open + filled, not canceled) on this condition. */
  cumulative_intent_usdc: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;
```

`our_token_id` is the larger-position leg; `opposite_token_id` is the other leg of the binary market. For non-binary markets (>2 outcomes) we represent only the side(s) we've actually traded — the projection is per `(condition_id, token_id)` underneath, with a binary helper view. Today's data is binary-only; multi-outcome surfaces unchanged.

### Storage decision — derive on read, no new table

| Option | Verdict |
|---|---|
| **A. Derive in SQL inside `snapshotState` (CHOSEN)** | One extra `GROUP BY` on the same query path. No new table, no migration, no triggers. Fail-closed already wired. Per-tick cost is the cost of a SUM over the target's history (~hundreds of rows worst case; index on `target_id` exists). |
| B. New materialized table + write-side maintenance | Adds invalidation surface, race on insert-vs-place, doubles the write path. Defer until SQL aggregation is measurably slow. |
| C. In-memory cache outside the ledger | Breaks `FAIL_CLOSED_ON_SNAPSHOT_READ` semantics; first cold read after restart returns nothing. |

**SQL sketch** (added to existing `Promise.all` in `snapshotState`):

```sql
SELECT
  market_id                                          AS condition_id,
  attributes->>'token_id'                            AS token_id,
  SUM(
    CASE WHEN attributes->>'side' = 'BUY'  THEN (attributes->>'size_usdc')::numeric / NULLIF((attributes->>'limit_price')::numeric, 0)
         WHEN attributes->>'side' = 'SELL' THEN -((attributes->>'size_usdc')::numeric / NULLIF((attributes->>'limit_price')::numeric, 0))
         ELSE 0 END
  )                                                  AS net_shares,
  SUM(
    CASE WHEN attributes->>'side' = 'BUY'  THEN (attributes->>'size_usdc')::numeric ELSE 0 END
  )                                                  AS gross_usdc_in,
  SUM(
    CASE WHEN attributes->>'side' = 'BUY'  THEN (attributes->>'size_usdc')::numeric / NULLIF((attributes->>'limit_price')::numeric, 0) ELSE 0 END
  )                                                  AS gross_shares_in
FROM poly_copy_trade_fills
WHERE target_id = $1
  AND status IN ('open','filled','partial')          -- exclude canceled/error from position math
  AND (position_lifecycle IS NULL OR position_lifecycle IN ('unresolved','open','closing'))
  AND attributes->>'closed_at' IS NULL
GROUP BY market_id, attributes->>'token_id';
```

Application code aggregates per-`condition_id`: collapses the (up to two) token_id rows into a single `Position`. `our_token_id` = the row with positive `net_shares`; `opposite_token_id` = the other token in the binary, looked up from market metadata cache (already on the fill's `attributes.token_id` companion if both legs traded; else fetched lazily via existing market-meta path — out of scope here).

VWAP = `gross_usdc_in / gross_shares_in` on the long leg.

### Plumbing into `RuntimeState`

Add one optional field — keeps the existing schema additive, no migration to consumers:

```ts
export const RuntimeStateSchema = z.object({
  already_placed_ids: z.array(z.string()),
  cumulative_intent_usdc_for_market: z.number().optional(),
  /** NEW. Position on the condition_id of the fill being planned. Undefined ⇒ no prior exposure. */
  position: PositionSchema.optional(),
});
```

`mirror-pipeline.ts:processFill` picks `snapshot.positions_by_condition.get(fill.market_id)` and assigns to `state.position`. No new I/O — `snapshotState` is already called once per tick.

### `OrderLedger` surface change

```ts
export interface StateSnapshot {
  today_spent_usdc: number;
  fills_last_hour: number;
  already_placed_ids: string[];
  /** NEW. Per-condition position map derived in the same query batch. */
  positions_by_condition: Map<string, Position>;
}
```

Fail-closed path returns `positions_by_condition: new Map()` alongside the existing zeroes — preserves `FAIL_CLOSED_ON_SNAPSHOT_READ`.

## Backfill

None needed. `poly_copy_trade_fills` is already the source of truth; the projection is computed from it on every tick. First tick after deploy reflects full historical state automatically.

## How follow-ons reduce to predicates on `state.position`

Sketches only — full designs land in their own items.

| Follow-on | Predicate on `state.position` | Action |
|---|---|---|
| **story.5000 hedge-followup** | `position && position.our_qty_shares > 0 && fill.attributes.token_id === position.opposite_token_id` | Bypass percentile filter; size ≤ `position.our_qty_shares × fill.price` |
| **SELL-mirror (close-on-target-SELL)** | `position && position.our_token_id === fill.attributes.token_id && fill.side === 'SELL'` | Route to `closePosition` sized `min(target_close_pct × position.our_qty_shares, position.our_qty_shares)` |
| **Bankroll-fractional sizer** | `position?.our_qty_shares ?? 0` is one input alongside our wallet balance | Size = `f(target_trade_$, target_bankroll, our_bankroll, existing_position)` |
| **Layering-aware filter** | `position && fill.attributes.token_id === position.our_token_id && fill.side === 'BUY'` | Bypass percentile filter when scaling into a position we already mirrored on the primary leg |

Each is a 1–2-line predicate against `state.position`. Without this primitive, each is a new architecture.

## Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **PLAN_IS_PURE preserved** — `planMirrorFromFill` reads `state.position` synchronously; no DB access added to the planner.
- [ ] **POSITION_DERIVED_AT_SNAPSHOT** — `Position` is computed inside `OrderLedger.snapshotState` only. No second source of truth, no write-side maintenance, no cache layer.
- [ ] **FAIL_CLOSED_ON_SNAPSHOT_READ** — DB error → `positions_by_condition: new Map()`, same warn log path as the existing zeroes branch.
- [ ] **CAPS_LIVE_IN_GRANT untouched** — daily/hourly caps still resolve in `authorizeIntent` against `poly_wallet_grants`. The position primitive is a *signal* input, never a *cap*.
- [ ] **POSITION_SHAPE_BINARY_FIRST** — `Position` exposes `our_token_id` / `opposite_token_id` for binary markets; multi-outcome markets store only the leg(s) actually traded and surface `opposite_token_id: undefined`.
- [ ] **NO_NEW_TABLE** — schema migration not required. If a future perf measurement justifies materialization, it lands as its own design.

## Files

- **Modify** `nodes/poly/app/src/features/trading/order-ledger.types.ts` — add `Position` type, extend `StateSnapshot`.
- **Modify** `nodes/poly/app/src/features/trading/order-ledger.ts` — extend `snapshotState` with the GROUP BY, aggregate to `Map<condition_id, Position>`, add to fail-closed return.
- **Modify** `nodes/poly/app/src/features/copy-trade/types.ts` — add `PositionSchema`, extend `RuntimeStateSchema` with optional `position`.
- **Modify** `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts` — `processFill` picks `positions_by_condition.get(fill.market_id)` into `state.position`. No I/O added.
- **Test** `nodes/poly/app/tests/unit/features/trading/order-ledger-position-snapshot.test.ts` — covers: empty history, single BUY, BUY-only same token, BUY then partial SELL, both legs (hedge), canceled rows excluded, multi-outcome (>2 tokens) graceful.
- **Test** `nodes/poly/app/tests/unit/features/copy-trade/plan-mirror-position-state.test.ts` — covers: planner receives `position`, planner does not call DB, planner stays pure (deepEqual same input → same output across N runs).

## Rejected alternatives

- **Materialized `poly_copy_trade_positions` table** — write-path complexity (insert/update on every fill, race against placement), invalidation surface, ALTER. Defer until measured.
- **Compute `Position` inside `planMirrorFromFill`** — breaks `PLAN_IS_PURE`; planner becomes I/O-bound.
- **Per-fill query for position (separate call from `snapshotState`)** — adds N round-trips per tick where today there's one. The aggregation is cheap inside the existing query batch.
- **Live position from Polymarket Data-API (read upstream wallet state)** — bypasses our own ledger, reintroduces clock-skew between target observation and our exposure. We trust our fills.

## Next

`/implement` — single PR, ~150–300 LOC including tests. No migration. No new package. Branch off `main`.
