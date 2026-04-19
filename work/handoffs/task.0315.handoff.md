---
id: task.0315.handoff
type: handoff
work_item_id: task.0315
status: active
created: 2026-04-19
updated: 2026-04-19
branch: main
last_commit: 1a27f7564
---

# Handoff: poly copy-trade — mirror running, 0 fills landed, preview env wedged

## Context

- PR #930 (task.0328 sync-truth) merged 2026-04-19 and was flighted to candidate-a. Ships: typed `GetOrderResult`, `POLY_CLOB_NOT_FOUND_GRACE_MS` grace window, stuck-row → canceled promotion + counter, `synced_at` column + staleness badge, `/api/v1/poly/internal/sync-health` endpoint, link-semantics on Active Orders rows, `bg-[hsl(var(--chart-1))]` on positions segment.
- Preview target is **BeefSlayer** (`0x331bf91c132af9d921e1908ca0979363fc47193f`). Operator is `0x7a33…0aEB`.
- **Mirror is polling BeefSlayer's Data-API every 30s.** 15+ BeefSlayer trades in the last ~48h. Zero fills landed on the operator: the only placement attempt errored, everything else was correctly skipped.
- **bug.0329 filed**: SELL on neg_risk markets returns empty-error CLOB response. Operator holds two orphan positions that cannot be closed (LeBron 2028 YES 500 sh / $3.25; Iran peace YES 5 sh / $0.82 — Iran resolves 2026-04-22).

## Current State

- PR #930: merged + flighted to candidate-a. Main ahead of canary by one merge at handoff time.
- Candidate-a kill switch: verify current state (was `enabled=false` during #918 freeze).
- **Preview**: running, but partially wedged.
  - Old pod `6c545fc995-*` boots fine, serves dashboard, runs the mirror loop against BeefSlayer — observed in Loki as `poly.mirror.decision outcome:skipped reason:sell_without_position` every ~30s.
  - New pod `7f6664947d-*` (post-#930 promotion) throws `EnvValidationError: invalid: ['POLY_PROTO_WALLET_ADDRESS']` on every request that pulls server-env. Not a crashloop — the process runs, but anything using that code path returns 500. Likely the preview ConfigMap/Secret's value drifted (empty string / bad format). Regex unchanged since task.0315.
- Dashboard shows **1 Active Order with `status: error`** — that is the only row that made it past `decide()` into `insertPending`. Placement threw `placement_failed` at 2026-04-19 17:14:53 UTC on a mirror BUY of BeefSlayer's Chicago 48-49°F YES @ 0.697 ($1 notional). Reason not captured in decision log — need clob-executor / adapter logs for that tick.
- Every BeefSlayer SELL since has been skipped with reason `sell_without_position` (correct — operator never held those positions, so we're not opening shorts).
- Candidate-a still has the two orphan positions. SELL path blocked by bug.0329 on neg_risk.

## Decisions Made

- **BUY_ONLY on `capability.placeTrade`, SELL routed via `closePosition`**: agent-tool safety boundary. Mirror coordinator detects target SELLs and calls `closePosition` only when operator already holds the asset; else skips with `sell_without_position`. This is why the dashboard sees no SELL activity from BeefSlayer — all correct.
- **bug.0329 kept out of PR #930 scope**: EIP-712 domain/verifyingContract investigation on neg_risk SELL is a distinct adapter bug; filed separately.
- **Legacy Market column renders empty for pre-#918 rows**: Data-API title is always populated for modern rows; no conditionId-in-tooltip, no truncated-hex fallback. Finite migration tail, not worth placeholder UX.
- **Reconciler stamps `synced_at` for every typed CLOB response** (found OR not_found); skips only on network throw. `/sync-health` returns `{oldest_synced_row_age_ms, rows_stale_over_60s, rows_never_synced, reconciler_last_tick_at}`.

## Next Actions

- [ ] **Fix preview env**: `kubectl -n cogni-preview get secret poly-node-app-secrets -o json | jq '.data.POLY_PROTO_WALLET_ADDRESS|@base64d'` — should be `0x7a3347d25a69e735f6e3a793ecbdca08f97a0aeb`. If empty / malformed, patch. Then `kubectl rollout restart deployment/poly-node-app -n cogni-preview`.
- [ ] **Investigate `placement_failed` on the 2026-04-19 17:14 UTC BUY** (Chicago 48-49°F YES @ 0.697). Pull the clob-executor log around that timestamp from preview (Loki `{namespace="cogni-preview"} |~ "poly_copy_trade_execute"` around 17:14:53Z). If Chicago daily-temperature markets are neg_risk, this may be bug.0329 extended to BUY too — escalating bug.0329 from "can't close" to "can't open either on neg_risk".
- [ ] **File bug for the env-validation regression** on the new pod — env config drift is a recurring failure mode; needs a `task.0318` follow-up to CI-propagate the value rather than hand-seeding.
- [ ] **Fix bug.0329** (neg_risk SELL signing path). See `work/items/bug.0329.poly-sell-neg-risk-empty-reject.md` for symptom, reproducer, and suspected root cause.
- [ ] **Address three UI follow-ups** from the task.0328 rev2 review (filed in-line on the work item): `focus-visible:outline-none` a11y regression, `role="link"` semantics on `<tr>`, `bg-[hsl(var(--chart-1))]/70` opacity-modifier syntax (probably renders at 100%).
- [ ] Confirm BeefSlayer fills start landing once the env + placement-failure issues are resolved; watch for the first `outcome:placed reason:ok` in Loki.
- [ ] After Iran market resolves (2026-04-22), verify CTF redemption path works end-to-end — non-SELL exit path, never exercised.

## Risks / Gotchas

- **The errored row will never be reconciled**: reconciler skips rows without `order_id` (`order-reconciler.job.ts:176-180`). The one row on the dashboard will show "Never synced" (grey dot) until manually canceled / dropped.
- **New pod serves HTML fine**, so visiting the dashboard "works" — but `/api/v1/poly/wallet/balance` and `/api/v1/poly/copy-trade/orders` return 500 on that pod. Old pod masks this at the service level via load balancing.
- **Preview and candidate-a share the operator wallet** (`0x7A33…0aEB`). Cross-env positions interfere if both mirrors run with `enabled=true`. Coordinate before flipping switches.
- **Mirror BUYs at BeefSlayer's limit price** — if the book moved between his fill and our tick, our limit may be too far off-market and the order errors. 17:14 error on @ 0.697 is a candidate case.
- **Preview manual env seeding** is the upstream cause of the new-pod failure. Until task.0318 RLS ships and deletes these vars, every pod rollout is a chance for drift.

## Pointers

| File / Resource                                                               | Why it matters                                                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [PR #930](https://github.com/Cogni-DAO/node-template/pull/930)                | Sync-truth slice + release-surface cleanup — most recent merge                                                                      |
| [task.0328 work item](../items/task.0328.poly-sync-truth-ledger-cache.md)     | Sync-truth design, invariants, rev2 UI follow-ups                                                                                   |
| [bug.0329 work item](../items/bug.0329.poly-sell-neg-risk-empty-reject.md)    | neg_risk SELL blocker — symptom, reproducer, suspected root cause                                                                   |
| [task.0318](../items/task.0318.poly-wallet-multi-tenant-auth.md)              | Multi-tenant RLS — will delete manual env seeding                                                                                   |
| [task.0322](../items/task.0322.poly-copy-trade-phase4-design-prep.md)         | P4 WS cutover design prep                                                                                                           |
| [poly-dev-expert skill](../../.claude/skills/poly-dev-expert/SKILL.md)        | Wallet roles, approvals, onboarding runbook                                                                                         |
| `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts` | SELL signing path — bug.0329 lives here                                                                                             |
| `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts`                | `processSellFill` = close-vs-short discrimination                                                                                   |
| `nodes/poly/app/src/bootstrap/jobs/order-reconciler.job.ts`                   | Grace-window promotion, last-tick tracking                                                                                          |
| `nodes/poly/app/src/features/trading/order-ledger.ts`                         | `markSynced`, `syncHealthSummary`, `updateStatus(reason?)`                                                                          |
| `nodes/poly/app/src/app/api/v1/poly/internal/sync-health/route.ts`            | New endpoint — Grafana-scrape shape                                                                                                 |
| `scripts/experiments/privy-polymarket-order.ts`                               | Reproducer for bug.0329: `place --side SELL …`                                                                                      |
| Operator profile                                                              | `https://polymarket.com/profile/0x7a3347d25a69e735f6e3a793ecbdca08f97a0aeb`                                                         |
| BeefSlayer trades                                                             | `https://data-api.polymarket.com/trades?user=0x331bf91c132af9d921e1908ca0979363fc47193f&limit=20`                                   |
| Operator positions                                                            | `https://data-api.polymarket.com/positions?user=0x7a3347d25a69e735f6e3a793ecbdca08f97a0aeb`                                         |
| Kill switch                                                                   | `docker exec <postgres> psql -U postgres -d cogni_poly -c "UPDATE poly_copy_trade_config SET enabled=<bool> WHERE singleton_id=1;"` |
| Loki query                                                                    | `{namespace="cogni-preview"} \|~ "poly.mirror.decision"`                                                                            |
