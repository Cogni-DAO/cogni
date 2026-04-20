---
id: task.0323
type: task
title: "Poly copy-trade v1 hardening — close the v0 gaps uncovered during candidate-a validation"
status: needs_review
priority: 2
rank: 99
estimate: 3
branch: feat/poly-mirror-dashboard
pr: "918"
created: 2026-04-18
updated: 2026-04-19
summary: "v0 prototype (task.0315) validated end-to-end on candidate-a 2026-04-18 with a real mirrored $0.985 BUY. Validation exposed a set of v0 shortcuts that are NOT tracked anywhere (only in the task.0315 handoff prose). This task is the single bucket for hardening them before P2 multi-tenant or P4 streaming lands. Most critical: both operator + target wallets were onboarded for BUY only — no CTF ERC-1155 `setApprovalForAll` means we physically cannot SELL positions we've opened. That's a one-way-trade bug, not a v0 scope trim."
outcome: "All items below either (a) landed, (b) filed as follow-up tasks with durable tracking, or (c) explicitly re-scoped out with a written rationale. No item silently carries forward into P2/P4 work."
spec_refs:
  - architecture
assignees: []
project: proj.poly-copy-trading
labels: [poly, polymarket, copy-trading, hardening, v1]
---

# task.0323 — Poly copy-trade v1 hardening

> Prerequisite reading: [task.0315](./task.0315.poly-copy-trade-prototype.md) handoff + [task.0322](./task.0322.poly-copy-trade-phase4-design-prep.md) Phase 4 design prep.

## Context

Phase 1 (task.0315) shipped a working copy-trade prototype. Candidate-a validation (PR #920, 2026-04-18) proved the pipeline end-to-end with live money on Polymarket. During validation + close-out a set of v0 shortcuts surfaced that exist only as prose in the handoff — none are filed as work items. That's how gaps rot into the next phase. This task collects them in one place.

## Critical — ships before anything else lands on top

### 0. CTF ERC-1155 SELL onboarding

**Symptom:** both `POLY_PROTO` (operator) and the test wallet cannot SELL positions. CLOB rejects placement with `success=undefined, errorMsg=""`. Onboarding did `approve(spender, MaxUint256)` for USDC.e only. SELL requires `setApprovalForAll(exchange, true)` on the CTF (ERC-1155) contract at `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` for both `Exchange (0x4bFb…982E)` and `Neg-Risk Exchange (0xC5d5…f80a)`.

**Blast radius:** if the mirror buys into a market that moves against us, we can't close. One-way-trade bug.

**Fix:** extend `scripts/experiments/approve-polymarket-allowances.ts` + `scripts/experiments/onboard-raw-pk-wallet.ts` to include CTF approvals; re-run once per wallet; add to the docs/guides/polymarket-account-setup.md step list.

## High — tick-level correctness + operability

### 1. Cursor persistence + dedup re-tick noise

Cursor is in-memory. Restart = 60s warmup gap. Worse: `newSince = max(timestamp)` with `>=` filter means the same fill replays every tick forever (until it falls out of Data-API's 100-row window). Every tick currently emits `poly.mirror.decision outcome=skipped reason=already_placed` — functionally correct, log-noisy. Fix: persist cursor on `poly_copy_trade_config` (one column), advance as `max_ts + 1` with `>` filter in client.

### 2. Ledger status-sync

`poly_copy_trade_fills.status` is set at placement time and never re-read from CLOB. Rows that actually filled on-chain still show `open` in our DB. Dashboard lies. Fix: periodic reconciler reads `GET /order/:id` from CLOB for rows with `status IN (pending, open)` older than N minutes, updates status + filled_size.

### 3. `placeIntent` has no timeout

If Polymarket hangs, the tick hangs — and setInterval keeps firing, so promises leak. Add `AbortController` with a budget (default ~8s) inside the coordinator's `placeIntent` call.

## Medium — surface area the validation didn't exercise

### 4. Agent-tool placements not in order-ledger

`core__poly_place_trade` (shipped PR #900) places real orders via `PolyTradeBundle` but does not write to `poly_copy_trade_fills`. Dashboard + `/api/v1/poly/copy-trade/orders` show autonomous mirror orders only. Trivial fix — one call-site in `bootstrap/capabilities/poly-trade.ts::placeTrade` to route through the same ledger insert.

### 5. Metrics are `noopMetrics`

Metric names are defined in code (`poly_mirror_*`, `poly_clob_*`, `poly_mirror_data_api_*`) but the metrics port on the mirror path is `noopMetrics`. No Prom scrape = no Grafana panels. Wire the shared `buildMetricsPort` from `poly-trade.ts` into the mirror boot path.

### 6. No automated alerting

No Grafana alerts on `poly.mirror.poll.tick_error`, `poly.mirror.source_error`, unexpected placement-rate spikes, or operator wallet USDC.e drawdown. Handoff's "watch during first 48 hours" is entirely manual. At minimum: tick_error rate, source_error rate, decisions/hour, operator-wallet USDC.e balance delta.

### 7. Balance endpoint rebuilds viem client per request

`/api/v1/poly/wallet/balance` constructs a fresh viem client on every call. Cache at module scope if the dashboard's latency becomes a user complaint (not urgent today).

## Cross-reference: what is NOT in this task

- **MUST*FIX_P2 — RLS on `poly_copy_trade*\*`** is tracked in [task.0315](./task.0315.poly-copy-trade-prototype.md) under P2 "Required work". That task owns it.
- **Phase 4 streaming upgrade** (WS + Redis + Temporal) is tracked in [task.0322](./task.0322.poly-copy-trade-phase4-design-prep.md). Not re-scoped here.

## Exit criteria

- Item 0 (CTF SELL) is merged + both wallets re-onboarded + verified by an actual SELL on Polymarket.
- Items 1–3 are merged into `main` or filed as separate tasks with durable tracking.
- Items 4–7 are either merged or explicitly deferred with a written note (inline here or on [task.0322](./task.0322.poly-copy-trade-phase4-design-prep.md) if they fold into P4 naturally).

## Validation

Fixed when: (a) a real SELL from both the operator and test wallets succeeds end-to-end (CTF approvals proven live), (b) items 1–3 land as merged PRs or are re-filed as standalone tasks, (c) every remaining bullet has a merged PR or a one-line rationale for deferral. "The handoff said so" is not durable tracking.
