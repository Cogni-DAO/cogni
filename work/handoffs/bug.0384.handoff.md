---
id: bug.0384.handoff
type: handoff
work_item_id: bug.0384
status: active
created: 2026-04-26
updated: 2026-04-26
branch: bug/0384-sweep-race
last_commit: 78942ef66
---

# Handoff: bug.0384 — sweep race guards LIVE IN PROD but **STILL BLEEDING** (~50% of pre-fix rate)

## Context

- bug.0383 fixed the per-position predicate; exposed a sweep race. bug.0384 (PR #1070, merged + flighted + promoted to prod) added (1) module-scope `sweepInFlight` mutex, (2) per-condition 60s cooldown, (3) `poly.ctf.redeem.sweep_completed` observability emit.
- **Validation post-refund SHOWED THE FIX IS NOT FULLY HOLDING.** Funder `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` was refunded with 1.0 POL at 22:36:23Z. In the next 6 min: **15 redeem txs, 0.13 POL spent, ZERO USDC inbound.** Same condition_ids re-firing every 60-90s (cooldown expires between sweep ticks).
- Pre-fix burn rate: ~0.06 POL/min. Current: ~0.027 POL/min. Improvement, but still no-op spam — not the "1 redeem per condition then settle" target the design promised.
- Tx receipt analysis (`0xd6e6c3...`) confirms no-op pattern: gasUsed=65230, **2 logs only** (PayoutRedemption + Polygon gas burn), **NO ERC1155 TransferSingle**, **NO ERC20 Transfer** — same signature as bug.0383's pre-fix no-ops.

## Current State

- **Wallet bleeding live as of handoff write**: nonce 461 → 476 in 6 min, bal 1.004 → 0.871 POL.
- Watch monitor task `bx5jaxha6` is armed and emitting on every nonce/balance change. **Stop with `TaskStop bx5jaxha6` once you've taken over.**
- The 3 conditions in the loop are: `0x941012e786…d082` (Shanghai Haigang), `0xeb7627b699…53a8` (unknown), `0x6178933348…bddbb` (Querétaro). All three were the WINNING-side conditions that successfully paid out earlier today (~$17 USDC inbound during the pre-fix burst). They keep firing now with zero payout.
- Cooldown timing on Loki: same cid fires at 22:36:43, 22:38:13 (90s gap), 22:39:35-ish, 22:40:56 — cooldown expiring right as the next-next mirror tick hits.
- Tests still green (18 in `poly-trade-executor.test.ts`); they pass the synthetic mocked race but don't catch this real-chain pattern. **The fixture matrix needs a "wallet still has balance after a successful redeemPositions" case.**

## Decisions Made

- Mutex + cooldown both shipped per design review of bug.0384 — but design assumed `redeemPositions` actually burns the ERC1155 and zeroes balance. **Real chain behavior: balance can stay > 0 after a successful tx** (mechanism unknown — see Risks). Cooldown was sized for "wait for tx receipt + propagation"; it does that, but the underlying balance-stays-> 0 pattern bypasses the predicate after expiry.
- 60s cooldown was the "Polygon finality + RPC propagation × 2" calculation — correct for that purpose, wrong for THIS bug. The right metric is "minimum time before the same condition could legitimately re-fire" which is unbounded if balance never zeros.
- See [PR #1070](https://github.com/Cogni-DAO/node-template/pull/1070) for full design + reviewer pushback transcripts.

## Next Actions

- [ ] **STOP THE BLEED FIRST**: send remaining ~0.87 POL out of `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` to halt the loop. Current rate eats it in ~30 min.
- [ ] **TaskStop `bx5jaxha6`** — handoff watch monitor.
- [ ] **Inspect a no-op tx receipt** (`0xd6e6c3bf842c555065624c72d656c0ef6e1d0e4e2e8f68e58fcc75df7584a73a` is one). Decode `PayoutRedemption` event from CTF (`0x4d97DCd97eC945f40cF65F87097ACe5EA0476045`, topic0 `0x2682012a…`) — the `payout` field tells you why USDC didn't transfer.
- [ ] **Check `balanceOf(funder, positionId)` BEFORE and AFTER one of these no-op txs.** If balance unchanged across a successful tx, the CTF is not burning the ERC1155 we hold. Likely cause: we're holding the LOSER positionId on a market that already resolved AGAINST us, but the previous fix's predicate is comparing balance to the wrong index.
- [ ] **Re-run the bug.0383 fixture validation** against the CURRENT funder positions — the predicate worked on 2026-04-25 fixture; it may not work on 2026-04-26 positions if neg-risk conditions changed shape.
- [ ] If predicate is still correct → real fix is **task.0377 event-driven sweep** (drop polling, listen to CTF events, idempotency from the `PayoutRedemption` event itself). Bandaid PRs are out of road.
- [ ] If predicate is wrong → file bug.0385, identify the failing predicate path (vanilla CTF vs neg-risk vs partial-payout scalar).

## Risks / Gotchas — READ THESE

- **`redeemPositions(cid, [1,2])` on the standard CTF can succeed without burning ERC1155 or paying USDC** when the held positionId is for a market that resolved against us. The predicate `payoutNumerator(cid, outcomeIndex) > 0` is supposed to filter this out — but the FUNCTION CALL still succeeds, the contract emits `PayoutRedemption(payout=0)`, and balance stays unchanged. So the next predicate check sees balance > 0 again. **Cooldown only delays this, doesn't fix it.**
- **The 3 looping conditions paid out earlier today** ($17 USDC). Then they kept appearing in `Position.redeemable=true` from Polymarket Data-API. Either (a) we re-acquired positions on the same conditions via copy-trade (mirror keeps trading), or (b) the wallet still holds the losing-side ERC1155 of these now-resolved markets and the predicate is reading the winning-side payoutNumerator while balanceOf reads the losing-side positionId.
- **Single-pod constraint** (in-process Map+bool) is hardcoded — multi-replica scaling reintroduces the inter-tick race regardless. `SINGLE_POD_ASSUMPTION` invariant in module doc.
- **bug.0335** (CLOB BUY empty reject on candidate-a) and **bug.0329** (SELL on neg-risk) still active. Unrelated to bleed but complicate any e2e validation.
- **Don't ship another bandaid.** task.0377 (event-driven sweep, listen to CTF events for idempotency) is the only architecture that breaks this bug class for good. Polling chain state for write-idempotency IS the bug class.

## Pointers

| File / Resource                                                                                                                                                       | Why it matters                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Grafana / Loki — start here**                                                                                                                                       |                                                                                                                                      |
| `https://derekg1729.grafana.net/explore` (datasource: `grafanacloud-logs`)                                                                                            | All app logs. `env="production"` for prod, `env="candidate-a"` for stage.                                                            |
| LogQL: `{env="production", service="app"} \| json \| event=~"poly.ctf.redeem.*"`                                                                                      | Every redeem event in prod. Use this AS the audit log when correlating with on-chain nonces.                                         |
| LogQL: `{env="production", service="app"} \| json \| event="poly.ctf.redeem.ok" \| condition_id="0x941012e786eb79e32dc46ffffb2f0d528c3f6fb7cac9b88c9086b6360481d082"` | Per-condition redeem timeline. Drop in any of the three looping cids.                                                                |
| LogQL: `topk(20, sum by (event) (count_over_time({env="production", service="app"} \| json \| event=~"poly.ctf.redeem.*" [15m])))`                                    | Event distribution. Tells you ratio of skip_pending_redeem (cooldown engaging) vs redeem.ok (firing) vs sweep_completed (heartbeat). |
| `scripts/loki-query.sh '<logql>' [mins_back] [limit]`                                                                                                                 | MCP-down fallback. Auto-sources `.env.canary` for `GRAFANA_*` creds.                                                                 |
| **Code**                                                                                                                                                              |                                                                                                                                      |
| `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`                                                                                                    | All bug.0384 guards. Module-scope `redeemCooldownByConditionId`, `sweepInFlight`. `decideRedeem` predicate (the suspect).            |
| `packages/market-provider/src/adapters/polymarket/polymarket.ctf.ts`                                                                                                  | CTF ABI module. `polymarketCtfRedeemAbi` exports.                                                                                    |
| `nodes/poly/app/tests/fixtures/poly-ctf-redeem/`                                                                                                                      | bug.0383 real-data fixture matrix. Add a "post-redeem balance still > 0" case to expose this bug.                                    |
| **Docs / specs**                                                                                                                                                      |                                                                                                                                      |
| `work/items/bug.0384.poly-redeem-sweep-race-condition.md`                                                                                                             | Full bug record + design rationale + invariants + follow-up plan.                                                                    |
| `work/items/bug.0383.poly-ctf-redeem-sweep-loses-on-losing-outcomes.md`                                                                                               | Predicate fix that this PR built on. Read for CTF semantics context.                                                                 |
| `work/items/task.0377.poly-redeem-sweep-reactive-architecture.md`                                                                                                     | The real fix. Event-driven sweep. **`Needs Design` — start here once you've stopped the bleed.**                                     |
| `work/items/task.0379.poly-redemption-sweep-production-grade.md`                                                                                                      | Multi-pod hardening. Blocked on 0377.                                                                                                |
| `.claude/skills/poly-market-data/SKILL.md`                                                                                                                            | CTF + Data-API ground-truth order. EOA-vs-Safe gotcha. CLOB order semantics.                                                         |
| `.claude/skills/poly-copy-trading/SKILL.md`                                                                                                                           | Mirror pipeline reference. Anti-pattern about own-wallet trade not triggering mirror.                                                |
| **On-chain**                                                                                                                                                          |                                                                                                                                      |
| `https://polygonscan.com/address/0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`                                                                                          | Funder activity. Watch txs to CTF (`0x4d97…6045`) — receipt logs tell you whether USDC transferred.                                  |
| `https://polygonscan.com/tx/0xd6e6c3bf842c555065624c72d656c0ef6e1d0e4e2e8f68e58fcc75df7584a73a`                                                                       | Sample no-op tx. PayoutRedemption with payout=0, no ERC1155 burn, no USDC Transfer.                                                  |
| Watch task `bx5jaxha6`                                                                                                                                                | Persistent prod-funder nonce/balance monitor. **TaskStop after takeover.**                                                           |
