---
id: design.poly-copy-target-performance-benchmark
type: design
status: review
created: 2026-05-03
updated: 2026-05-03
tags: [poly, copy-trading, benchmarks, sizing, rn1, swisstony]
implements: task.5005
---

# Poly Copy Target Performance Benchmark

## Design

### Outcome

Success is when the existing poly research UI can compare RN1/swisstony target style, VWAP, position outcomes, and PnL deltas against Cogni copied/skipped/resting/error responses, with active gap reason codes for target positions Cogni is not addressing.

### MVP Path

Ship task.5005 as a research UI extension, not a new dashboard and not another planner change.

The shortest useful path is:

1. Start continuously observing configured trader wallets from today forward: RN1, swisstony, and active tenant trading wallets.
2. Persist every observed wallet trade for both copy targets and tenant trading wallets into the same Postgres observation tables.
3. Persist current position snapshots for those wallets on each poll, deduping unchanged snapshots.
4. Maintain a separate current-position state table for active-gap queries; snapshots remain immutable observation history.
5. Attribute observed target trades/positions to the signed-in tenant's observed wallet trades and existing mirror decision/fill ledger.
6. Query the stored observation data by time window, starting with `1D`.
7. Extend the existing wallet research detail pages at `/research/w/[addr]` with three panels:
   - benchmark summary;
   - per-market VWAP attribution;
   - active gaps.
8. Reuse PR #1137's order-flow distributions as the style context on those same wallet research pages.

PR #1137 only impacted specific wallet research pages and only populates the new distributions for RN1 and swisstony. That is fine for this MVP: task.5005 should start with those same two copy targets, then add active tenant trading wallets as first-class observed trader wallets.

### Live Forward Observation

The primary design is live forward collection, not rolling-window scraping. From the moment task.5005 ships, configured wallets should be observed continuously so future 1d/1w/1m analysis is a database query over facts we already saved.

The observed-wallet set has two independent states:

- `active_for_research`: save this wallet's public Polymarket activity for research and benchmarking. This belongs to the trader-observation read model.
- `active_for_copy_trade`: allow the mirror planner to consider this wallet as a copy-trade target. This is represented by the existing `poly_copy_trade_targets` policy table's active row state (`disabled_at IS NULL`), not by trader-observation config.

RN1/swisstony should normally have `active_for_research=true`. They may have `active_for_copy_trade=true` or `false`; observation must not depend on active copying.

Active tenant trading wallets should also be observed directly. `poly_copy_trade_fills` remains useful as our intent/placement ledger, but direct wallet observation is the apples-to-apples comparison against target wallets. It catches actual public wallet activity, manual trades, fills not cleanly reflected in intent rows, and reconciliation drift.

In the UI and benchmark queries, "our wallet" means the signed-in user's active `poly_wallet_connections.address`. The observer may save public facts for every active tenant wallet, but benchmark aggregation must filter to the current user's active funder address. Never aggregate all `kind='cogni_wallet'` rows as "Cogni" in a multi-tenant view.

### Query Windows And Historical Backfill

Do not crawl full RN1/swisstony history. These wallets are high-frequency enough that a full-history pull would be slow, rate-limit-prone, and unnecessary for the operator question.

`1D`, `1W`, and `1M` are query windows over saved observations. They are not separate ingestion strategies.

For the first day after launch, the `1D` view answers: "since we started observing, what did RN1/swisstony do, what did the signed-in tenant wallet do, and where did we miss?" After a week of continuous observation, the same tables power `1W`. After a month, they power `1M`.

Historical backfill is v2. It can fill older gaps opportunistically under a strict rate budget, using the same observed-trade tables with an explicit source/cursor path, but it must not block the live-forward MVP.

The live observation poller should:

1. Poll configured `active_for_research` wallets with `takerOnly=false`.
2. Paginate from newest toward the previous watermark and stop as soon as it reaches already-seen data.
3. Upsert each observed trade by native source identity.
4. Update per-wallet ingestion checkpoints only after successful upserts.
5. Pull current positions for observed wallets and save a new snapshot only when the position hash changed or a fixed cadence boundary is reached.

This path does not require:

- final market resolution;
- full lifetime wallet backfill;
- historical snapshots before the 24h window;
- a new streaming system.

It does require:

- per-wallet cursors or watermark checkpoints for each source;
- small-page pagination with early stop at the previous watermark;
- idempotent upserts by native trade identifier;
- explicit stale/partial labels if an upstream page fails or the rate budget is exhausted.

### Current Evidence

Measured on 2026-05-03 against Polymarket public APIs.

#### Target Wallet PnL Curve Deltas

Source: `https://user-pnl-api.polymarket.com/user-pnl`.

| Wallet                                                 |  1d delta |  1w delta |    1m delta | Current PnL chart value |
| ------------------------------------------------------ | --------: | --------: | ----------: | ----------------------: |
| RN1 `0x2005d16a84ceefa912d4e380cd32e7ff827875ea`       | +$199,183 | +$539,049 | +$1,352,022 |              $8,152,673 |
| swisstony `0x204f72f35326db932158cba6adff0b9a1da95e14` | +$159,419 | +$796,718 | +$1,630,803 |              $7,322,721 |

These are chart-service PnL values. They are useful headline benchmarks but not sufficient for per-market copy-trade attribution.

#### Existing Tenant Wallet PnL Curve Deltas

Known tenant wallets from existing work items and handoffs. These are evidence samples, not hardcoded comparison identities:

| Wallet                                                              | 1d delta | 1w delta | 1m delta | Current PnL chart value | Notes                                               |
| ------------------------------------------------------------------- | -------: | -------: | -------: | ----------------------: | --------------------------------------------------- |
| prod funder `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`            |  +$38.98 |  +$10.37 |  +$24.88 |                  $18.73 | Small base; percentages are misleading around zero. |
| Derek candidate tenant `0x9A9e7276b3C4d6E7c9a866EB6FEB8CFaB82C160A` |   -$6.09 |  -$30.30 |  -$30.29 |                 -$30.59 | Candidate/test wallet from task.0318 validation.    |
| old shared operator `0x7A3347D25A69e735f6E3a793ecbdca08F97A0aEB`    |    $0.00 |   +$0.22 |  -$13.17 |                 -$13.42 | Legacy prototype wallet.                            |

#### Open-Position Scale

Source: Polymarket Data API `/positions?sizeThreshold=...`, capped at the first 500 rows by the endpoint query used here.

| Wallet                 | Open rows at threshold 0 | Cost basis in returned rows | Current value in returned rows |
| ---------------------- | -----------------------: | --------------------------: | -----------------------------: |
| RN1                    |                     500+ |               $1,293,335.96 |                    $579,940.84 |
| swisstony              |                     500+ |                 $260,886.95 |                    $266,878.97 |
| prod funder            |                      166 |                     $526.59 |                        $228.70 |
| Derek candidate tenant |                       89 |                     $148.72 |                         $11.84 |
| old shared operator    |                        3 |                       $5.47 |                          $4.41 |

The target wallets operate at a different scale. A research surface that only shows target style or only shows our ledger cannot answer whether Cogni is tracking the live target opportunity set.

### Existing Flow To Preserve

- `docs/design/poly-bet-sizer-v1.md` is the current as-built sizing spec.
- `docs/design/poly-mirror-position-projection.md` is the current as-built mirror-position/VWAP projection spec.
- PR #1137 / `task.0431` is the order-flow distributions foundation on wallet research pages. It explains target style, but it is not the copy-performance attribution store.
- `TOP_TARGET_SIZE_SNAPSHOTS` in `copy-trade-mirror.job.ts` hardcodes RN1 and swisstony p50/p75/p90/p95/p99 position cost-basis snapshots.
- Default copied target policy is p75 and `$5` max per trade.
- The pXX gate compares the target's current token-position cost basis, not the individual trigger order.
- `planMirrorFromFill()` remains pure. Target and mirror position context is supplied in `RuntimeState`.
- Our VWAP is derived from local intent rows in `poly_copy_trade_fills` through `OrderLedger.snapshotState()` and `aggregatePositionRows()`.
- Target position context is currently live Data API context only. Durable target activity persistence is the missing task.5005 read-model work.

### Approach

**Solution**: Add a Postgres operational read model for observed trader activity across both copy targets and active tenant trading wallets, continuously populate it from today forward, then expose a small benchmark API slice consumed by the existing wallet research detail surface.

**Reuses**:

- Existing Polymarket Data API client and user-PnL fetch path from `features/wallet-analysis`.
- Existing generic `features/wallet-watch` observation primitive, extended to paginate safely for high-frequency wallets instead of single-page polling.
- Existing `poly_copy_trade_fills` and `poly_copy_trade_decisions` as tenant execution truth.
- Existing `MirrorPositionView` / `aggregatePositionRows()` as tenant VWAP and position projection.
- Existing wallet research route and PR #1137 `DistributionsBlock` for target-style context.
- Existing Pino/Loki event flow for validation and candidate-a verification.

**Rejected**:

- Extra `trader_kind` column on `poly_copy_trade_fills`: target wallet activity is not a Cogni order lifecycle and does not have CLOB status, tenant intent, or client order IDs.
- Separate target-vs-Cogni observed-trade tables: both are public wallet observations with the same grain, so they belong in one `poly_trader_fills` table keyed by `trader_wallet_id`.
- Separate "copy target dashboard": duplicates the research surface and delays the core comparison.
- New planner or hedge-sizing policy in this task: #1187/#1188/#1199/#1203 already shipped target pXX sizing, mirror VWAP, layer follow-ups, and hedge follow-ups.
- Doltgres target activity storage: this is append-mostly operational telemetry, not curated knowledge.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] RESEARCH_UI_FIRST: Task.5005 extends `/research/w/[addr]`; it does not create a separate dashboard for the MVP.
- [ ] RN1_SWISSTONY_FIRST: The MVP target set is RN1 and swisstony, matching PR #1137's populated research surface.
- [ ] LIVE_FORWARD_COLLECTION: The MVP starts saving observed RN1/swisstony and active tenant trading-wallet trades continuously from deployment forward.
- [ ] QUERY_WINDOWS_NOT_INGESTION_WINDOWS: `1D`/`1W`/`1M` are query windows over saved observations, not ad hoc scraping jobs.
- [ ] OBSERVATION_INDEPENDENT_OF_COPYING: RN1/swisstony observation continues even when a wallet is not actively copy-enabled.
- [ ] SAME_OBSERVED_TRADE_TABLE: Copy-target and tenant trading-wallet public trades use the same observed-trade table keyed by `trader_wallet_id`.
- [ ] NO_FULL_HISTORY_CRAWL: Historical RN1/swisstony backfill is v2 and must be rate-budgeted; the MVP does not crawl full target history.
- [ ] DO_NOT_OVERLOAD_MIRROR_LEDGER: Target wallet fills and positions are not inserted into `poly_copy_trade_fills`.
- [ ] POSTGRES_OPERATIONAL_TRUTH: Target activity, position snapshots, and attribution live in poly Postgres tables, not Doltgres.
- [ ] CONTRACT_FIRST_HTTP: Any new research API response shape is defined in `nodes/poly/app/src/contracts/*.contract.ts` and routes parse input/output with Zod.
- [ ] PLANNER_STAYS_PURE: `planMirrorFromFill()` receives context; it does not read target attribution tables or perform I/O.
- [ ] EXISTING_EXECUTION_TRUTH: Cogni VWAP and response status derive from `poly_copy_trade_decisions`, `poly_copy_trade_fills`, and existing order-ledger projection helpers.
- [ ] BOUNDED_GAP_REASONS: Active-gap reasons are bounded enum values suitable for UI display and Loki labels.
- [ ] PAGINATED_TARGET_INGESTION: Data API ingestion paginates from newest to prior watermark and dedupes by native source identifiers.
- [ ] OBSERVABILITY_REQUIRED: Candidate validation must show target ingestion, mirror decision, and attribution write logs at the deployed SHA.
- [ ] SIMPLE_SOLUTION: Leverages existing wallet-analysis, copy-trade, and order-ledger patterns over bespoke analytics infrastructure.
- [ ] ARCHITECTURE_ALIGNMENT: Routes stay in `app/api`, UI in `features/wallet-analysis`, copy-trade policy in `features/copy-trade`, and schema in `@cogni/poly-db-schema`.

### Storage Design

Use Postgres read-model tables in `@cogni/poly-db-schema`; generate the migration under the poly app DB migrations directory.

| Table                            | Grain                                                       | Purpose                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poly_trader_wallets`            | one row per observed wallet address                         | Canonical observed trader identity: `kind in ('copy_target','cogni_wallet')`, label, `active_for_research`, first_observed_at. Copy targets are seeded; active tenant trading wallets are synced from `poly_wallet_connections`. This is research observation state, not copy policy.                |
| `poly_trader_ingestion_cursors`  | one row per trader/source                                   | Watermark/checkpoint for live forward observation: source, last_seen_at, last_seen_native_id, last_success_at, last_error_at, partial/stale status. Prevents re-scraping and makes rate-limit gaps visible.                                                                                          |
| `poly_trader_fills`              | one normalized observed trade per trader                    | Data API or future WS/on-chain fills for both target wallets and tenant trading wallets. Includes `trader_wallet_id`, `source`, `native_id`, `condition_id`, `token_id`, `side`, `price`, `shares`, `size_usdc`, `tx_hash`, `observed_at`, `raw`. Unique on `(trader_wallet_id, source, native_id)`. |
| `poly_trader_position_snapshots` | one row per trader/condition/token/material snapshot        | Immutable position history: shares, cost basis, current value, avg price, captured_at, content_hash, raw. Save on material change or cadence boundary. Powers later outcome analysis without pretending absences are close events.                                                                   |
| `poly_trader_current_positions`  | one row per trader/condition/token latest state             | Current active-position state for live research UI. Updated from complete paginated position polls. Missing rows are deactivated only when the poll proves it saw the full wallet position set.                                                                                                      |
| `poly_copy_trade_attribution`    | one row per target fill or target position x Cogni response | Joins target observation to Cogni observed fills plus optional existing decision/fill rows: `copied`, `partial`, `missed`, `resting`, `skipped`, `error`, `no_response_yet`. Carries bounded reason and Cogni VWAP fields when available.                                                            |
| `poly_market_outcomes`           | one row per condition/token resolution                      | Final outcome, payout, close/resolution time. Needed for realized attribution once outcomes are available; marked current value remains valid before resolution.                                                                                                                                     |

This keeps joins explicit:

- `target observed fill -> attribution -> Cogni observed fills`
- `target observed fill -> attribution -> poly_copy_trade_decisions/poly_copy_trade_fills`
- `target position snapshot -> MirrorPositionView -> active gap reason`
- `target fill/position/outcome -> target VWAP/outcome`
- `signed-in tenant observed fill/position/outcome -> tenant VWAP/outcome`

### API And UI Requirements

The existing wallet research page should load one benchmark bundle for the viewed wallet. For RN1/swisstony, the bundle includes target metrics plus comparison against the signed-in user's active tenant trading wallet. For non-target wallets, the bundle may return empty attribution while the existing wallet research surface still renders.

#### Benchmark Panel

Show RN1, swisstony, and the signed-in user's active tenant trading wallet over 1d, 1w, 1m:

- target PnL chart delta;
- Cogni PnL chart delta;
- target open cost basis and current value;
- Cogni open cost basis and current value;
- copy capture ratio: `cogni_size_usdc / target_size_usdc`;
- missed edge: target marked or realized PnL on markets where Cogni did not place;
- adverse copy: Cogni loss on markets where the target was flat or profitable.

The `1D` view is the first query window over saved forward observations. It should label results as "marked" when the market has not resolved and should show observation coverage: observed_since, last_success_at, partial/stale status, and number of observed target/Cogni trades in the window.

#### Per-Market Attribution Table

One row per `(target_wallet, condition_id, token_id)`:

- target VWAP, shares, cost basis, current value, marked or realized PnL;
- Cogni VWAP, shares, cost basis, current value, marked or realized PnL;
- copy status: `copied`, `partial`, `missed`, `resting`, `skipped`, `error`;
- latest reason from `poly_copy_trade_decisions` or the generated active-gap classifier;
- policy branch: `new_entry`, `layer`, `hedge`, `sell_close`;
- current pXX threshold and target position cost basis;
- time since target first opened and last modified the position.

#### Active Gaps Table

A target position appears when:

- target has non-dust current exposure;
- Cogni has no matching active exposure or resting order; and
- the target position is above p50, or above p75 for the default actionable view.

Reason codes must be generated from state, not hand-written:

- `below_selected_pxx`
- `market_floor_above_user_max`
- `position_cap_reached`
- `already_resting`
- `target_hedge_ratio_below_min`
- `target_hedge_usdc_below_min`
- `mirror_position_too_small_for_followup`
- `no_wallet_grant`
- `wallet_not_trading_ready`
- `placement_error`
- `not_seen_by_ingestion`
- `no_response_yet`

### Live Decision Streaming vNext

For the later live stream in the research UI, split visibility from actionability:

- stream every target position or fill at or above p50 into the research UI;
- mark p75 and above as actionable by default;
- mark p90 and above as urgent review;
- only auto-consider hedge follow-ups when the as-built position-follow-up predicates pass:
  - target opposite-token cost basis >= `$5`;
  - target hedge ratio >= `0.02`;
  - our mirror exposure >= `max($5, market_floor * 5)`;
  - proposed hedge <= `25%` of our current mirror exposure;
  - cumulative market intent remains <= per-target `mirror_max_usdc_per_trade`.

Do not create a second hedge-size pXX gate. The selected pXX remains the conviction gate. Hedge-specific thresholds are risk controls for whether the opposite-token position is meaningful enough to mirror.

### Files

- Create: `nodes/poly/packages/db-schema/src/trader-activity.ts` — Drizzle schema for target/tenant trader read-model tables.
- Modify: `nodes/poly/packages/db-schema/src/index.ts` and package exports — expose the new schema slice.
- Create: `nodes/poly/app/src/adapters/server/db/migrations/<next>_poly_trader_activity.sql` — generated migration for the new Postgres tables.
- Create: `nodes/poly/app/src/contracts/poly.copy-target-benchmark.v1.contract.ts` — Zod request/response contract for the research benchmark bundle.
- Modify: `nodes/poly/app/src/features/wallet-watch/` — add paginated observation from newest to prior watermark while preserving the generic wallet-watch boundary.
- Create: `nodes/poly/app/src/features/wallet-analysis/server/copy-target-benchmark-service.ts` — server-side read model and aggregation service.
- Modify: `nodes/poly/app/src/app/api/v1/poly/wallets/[addr]/route.ts` or add a sibling benchmark route — attach the benchmark bundle without bypassing contracts.
- Modify: `nodes/poly/app/src/features/wallet-analysis/` components — render benchmark, attribution, and active-gap panels on `/research/w/[addr]`.
- Modify: `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts` and/or add a sibling observed-trader job — schedule forward observation for `active_for_research` wallets while preserving pure planner boundaries.
- Test: `nodes/poly/app/tests/unit/features/wallet-analysis/` — aggregation math, gap reason classification, and empty-bundle behavior.
- Test: `nodes/poly/app/tests/unit/features/copy-trade/` — attribution does not alter planner decisions.
- Test: `nodes/poly/app/tests/unit/features/wallet-watch/` — pagination stops at the previous watermark and does not lose high-frequency pages.
- Test: `nodes/poly/app/tests/component/` or API contract tests — benchmark route parses and returns bounded shapes.

### Implementation Sequence

1. Schema and migration for observed trader wallets, ingestion cursors, observed fills, position snapshots, attribution, and market outcomes.
2. Seed RN1 and swisstony as `active_for_research` trader wallets.
3. Forward observation job that syncs active tenant trading-wallet connections into `poly_trader_wallets`, polls `active_for_research` wallets, paginates to prior watermark, upserts observed trades, snapshots positions, and records stale/partial status under rate pressure.
4. Attribution write path from target observations to signed-in tenant observed fills plus existing mirror decision/fill rows.
5. Benchmark API contract and service returning an empty-safe bundle for non-target wallets and explicit coverage metadata for observed wallets.
6. Research UI panels on `/research/w/[addr]`, reusing #1137 distributions for RN1/swisstony.
7. Candidate-a validation with one new observed target fill, one observed signed-in tenant wallet window, and Loki evidence.

### Validation

exercise: On candidate-a, use a signed-in account with an active Polymarket trading wallet, wait for at least one successful observation tick for RN1, swisstony, and that tenant wallet, then let the mirror process at least one new target fill. Open `/research` and the target wallet pages `/research/w/0x2005d16a84ceefa912d4e380cd32e7ff827875ea` and `/research/w/0x204f72f35326db932158cba6adff0b9a1da95e14`; verify target headline deltas, tenant-wallet deltas, PR #1137 order-flow distributions, per-market VWAP comparison, active gap reason codes, and observation coverage metadata render for the exercised wallets.

observability: Query Loki for the deployed SHA and confirm observation logs `poly.trader.observe` for RN1/swisstony and the signed-in tenant wallet, mirror logs `poly.mirror.decision` with `position_branch` fields, and attribution write logs `poly.copy_target.attribution` include the target observed fill id plus the tenant observed fill id or mirror decision id for the agent's own exercised fill.

## Design Review

### Scorecard

| Dimension              | Score   | Rationale                                                                                                                                           |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simplicity             | PASS    | The MVP is one forward observation pipeline plus three panels on the existing wallet research detail page; no new dashboard or planner rewrite.     |
| OSS-First              | PASS    | No bespoke charting or stream framework is required; the design reuses existing React/query/table patterns and upstream Polymarket APIs.            |
| Architecture Alignment | PASS    | Schema, contracts, wallet-watch observation, API route, feature service, and UI are placed in existing repo layers.                                 |
| Boundary Placement     | PASS    | Shared table definitions live in `@cogni/poly-db-schema`; runtime ingestion and UI stay in the app.                                                 |
| Content Boundaries     | PASS    | This doc owns design and invariants; task.5005 owns execution status; #1137 remains linked as UI foundation.                                        |
| Scope Discipline       | PASS    | The task is scoped to benchmark attribution and active gaps, not trading policy changes.                                                            |
| Risk Surface           | CONCERN | Data API pagination, rate limits, and high-frequency target wallets require forward watermarks, bounded pagination, stale labels, and dedupe tests. |

### Blocking Issues Found And Corrected

1. The prior design treated `24h` as an ingestion strategy. That fails the outcome because it would keep re-scraping high-frequency wallets and would not build durable forward oversight. Corrected to continuous `active_for_research` wallet observation, with `1D`/`1W`/`1M` as query windows over saved facts.
2. The prior design did not make direct tenant-wallet observation first-class. That fails apples-to-apples VWAP comparison. Corrected by saving tenant public wallet trades into the same `poly_trader_fills` table as target-wallet trades, while retaining `poly_copy_trade_fills` as the intent/placement ledger.
3. `features/wallet-watch` currently documents that v0 can lose tail trades when activity exceeds one page between polls. That is incompatible with RN1/swisstony. Implementation must upgrade wallet-watch pagination before relying on it for benchmark collection.

### Remaining Concerns

1. PnL chart deltas from `user-pnl-api` should be labeled as upstream chart-service values until market outcome attribution is mature. They are useful headlines, not accounting truth.
2. If the benchmark route is added as a sibling route instead of a slice on `/api/v1/poly/wallets/[addr]`, the route contract still needs to live in `src/contracts` first.
3. The observer needs explicit rate-budget behavior: skip lower-priority wallets or mark stale rather than extending poll duration indefinitely.

### Verdict

APPROVE for implementation only with the live-forward observation invariants above. A rolling-window scraper or first-page-only wallet-watch implementation should be rejected in code review.
