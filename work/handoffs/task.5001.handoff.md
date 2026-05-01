---
id: task.5001.handoff
type: handoff
work_item_id: task.5001
status: active
created: 2026-05-01
updated: 2026-05-01
branch: fix/0037-race-safe-and-doc-truthup
last_commit: 06fc35170
---

# Handoff: task.5001 follow-up — copy-trade actually works on prod

## Context

- task.5001 (mirror placement v0) shipped on PR #1164 (commit `8e4a7e7a`), reached prod via "Promote and Deploy" `25201268651`. **Code is live everywhere.**
- After deploy, prod's mirror loop is detecting RN1 fills (the only active tracked target on prod, wallet `0x2005d16a84ceefa912d4e380cd32e7ff827875ea`) but **no successful limit orders are landing**. Three distinct bugs discovered, each separately blocking the "limit orders place when target trades" outcome.
- Open PR #1167 on this branch bundles three fixes; **takerOnly fix is unvalidated and the leading hypothesis needs to be confirmed against preview/candidate-a behavior before merge**.

## Current State

- Migration 0037 + bug.0438 (`DROP poly_copy_trade_config`) both applied on candidate-a, preview, prod. Each was applied via manual ad-hoc DDL inside `ACCESS EXCLUSIVE` lock to work around the drizzle race (PR #1167 `0037` rewrite makes this race-safe going forward).
- Operational unblock on prod: 43,688 historical FOK error rows DELETE'd by Derek's authorization (cumulative_intent cap noise, `bug.0430` pessimism). Filled (133) and canceled (76) rows kept. Cap stopped firing on RN1's market.
- **Still no successful place on prod** despite the cap being clear → led to discovery of takerOnly default behavior on Polymarket Data API (see Decisions). Hypothesis untested.
- PR #1167 CI on `06fc35170` not yet observed past 9f0ab4ed9 (which was green). Re-run kicked off automatically by the takerOnly commit.

## Decisions Made

- Migration race-safety = single `DO $$` block + `LOCK TABLE`. See PR #1167 file diff: [`nodes/poly/app/src/adapters/server/db/migrations/0037_poly_copy_trade_market_id.sql`](../../nodes/poly/app/src/adapters/server/db/migrations/0037_poly_copy_trade_market_id.sql).
- `cumulativeIntentForMarket` counts `error` rows only when `attributes.placement = 'market_fok'`. Limit-order errors are CLOB-rejected → no CTF → don't count. See [`order-ledger.ts:cumulativeIntentForMarket`](../../nodes/poly/app/src/features/trading/order-ledger.ts).
- Persist `attributes.placement` at `insertPending` so the cap-logic discriminator has data to filter on. See `order-ledger.ts:insertPending`.
- **takerOnly hypothesis (UNVERIFIED):** Polymarket Data API `/trades` defaults `takerOnly=true` server-side. Adapter omitted the param → API returned only TAKER fills → maker-side trades invisible. RN1 is observably maker-heavy (curl proved last taker fill 26min ago, latest fill 2.2min ago when `takerOnly=false`). Fix in `polymarket.data-api.client.ts:listUserTrades`. **The challenge to verify:** how did candidate-a + preview produce successful mirror activity on `0x204f72f3…35326dba…` if this filter was hiding everything? Suspect `0x204f72f3…` is a taker-heavy trader and the filter happened not to bite. Unconfirmed.
- Cross-domain doc cleanup (kustomization comments + skill + multi-node-dev) was REMOVED from this PR for single-node-scope. Owner: file as separate operator-domain PR.

## Next Actions

- [ ] **Verify takerOnly hypothesis BEFORE merge.** Hit `/trades?user=0x204f72f335326dba…&takerOnly=true` vs `takerOnly=false`. If the wallet's recent fills show up in BOTH, the hypothesis is wrong and the fix may be a no-op (or worse, change behavior in a way I don't understand).
- [ ] CI on `06fc35170` watcher: PR #1167 checks. Static was failing on biome import format earlier (fixed at `9f0ab4ed9`); validate the new commit doesn't reintroduce.
- [ ] Squash/clean inline comments per CLAUDE.md "default to no comments." The 5-line block in `polymarket.data-api.client.ts` should collapse to one line or move to TSDoc module header.
- [ ] If hypothesis verifies → merge PR #1167 → preview-forward to prod → watch the post-DELETE prod DB for first `status='open'` row. ETA: 30s–few min after RN1's next fill if the fix works.
- [ ] After this PR ships, file the operator-domain PR with the kustomization comment cleanup + database-expert skill update + multi-node-dev.md update (all reverted from this branch). All four cited a removed `exit 0` patch + cited task.0260 incorrectly (correct ref is task.0370 step 1).
- [ ] **Aggregate-production CI gate has a pre-existing bug** (`Axiom 19 contradiction: scheduler-worker` even when all individual gates green). Out of scope for this work item; flag separately.

## Risks / Gotchas

- The takerOnly fix changes default behavior of `listUserTrades` for ALL callers, not just wallet-watch. Audit other callers in `nodes/poly` before merge — if any rely on the prior implicit-taker-only behavior, they'll regress.
- DELETE'd 43,688 prod error rows under "no CTF risk" rationale (CLOB rejected = no on-chain effect for limit; FOK racing was the original `bug.0430` concern). If any of those rows was a FOK that DID race to mint CTF, we just lost the cap signal for that position. Mitigation: prod's `filled` table is the source of truth for actual positions; cap pessimism was belt-and-suspenders.
- Migration 0037's content change → drizzle hash differs → drizzle re-applies on next pod boot in every env. New SQL is all `IF EXISTS` / `IF NOT EXISTS` guarded → no-op on re-run, but inserts a 2nd `__drizzle_migrations` row at the same `when=1778000200000`. Cosmetic, not load-bearing.
- Aggregate-production strict-fail bug is unrelated but will keep producing red CI on any prod promote. Will need a separate fix or a manual gate-bypass to declare prod-ready.
- Comments I added are too verbose per CLAUDE.md style. Trim before merge.

## Pointers

| File / Resource                                                                                     | Why it matters                                                                                           |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [PR #1167](https://github.com/Cogni-DAO/node-template/pull/1167)                                    | This branch's PR; full diff + CI history                                                                 |
| [PR #1164](https://github.com/Cogni-DAO/node-template/pull/1164)                                    | Original task.5001; shipped + verified on candidate-a/preview/prod                                       |
| [`task.5001` (Cogni API)](https://preview.cognidao.org/api/v1/work/items/task.5001)                 | Design v3.1 lives in `summary` field; `status: done` per PR #1164 merge                                  |
| `nodes/poly/app/src/adapters/server/db/migrations/0037_poly_copy_trade_market_id.sql`               | Race-safe DO-block migration                                                                             |
| `nodes/poly/app/src/features/trading/order-ledger.ts`                                               | `cumulativeIntentForMarket` (FOK-only error inclusion) + `insertPending` (persist placement attr)        |
| `nodes/poly/packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts`         | `listUserTrades` — the takerOnly fix lives here. **VERIFY BEFORE MERGE.**                                |
| `nodes/poly/app/tests/unit/features/trading/order-ledger-cumulative-intent.test.ts`                 | Updated regression test mirrors prod scenario (legacy errors don't block)                                |
| `work/handoffs/archive/task.5001/2026-05-01T04-52-43.md`                                            | Previous handoff (rebase + flight-validate state) — superseded                                           |
| `.claude/skills/database-expert/SKILL.md` § "Multi-step migrations must hold ACCESS EXCLUSIVE LOCK" | Doc-only; lives in operator-domain follow-up PR                                                          |
| `.local/canary-vm-key`, `.local/preview-vm-key`, `.local/production-vm-key`                         | SSH keys for ad-hoc DB ops; `cogni_poly` DB in `cogni-runtime-postgres-1` container on each VM           |
| Polymarket profile lookup                                                                           | `polymarket.com/@<slug>` page contains `"proxyWallet":"0x..."` in inline JSON; canonical wallet→slug map |
