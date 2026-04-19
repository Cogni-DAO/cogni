---
id: task.0315.handoff
type: handoff
work_item_id: task.0315
status: active
created: 2026-04-19
updated: 2026-04-19
branch: main
last_commit: df95f6c3a
---

# Handoff: poly copy-trade — preview live on BeefSlayer, 3 open UI/adapter bugs

## Context

- PR #918 merged to main 2026-04-19 — shipped dashboard slice (Operator Wallet, Active Orders, Monitored Wallets) + task.0323 hardening cherry-picks (CTF approvals, reconciler, closePosition, close-vs-short).
- Preview is live on PR #918's code. Running operator wallet `0x7A33…0aEB`. Mirror target set per [spike.0323 research](../../docs/research/polymarket-copy-trade-candidates.md) to **BeefSlayer** (`0x331bf91c132af9d921e1908ca0979363fc47193f`, weather-markets specialist, 78% WR n=118, 10.7% max DD).
- Candidate-a frozen — kill switch `poly_copy_trade_config.enabled = false`. No new orders placed there.
- 2 orphan positions sit on operator wallet from earlier candidate-a mirror (LeBron 2028 YES 500 shares / $3.25, Iran peace YES 5 shares / $0.78). Can't SELL them — see risk #1 below.
- Three UI/adapter bugs surfaced during preview validation — captured as the follow-up bug listed in §Decisions.

## Current State

- Preview: `https://poly-preview.cognidao.org` → readyz version `0e75b4a65e41…` (PR #918 HEAD build).
- Preview pod env contains all 9 poly-proto/clob vars + `POLYGON_RPC_URL` + `COPY_TRADE_TARGET_WALLET=0x331bf91c…` — seeded manually per task.0318 decision ([deferred env-update for vars RLS will delete](../items/task.0318.poly-wallet-multi-tenant-auth.md)).
- Preview kill switch: `enabled=true` as of 2026-04-19T10:10:43Z. Mirror polling every 30s, last tick ok, 0 fills observed (BeefSlayer hadn't traded in the warmup window yet).
- Candidate-a kill switch: `enabled=false` as of 2026-04-19T10:10:39Z.
- Preview poly image overlay was manually promoted on the `deploy/preview` branch (commit `8bf684644`) because PR #924's flight rebuilt poly from pre-#918 code; a proper promote-and-deploy re-run on current main will overwrite that with the correct digest next merge.
- Dashboard renders on preview with live Alchemy RPC balances. Three visible regressions listed in §Next Actions.

## Decisions Made

- **Preview env secrets seeded manually, not propagated through CI**: codified in [task.0318 §"Env vars this task deletes"](../items/task.0318.poly-wallet-multi-tenant-auth.md#env-vars-this-task-deletes-current-single-operator-scaffolding). Avoided env-update churn on vars RLS will remove.
- **BeefSlayer as preview v0 target**: selected for clean category (weather, no insider-flag risk), largest resolved sample in the v3 cross-category screen. See [polymarket-copy-trade-candidates.md §"v0 paper-mirror roster"](../../docs/research/polymarket-copy-trade-candidates.md).
- **Orphan positions left to resolve naturally**: Iran market resolves 2026-04-22 (3d); LeBron 2028 is a write-off. SELL adapter bug makes force-close uneconomical. Logged as bug to file.
- **Bug #918 follow-ups consolidated into one bug** (not 3): adapter SELL failure + market-title hash fallback + stacked-bar color collision are the same release surface area.

## Next Actions

- [ ] File consolidated bug covering: (a) `PolymarketClobAdapter` SELL on neg_risk markets returns empty-error (`success=undefined, orderID=<missing>, errorMsg=""`) despite all approvals / valid tick / notional; (b) Active Orders "Market" column falls back to truncated conditionId for pre-stash rows (expected, but UX is worse than "(unknown)"); (c) Operator Wallet stacked bar shows positions segment indistinguishable from available because both `--primary` (HSL 160 65% 45%) and `--color-success` (HSL 142 71% 45%) are near-green. Use a `--chart-N` token or amber/cyan for positions.
- [ ] Fix (a) adapter bug: trace CLOB raw response, verify neg-risk verifyingContract + EIP-712 domain are set correctly on SELL signing path. Likely in `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts` around line 180–215.
- [ ] Fix (c) in `nodes/poly/app/src/app/(app)/dashboard/_components/OperatorWalletCard.tsx` — swap `bg-primary/70` to a distinct chart token (e.g. `bg-[hsl(var(--chart-3))]/70` = amber).
- [ ] Fix (b): either (i) backfill `attributes.title` for historic rows via a one-off Gamma-lookup script, or (ii) render a friendlier placeholder than `slice(-12)` of the hash.
- [ ] After adapter fix lands, retry SELL on the LeBron/Iran orphans. If Iran has resolved by then, redeem via CTF instead.
- [ ] Replace manual preview secret seeding with CI propagation once [task.0318](../items/task.0318.poly-wallet-multi-tenant-auth.md) ships RLS — at that point env vars listed there are deleted entirely.
- [ ] Watch preview for BeefSlayer fills over the next 24–48h; first mirror order is the real edge-validation signal.

## Risks / Gotchas

- **Adapter SELL bug blocks ALL close-position flows on neg_risk markets.** Every position we open in a neg-risk market becomes roach-motel until the bug lands. Cancel path (pre-fill) works; post-fill SELL does not.
- **Preview `deploy/preview` branch is ahead of what promote-and-deploy will produce next merge.** The manual `ops:` commit will be overwritten on the next promote run unless the promoter re-picks the correct digest. Watch for poly image regression on the next post-merge preview deploy.
- **Pre-#918 ledger rows have no `attributes.title`** — permanent UX degradation until backfilled. Rows from the mirror post-#918 will populate correctly via `decide.ts` title passthrough.
- **CTF ERC-1155 approvals landed for operator wallet via `approve-polymarket-allowances.ts` run 2026-04-19** — same wallet now works across candidate-a + preview. Don't re-provision Privy; you'll churn allowances.
- **Preview wallet is the SAME as candidate-a** (`0x7A33…0aEB`). Cross-env positions can interfere if both mirrors run concurrently. Candidate-a is frozen; don't re-enable without coordinating.

## Pointers

| File / Resource                                                                                                                 | Why it matters                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #918](https://github.com/Cogni-DAO/node-template/pull/918)                                                                  | Merged dashboard + hardening scope                                                                                                                         |
| [spike.0323 research](../../docs/research/polymarket-copy-trade-candidates.md)                                                  | BeefSlayer rationale + v0 roster methodology                                                                                                               |
| [task.0318](../items/task.0318.poly-wallet-multi-tenant-auth.md#env-vars-this-task-deletes-current-single-operator-scaffolding) | Env vars manually seeded on preview (deferred by design)                                                                                                   |
| [poly-dev-expert skill](../../.claude/skills/poly-dev-expert/SKILL.md)                                                          | Runbook — wallet roles, approvals, empty-error-SELL symptom                                                                                                |
| `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts`                                                   | Adapter SELL bug lives here (L180–230 neg-risk path)                                                                                                       |
| `nodes/poly/app/src/app/(app)/dashboard/_components/OperatorWalletCard.tsx`                                                     | Stacked bar color collision (bg-primary vs bg-success)                                                                                                     |
| `nodes/poly/app/src/app/(app)/dashboard/_components/OrderActivityCard.tsx`                                                      | Market-title fallback logic (L185-190)                                                                                                                     |
| `nodes/poly/app/src/features/copy-trade/decide.ts`                                                                              | Title/tx_hash passthrough into intent.attributes (post-#918)                                                                                               |
| `nodes/poly/app/src/features/trading/order-ledger.ts`                                                                           | Attribute allow-list on write (L135-160)                                                                                                                   |
| `scripts/experiments/privy-polymarket-order.ts`                                                                                 | Reproduce SELL bug: `place --side SELL --size 2.5 --price 0.005 --token-id <LeBron-YES>`                                                                   |
| Kill switch                                                                                                                     | `docker exec cogni-runtime-postgres-1 psql -U postgres -d cogni_poly -c "UPDATE poly_copy_trade_config SET enabled=<bool>…"` (from preview/candidate-a VM) |
| Grafana Loki                                                                                                                    | `{namespace="cogni-preview",app="poly"} \|~ "poly.mirror.decision"` — watch for first placed-mirror                                                        |
