---
id: task.0315.handoff
type: handoff
work_item_id: task.0315
status: active
created: 2026-04-18
updated: 2026-04-18
branch: feat/poly-mirror-v0
worktree: /Users/derek/dev/cogni-template-mirror
last_commit: 8b009843b
---

# Handoff: task.0315 — PR #920 ready for merge; mirror needs ONE env var to actually run

## The one thing you need to know

**Nothing I did in this branch actually trades yet.** The code is merged-ready, but every deployment where you want the autonomous mirror to run needs ONE env var set + ONE psql line:

```bash
kubectl set env deployment/poly COPY_TRADE_TARGET_WALLET=0x<target-wallet>
# wait for pod restart
psql -h <poly-db-host> -U <user> -d cogni_poly \
  -c "UPDATE poly_copy_trade_config SET enabled=true WHERE singleton_id=1;"
```

That's it. Not in any deploy manifest (deliberate — this is `@scaffolding`, Deleted-in-phase: 4). When you don't set the env var, the poll skips boot + logs `poly.mirror.poll.skipped` and the app runs normally.

## What shipped on this branch (PR #920)

13 commits, all green locally. CI pending on `8b009843b` at push time.

1. `e97552ddc` Phase 1 spec + three-layer retargeting
2. `078d9d3f7` cp4.3a — `PolyTradeBundle` seam split (agent tool + poll share ONE adapter)
3. `6a8edfb9d` cp4.3b — `features/trading/` layer (executor move + order-ledger)
4. `2d33410fe` cp4.3c — `features/wallet-watch/` layer (polymarket-source)
5. `086ec2ab0` cp4.3d — mirror-coordinator (thin copy-trade glue, 9-scenario tests)
6. `4feaccbb8` cp4.3e — scheduler job + bootstrap wiring
7. `7825650da` read APIs: `GET /api/v1/poly/{copy-trade/targets, copy-trade/orders, wallet/balance}`
8. `b0392c953` closeout handoff (now stale — this file supersedes)
9. `33328c7bf` review fixes B1 wrong URL / B2 normalizer wedge / C1 uuidv5 / C2 monitor flag
10. `da70036f7` container.serviceDb routing (lint fix)
11. `f7a4314f4` **MUST_FIX_P2 flag** on task.0315 P2 — RLS + tenant-scoping required before multi-tenant
12. `0bbe25bc8` Turbopack `.js`-extension import fix (unblocked poly build)
13. `da894ee7a` self-review APPROVE marker
14. `85862333d` observability pass — 17 events registered in `EVENT_NAMES`, errorCode on every error log, debug noise trimmed
15. `8b009843b` **env cleanup** — deleted `POLY_ROLE`, `COPY_TRADE_MODE`, `MIRROR_USDC`, `MAX_DAILY_USDC`, `MAX_FILLS_PER_HOUR`, `POLL_MS`. Only `COPY_TRADE_TARGET_WALLET` remains. Defaults hardcoded in `bootstrap/jobs/copy-trade-mirror.job.ts`.

## CP5 — what's left to actually observe a live mirror trade

Not my work to do from this session, but concrete:

1. **Merge PR #920** once CI is green.
2. **Pick a deployment** to enable mirror on (candidate-a or dedicated prototype env).
3. **Set the env:** `kubectl set env deployment/poly COPY_TRADE_TARGET_WALLET=0x<real-high-volume-wallet> -n <ns>`.
4. **Wait for pod restart.** Tail logs, confirm `poly.mirror.poll.singleton_claim` appears **exactly once**. If multiple instances log it, replicas>1 → fix before proceeding (SINGLE_WRITER breaks).
5. **Flip the kill-switch:** `psql ... -c "UPDATE poly_copy_trade_config SET enabled=true WHERE singleton_id=1;"`. Takes effect on the next poll tick (≤30s).
6. **Watch:** `poly_copy_trade_fills` for the first row with non-null `order_id`. Target wallet's profile on polymarket.com + our operator profile should both show the mirrored position.
7. **Paste evidence** (order_id, tx hash, screenshots) into the PR or a follow-up issue.
8. **Turn off when done:** `UPDATE poly_copy_trade_config SET enabled=false;` + optional `kubectl set env ... COPY_TRADE_TARGET_WALLET-` to remove the env.

## Hardcoded v0 constants (edit-in-code, redeploy to change)

`bootstrap/jobs/copy-trade-mirror.job.ts:44-57`:

- `MIRROR_POLL_MS = 30_000`
- `MIRROR_USDC = 1`
- `MIRROR_MAX_DAILY_USDC = 10`
- `MIRROR_MAX_FILLS_PER_HOUR = 5`
- `mode: "live"` (paper adapter body = P3)
- Warmup backlog = 60s (first-tick cursor skips the last minute of target history to avoid replay)

## Known gaps (carryover + my misses)

- **MUST_FIX_P2**: RLS + `owner_user_id` column + `withTenantScope` migration before P2 multi-tenant ships. Currently the three read APIs use `Container.serviceDb` (BYPASSRLS). Documented in `docs/spec/poly-copy-trade-phase1.md` + `task.0315.poly-copy-trade-prototype.md` P2 bullet + JSDoc on the `Container.serviceDb` field.
- **Agent-tool placements NOT in order-ledger.** The agent path (`core__poly_place_trade`) places orders but doesn't write to `poly_copy_trade_fills`. One call-site change in `bootstrap/capabilities/poly-trade.ts::placeTrade` — omitted to keep this PR scoped. Dashboard will show ONLY autonomous mirror orders.
- **`poly_mirror_*` metrics are `noopMetrics`.** Defined in code, not wired. Pull `buildMetricsPort` from `poly-trade.ts` to wire real prom-client when Grafana panels exist.
- **`placeIntent` has no timeout.** If Polymarket hangs, the tick hangs. Dedupe saves correctness; next tick's `setInterval` still fires. Add `AbortController` when it becomes a real problem.
- **Cursor resets on process restart.** First-tick cursor = `now - 60s`. Any fill observed in the 60s before restart is missed. v0 accepts; persisted cursor is trivial (one column on `poly_copy_trade_config`).
- **Kill-switch flip is a manual psql step.** We could auto-seed `enabled=true` via a migration or have startup auto-flip when untouched, but migration 0027 is already on main and the manual gate is honest for a money-handling prototype. Leave as-is.
- **Balance endpoint rebuilds viem client per request.** Cache at module scope if dashboard polls cause latency.

## What you DON'T need to do

- Rename "kill-switch" to "monitoring-active" across the code. Naming is bad but touches `decide.ts` + the decisions.reason column values + tests. Cosmetic churn. Skip until P2.
- Re-review B1/B2/C1/C2. All resolved, tests cover regressions, scored APPROVE at `da894ee7a`.
- Write a doc. You (Derek) explicitly said no.

## Pointers

| File                                                | Why                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bootstrap/jobs/copy-trade-mirror.job.ts`           | Job shim + v0 hardcoded constants + UUIDv5 target-id helper                              |
| `features/copy-trade/mirror-coordinator.ts`         | Pure `runOnce(deps)` — the glue                                                          |
| `features/trading/order-ledger.ts`                  | Drizzle adapter + caps filter on `created_at` (CAPS_COUNT_INTENTS)                       |
| `features/wallet-watch/polymarket-source.ts`        | Data-API wrapper + normalize-error catch                                                 |
| `bootstrap/capabilities/poly-trade.ts`              | `PolyTradeBundle` factory + `buildRealAdapterMethods` (single-tenant isolation boundary) |
| `packages/node-contracts/src/poly.*.v1.contract.ts` | 3 read-API contracts                                                                     |
| `docs/spec/poly-copy-trade-phase1.md`               | Phase 1 spec — layer boundaries, invariants, scenarios                                   |
| `work/items/task.0315.poly-copy-trade-prototype.md` | Parent task, includes MUST_FIX_P2                                                        |

## PR

https://github.com/Cogni-DAO/node-template/pull/920
