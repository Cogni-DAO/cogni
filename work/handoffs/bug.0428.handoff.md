---
id: bug.0428.handoff
type: handoff
work_item_id: bug.0428
status: active
created: 2026-04-30
updated: 2026-04-30
branch: fix/poly-redeem-collateral-token-vintage
last_commit: 2f55e7557
---

# Handoff: bug.0428 — V2 redeem collateralToken capture (PR #1145 in merge queue)

## Context

- bug.0428 fixed the redeem worker hardcoding `POLYGON_USDC_E` on every vanilla-CTF dispatch. Mismatched collateralToken silently zero-burns and yields no payout — bites V2 (post-2026-04-28 cutover) pUSD-collateralized positions.
- Fix: chain probe at enqueue time (`getCollectionId` + `getPositionId` view calls) picks the candidate (pUSD or USDC.e) whose hash matches the funder's known on-chain `positionId`. Result stored on `poly_redeem_jobs.collateral_token`; worker reads from row.
- PR #1145 is in the merge queue (no more pushes). Code-path verified end-to-end on real prod-grade data on candidate-a — chain probe correctly returned USDC.e for two V1-vintage positions; on-chain `PayoutRedemption` event fired with the right `collateralToken`.
- Documentation gap that surfaced during validation: the V1/V2 framing in `docs/spec/poly-collateral-currency.md` was misleading (treated cutover as a date-threshold instead of a per-position property). Clarified in PR #1154 alongside this handoff.

## Current State

- **PR #1145** — in merge queue, awaiting auto-merge. SHA `2f55e7557`. Includes rebased main + cherry-pick of `022b1dec5` (poly-ai-tools dep fix that resolves the placeOrder TypeError introduced by PR #1125).
- **Migration 0034** applied to candidate-a Postgres. Default value = USDC.e address (V1-legacy safe). Pre-existing rows retain default; new rows get probe result.
- **Audit fields live**: `collateral_token` on `poly.ctf.redeem.job_enqueued` event; `collateral_token_used` on `poly.ctf.redeem.tx_submitted` event.
- **PR #1154** — docs branch, open: `poly-collateral-currency.md` clarification + the dashboard-hang handoff (orthogonal investigation, see `work/handoffs/handoff.poly-dashboard-positions-hang.md`).
- **Production not yet flighted.** Per Derek's plan, ship bug.0428 + task.0429 (auto-wrap) bundled to prod so V1 redeem inflows recycle automatically.
- **bug.0431 backfill not done** — pre-fix-stuck `loser` rows for already-resolved V1 winners (Sanchez Izquierdo $5, KT Wiz $4.91 et al.) were manually flipped to `pending/winner` for validation today, but the broader 48-loser audit hasn't run.

## Decisions Made

- Per-job `collateral_token` capture chosen over (A) global block-cutover heuristic and (C) try-pUSD-first fallback. Per-job probe is deterministic and silent-fail-safe (`bleed_detected` invariant remains the loud backstop). See [PR #1145 description](https://github.com/Cogni-DAO/node-template/pull/1145).
- Probe runs only for `decision.kind === "redeem"` on non-neg-risk markets. NegRiskAdapter ignores `collateralToken` — wasted RPC otherwise.
- `enqueue()` keeps `ON CONFLICT DO NOTHING`. Existing rows retain their stored `collateral_token`. Pre-fix rows that were re-enqueued today did NOT pick up the chain-probe result. Acknowledged limitation; filed as follow-up below.
- Migration 0034 journal `when` was bumped to `1777908700000` to defeat the bogus future-dated `when` on entry 0033 from PR #930. Latent landmine — separate cleanup needed (see Risks).

## Next Actions

- [ ] Watch PR #1145 merge complete; verify on `main`.
- [ ] Bundle ship to prod with task.0429 (parallel dev's auto-wrap loop). Same flight, single change window.
- [ ] File follow-up bug: `enqueue()` should refresh `collateral_token` (and other probe-derived fields) when a candidate re-enters with `redeem` decision but row exists from pre-probe era. Today's recovery path used migration default, not fresh probe result.
- [ ] File follow-up bug: poly migration journal entry `0033_poly_redeem_jobs.when=1777908600000` (5-day-future) — silently skips every drizzle-kit-auto-generated migration until 2026-05-04 wallclock. Recipe in `docs/spec/databases.md §2.6` should add a `when`-monotonicity rule.
- [ ] Backfill audit: for tenant `777dedd4`, find all `poly_redeem_jobs` rows with `lifecycle_state='loser'` whose held outcome has `payoutNumerators > 0` on chain — re-classify and re-dispatch (see bug.0431 § Out of scope).
- [ ] Validate the pUSD branch of the chain probe directly. As of 2026-04-30, no V2-vintage redemption has fired in our logs (the funder holds zero pUSD-vintage CTF balance). Either wait for natural exposure, or write a stack test that asserts `inferCollateralTokenForPosition` returns pUSD when `getPositionId(pUSD, ...)` matches.
- [ ] Investigate intermittent `e.toLowerCase` TypeError that resurfaces post-merge in some bundles. Root-caused once (PR #1125 rename gap, fixed by 022b1dec5) but reappeared after rebase. May be related to bundle caching or chunk-hash collision.

## Risks / Gotchas

- **Pre-existing redeem-job rows do NOT get re-probed.** Recovery paths that flip `skipped→pending/winner` rely on the migration default `collateral_token` (USDC.e). For V2-vintage rows stuck pre-fix, manual `UPDATE` of the column is required before re-dispatch — otherwise zero-burn.
- **`burn_observed=false` from worker logs is unreliable.** The decode-receipt-for-burn parser has a corner case that flags successful redeems as zero-burn when payout is ≥ 0 but TransferSingle parsing fails. Confirmed via on-chain receipt inspection (PayoutRedemption fires correctly). Don't trust `burn_observed=false` as a definitive signal — cross-reference with chain receipt.
- **The chain probe falls back to USDC.e on RPC failure (`default_no_match` legacy path).** If Polygon RPC is degraded, the probe silently returns USDC.e. Loud-fail backstop is `bleed_detected` at finality (~5 blocks later). For V2 positions that's a 30s window of wrong dispatch.
- **Cap-clearing wipe.** Today we deleted 46,989 stale `error` rows from `poly_copy_trade_fills` for tenant `777dedd4` to unblock cap-blocked placements. Bug.0430's pessimistic include-error-rows design works in steady state but inherits any error backlog as phantom-cap-intent. The reconciler (bug.0430 Option B) is the durable fix; until it ships, expect cap-blocking to recur after extended outages.

## Pointers

| File / Resource                                                                               | Why it matters                                                    |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [PR #1145](https://github.com/Cogni-DAO/node-template/pull/1145)                              | The bug.0428 fix — code, tests, migration, validation comments    |
| [PR #1154](https://github.com/Cogni-DAO/node-template/pull/1154)                              | V1/V2 spec clarification + dashboard-hang handoff                 |
| `nodes/poly/app/src/features/redeem/infer-collateral-token.ts`                                | The chain probe (50 LOC, the heart of bug.0428)                   |
| `nodes/poly/app/src/features/redeem/redeem-worker.ts:259`                                     | Worker dispatch — reads `job.collateralToken` instead of hardcode |
| `nodes/poly/app/src/adapters/server/db/migrations/0034_poly_redeem_jobs_collateral_token.sql` | Migration. Default = USDC.e address                               |
| `docs/spec/poly-collateral-currency.md`                                                       | Updated V1/V2 spec — read this before touching redeem code        |
| `work/items/bug.0428.poly-redeem-worker-hardcodes-usdce.md`                                   | Bug doc — symptom, root cause, fix options                        |
| `work/items/bug.0431.poly-redeem-policy-misclassifies-winners-as-losers.md`                   | Adjacent bug whose backfill is still TODO                         |
| Loki: `\| route="poly.wallet.execution"` (candidate-a)                                        | Health check for adjacent dashboard-positions issue               |
| `nodes/poly/packages/market-provider/src/adapters/polymarket/polymarket.ctf.ts`               | `POLYGON_PUSD` constant + `polymarketCtfPositionIdAbi`            |
