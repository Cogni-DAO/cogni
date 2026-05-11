---
id: task.0329.handoff
type: handoff
work_item_id: task.0329
status: active
created: 2026-04-19
updated: 2026-04-19
branch: design/wallet-analysis-components
last_commit: 1fa2a9b93
---

# Handoff: wallet-analysis — Checkpoint A shipped, B + C are yours

## Context

[task.0329](../items/task.0329.wallet-analysis-component-extraction.md) extracts the BeefSlayer hero on `/research` into a reusable `WalletAnalysisView` (Checkpoint A — done), then wires it to a live data plane (Checkpoint B — your job), then opens it as a drawer from `Monitored Wallets` (Checkpoint C — your job). One PR, three commits.

Design lock: [`docs/design/wallet-analysis-components.md`](../../docs/design/wallet-analysis-components.md). It went through two `/review-design` passes; the v2 version is what you implement.

PR: [#934](https://github.com/Cogni-DAO/cogni/pull/934) — open, all CI green, branch 8 commits ahead of main. **Do NOT recreate; build on top.**

## Current State

- Branch `design/wallet-analysis-components` @ `1fa2a9b93`. Working tree clean.
- Checkpoint A is committed and pushed: 7 molecules + `WalletAnalysisView` organism in `nodes/poly/app/src/features/wallet-analysis/`. `/research` BeefSlayer block renders through it. `BalanceBar` molecule now also powers `OperatorWalletCard`.
- Snapshot data on the existing component is hardcoded inline in `view.tsx` as `BEEF_ANALYSIS`. Your job is to replace that read path with a live hook.
- `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm --filter @cogni/poly-app build`, `pnpm check:docs` — all green at HEAD.

## Decisions Made (LOCKED — do not relitigate)

The design has been reviewed twice. The pinned decisions, in priority order:

1. **Snapshot is computed from CLOB + math, not stored.** No `poly_wallet_screen_snapshots` table. No DDL. No seed script. No fixture-as-runtime-source. The fixture file is unit-test seed only.
2. **Three caches, three lifetimes.**
   - Trades: 30 s TTL (`trades:<addr>`)
   - Market metadata: **immutable once `closed=true`**, LRU 10 000 (`market:<conditionId>`)
   - Computed snapshot: tied to trades cache (`snapshot:<addr>`)
3. **Coalescing primitive: module-scoped `Map<string, {promise, expiresAt}>`** — NOT `unstable_cache` (experimental, request-scoped, wrong tool).
4. **Concurrency: `p-limit(4)`** wrapping all `PolymarketDataApiClient` + `PolymarketClobAdapter` calls inside the route. Coalesce dedups same key; `p-limit` caps fan-out across different keys.
5. **One slice per HTTP call.** Client fans out to three React-Query keys: `["wallet", addr, "snapshot" | "trades" | "balance"]`. Each slice exposes `{ data, isLoading, error }` (per-slice error state — molecules render "X unavailable" not silent empty).
6. **`balance` slice is operator-only.** Omit when `addr !== POLY_PROTO_WALLET_ADDRESS`. Non-operator wallets get a warning, no balance object.
7. **Auth: explicit `getServerSessionUser()`** at route handler. 401 acceptance test in `pnpm test:component`.
8. **Address validation in the contract** (Zod regex `^0x[a-f0-9]{40}$` + lowercase transform), not the handler.
9. **Reuse mandate.** All Polymarket calls go through the **existing** `packages/market-provider`. **Adding a second client in `nodes/poly/app/` is a review-blocking violation.**
10. **Single-replica boot-time assert** in `nodes/poly/app/src/instrumentation.ts`. Module-Map cache silently corrupts under replicas > 1; throw on startup, don't comment.
11. **Edge hypothesis = analyst markdown**, not derived metrics. Lives in `docs/research/wallet-hypotheses/<addr>.md` (lowercased). Read at request time, merged into `snapshot.hypothesisMd`. Missing file → field absent. Authorship + diffs are git-native.

## Math (the heart of Checkpoint B)

`aggregateSnapshot(trades, marketResolutions) → WalletSnapshotDto`. Pure function, no IO. Spec'd in design doc §Math. Pseudocode summary:

```
per (conditionId, tokenId):
  buy_usdc, sell_usdc, shares = aggregate from trades on that token
  if market.closed:
    payout   = (winnerTokenId == tokenId) ? shares × $1 : 0
    realized = sell_usdc + payout − buy_usdc
    duration = first_sell_ts − first_buy_ts (when both observed)
    push  ResolvedPosition

aggregate over ResolvedPosition[]:
  n, wins, losses, wr, realizedPnl, capitalDeployed, roi, medianRoundTripMin
  equity curve (cumulative pnl chronological) → ddPctOfPeak
```

**TDD it first.** Read `docs/research/fixtures/poly-wallet-screen-v3-weather.json`, pick BeefSlayer's row (`0x331bf91c…`), fabricate `(trades, markets)` matching the expected n=118, then run `aggregateSnapshot` and assert WR 78% / ROI 27.3% / DD 10.7% within ±1%. If your math doesn't reproduce the published fixture, your math is wrong — fix it before shipping.

## Next Actions (do them in this order)

- [ ] Pick the partial-snapshot strategy (review concern #1): time-bound the route to ~1.5 s; on miss return `snapshot: { …, partial: true }` + `warning: snapshot_recomputing`. Background recompute continues; next request gets warm result. Pin in the contract before writing the orchestrator.
- [ ] Add `partial: bool` and `freshness: { live: ISO, snapshot: ISO }` to the Zod contract. Snapshot freshness = function of trades-cache + market-cache; record when `aggregateSnapshot` completed.
- [ ] **Write the math + tests first**: `nodes/poly/app/src/features/wallet-analysis/server/compute-snapshot.ts` + a unit test that reproduces BeefSlayer's published numbers from synthetic inputs. Gate the rest of B on this.
- [ ] Build the orchestrator: `snapshot.ts` (orchestrates trades fetch → market metadata fetch via CLOB → `aggregateSnapshot` → cache); `cache.ts` (the module Map); `data-api-pool.ts` (`p-limit(4)` wrapper); `clob-markets.ts` (LRU for market metadata).
- [ ] Build the route: `nodes/poly/app/src/app/api/v1/poly/wallets/[addr]/route.ts` — explicit `getServerSessionUser()`, parse `?include=<slice>` via Zod, fan out to the orchestrator. Add 401 + 400 + balance-omit acceptance tests in `pnpm test:component`.
- [ ] Boot-time assert in `instrumentation.ts` — throws if `POLY_REPLICA_INDEX != 0` (or pod-name suffix).
- [ ] Use `lru-cache` package (already in monorepo? check) for market metadata; emit eviction counter via existing observability.
- [ ] Build the React Query hook `useWalletAnalysis(addr)` — three keys, `?include=<slice>` per call, returns `{ snapshot, trades, balance }` each with `{ data, isLoading, error }`.
- [ ] Wire `/research` BeefSlayer block to the live hook (delete `BEEF_ANALYSIS` constant from `view.tsx`).
- [ ] Build dynamic `/research/w/[addr]` page — auth-gated server shell, client `WalletAnalysisView`.
- [ ] **Checkpoint C**: add `drawer` variant to `WalletAnalysisView`; wire `TopWalletsCard` row click → `Sheet`; pointer/focus/touch prefetch (debounced 50 ms); `?w=0x…` deep-link.
- [ ] Move BeefSlayer's hypothesis prose from `BEEF_ANALYSIS.snapshot.hypothesisMd` (currently inline in `view.tsx`) to `docs/research/wallet-hypotheses/0x331bf91c…md`. Existing file path was scaffolded earlier in this session and removed; re-create with frontmatter (use the wallet-hypotheses validator format).

## Anti-Patterns to Avoid (lessons from this session)

- ❌ **Don't put computed analytics in postgres.** Snapshot data is derived; cache it, don't store it. (We tried this; the user pushed back hard.)
- ❌ **Don't put fixture JSON as a runtime data source.** Fixtures are test seeds.
- ❌ **Don't add a second Polymarket client.** All calls through `packages/market-provider`.
- ❌ **Don't use `unstable_cache`.** Module-scoped TTL Map.
- ❌ **Don't batch big multi-step changes into one push.** Each commit should land green; each push should be re-flightable.
- ❌ **Don't trust readyz `version` after a flight.** It's been stale across this session — verify with both Loki app-started logs AND a fresh fetch of `/_next/static/chunks/*.js` digest.
- ❌ **Don't run `pnpm install` on a stale worktree without checking the lockfile diff.** A pre-existing worktree on an old base will silently downgrade workspace deps and bake them into your commits.

## Risks / Gotchas

- **Branch is downstream of #934 and PR #945** (PR #945 reverts the wagmi 2→3 bump from #910 that was crashing all client bundles). Once #945 merges, **rebase onto fresh main first thing.** The `nodes/poly/app/package.json` poly app pinned versions will move back to wagmi 2.x — your branch follows that.
- **Cold-start latency for snapshot.** A wallet with 200 unresolved-yet conditionIds, none cached, behind `p-limit(4)` at ~150 ms/CLOB call ≈ 7.5 s. The 200 ms drawer-open gate from Checkpoint C only holds _after_ warm-up. Mitigate via the `partial: true` strategy above OR a background warm at boot for the top-N wallets.
- **Pre-existing duplicate `bug.0331` on main.** This branch already renamed one of them to `bug.0333` in the merge commit. Don't undo it.
- **Snapshot table migration `0029_*` was attempted earlier this session and reverted.** It's NOT in any commit. Don't be surprised when you don't find it; `aggregateSnapshot` replaces the entire DB plan.
- **CI builds green ≠ runtime healthy.** The deployed bundle was crashing client-side via wagmi 3 + rainbowkit 2 peer mismatch (PR #910). Always click through the deployed app, not just check workflow conclusions.
- **`pnpm db:generate:poly` is currently broken on main** (snapshot collision in drizzle migrations meta dir, pre-existing). If you needed to add a migration you'd hit this — but you don't, because no DB.

## Pointers

| File / Resource                                                                                                 | Why it matters                                                          |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [PR #934](https://github.com/Cogni-DAO/cogni/pull/934)                                                  | This work item's PR — build on top, don't recreate                      |
| [Design doc](../../docs/design/wallet-analysis-components.md)                                                   | The spec. Every implementation choice traces back here.                 |
| [task.0329 work item](../items/task.0329.wallet-analysis-component-extraction.md)                               | Acceptance gates                                                        |
| [Checkpoint A barrel](../../nodes/poly/app/src/features/wallet-analysis/index.ts)                               | What's already exported and reusable                                    |
| [WalletAnalysisView](../../nodes/poly/app/src/features/wallet-analysis/components/WalletAnalysisView.tsx)       | Organism — already takes pure props                                     |
| [Hardcoded BEEF_ANALYSIS](<../../nodes/poly/app/src/app/(app)/research/view.tsx>)                               | Replace this with the live `useWalletAnalysis` hook                     |
| [PolymarketDataApiClient](../../packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts) | The ONE Polymarket Data-API client. Reuse, don't replace.               |
| [PolymarketClobAdapter](../../packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts)      | For `/markets/{cid}` resolution lookups (decision #2 cache layer 2)     |
| [v3 fixture](../../docs/research/fixtures/poly-wallet-screen-v3-weather.json)                                   | Test seed for `aggregateSnapshot` math                                  |
| [Existing wallet balance route](../../nodes/poly/app/src/app/api/v1/poly/wallet/balance/route.ts)               | Reference for `wrapRouteHandlerWithLogging` + `getSessionUser` patterns |
| [poly-dev-expert skill](../../.claude/skills/poly-dev-expert/SKILL.md)                                          | Domain context (operator wallet, SINGLE_WRITER, kill switch)            |
| [database-expert skill](../../.claude/skills/database-expert/SKILL.md)                                          | Per-node DB layout (you won't need this — no DB — but useful context)   |
| [test-expert skill](../../.claude/skills/test-expert/SKILL.md)                                                  | Where component vs stack tests go for the route handler                 |

## Validation

Before opening for review, the following must all be true:

- [ ] `aggregateSnapshot` unit test reproduces BeefSlayer's published 78% WR / 27.3% ROI / 10.7% DD within ±1% from the v3 fixture
- [ ] `GET /api/v1/poly/wallets/0x…?include=snapshot` returns 200 with `partial:true` on cold start, full snapshot on warm
- [ ] `GET /api/v1/poly/wallets/0x…` returns 401 unauthenticated, 400 on invalid addr, 200 with `balance` omitted for non-operator
- [ ] Ten concurrent `?include=trades` for the same addr produce one upstream Data-API call (component test with adapter spy)
- [ ] No `Polymarket*Client` exists outside `packages/market-provider`
- [ ] `instrumentation.ts` boot-time assert throws when `POLY_REPLICA_INDEX != 0`
- [ ] `BEEF_ANALYSIS` constant deleted from `view.tsx`
- [ ] `/research/w/0x331bf91c…` renders BeefSlayer with numbers identical to current `/research`
- [ ] `TopWalletsCard` row click opens drawer; `?w=0x…` deep-link works; pointer/focus/touch prefetch all fire (debounced 50 ms)
- [ ] `pnpm typecheck:poly`, `pnpm --filter @cogni/poly-app lint`, `pnpm --filter @cogni/poly-app build`, `pnpm check:docs` all green
- [ ] PR description includes a Loki Grafana link for `poly.wallet-analysis.*` events captured during preview re-flight
