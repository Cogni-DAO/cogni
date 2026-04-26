---
id: task.0377
type: task
title: poly CTF redeem sweep — reactive architecture (replace per-tick RPC fan-out)
status: needs_triage
priority: 2
rank: 50
estimate: 3
branch:
summary: After bug.0373's predicate-inversion fix, the sweep still runs every mirror-pipeline tick over every position with O(positions) `balanceOf` reads. Move it to be reactive — triggered by `wallet-watch` observing a market resolution event for a held condition_id — or to a slow dedicated cron.
outcome: Redeem sweep stops running on every mirror tick. Each resolved position triggers exactly one redeem attempt (at resolution time), or N stays bounded by a sane cron cadence. RPC load on the shared public client drops accordingly.
spec_refs:
assignees: []
credit:
project: proj.poly-web3-security-hardening
pr:
reviewer:
revision: 0
blocked_by: bug.0373
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [poly, copy-trade, refactor]
external_refs:
---

# poly CTF redeem sweep — reactive architecture

## Requirements

After `bug.0376` lands the correctness fix (predicate inverted to use on-chain
ERC1155 balance instead of `Data-API.redeemable`), the sweep is _correct_ but
still architecturally ugly:

- Runs every mirror-pipeline tick (~30s) regardless of whether anything has
  resolved.
- Issues O(positions) `balanceOf` RPC reads per tick — wasteful on the
  shared `publicClient` and on the upstream RPC quota.
- Tightly coupled to the mirror pipeline despite redemption being unrelated
  to copy-trade fills.

## Approach options (decide in /design)

1. **Reactive on resolution event.** When `wallet-watch`
   (`nodes/poly/app/src/.../wallet-watch.ts`) observes a fill or position
   change for a market that has resolved, enqueue a one-shot redeem for that
   `(funder, conditionId)` pair. Sweep is replaced by an event-driven worker.
2. **Slow dedicated cron.** Detach the sweep from mirror-pipeline; run it on
   a Temporal cron (or simple `setInterval`) at e.g. 5-min cadence.
   Lower-effort migration; still polling but at sane frequency.

Option 1 is architecturally cleaner and aligns with the wallet-watch event
plumbing; option 2 is faster to ship.

## Allowed Changes

- `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
- `nodes/poly/app/src/bootstrap/container.ts`
- `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts`
- New worker / activity file under `nodes/poly/app/src/features/` if option 1.
- Tests for the chosen architecture.

## Plan

- [ ] `/design` — pick option (1 or 2), write the design block.
- [ ] Implement.
- [ ] Tests (unit + integration on anvil fork).
- [ ] Flight to candidate-a, confirm cadence drop in Loki.

## Validation

```bash
pnpm --filter @cogni/poly-node-app test:integration -- redeem-sweep
```

**Post-flight:** Loki query `{env="candidate-a",pod=~"poly-node-app-.*"} | json | event="poly.ctf.redeem.skip_zero_balance"`
should drop from ~120 events/hour (current sweep cadence) to either ~0 (option
1, reactive) or ~12/hour (option 2, 5-min cron).

## Review Checklist

- [ ] **Work Item:** `task.0377` linked in PR body
- [ ] **Spec:** `bug.0376` invariants still uphold (predicate is on-chain
      balance; no env flags introduced)
- [ ] **Tests:** integration covers chosen trigger path
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Parent fix: bug.0373
- Sweep code: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:657`

## Attribution

- Filed by: derek (`/review-design` follow-up on bug.0373)
