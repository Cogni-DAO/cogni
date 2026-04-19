---
id: task.0315.handoff
type: handoff
work_item_id: task.0315
status: active
created: 2026-04-18
updated: 2026-04-18
branch: feat/poly-mirror-v0
worktree: /Users/derek/dev/cogni-template-mirror
last_commit: 7825650da
---

# Handoff: task.0315 Phase 1 — CP4.3 mirror poll + CP4.5-replacement read APIs

## Where to work

- **Worktree:** `/Users/derek/dev/cogni-template-mirror` (separate from main clone at `/Users/derek/dev/cogni-template`)
- **Branch:** `feat/poly-mirror-v0` — opens a fresh PR into `main`; PR #900 merged as squash `b0765ef99`, so CP4.1 / CP4.2 / CP4.25 are already on main.
- **Env:** `.env.local` symlinked from the main worktree.
- **Stale worktrees (prune at your leisure):** `/Users/derek/dev/cogni-template-cp4` (on the now-deleted `feat/poly-copy-trade-cp4` branch), `/Users/derek/dev/cogni-template-pr900` (detached).

## Context

- **Mission:** Polymarket copy-trade prototype. v0 (PR-A) shipped a top-wallets scoreboard in an earlier PR. v0.1 (PR #900) shipped the agent-callable `core__poly_place_trade` tool + DB migration + CLOB adapter. **This branch (`feat/poly-mirror-v0`) ships the autonomous 30s mirror poll and the read APIs the frontend dev's new dashboard consumes.**
- **Strategy:** stable-`decide()`-boundary design, decomposed into three layers per the refined design (see spec): `features/trading/` (generic placement + order ledger), `features/wallet-watch/` (generic Polymarket observation), `features/copy-trade/` (thin coordinator + policy).
- **Operator wallet** is the HSM-custodied Privy EOA `0xdCCa8D85603C2CC47dc6974a790dF846f8695056` — onboarded + funded + approved on Polygon mainnet. Dress rehearsal + a live $5 take-fill already happened on `main`; CP5 canary verifies the container-issued path.

## Current State

**Shipped on branch (7 commits since `origin/main`):**

| Commit      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e97552ddc` | Phase 1 spec + task retargeting — three-layer decomposition; `poly_mirror_*` metric prefix; CP4.5 dashboard card replaced with read APIs for the frontend dev's track.                                                                                                                                                                                                                                                                                                        |
| `078d9d3f7` | **CP4.3a — seam split.** `createPolyTradeCapability()` returns `PolyTradeBundle { capability, placeIntent, operatorWalletAddress }`. Both paths share ONE lazy adapter + ONE Privy wallet. Capability-factory test asserts `SEAM_SHARES_ADAPTER`.                                                                                                                                                                                                                             |
| `6a8edfb9d` | **CP4.3b — `features/trading/` layer.** Moves `clob-executor` out of `copy-trade/` (it's not copy-trade-specific). Adds `order-ledger.ts` + `order-ledger.types.ts` port + Drizzle adapter over `poly_copy_trade_{fills,decisions,config}`. `FakeOrderLedger` in `adapters/test/trading/`. Layer invariant `TRADING_IS_GENERIC` documented in AGENTS.md.                                                                                                                      |
| `2d33410fe` | **CP4.3c — `features/wallet-watch/` layer.** `WalletActivitySource` port + `createPolymarketActivitySource` Data-API adapter. `WALLET_WATCH_IS_GENERIC`. Empty-tx rejection + bounded-label skip counter. 5-scenario unit tests.                                                                                                                                                                                                                                              |
| `086ec2ab0` | **CP4.3d — `mirror-coordinator.ts`.** Pure `runOnce(deps)` glues wallet-watch → decide → trading. `INSERT_BEFORE_PLACE` enforced. 9-scenario test suite (idempotent re-run, insert-then-crash resume, kill-switch off, fail-closed on DB error, empty page, daily-cap, rate-cap, happy path). Also fixes cap-math bug: caps filter on `created_at` (intent time), not `observed_at` (upstream fill time).                                                                     |
| `4feaccbb8` | **CP4.3e — scheduler job + bootstrap wiring.** `bootstrap/jobs/copy-trade-mirror.job.ts` (`@scaffolding` / `Deleted-in-phase: 4`). 30s `setInterval`, gated by `POLY_ROLE=trader` + bundle + target wallet. Singleton claim log + counter. `targetIdFromWallet` derives a deterministic UUIDv5 from the wallet address. Env additions: `POLY_ROLE`, `COPY_TRADE_*`. Lazy-imports `features/trading` + `features/wallet-watch` so non-trader pods never pull in the machinery. |
| `7825650da` | **CP4.5-replacement — three read APIs for the frontend dev.** `/api/v1/poly/copy-trade/targets`, `/api/v1/poly/copy-trade/orders`, `/api/v1/poly/wallet/balance`. Contracts in `packages/node-contracts/src/poly.*.v1.contract.ts`. Container exposes `polyTradeBundle` so the balance route can reuse `capability.listOpenOrders()` without rebuilding the adapter. Every route has a `TODO(HARDCODED_USER)` pointing at P2.                                                 |

**Test status:** 317 passed / 11 skipped / 0 failed across `tests/unit/bootstrap` + `tests/unit/features`. `pnpm typecheck` clean. `pnpm check:fast` green pre-push.

## Decisions Made

- **Three-layer decomposition.** `trading/` and `wallet-watch/` are GENERIC and survive Phase 4; `copy-trade/` is a thin coordinator that P4 replaces with a Temporal workflow while reusing the same trading + decide surfaces.
- **Use `setInterval`, not `@cogni/scheduler-core`.** The scheduler-core package is governance-schedule machinery (Temporal + cron + grants), not a tick library. Since the poll is `@scaffolding / Deleted-in-phase: 4`, a 4-line `setInterval` is the correct fit; P4 replaces with Temporal. Documented inside `copy-trade-mirror.job.ts`.
- **`SINGLE_WRITER` invariant.** `POLY_ROLE=trader` + `replicas=1` is the joint deployment invariant. Boot log `event:poly.mirror.poll.singleton_claim` + counter `poly_mirror_poll_ticks_total` make a duplicate-pod setup Loki-visible. No DB-lock leader election in v0 (deferred to P2 if horizontal scaling is ever needed).
- **In-memory cursor with 60s warm-up backlog.** First-tick cursor = `now - 60s` so the poll doesn't replay months of a target's historical activity through `decide()` at boot. Cursor resets on process restart — fine for v0 (at-most-once is backed by the DB ledger, not the cursor).
- **Caps filter by `created_at`, not `observed_at`.** `INTENT_BASED_CAPS` means "what we submitted today," not "what the target filled today." Applied to both Drizzle adapter + FakeOrderLedger. Surfaced by the mirror-coordinator cap-hit test.
- **Agent-tool placements are NOT in the ledger in v0.** The agent path still flows through the executor but doesn't write `poly_copy_trade_fills` rows. Tracked as explicit follow-up (one call-site change in `capabilities/poly-trade.ts::placeTrade`); kept out of this PR to minimize blast radius.
- **`noopMetrics` for the poll in v0.** Real prom-client wiring for `poly_mirror_*` lands when a Grafana dashboard justifies it (P2).
- **`HARDCODED_USER` TODOs on every read API.** Multi-tenant scoping lands in P2 when `poly_copy_trade_targets.owner_id` exists. `src/bootstrap/capabilities/poly-trade.ts::buildRealAdapterMethods` is still the ONE allowed place for single-tenant wallet resolution (`HARDCODED_WALLET_SECRETS_OK`).

## Next Actions (remaining for PR close + CP5)

- [ ] **Push + open PR** against `main` from `feat/poly-mirror-v0`.
- [ ] **`pnpm check` once before push** — the CLAUDE.md pre-commit gate.
- [ ] **CI validates the PR.** Watch for `workspace:test` flakes under load (the shared vitest pool occasionally times out on `analytics.summary` + `treasury.snapshot` + `container.spec`; they pass in isolation).
- [ ] **Frontend dev** consumes the three read APIs to build the dashboard panels (monitored wallets / order ledger / wallet balance). No further backend work expected for the UI.
- [ ] **CP5 (manual, ~1h, gated on merge):** Deploy to canary. Tail `poly` container logs for `event:poly.mirror.poll.singleton_claim` (confirms single writer). Flip `poly_copy_trade_config.enabled=true` via `psql`. Observe container-issued `order_id` land in `poly_copy_trade_fills`. Paste evidence into the PR.
- [ ] **Follow-up items (not in this PR):**
  - Agent-tool placements should also write to `order-ledger` so the dashboard shows both paths. One call-site change.
  - Real prom-client wiring for `poly_mirror_*` when dashboards justify it.
  - Multi-tenant wallet resolution (task.0315 P2) — swap the body of `buildRealAdapterMethods()` for a per-connection lookup.

## Risks / Gotchas

- **Biome import ordering.** The formatter will re-sort `import` blocks on every `pnpm format`. Don't re-order manually; let Biome win. This affected every commit on this branch.
- **Commit message constraints.** `body-max-line-length: 100` + `subject-case` rules (lowercase start, no banned words like "complete"/"comprehensive"/"full"). Use the HEREDOC + hard-wrap pattern.
- **Polygon public RPCs round-robin.** `balance/route.ts` uses the default `viem` transport (public RPC). Not a concern for read-only balance queries, but if read staleness becomes user-visible, swap to a pinned RPC via `http(rpcUrl)`.
- **Cursor reset on restart.** The poll replays the last 60s of the target's activity on boot. Each row is dedupe'd by `(target_id, fill_id)` composite PK, so no double-placement — but briefly higher CPU on the first tick after a deploy. If this becomes painful, persist cursor to `poly_copy_trade_config` via a new column. Deferred.
- **Balance endpoint hits the chain synchronously.** Each request does three concurrent reads (USDC balance, POL balance, Polymarket open orders). Typical latency ~1–3s. If the dashboard polls it frequently, add a short TTL cache. Not yet.

## Pointers

| File / Resource                                                                                                               | Why it matters                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [docs/spec/poly-copy-trade-phase1.md](../../docs/spec/poly-copy-trade-phase1.md)                                              | Phase 1 spec — file layout by layer, invariants, E2E scenarios, deferred pointers.                               |
| [work/items/task.0315.poly-copy-trade-prototype.md](../items/task.0315.poly-copy-trade-prototype.md)                          | Canonical task — CP4.1 / 4.2 / 4.25 done on main; CP4.3a–e + CP4.5-replacement done on this branch. CP5 pending. |
| `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts`                                                                | The thin glue. Start here when debugging a tick.                                                                 |
| `nodes/poly/app/src/features/trading/order-ledger.ts`                                                                         | Drizzle adapter + the `CAPS_COUNT_INTENTS` filter on `created_at`.                                               |
| `nodes/poly/app/src/features/wallet-watch/polymarket-source.ts`                                                               | Data-API wrapper + normalizer call site.                                                                         |
| `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts`                                                                  | Scheduler job. `@scaffolding` / `Deleted-in-phase: 4`.                                                           |
| `nodes/poly/app/src/bootstrap/capabilities/poly-trade.ts`                                                                     | Single-tenant wallet resolution boundary (`buildRealAdapterMethods`).                                            |
| `packages/node-contracts/src/poly.*.v1.contract.ts`                                                                           | The three read-API contracts the frontend dev consumes.                                                          |
| `packages/db-schema/src/poly-copy-trade.ts` + `nodes/operator/app/src/adapters/server/db/migrations/0027_silent_nextwave.sql` | Ledger schema. No RLS.                                                                                           |
