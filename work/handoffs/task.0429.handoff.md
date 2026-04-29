---
id: task.0429.handoff
type: handoff
work_item_id: task.0429
status: active
created: 2026-04-29
updated: 2026-04-29
branch: feat/poly-auto-wrap-usdce-to-pusd
last_commit: 03b1e2160
---

# Handoff: Poly wallet-cycle continuity (task.0429 + bug.0428 + bug.0430 + bug.0431)

## Context

- Branch was created for **task.0429** (auto-wrap USDC.e → pUSD), but production validation of PR #1131 surfaced two more bugs that are higher priority. The worktree now carries all four work items in one branch and the next dev is expected to triage between them, not necessarily ship task.0429 first.
- Production copy-trading is currently **paused** (`poly_copy_trade_config.enabled=false` for tenant `207795de-891c-4791-9f8b-aa0f0bcc4911`) because **bug.0430** drained ~$46 of pUSD in 25 minutes through silent on-chain fills the app's ledger doesn't see. Until bug.0430 ships, the kill switch must stay off.
- The trio (bug.0428, bug.0430, bug.0431) all live in the same broken sub-system: ledger-state vs on-chain-state divergence. They reinforce each other — fixing one without the others leaves real money silently moving.
- task.0429 (auto-wrap loop) is the structural fix for the V1-legacy + external-deposit cycle and only makes sense to ship after bug.0430 is in hand.

## Current State

- 4 work items filed on this branch, all `priority: 1`. See [proj.poly-copy-trading.md](../projects/proj.poly-copy-trading.md) Open Bugs + Phase 5.
- Worktree bootstrapped: `pnpm install --frozen-lockfile` + `pnpm packages:build` already run; `pnpm --filter @cogni/poly-app typecheck` is clean.
- Branch is on top of fresh main (`origin/main` at branch-create time was `a825e4c5c`, current head `03b1e2160`).
- Prod kill switch flipped off at 08:42Z 2026-04-29 — verify before re-enabling.
- 2 stuck redeem jobs were force-flipped to `pending` and the worker burned the underlying CTF tokens at 08:37Z; whether the collateral actually transferred is uncertain (post-redeem pUSD = $0.60, USDC.e = $0). Verify via Polygonscan if needed: tx `0xc7ef88...` (Tampa Bay) and `0xd07724...` (Oilers).

## Decisions Made

- **Position cap (task.0424)** chose intent-based, not filled-based. Source: PR #1131 review feedback in [task.0424](../items/task.0424.poly-bet-sizer-per-position-cap.md). bug.0430 fixes the gap that choice surfaced.
- **bug.0430 fix path (A) is the v0 hard fix**: include `error` rows in `cumulativeIntentForMarket`. (B) reconciler-driven verification is the durable fix; defer.
- **bug.0428 fix path (B)**: capture position vintage at redeem-job-create time. See [bug.0428 § Fix](../items/bug.0428.poly-redeem-worker-hardcodes-usdce.md).
- **task.0429 stays explicit-consent**: not auto-on, even though on-chain approval already exists. See task.0429 § Scope.
- **bug.0431 likely root cause** is per-outcome decisions collapsing into a single per-condition redeem-job and the loser's stamp winning. See [bug.0431 § Likely root cause](../items/bug.0431.poly-redeem-policy-misclassifies-winners-as-losers.md).

## Next Actions

- [ ] **bug.0430 first.** One-line SQL change in `cumulativeIntentForMarket` (`order-ledger.ts` + `fake-order-ledger.ts`); update tests to expect error rows in the sum. **Until this ships, do not re-enable copy trading.**
- [ ] **bug.0431 second.** Write the unit test using actual prod `payoutNumerators` for the two stuck conditions, then trace the misclassification through `resolve-redeem-decision.ts` → `decision-to-enqueue-input.ts` → `redeem-subscriber.ts`.
- [ ] **bug.0428 third.** Capture `collateral_token` at redeem-job-create time; use it on dispatch.
- [ ] **task.0429 last.** Auto-wrap loop — schema migration `0034_poly_wallet_auto_wrap_consent.sql`, port methods, bootstrap job, route, UI toggle. See task.0429's `## How to start`.
- [ ] After bug.0430 ships, verify prod with the kill switch ON and observe one full target-fill cycle without divergence between ledger and on-chain CTF balance.
- [ ] When tracing bug.0431, also write the backfill query: any `lifecycle=loser` row with non-zero CTF balance for the held outcome → re-classify and re-dispatch (could recover hidden winners across the whole `48 loser` set).

## Risks / Gotchas

- **Re-enabling copy trading before bug.0430 ships will silently drain pUSD.** Prove the cap counts error rows in a unit test first. The bleed observed was $46 in 25min on a single tenant.
- **bug.0421's reclassifier and bug.0430 interact.** When you change the cap math, also reason about whether the reclassifier's `fok_no_match` path correctly leaves rows that DID fill in a state the cap can see. They share the `error` lifecycle today.
- **bug.0428 might be biting silently right now.** The 2 stuck winners' redeems stamped `lifecycle=redeemed` but on-chain CTF balance dropping to 0 doesn't prove collateral transferred. Confirm via tx receipt before assuming the worker's success state is honest.
- **Single-flight is critical for task.0429's wrap loop.** Two near-simultaneous wraps both pull the same USDC.e amount and one reverts. Use the existing redeem-pipeline single-flight pattern.
- **Don't widen the bug.0430 fix to `notInArray(['canceled'])` blindly.** `canceled` rows can also have hidden fills under some paths; verify by fixture before generalizing.

## Pointers

| File / Resource                                                                      | Why it matters                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------- | ---------------------- |
| [bug.0430](../items/bug.0430.poly-mirror-cap-leaks-on-error-rows-that-fill.md)       | Critical-path bug doc with file paths, fix options, validation block |
| [bug.0431](../items/bug.0431.poly-redeem-policy-misclassifies-winners-as-losers.md)  | Misclassification bug doc with file paths and unit test plan         |
| [bug.0428](../items/bug.0428.poly-redeem-worker-hardcodes-usdce.md)                  | V2 redeem collateralToken bug doc                                    |
| [task.0429](../items/task.0429.poly-auto-wrap-usdce-to-pusd.md)                      | Auto-wrap design + scope + first-three-commits                       |
| [proj.poly-copy-trading.md](../projects/proj.poly-copy-trading.md)                   | P5 roadmap, all 4 items linked, severity context                     |
| [docs/spec/poly-collateral-currency.md](../../docs/spec/poly-collateral-currency.md) | V2 collateral lifecycle (USDC.e / pUSD / Onramp)                     |
| `nodes/poly/app/src/features/trading/order-ledger.ts:137-175`                        | `cumulativeIntentForMarket` — bug.0430 lives here                    |
| `nodes/poly/app/src/features/redeem/redeem-worker.ts:255-275`                        | Vanilla CTF dispatch + USDC.e hardcode (bug.0428)                    |
| `nodes/poly/app/src/features/redeem/resolve-redeem-decision.ts`                      | Redeem policy decision (bug.0431)                                    |
| PR #1131                                                                             | Most recent merged PR; the trio surfaced during its prod validation  |
| Loki recipe (canary): `{env="production",service="app",pod=~"poly-node-app-.\*"}     | json                                                                 | event="poly.mirror.decision"` | Watch the cap behavior |
| `scripts/loki-query.sh` (needs `.env.canary` in worktree root)                       | LogQL helper used throughout the diagnosis                           |

## PR / Links

- Branch: `feat/poly-auto-wrap-usdce-to-pusd`
- Last commit: `03b1e2160`
