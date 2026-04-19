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

**This is live money on a real target wallet. Read the "before you turn it on" section below BEFORE running the kubectl line.**

### Before you turn it on

- **Pick the target wallet deliberately.** You're copying a real human's Polymarket trades 1-for-1 (fixed $1 notional each, capped $10/day). If they buy a dumb market, you buy it too. There is no "smart" filter. Candidates: one of the high-PnL wallets from the existing Top Wallets dashboard card.
- **Verify operator wallet state.** `0xdCCa8D85603C2CC47dc6974a790dF846f8695056` on Polygon must have: USDC.e > $20, POL > 0.5 (gas), CLOB creds derived, USDC.e allowance at `MaxUint256` for the three Polymarket exchange contracts. PR #900 onboarded this; re-verify via `scripts/experiments/probe-polymarket-account.ts`.
- **Coordinate with the frontend dev.** The 3 read APIs return empty/degraded shapes until a target is set + enabled. The dashboard panels will look broken until CP5 actually runs. Tell them "flip going live at &lt;time&gt;."
- **Plan the stop point.** Don't "set it and see what happens." Decide up front: stop after N hours, or after first placed order + manual review, or after hitting daily cap. Calendar reminder. Nothing alerts if you walk away.

### The command sequence

1. Merge PR #920 once CI is green.
2. Pick the deployment (candidate-a or a dedicated prototype env).
3. Set the env: `kubectl set env deployment/poly COPY_TRADE_TARGET_WALLET=0x<wallet> -n <ns>`.
4. Wait for pod restart. Tail logs, confirm `poly.mirror.poll.singleton_claim` appears **exactly once**. Multiple instances = `replicas>1` = SINGLE_WRITER broken, fix before continuing.
5. Flip the enable switch: `psql ... -c "UPDATE poly_copy_trade_config SET enabled=true WHERE singleton_id=1;"`. Takes effect within one poll tick (≤30s).
6. **Watch actively.** First real mirrored fill lands in `poly_copy_trade_fills` with non-null `order_id`. Verify on polymarket.com both the target's profile (the fill they made) and the operator profile `0xdCCa8…5056` (our mirror).
7. Paste evidence — `order_id`, Polygon tx hash, screenshots — into the PR or a follow-up issue.

### Stopping + rollback

- **Normal stop:** `UPDATE poly_copy_trade_config SET enabled=false;`. Effective within one tick. Pending orders stay open on Polymarket — they're active limit orders, not automatically cancelled.
- **Cancel open orders manually:** via the agent tool (`core__poly_cancel_order` in poly-brain chat — takes an `order_id`), OR directly through Polymarket's UI logged in as the operator EOA.
- **Clean up ledger rows:** `poly_copy_trade_fills` rows with `status='open'` aren't auto-transitioned to `canceled` in v0. Either accept the stale status (they don't hurt anything) or manually UPDATE them to match the actual CLOB state.
- **Full teardown:** `kubectl set env ... COPY_TRADE_TARGET_WALLET-` removes the env. Next pod restart, mirror skips boot entirely.

### If something goes wrong

- **Wrong market mirrored:** cancel via agent tool or Polymarket UI. The `enabled=false` flip stops future placements but doesn't touch existing orders.
- **Mirror stuck, no new fills:** check Loki for `poly.mirror.source_error` + `poly.wallet_watch.normalize_error`. Source timeout = Data-API flaked; normalize = Polymarket schema drifted.
- **Operator wallet draining faster than expected:** `enabled=false` immediately, then `SELECT * FROM poly_copy_trade_fills ORDER BY created_at DESC` — the caps are intent-based, not fill-based, so a target that fills repeatedly at high sizes won't exceed our caps but COULD drain USDC on slippage. Manual review.

### What to watch during the first 48 hours

**Nothing alerts automatically.** You are the alert. Minimum:

- Daily: `SELECT status, COUNT(*) FROM poly_copy_trade_fills WHERE created_at > now() - interval '1 day' GROUP BY status`. Expect a mix of `filled` / `open`. `error` > 0 = read the row.
- Daily: operator USDC.e balance on Polygon. Delta should roughly track placements × (filled price vs limit price).
- Daily: Loki query `{container="poly"} |= "poly.mirror.poll.tick_error" | json`. Expect zero. Any hit = bug.

## Hardcoded v0 constants (edit-in-code, redeploy to change)

`bootstrap/jobs/copy-trade-mirror.job.ts:44-57`:

- `MIRROR_POLL_MS = 30_000`
- `MIRROR_USDC = 1`
- `MIRROR_MAX_DAILY_USDC = 10`
- `MIRROR_MAX_FILLS_PER_HOUR = 5`
- `mode: "live"` (paper adapter body = P3)
- Warmup backlog = 60s (first-tick cursor skips the last minute of target history to avoid replay)

## Known gaps (carryover + my misses)

**Security / hygiene (must fix before growing scope):**

- **MUST*FIX_P2 — RLS on `poly_copy_trade*\*`.** Three tables landed as system-owned with BYPASSRLS on the read APIs. Shipping P2 multi-tenant on top of this = security regression. The 5-step migration (add `owner_user_id`, enable RLS + policy, `withTenantScope` writes, app-role reads, delete `Container.serviceDb`) is flagged in `task.0315.poly-copy-trade-prototype.md` P2 bullet + JSDoc on the `Container.serviceDb` field. **Not yet a separate task item — ask Derek whether to file it.**

**Operational (you will hit these):**

- **No automated alerting.** No Grafana alerts wired for `poly.mirror.poll.tick_error` or unexpected placement spikes. The "watch during first 48 hours" checklist above is manual. Filing a real alert is a P2 concern.
- **No cursor persistence.** Pod restart = last 60s of target activity is missed (first-tick cursor = `now-60s`). Trivial to fix (one column on `poly_copy_trade_config`), deferred.
- **`placeIntent` has no timeout.** If Polymarket hangs, the tick hangs. Dedupe saves correctness (next tick still fires); in-flight promises leak. Add `AbortController` when it bites.
- **Balance endpoint rebuilds viem client per request.** Cache at module scope if dashboard latency becomes a user complaint.

**Scope omissions (deliberate, tracked):**

- **Agent-tool placements NOT in order-ledger.** `core__poly_place_trade` (shipped PR #900) places orders but doesn't write to `poly_copy_trade_fills`. One call-site change in `bootstrap/capabilities/poly-trade.ts::placeTrade` — kept out to scope this PR. Dashboard + `/api/v1/poly/copy-trade/orders` show ONLY autonomous mirror orders today.
- **`poly_mirror_*` metrics are `noopMetrics`.** Metric names defined in code but not wired to prom. Extract `buildMetricsPort` from `poly-trade.ts` when Grafana panels are worth building.
- **Paper mode isn't implemented.** P3 adds the paper adapter body; v0 only places real orders. `mode: "live"` hardcoded in `buildMirrorTargetConfig`.

## What you DON'T need to do

- Rename "kill-switch" to "monitoring-active" across the code. Naming is bad but touches `decide.ts` + the decisions.reason column values + tests. Cosmetic churn. Skip until P2.
- Re-review B1/B2/C1/C2. All resolved, tests cover regressions, scored APPROVE at `da894ee7a`.
- Write a doc. Derek explicitly said no.
- Back-fill a retroactive flight-runbook. The "CP5" section above IS the runbook — everything ops needs is between the `kubectl` line and the rollback instructions.

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
