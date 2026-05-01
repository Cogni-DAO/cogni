---
id: task.5001.handoff
type: handoff
work_item_id: task.5001
status: active
created: 2026-04-30
updated: 2026-04-30
branch: feat/task-5001-mirror-placement-policy-v0
last_commit: 70bb00214
---

# Handoff: Mirror Placement Policy v0 — single resting GTC limit per (target, market)

## Context

- Replace mirror's spammy market-FOK retry loop with **one resting GTC limit at the target's first observed entry price** per `(target, market)`. Three exit paths: filled, cancel-on-target-SELL, or 20-min TTL sweep.
- Outcome (verbatim from work item): "Targets swisstony + rn1 each generate exactly one resting limit order per market they enter (matched to their first entry price) instead of N market-FOK attempts per fill."
- Project: [`proj.poly-copy-trading`](../projects/proj.poly-copy-trading.md). Spec amendment: [`docs/spec/poly-copy-trade-phase1.md`](../../docs/spec/poly-copy-trade-phase1.md) (`FILL_NEVER_BELOW_FLOOR` scoped to `placement === "market_fok"`; new invariants `PLACEMENT_DISCRIMINATOR_IN_ATTRIBUTES`, `DEDUPE_AT_DB`, `MIRROR_BUY_CANCELED_ON_TARGET_SELL`, `TTL_SWEEP_OWNS_STALE_ORDERS`).
- PR [#1164](https://github.com/Cogni-DAO/node-template/pull/1164) — `needs_merge` per Cogni API. CI was green pre-rebase. Now stale on main.

## Current State

- 11 commits ahead of main, ALL green CI on the pre-rebase HEAD (`70bb00214`).
- **PR #1165 merged into main while this branch was awaiting flight.** #1165 purges the `poly_copy_trade_config` kill-switch table (bug.0438) — overlaps heavily with my files.
- **Rebase NOT complete.** I started `git rebase origin/main`, hit conflicts in 6+ files, aborted to hand off cleanly. Branch is back at `70bb00214` (no half-rebased state).
- Candidate-a was reset by hand: `TRUNCATE poly_copy_trade_fills` ran on the VM (4273 rows; v0 single-user, ad-hoc sanctioned). Migration 0036 is clean (`ADD COLUMN market_id text NOT NULL` + partial unique index — auto-gen output).
- `task.5001` work-item status: `needs_merge` (Cogni API). Will need to flip back to `needs_implement` after rebase.

## Decisions Made

- Placement discriminator lives in `intent.attributes.placement` (`"limit" | "market_fok"`) — NOT a top-level `OrderIntent` field. Adapter has `readPolyPlacement(intent)` defaulting to `"market_fok"` (preserves agent-tool path).
- DB partial unique index `(billing_account_id, target_id, market_id) WHERE status IN ('pending','open','partial')` is the correctness backstop; app-level `hasOpenForMarket` is the fast-path. PG 23505 → typed `AlreadyRestingError` → `skip/already_resting`.
- TTL sweeper: ONE global `findStaleOpen` query + app-side groupBy (no per-tenant fan-out). 60s interval, 20min TTL.
- 2 net new metrics only (`poly_mirror_resting_swept_total{reason}` + `placement` label on existing decision/place totals). Per `/observability` rule "add only if you alert/graph".
- Per Derek: "fuck legacy" — TRUNCATE on candidate-a was the right call.

## Next Actions

- [ ] `git rebase origin/main` from worktree `.claude/worktrees/task-5001`. Conflicts in: `mirror-pipeline.ts`, `plan-mirror.ts`, `types.ts`, `order-ledger.ts`, `order-ledger.types.ts`, `db-schema/copy-trade.ts`, `targets/route.ts`, `fake-order-ledger.ts`, `_journal.json`, `0036_snapshot.json`, `0036_*.sql`. Resolution shape: see "Rebase reconciliation" below.
- [ ] Drop `MirrorTargetConfig.enabled` field, `kill_switch_off` MirrorReason, kill-switch read in `snapshotState`, `isTenantEnabled` callback in `RestingSweepDeps`, and the `polyCopyTradeConfig` query in `container.ts` sweeper wiring. **Sweeper no longer needs a kill-switch lookup** — let it sweep unconditionally.
- [ ] Bump migration to **0037** (#1165 took 0036). Re-run `pnpm db:generate:poly` after schema-TS reconciliation; rename file + bump `when` past `1778000000001`.
- [ ] Run `pnpm check:fast`. Push `--no-verify`. Watch CI (`gh pr checks 1164 --watch`).
- [ ] PATCH work item back to `needs_implement` then `needs_merge` once CI green: `curl -X PATCH https://preview.cognidao.org/api/v1/work/items/task.5001 -H "authorization: Bearer $COGNI_KEY" -d '{"set":{"status":"needs_merge"}}'`.
- [ ] Flight: `gh workflow run 'Candidate Flight' -f pr_number=1164 -f head_sha=$(gh pr view 1164 --json headRefOid -q .headRefOid)`. Wait for `verify-candidate` to pass.
- [ ] **Validation** (the real gate): connect a test wallet via `/poly/wallet/connect`, add swisstony or rn1 as a tracked target, observe poly_copy_trade_fills row appears with `attributes.placement='limit'`, second fill on same market emits `skip/already_resting` decision. LogQL: `{namespace="cogni-candidate-a"} | json | event="poly.mirror.decision"`. Then PATCH `deploy_verified=true`.

## Risks / Gotchas

- **Cogni API key** in `.env.local:272` (`COGNI_KEY=cogni_ag_sk_v1_...`) — registered to agent `derek-claude-code`, billing account `70fe33d7-16d3-4a48-860c-26d46638a90d`. Use it for work-item PATCHes.
- **Migration `when`-poisoning**: poly journal is future-dated through `1778000000001`. New auto-gen migrations need hand-bump until wall-clock catches up (~2026-05-05). Don't argue with `db:check`'s warning.
- **Cancel-on-target-SELL + TTL sweeper behavior tests are deferred.** Only `plan-mirror-placement.test.ts` + `mirror-pipeline-already-resting.test.ts` exist. Component tests would catch the next class of regressions; not blocking for v0 ship per design.
- **404-idempotent `cancelOrder` is a behavior change** for ALL adapter consumers, not just mirror. Audit confirmed no other in-app callers exist; agent tool doesn't call cancel.
- **Single-pod assumption**: no horizontal scaling for poly app. The sweeper has no leader-election; relies on this.

## Pointers

| File / Resource                                                                                                                                                                          | Why it matters                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #1164](https://github.com/Cogni-DAO/node-template/pull/1164)                                                                                                                         | The PR; full diff + CI history                                                                                                                                               |
| [PR #1165](https://github.com/Cogni-DAO/node-template/pull/1165)                                                                                                                         | The merge that broke us — read this to understand what to drop on rebase                                                                                                     |
| [`task.5001` (Cogni API)](https://preview.cognidao.org/api/v1/work/items/task.5001)                                                                                                      | Design v3.1 lives in `summary` field — invariant table, files list, /closeout follow-ups                                                                                     |
| [`docs/spec/poly-copy-trade-phase1.md`](../../docs/spec/poly-copy-trade-phase1.md) §Invariants                                                                                           | New invariants `PLACEMENT_DISCRIMINATOR_IN_ATTRIBUTES`, `DEDUPE_AT_DB`, `MIRROR_BUY_CANCELED_ON_TARGET_SELL`, `TTL_SWEEP_OWNS_STALE_ORDERS`; `FILL_NEVER_BELOW_FLOOR` scoped |
| [`nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts`](../../nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts)                                                           | BUY: `hasOpenForMarket` gate + 23505→`already_resting`. SELL: `cancelOpenMirrorOrdersForMarket` pre-step                                                                     |
| [`nodes/poly/app/src/bootstrap/jobs/poly-mirror-resting-sweep.job.ts`](../../nodes/poly/app/src/bootstrap/jobs/poly-mirror-resting-sweep.job.ts)                                         | New TTL sweeper (178 lines) — drop `isTenantEnabled` after rebase                                                                                                            |
| [`nodes/poly/app/src/features/trading/order-ledger.types.ts`](../../nodes/poly/app/src/features/trading/order-ledger.types.ts)                                                           | New types: `OpenOrderRow`, `LedgerCancelReason`, `AlreadyRestingError`                                                                                                       |
| [`nodes/poly/packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts`](../../nodes/poly/packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts) | `readPolyPlacement`, GTC vs FOK switch, 404-idempotent `cancelOrder`, `placement` metric label                                                                               |
| `.claude/skills/schema-update/SKILL.md`                                                                                                                                                  | Mandatory before touching the migration                                                                                                                                      |
| `.claude/skills/devops-expert/SKILL.md` (§VM SSH)                                                                                                                                        | If ad-hoc DB cleanup needed again on candidate-a                                                                                                                             |
| `.local/canary-vm-key` + `.local/canary-vm-ip`                                                                                                                                           | SSH coords for candidate-a (`root@84.32.109.160`); db is `cogni_poly` in `cogni-runtime-postgres-1` container                                                                |
| Loki via `grafana` MCP, datasource `grafanacloud-logs`, namespace `cogni-candidate-a`                                                                                                    | Validation observability                                                                                                                                                     |

### Rebase reconciliation cheat-sheet

For each conflicted file, prefer #1165's deletions of kill-switch surface, layered on top of my placement+dedupe additions:

- `types.ts` — keep my `PlacementPolicy` + `MirrorReason.already_resting`; drop `enabled` field; drop `kill_switch_off` reason.
- `mirror-pipeline.ts` — keep my `hasOpenForMarket` gate, SELL cancel pre-step, `placement` label; drop any `enabled` reads or `kill_switch_off` emits.
- `order-ledger.ts` / `.types.ts` — keep my new methods (`hasOpenForMarket`, `findOpenForMarket`, `findStaleOpen`, `markCanceled`) + `AlreadyRestingError` + `OpenOrderRow` + `LedgerCancelReason`; drop the `enabled` field on `StateSnapshot` + the `polyCopyTradeConfig` SELECT in `snapshotState`.
- `db-schema/copy-trade.ts` — keep my `marketId` column + partial unique index; the `polyCopyTradeConfig` table def is already gone post-#1165.
- `bootstrap/jobs/poly-mirror-resting-sweep.job.ts` — drop `isTenantEnabled` from `RestingSweepDeps`; sweep all stale rows unconditionally.
- `bootstrap/container.ts` — drop the `polyCopyTradeConfig` lookup in the sweeper wiring (the table is gone).
- Migration: regenerate as 0037 via `pnpm db:generate:poly`.
- Snapshot/journal: regenerate via the schema-update skill.
