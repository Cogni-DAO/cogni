---
id: bug.0384.handoff
type: handoff
work_item_id: bug.0384
status: active
created: 2026-04-26
updated: 2026-04-26
branch: bug/0384-sweep-race
last_commit: 209863cd2
---

# Handoff: bug.0384 — poly redeem-sweep race guards (LIVE IN PROD, awaiting validation)

## Context

- bug.0383 fix shipped to prod (PR #1065) → exposed a separate race: same conditions firing 3-5x per sweep cycle because `balanceOf` multicall reads pre-burn state. After 1 POL refund, prod funder drained 0.79 POL in 13 min (82 txs / 3 payouts).
- bug.0384 (this PR #1070) ships three module-scope guards in `poly-trade-executor.ts`: sweep mutex (catches inter-tick overlap), per-condition 60s cooldown (catches manual ↔ sweep + double-click), and `poly.ctf.redeem.sweep_completed` observability (catches the next race-class issue within the hour).
- Live in production NOW. Candidate-a validation showed sweep-race stopped (nonce went flat after deploy). Cooldown was unproven directly because no winners on candidate-a; mutex IS engaging (15 `sweep_skip_in_flight`/10m).
- This is a band-aid. Real fix is **task.0377** (event-driven sweep via CTF `ConditionResolution` + own `PayoutRedemption` event subscription). bug.0384's mutex+cooldown delete as dead code once 0377 ships.

## Current State

- PR #1070: merged to main. Production deployed (verified `/version` on poly-test before promote). bug.0384 work-item file lives in this PR (single-node-scope gate force-merged).
- Production funder `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`: nonce 461, bal 0.004 POL at 22:33Z. User about to refund POL — first real prod proof.
- Watch monitor armed (task `bx5jaxha6`): emits on every nonce/balance change for the prod funder. PASS = nonce climbs by N (one per distinct winner) then settles. FAIL = climbs past 5-10 with no slowdown.
- Tests: 18 executor cases (14 existing + 4 race regression), all green. Fixture-driven decision matrix from bug.0383 (`tests/fixtures/poly-ctf-redeem/`) still passing.
- Worktree clean. Pushed. PR squash-merged.

## Decisions Made

- Mutex AND cooldown both load-bearing (different races): see [PR #1070](https://github.com/Cogni-DAO/node-template/pull/1070) and `bug.0384.poly-redeem-sweep-race-condition.md` § Approach for the justification table.
- 60s cooldown tied to Polygon finality math (block 2s + 3-5 block finality + RPC propagation × 2× safety) — not folk wisdom. Documented in code at `REDEEM_COOLDOWN_MS`.
- No `POLY_REDEEM_SWEEP_ENABLED` kill switch env var. Two prior reviews flagged it as speculative config debt; revert+redeploy is the same friction without permanent matrix bloat.
- `SINGLE_POD_ASSUMPTION` invariant added to module doc — in-process Map+bool break under multi-replica scaling. Deployment must stay single-replica until task.0377.

## Next Actions

- [ ] User funds prod wallet; watch monitor `bx5jaxha6` emits each nonce/balance change.
- [ ] Verify post-refund: nonce climbs by ≤ N (count of distinct winning conditions) then FLAT. POL spend ≤ N × 0.012.
- [ ] Loki sanity in prod: `event=poly.ctf.redeem.sweep_completed` emits per ~30s tick with `duration_ms < 30000`; `event=poly.ctf.redeem.skip_pending_redeem` ≥ 1 within 60s of any `redeem.ok`.
- [ ] If FAIL pattern (nonce climbing past 5-10): revert PR #1070, redeploy, file follow-up bug.
- [ ] If PASS: post final scorecard PR comment on #1070 with prod evidence; archive this handoff.
- [ ] Start `/design` on **task.0377** (event-driven sweep) — fresh worktree off main, branch `task/0377-event-driven-sweep`. The follow-up plan is in `bug.0384.md` § Follow-up plan.

## Risks / Gotchas

- **Single-pod constraint is hard-locked.** If poly node ever scales to >1 replica, bug.0384's in-process Map + mutex break instantly. Race returns. Module doc invariant `SINGLE_POD_ASSUMPTION` documents this.
- **Cooldown was unverified on candidate-a** — no winners present to trigger it. First prod refund is the actual proof.
- **bug.0335 still active** (CLOB BUY empty reject on candidate-a, operator wallet allowance issue). Unrelated to bug.0384 but may complicate any e2e validation that involves trade placement, not just redemption.
- **Polymarket Data-API `outcomeIndex` schema** still has `.default(0)` in `packages/market-provider` — bug.0383 design tightened it briefly then reverted to keep PR single-domain. Not blocking, but means a missing-field response silently coerces to outcome 0.
- **task.0377 is the real fix.** Polling chain state for idempotency is the bug class; bug.0384 buys time, doesn't cure. Don't optimize the polling further — replace it.

## Pointers

| File / Resource                                                            | Why it matters                                                                                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [PR #1070](https://github.com/Cogni-DAO/node-template/pull/1070)           | The fix. Validation scorecard in PR comments.                                                                                       |
| `work/items/bug.0384.poly-redeem-sweep-race-condition.md`                  | Full bug record: root cause, design rationale, invariants, follow-up plan to task.0377.                                             |
| `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`         | All three guards live here. Module-scope `redeemCooldownByConditionId` Map + `sweepInFlight` bool at top; `decideRedeem` predicate. |
| `nodes/poly/app/tests/unit/bootstrap/poly-trade-executor.test.ts`          | 4 race regression tests in the `bug.0384` describe block.                                                                           |
| `nodes/poly/app/tests/fixtures/poly-ctf-redeem/`                           | bug.0383 fixture matrix (real Polymarket+Polygon snapshots). Predicate behavior in 0377 must stay identical.                        |
| [task.0377](../items/task.0377.poly-redeem-sweep-reactive-architecture.md) | The real fix. Event-driven sweep via CTF event subscription. `Needs Design` → start here next.                                      |
| [task.0379](../items/task.0379.poly-redemption-sweep-production-grade.md)  | Multi-pod hardening (Redis idempotency, per-condition cooldown across pods). Blocked on 0377.                                       |
| `.claude/skills/poly-copy-trading/SKILL.md`                                | Mirror pipeline reference. Anti-patterns section warns against placing trades from your own wallet to test the mirror.              |
| `.claude/skills/poly-market-data/SKILL.md`                                 | CTF + Data-API semantics. EOA-vs-Safe-proxy gotcha. CLOB order fields.                                                              |
| `scripts/loki-query.sh`                                                    | MCP-down fallback for Loki queries. Reads `GRAFANA_*` from `.env.canary`.                                                           |
| Watch task `bx5jaxha6`                                                     | Persistent prod-funder nonce/balance monitor. Every change emits a notification. `TaskStop bx5jaxha6` to cancel.                    |
