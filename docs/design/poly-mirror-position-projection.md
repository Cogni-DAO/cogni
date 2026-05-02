---
id: design.poly-mirror-position-projection
type: design
status: needs_implement
created: 2026-05-02
updated: 2026-05-02
tags: [poly, copy-trading, mirror, position, primitive]
implements: bug.5003
---

# Poly Mirror — Position Projection (`MirrorPositionView`)

## Outcome

`planMirrorFromFill()` can branch on **"do we have an open mirror position on this `condition_id`, and on which token?"** without reading the DB and without breaking `PLAN_IS_PURE`. This unblocks SELL-mirror, hedge-followup (story.5000), bankroll-fractional sizing, and layering-aware filtering — none of which can be implemented cleanly today because the planner has no concept of position.

## Why now

`docs/research/poly/mirror-divergence-2026-05-01.md` Findings D + E show every mirror gap traces to the same missing primitive: per-`condition_id` position state. We've stacked three sizing variants and a SELL branch onto a model that only knows "this fill is the first time we've seen this market." Stop adding policies; add the missing data.

## Reconciliation with the canonical position model

`docs/design/poly-positions.md` (Derek, 2026-04-26) defines the project-wide position model: **one identity, four authorities, seven states.** This design is **not** an alternate position model — it is a strictly-bounded _cache view_ against authority **#4 Local DB**, used **only** as a _signal_ input to mirror policy decisions.

| Concern                                                                               | Authority used                                       | Type                                                   |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| **Mirror policy hint** ("did we already mirror this condition? on which side?")       | #4 Local DB cache (this design)                      | `MirrorPositionView` (new)                             |
| **Settlement / redeem authority** ("do we actually still own these shares on chain?") | #1 Polygon chain via `poly_redeem_jobs` flow         | `OperatorPosition` + chain reads (existing, unchanged) |
| **SELL routing pre-check** ("do we have non-zero balance to close?")                  | #3 Data API via `getOperatorPositions`, then #2 CLOB | `OperatorPosition` (existing, unchanged)               |

**Hard rule**: `MirrorPositionView` may inform _what to plan_ (skip / hedge / layer / route to closePosition). It must **never** be used to decide _whether the wallet actually holds the shares_ — that path stays as today, going through `getOperatorPositions` (#3 → #1). This design adds zero new authority writes; the existing 7-state lifecycle on `position_lifecycle` is read as a _filter_ (only rows in the active phases contribute to the view), never reassigned here.

The name is `MirrorPositionView` — not `Position` — to surface the cache-vs-truth distinction at every callsite.

## Scope

**In:** Compute `MirrorPositionView` per `(target_id, condition_id)` from `poly_copy_trade_fills`, plumb into `RuntimeState`, surface via `OrderLedger.snapshotState`. Define the per-fill mutation rule that keeps the view consistent inside one tick.
**Out:** New sizing policies, exit-trigger logic, layering policy, hedge-followup decision logic. Multi-outcome and neg-risk hedge math. Those follow-on designs each reduce to ≤2-line predicates on this primitive.

## Approach

**One change in four small parts:**

1. Extend `OrderLedger.snapshotState` (the existing per-tick read) to also return `position_aggregates: PositionIntentAggregate[]` (generic per-(market, token) intent aggregates) derived in SQL from `poly_copy_trade_fills`. Trading vocabulary stays generic — TRADING_IS_GENERIC invariant unbroken. Mirror-vocabulary overlay (`Map<condition_id, MirrorPositionView>`) is computed in copy-trade via `aggregatePositionRows()`.
2. Plumb the map into the per-tick context. Pipeline picks the entry for the fill's `condition_id` and passes it as a single optional field on the planner's input.
3. After each successful place inside the tick, the pipeline **mutates** its in-memory copy of the map so the next fill in the same tick sees the updated view (see "Within-tick semantics" below).
4. `planMirrorFromFill` reads `state.position` synchronously. Pure.

### `MirrorPositionView` shape

```ts
export const MirrorPositionViewSchema = z.object({
  condition_id: z.string(),
  /** Token id with our larger net long exposure. Undefined ⇒ no exposure either side. */
  our_token_id: z.string().optional(),
  /** Net shares on `our_token_id` (intent-based, see "Filled vs intent"). */
  our_qty_shares: z.number(),
  /** Sum-of-USDC-in / sum-of-shares-in for `our_token_id`. Undefined when our_qty_shares == 0. */
  our_vwap_usdc: z.number().optional(),
  /**
   * The complementary token in this binary market, if known. Undefined for:
   *   (a) markets we've only traded one side of and the market-meta lookup is unavailable, or
   *   (b) multi-outcome / neg-risk markets where the binary "opposite" doesn't apply.
   * Hedge-followup predicate must NO-OP when this is undefined.
   */
  opposite_token_id: z.string().optional(),
  /** Net shares on `opposite_token_id` (zero unless we've previously hedged). */
  opposite_qty_shares: z.number(),
});
export type MirrorPositionView = z.infer<typeof MirrorPositionViewSchema>;
```

`cumulative_intent_usdc` is **not** on this type — it stays where it lives today on `RuntimeState.cumulative_intent_usdc_for_market`. One source of truth.

### Storage decision — derive on read, no new table

| Option                                               | Verdict                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Derive in SQL inside `snapshotState` (CHOSEN)** | One extra `GROUP BY` on the same query path. No new table, no migration, no triggers. Fail-closed already wired. Per-tick cost is the cost of a SUM over the target's history (~hundreds of rows worst case; index on `target_id` exists). |
| B. New materialized table + write-side maintenance   | Adds invalidation surface, race on insert-vs-place, doubles the write path. Defer until SQL aggregation is measurably slow.                                                                                                                |
| C. In-memory cache outside the ledger                | Breaks `FAIL_CLOSED_ON_SNAPSHOT_READ`; first cold read after restart returns nothing.                                                                                                                                                      |

### Filled vs intent — explicit choice

The schema today does **not** carry a `filled_size_usdc` column distinct from intent. We treat **intent shares as the position quantity for mirror-policy purposes**, and document the implication:

- Computed via `(attributes->>'size_usdc')::numeric / NULLIF((attributes->>'limit_price')::numeric, 0)`.
- Includes `status IN ('open','filled','partial')` rows; excludes `canceled` and `error`.
- Effect: a resting `open` order is treated as fully exposed for follow-on sizing math. **This is intentionally fail-safe upward** — it means hedge-followup and same-side layering predicates will under-shoot rather than over-shoot follow-on orders. Caps stay tighter, not looser, than chain truth.
- For _settlement_ truth (e.g. SELL-routing's "can I actually close this?"), the SELL branch continues to read `getOperatorPositions` (#3 → #1), unchanged.

If this conservative approximation later proves too tight (e.g. resting orders that never fill skew sizing), the fix is a `filled_size_usdc` column + a typed `Fill` boundary, not a richer aggregation here. Out of scope.

### `opposite_token_id` resolution

Two sources, in order:

1. **Self-derivable**: if `poly_copy_trade_fills` has rows for this `condition_id` on a _second_ `token_id` (i.e. we've traded both legs ourselves), the view emits both with no external lookup needed.
2. **Market-meta lookup**: otherwise, look up the conditionId via the existing market-meta cache in `nodes/poly/packages/market-provider`. Cache hit → `opposite_token_id` populated. **Cache miss → leave `undefined`**, and the hedge-followup predicate no-ops by design. We never fail a tick on a missed lookup.

For neg-risk / multi-outcome markets (>2 tokens), `opposite_token_id` is always `undefined` — the binary "opposite" concept doesn't apply and hedge-followup predicate no-ops. Flagged on the view via a boolean we'll add only if needed; the `undefined` already short-circuits.

### SQL sketch — added to existing `Promise.all` in `snapshotState`

```sql
SELECT
  market_id                                          AS condition_id,
  attributes->>'token_id'                            AS token_id,
  SUM(
    CASE WHEN attributes->>'side' = 'BUY'  THEN  (attributes->>'size_usdc')::numeric / NULLIF((attributes->>'limit_price')::numeric, 0)
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
  AND status IN ('open','filled','partial')
  AND (position_lifecycle IS NULL OR position_lifecycle IN ('unresolved','open','closing'))
  AND attributes->>'closed_at' IS NULL
GROUP BY market_id, attributes->>'token_id';
```

App-side aggregation collapses (up to two binary) `token_id` rows per `condition_id` into one `MirrorPositionView`. `our_token_id` = the row with the larger positive `net_shares`; `opposite_token_id` = the other row (or market-meta lookup, or undefined). VWAP = `gross_usdc_in / gross_shares_in` on the long leg.

### Within-tick semantics — automatic via per-fill `snapshotState`

Reviewing `mirror-pipeline.ts:processFill` revealed `snapshotState` is already called **per fill**, not once per tick. Combined with `INSERT_BEFORE_PLACE` (the pending row is committed before the next fill is processed), the next fill's `snapshotState` reads a DB that already contains the prior fill's placement.

To make this work, the position SQL filter includes `pending` rows alongside `open | filled | partial`. This is consistent with the "intent-based, fail-safe upward" choice above: a `pending` row represents committed intent we believe will fill.

Result: no in-memory mutation logic needed. The planner sees a fresh DB-backed view on every fill. Trade-off: an extra `GROUP BY` per fill instead of once per tick — acceptable because `snapshotState` is already per-fill, and the GROUP BY runs against a `target_id`-indexed table with bounded fill history per target.

If `snapshotState` is later promoted to once-per-tick for performance, in-tick mutation becomes necessary again. The invariant `WITHIN_TICK_FRESHNESS` below names the contract; the implementation can satisfy it either way.

### Plumbing into `RuntimeState`

Additive; no breaking change to consumers.

```ts
export const RuntimeStateSchema = z.object({
  already_placed_ids: z.array(z.string()),
  cumulative_intent_usdc_for_market: z.number().optional(),
  /** NEW. Mirror position cache view for this fill's condition_id. Undefined ⇒ no prior exposure. */
  position: MirrorPositionViewSchema.optional(),
});
```

`mirror-pipeline.ts:processFill` calls `aggregatePositionRows(snapshot.position_aggregates)` and picks `.get(fill.market_id)` into `state.position`. No I/O added.

### `OrderLedger` surface change

```ts
export interface StateSnapshot {
  today_spent_usdc: number;
  fills_last_hour: number;
  already_placed_ids: string[];
  /** NEW. Per-condition position view derived in the same query batch. */
  position_aggregates: PositionIntentAggregate[];
}
```

Fail-closed path returns `position_aggregates: []` alongside the existing zeroes — preserves `FAIL_CLOSED_ON_SNAPSHOT_READ`.

### Boundary placement

`MirrorPositionView` is consumed only by mirror-pipeline + plan-mirror today. It lives next to existing copy-trade types in `nodes/poly/app/src/features/copy-trade/types.ts` (precedent: `OperatorPosition` is also defined in mirror-pipeline.ts as app-local). If a second runtime later reads it (Temporal activity, dashboard), promote to `nodes/poly/packages/...` then. Premature shared-package extraction is rejected per packages-architecture's "boundary placement is conditional on >1-runtime use."

## Backfill

None needed. `poly_copy_trade_fills` is already the source of truth; the projection is computed from it on every tick. First tick after deploy reflects full historical state automatically.

## How follow-ons reduce to predicates on `state.position`

Sketches only — full designs land in their own items. Each follow-on is ≤2 lines on the planner.

| Follow-on                              | Predicate on `state.position`                                                             | Action                                                                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **story.5000 hedge-followup**          | `position?.our_qty_shares > 0 && fill.attributes.token_id === position.opposite_token_id` | Bypass percentile filter; size = `min(market_min_bet, position.our_qty_shares × fill.price, max_usdc_per_trade)`                                                                                        |
| **SELL-mirror (close-on-target-SELL)** | `fill.side === 'SELL' && position?.our_token_id === fill.attributes.token_id`             | Route to `closePosition` sized `min(target_close_pct × position.our_qty_shares, position.our_qty_shares)`. _Authority gate_: SELL execution still requires the live `getOperatorPositions` chain check. |
| **Layering-aware filter**              | `fill.side === 'BUY' && position?.our_token_id === fill.attributes.token_id`              | Bypass percentile filter; same-side scale-in.                                                                                                                                                           |
| **Bankroll-fractional sizer**          | reads `position?.our_qty_shares` and `our_vwap_usdc` as inputs                            | Size = `f(target_$, target_bankroll, our_bankroll, position?.our_qty_shares ?? 0)`                                                                                                                      |

## Observability

New invariant: **DECISION_LOG_NAMES_VIEW** — any `decisionsTotal` emission whose decision branched on `state.position` must include in the structured log:

- `position_branch`: one of `none | hedge | layer | sell_close | new_entry`
- `position_qty_shares`: `state.position?.our_qty_shares ?? 0`
- `position_token_id`: `state.position?.our_token_id ?? null`

This makes the new branches attributable in Loki without a Grafana refactor. The label cardinality stays bounded (`position_branch` is enum of 5).

## Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **PLAN_IS_PURE preserved** — `planMirrorFromFill` reads `state.position` synchronously; no DB access added to the planner.
- [ ] **POSITION_DERIVED_AT_SNAPSHOT** — `MirrorPositionView` is computed inside `OrderLedger.snapshotState` only. No second source of truth, no write-side maintenance, no cache layer.
- [ ] **POSITION_VIEW_IS_CACHE_NOT_TRUTH** — view is _signal_, not authority. SELL execution + redeem flow still consult #1 chain / #3 Data API as today. Doc: docs/design/poly-positions.md.
- [ ] **WITHIN_TICK_FRESHNESS** — fill `N+1` in the same tick sees fill `N`'s placement in `state.position`. Today this is satisfied automatically because `snapshotState` runs per-fill and the SQL filter includes `pending` rows; a future per-tick `snapshotState` would need explicit in-tick mutation to keep this invariant.
- [ ] **FAIL_CLOSED_ON_SNAPSHOT_READ** — DB error → `position_aggregates: []`, same warn log path.
- [ ] **CAPS_LIVE_IN_GRANT untouched** — daily/hourly caps still resolve in `authorizeIntent` against `poly_wallet_grants`. The view is a _signal_ input, never a _cap_.
- [ ] **HEDGE_PREDICATE_NOOPS_ON_UNKNOWN_OPPOSITE** — when `opposite_token_id` is undefined (unknown / multi-outcome / neg-risk), hedge-followup predicate must NO-OP, not guess.
- [ ] **DECISION_LOG_NAMES_VIEW** — any decision branched on `state.position` emits `position_branch` + `position_qty_shares` + `position_token_id` on the structured log.
- [ ] **NO_NEW_TABLE** — schema migration not required.

## Files

- **Modify** `nodes/poly/app/src/features/trading/order-ledger.types.ts` — add generic `PositionIntentAggregate` type, extend `StateSnapshot.position_aggregates`. Trading slice stays mirror-free.
- **Modify** `nodes/poly/app/src/features/copy-trade/types.ts` — add `MirrorPositionView` type + `MirrorPositionViewSchema` + pure `aggregatePositionRows()` (collapses generic aggregates into the mirror-vocabulary view).
- **Modify** `nodes/poly/app/src/features/trading/order-ledger.ts` — extend `snapshotState` with the GROUP BY, aggregate to `Map<condition_id, MirrorPositionView>`, fail-closed return.
- **Modify** `nodes/poly/app/src/features/copy-trade/types.ts` — extend `RuntimeStateSchema` with optional `position: MirrorPositionView`.
- **Modify** `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts` — `processFill` picks view into `state.position`; new helper `applyPlacementToView()` mutates the per-tick map after a successful place.
- **Test** `nodes/poly/app/tests/unit/features/trading/order-ledger-position-snapshot.test.ts` — empty history, single BUY, BUY-only same token, BUY then partial SELL, both legs (hedge), canceled rows excluded, multi-outcome (>2 tokens) graceful, fail-closed returns empty Map.
- **Test** `nodes/poly/app/tests/unit/features/copy-trade/plan-mirror-position-state.test.ts` — planner receives `position`, planner is pure across N runs (deepEqual same input → same output), planner branches consume `position` without DB access.
- **Test** `nodes/poly/app/tests/unit/features/copy-trade/mirror-pipeline-within-tick-mutation.test.ts` — fill #1 places on `c`, fill #2 on the same `c` sees mutated view; tick boundary resets.

## Rejected alternatives

- **Materialized `poly_copy_trade_positions` table** — write-path complexity, race against placement, ALTER. Defer until measured.
- **Compute view inside `planMirrorFromFill`** — breaks `PLAN_IS_PURE`.
- **Per-fill query for position** — adds N round-trips per tick where today there's one.
- **Live position from Polymarket Data-API** — bypasses our own ledger, reintroduces clock-skew between target observation and our exposure. Also miscategorizes the authority (#3 Data API isn't authority for write decisions per `poly-positions.md`).
- **Promote to shared package now** — only one runtime consumes it. Conditional on packages-architecture rules; promote when a second runtime arrives.
- **Replace `OperatorPosition`** — that type serves a different authority (chain truth for SELL-execution); merging it with the cache view would conflate authorities. Both stay.

## Next

`/implement` — single PR on `derek/poly-position-projection-design`, ~250–400 LOC including tests. No migration. No new package.
