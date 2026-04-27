---
id: task.0388
type: task
title: "Capability B — event-driven redeem job queue (rips the sweep)"
status: needs_implement
priority: 0
rank: 2
estimate: 5
summary: "Replace the polling sweep + in-process mutex + in-memory cooldown Map with a Postgres-backed redeem job table driven by viem `watchContractEvent` subscriptions on CTF + neg-risk adapter. One worker drains `pending` rows via `FOR UPDATE SKIP LOCKED`. Completion is observed `PayoutRedemption` from our funder at N=5 finality (Polygon post-Heimdall-v2 milestones, ~12.5 s; prefer RPC `finalized` tag if exposed). Routes neg-risk redemptions through the NegRiskAdapter contract (`0xd91E80...`) instead of CTF — fixes the residual neg-risk bleed v0.1 only rate-limited. Removes `SINGLE_POD_ASSUMPTION` so poly can scale replicas. Depends on task.0387 (Capability A) for the decision policy."
outcome: "After this PR, the periodic sweep loop in `poly-trade-executor.ts` is deleted (`runRedeemSweep`, `redeemAllRedeemableResolvedPositions`, `sweepInFlight`, `redeemCooldownByConditionId`, `REDEEM_COOLDOWN_MS`). Resolution events from CTF + neg-risk adapter on Polygon enqueue jobs. One worker per pod drains them. `PayoutRedemption` from our funder is the only signal that flips a job to `confirmed`. Steady-state RPC load between resolutions drops to ~zero. The poly Deployment may run with `replicas > 1`. Three failed redeem attempts (or any malformed-class failure) escalate to `abandoned` with a Loki page following the runbook in `docs/design/poly-positions.md`."
spec_refs: [poly-positions, poly-position-exit, poly-multi-tenant-auth]
assignees: [derekg1729]
credit:
project: proj.poly-copy-trading
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0387]
deploy_verified: false
created: 2026-04-26
updated: 2026-04-26
labels:
  [
    poly,
    ctf,
    redeem,
    job-queue,
    postgres,
    viem,
    event-driven,
    bug-0384,
    single-pod-removal,
  ]
external_refs:
---

# Capability B — Event-Driven Redeem Job Queue

## Why

Even with Capability A's predicate correct (task.0387), the polling sweep is the wrong architecture. Periodic enumerate-and-fire over a Data-API hint produces constant RPC load, races itself across ticks, requires in-process guards that die on restart, and forces `replicas: 1` in perpetuity. The design doc (`docs/design/poly-positions.md` § Capability B + Subscription) specifies a job table + `watchContractEvent` subscriptions + one worker. That is what this task ships.

## Outcome

- One Postgres table `poly_redeem_jobs` in poly's local DB. Status enum mirrors `docs/design/poly-positions.md` lifecycle: `pending | submitted | confirmed | failed_transient | abandoned`. Unique key `(funder_address, condition_id)`. Audit-trail column `tx_hashes uuid[]` (or text array) per design Class-A runbook UPSERT.
- **Three viem `watchContractEvent` subscriptions** (one pod, persisted `last_processed_block`):
  - CTF `ConditionResolution(conditionId, oracle, questionId, outcomeSlotCount, payoutNumerators[])` at `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` → enumerate funder's positions for that condition → Capability A → INSERT pending rows.
  - CTF `PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)` → match `redeemer == funder` + existing job row → flip `submitted → confirmed` after N=5 finality.
  - **NegRiskAdapter `PayoutRedemption(address indexed redeemer, bytes32 indexed conditionId, uint256[] amounts, uint256 payout)`** at `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` → same `redeemer == funder` matching rule, same N=5 finality flip. **Different parameter shape from CTF event** (no `parentCollectionId`, `amounts` not `indexSets`) → different keccak256 topic hash; both must be subscribed independently.
- **Dispatch split** (the residual v0.1 bleed-stopper): the worker selects the redeem contract by `decision.flavor`:
  - `binary` / `multi-outcome` → `CTF.redeemPositions(USDC.e, parentCollectionId, conditionId, indexSets[])` (existing 4-arg path).
  - `neg-risk-parent` / `neg-risk-adapter` → **`NegRiskAdapter.redeemPositions(conditionId, amounts[2])`** (new 2-arg path; `amounts = [yes_amount, no_amount]`). Capability A's existing `flavor` field already carries the discriminator; this task makes it executable.
- One worker draining `WHERE status = 'pending' FOR UPDATE SKIP LOCKED`. Submits tx (CTF or adapter per flavor), writes hash, transitions to `submitted`. On receipt: `failed_transient` (RPC/gas/reorg) goes back to `pending` with backoff if `attempt_count < 3`; `success-but-no-PayoutRedemption-from-funder within N=5 blocks` goes straight to `abandoned` with a Loki alert (malformed class — never retry the same decision).
- **Finality target N=5 (~12.5 s)** post-Heimdall-v2 (Polygon mainnet 2025-09-16). Optional: prefer `eth_getBlockByNumber("finalized")` if RPC provider exposes milestone-derived finality (Alchemy/QuickNode); fall back to depth-N otherwise. Value lives next to RPC config in `nodes/poly/app/src/shared/env`.
- Startup + daily-cron catch-up: replay historical events from `last_processed_block` to chain head through Capability A. The **only** legitimate sweep in the system, bounded by chain history.
- Manual redeem button (existing `POST /api/v1/poly/wallet/positions/redeem`): inserts a job row, then `await`s the worker outcome with a **30 s** HTTP timeout (matches design § Resolved during review #4; falls back to `202 + job_id` if the worker has not confirmed within the window).
- Deletes from `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`: `sweepInFlight`, `redeemCooldownByConditionId`, `REDEEM_COOLDOWN_MS`, `pendingRedeemMsRemaining`, `markRedeemPending`, `_resetRedeemCooldownForTests`, `_resetSweepMutexForTests`, `redeemAllRedeemableResolvedPositions`, `runRedeemSweep`, `BINARY_REDEEM_INDEX_SETS` import + usages, all `SINGLE_POD_ASSUMPTION` doc-strings.
- Removes the `replicas: 1` constraint from the poly Deployment manifest with a comment pointing at this task.

## Approach

**Solution.** New capability package `packages/poly-redeem` containing the port (`RedeemJobsPort`), domain types (`RedeemJob`, `RedeemJobStatus`), pure transition logic, and a Postgres adapter. App-side wiring (subscriptions, worker, bootstrap) lives in `nodes/poly/app/src/bootstrap/capabilities/`. Capability A (task.0387) is the imported decision function — this task adds zero new policy.

**Reuses.**

- Capability A from task.0387 — `decideRedeem` is the single decision point.
- viem (already in use) — `watchContractEvent`, `getBlockNumber`, `getLogs` for catch-up.
- poly's existing Postgres connection + drizzle setup (per `database-expert` skill rules — operational data, not Doltgres).
- Postgres-as-queue pattern: pick one of `graphile-worker` (Node, Postgres-native, ~30s integration) or write the ~30 lines of `FOR UPDATE SKIP LOCKED`. Decision in `/implement`. Do not reinvent dedup.
- Pino structured logging + existing Loki ingest pipeline.

**Rejected.**

- _Keep the sweep as belt-and-suspenders._ Two truths is the bug. Resolved in design § Resolved during review #1.
- _Separate worker container._ In-process worker is fine for v0 single-pod; scaling out is straightforward later. Design § #3.
- _Manual button returns 202 + job_id._ Re-litigated in review2; v0 holds HTTP for sub-30s confirms. Design § #4.
- _Bespoke Postgres cooldown table keyed by `condition_id`._ That is a job queue with one column missing — go straight to the job model. Review2 + review1 agreed.

## Files

- Create: `packages/poly-redeem/` — new capability package per `docs/spec/packages-architecture.md`.
  - `src/types.ts` — `RedeemJob`, `RedeemJobStatus` enum, `FailureClass = 'transient' | 'malformed'`.
  - `src/port.ts` — `RedeemJobsPort` interface (enqueue, claim, transition, listForFunder, getByKey).
  - `src/transitions.ts` — pure state-machine transitions; no I/O.
  - `src/adapter.postgres.ts` — drizzle-backed adapter implementing the port.
  - `tests/transitions.test.ts` + `tests/adapter.postgres.test.ts` (testcontainers).
- Create: `nodes/poly/db-schema/migrations/NNNN_poly_redeem_jobs.sql` — table DDL, status enum, unique index.
- Create: `nodes/poly/app/src/bootstrap/capabilities/poly-redeem-subscriber.ts` — viem `watchContractEvent` subscriptions for CTF + neg-risk adapter; persists `last_processed_block`.
- Create: `nodes/poly/app/src/bootstrap/capabilities/poly-redeem-worker.ts` — drains `pending` rows, calls Capability A, submits tx, transitions states.
- Create: `nodes/poly/app/src/bootstrap/capabilities/poly-redeem-catchup.ts` — startup + cron replay from `last_processed_block` to head.
- Modify: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts` — delete the listed members; `redeemResolvedPosition` becomes a thin "insert job row, await outcome" wrapper.
- Modify: `nodes/poly/app/src/bootstrap/container.ts` (or equivalent) — wire subscriber + worker + catch-up at startup.
- Modify: poly Deployment manifest in `deploy/` — remove `replicas: 1` constraint with comment linking to this task.
- Modify: `nodes/poly/app/AGENTS.md` — replace `SINGLE_POD_ASSUMPTION` warning with "redeem path is event-driven; replicas > 1 is supported".

## Validation

`exercise:` On candidate-a, observe a real market resolution end-to-end. Pre-resolution: a `winner` position exists in funder's wallet. Trigger: market resolves on Polymarket. Expected within ~60 s: subscriber observes `ConditionResolution`, Capability A returns `redeem`, job row inserted, worker submits tx, observes own `PayoutRedemption` after N=10 blocks, flips job to `confirmed`. Funder ERC-1155 balance for that position drops to 0; USDC.e balance increases by expected payout. Manual button: `POST /api/v1/poly/wallet/positions/redeem` for a different known-resolved position; HTTP returns 200 with confirmed receipt within 45 s.

`observability:` Loki at deploy SHA shows the full event chain: `poly.ctf.subscriber.condition_resolution_observed` → `poly.ctf.redeem.policy_decision{kind:'redeem'}` → `poly.ctf.redeem.job_enqueued` → `poly.ctf.redeem.tx_submitted` → `poly.ctf.subscriber.payout_redemption_observed{redeemer=funder}` → `poly.ctf.redeem.job_confirmed`. Zero `poly.ctf.redeem.sweep_*` events appear (confirms the sweep code path is dead). Grafana POL-vs-USDC slope panel shows USDC redeemed > POL spent.

## Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] REDEEM_COMPLETION_IS_EVENT_OBSERVED — `confirmed` status only after observed `PayoutRedemption` from funder at N-block finality (spec: poly-positions)
- [ ] REDEEM_DEDUP_IS_PERSISTED — duplicate-redeem prevention is the unique index `(funder_address, condition_id)` on `poly_redeem_jobs`; no in-memory Maps anywhere (spec: poly-positions)
- [ ] REDEEM_HAS_CIRCUIT_BREAKER — `attempt_count >= 3` OR any malformed-class failure transitions to `abandoned` and emits `poly.ctf.redeem.abandoned` Loki page (spec: poly-positions)
- [ ] REDEEM_RETRY_IS_TRANSIENT_ONLY — only `transient` failures (RPC timeout, gas underpriced, reorg) re-enter `pending`; `malformed` skips the retry loop (spec: poly-positions)
- [ ] SWEEP_IS_NOT_AN_ARCHITECTURE — no periodic Data-API enumerate-and-fire; the only allowed sweep is event-replay catch-up bounded by chain history (spec: poly-positions)
- [ ] SINGLE_POD_REMOVED — poly Deployment manifest has no `replicas: 1` constraint and no `SINGLE_POD_ASSUMPTION` doc-strings remain (spec: poly-positions)
- [ ] BOUNDARY_PLACEMENT — port + domain types + transitions live in `packages/poly-redeem/`; subscription/worker/lifecycle wiring lives in `nodes/poly/app/src/bootstrap/` (spec: packages-architecture)
- [ ] SIMPLE_SOLUTION — uses Postgres-as-queue (chosen library or ~30 LOC `FOR UPDATE SKIP LOCKED`); does not introduce Redis, Temporal, or a new infrastructure dep (spec: architecture)

## Notes

- Blocked by task.0387 — Capability A must land first because this task imports `decideRedeem`. Both can be drafted in parallel; merge order is 0387 → 0388.
- After this task lands, close task.0379 ("Poly redemption sweep — top-0.1% production-grade hardening") as `done` — its scope is fully covered by 0387 + 0388.
- The reorg-handling story (confirmed → submitted on reorg-within-N) needs explicit test coverage in `tests/transitions.test.ts` and an integration test using viem's reorg simulation. Do not skip it — it is `REDEEM_COMPLETION_IS_EVENT_OBSERVED`'s teeth.

## Pre-implement investigations (already complete — values pinned 2026-04-27)

These were run during PR #1077 close-out so CP1 lands without re-research:

**Neg-risk adapter ABI** (verified Polygonscan, 2026-04-27):

```solidity
// Address: 0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296 (Polygon mainnet, Solidity 0.8.19, verified)
// Description: "Adapter for the CTF enabling the linking of a set binary markets where only one can resolve true"

function redeemPositions(bytes32 _conditionId, uint256[] calldata _amounts) external;
//   _amounts is length-2: [yes_amount, no_amount]

event PayoutRedemption(
    address indexed redeemer,
    bytes32 indexed conditionId,
    uint256[] amounts,
    uint256 payout
);
```

Source: <https://polygonscan.com/address/0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296#code>. Different signature from CTF's 4-arg `redeemPositions(collateral, parentCollectionId, conditionId, indexSets[])` and CTF's `PayoutRedemption(redeemer, collateralToken, parentCollectionId, conditionId, indexSets[], payout)` → different keccak256 topic hash → must subscribe to both independently.

**Polygon finality post-Heimdall-v2** (mainnet activation 2025-09-16, block 28913694):

- Milestone-based deterministic finality: 2–5 seconds (vote extensions). Pre-Heimdall-v2 was ~1 minute probabilistic.
- **N=5 (~12.5 s)** picked: 2.5× margin over the 5 s upper bound, well under the 30 s HTTP timeout ceiling.
- Optional optimization: `eth_getBlockByNumber("finalized")` from RPC providers exposes milestone-derived finality cleanly. If Alchemy/QuickNode supports it for our endpoint, use it instead of depth-counting; fall back to N=5 if not.
- Sources: [forum.polygon.technology v0.3.0 release announcement](https://forum.polygon.technology/t/heimdall-v2-v0-3-0-release-for-mainnet/21270), [Polygon Heimdall-v2 docs](https://docs.polygon.technology/pos/architecture/heimdall/checkpoint/) (vote-extensions section).
- Revisit cadence: after first 30 days of `PayoutRedemption` observation, ratchet down to N=3 (~7.5 s) if zero `confirmed → submitted` reverts; hold at N=5 if any reverts occur.
