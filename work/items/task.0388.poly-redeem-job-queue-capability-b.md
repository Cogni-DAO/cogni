---
id: task.0388
type: task
title: "Capability B — event-driven redeem job queue (rips the sweep)"
status: needs_implement
priority: 0
rank: 2
estimate: 5
summary: "Replace the polling sweep + in-process mutex + in-memory cooldown Map with a Postgres-backed redeem job table driven by viem `watchContractEvent` subscriptions on CTF + neg-risk adapter. One worker drains `pending` rows via `FOR UPDATE SKIP LOCKED`. Completion is observed `PayoutRedemption` from our funder at hard-pinned N=5 finality (Polygon post-Heimdall-v2 milestones, ~12.5 s). Routes neg-risk redemptions through the NegRiskAdapter contract (`0xd91E80...`) instead of CTF — fixes the residual neg-risk bleed v0.1 only rate-limited. Adds REDEEM_REQUIRES_BURN_OBSERVATION as a structural invariant: every receipt is decoded and asserted to contain a burn from funder; absence → abandoned at level=50 — bounds per-user blast radius to one tx of POL on any future routing mistake. Removes `SINGLE_POD_ASSUMPTION` so poly can scale replicas."
outcome: "After this PR, the periodic sweep loop in `poly-trade-executor.ts` is deleted (`runRedeemSweep`, `redeemAllRedeemableResolvedPositions`, `sweepInFlight`, `redeemCooldownByConditionId`, `REDEEM_COOLDOWN_MS`). Resolution events from CTF + neg-risk adapter on Polygon enqueue jobs. One worker per pod drains them. `PayoutRedemption` from our funder is the only signal that flips a job to `confirmed`. Steady-state RPC load between resolutions drops to ~zero. The poly Deployment may run with `replicas > 1`. Three failed redeem attempts (or any malformed-class failure) escalate to `abandoned` with a Loki page following the runbook in `docs/design/poly-positions.md`."
spec_refs: [poly-positions, poly-position-exit, poly-multi-tenant-auth]
assignees: [derekg1729]
credit:
project: proj.poly-copy-trading
branch: feat/task-0388-redeem-job-queue
pr:
reviewer:
revision: 0
blocked_by: []
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

## 🔴 v0.1 bleed is LIVE in prod (read this first)

As of 2026-04-27 ~05:00Z, 5 neg-risk conditions on funder `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` are firing `poly.ctf.redeem.ok` every ~90 s with fresh tx hashes — the bleed Capability A v0.1 was supposed to stop. Slow burn (~$0.03/cycle, ~$0.40/hr); Derek chose to leave it running rather than scale to 0. **Don't be confused by `.ok` events** — they mean tx-receipt-success, not burn-success.

**Root cause.** `decideRedeem` in v0.1 routes ALL `negativeRisk:true` markets through `flavor: "neg-risk-parent"` against the standard CTF contract (`POLYGON_CONDITIONAL_TOKENS`) with `parentCollectionId: PARENT_COLLECTION_ID_ZERO`. For the conditions above, that call signature is a no-op against CTF — the tx mines successfully but no `TransferSingle` from funder is emitted; `balanceOf` stays > 0; next sweep tick fires again after the 60 s in-process cooldown expires. `decideRedeem`'s docstring (line 113-122) explicitly notes `neg-risk-adapter` is **reserved**; v0.1 ships without it and folds everything into the parent path. For these markets, that fold is wrong.

**Loki proof** (cross-reference before doubting):

```logql
{env="production",service="app"} | json | event="poly.ctf.redeem.ok"
  | condition_id="0x86c171b757d290aebed1d5a22e63da3c06900e6e9f42e84ac27baf89fcf09e4b"
```

5 distinct tx hashes for that condition_id in a 6-min window 04:46:44–04:52:44Z. Same pattern for `0x18ec34d0...`, `0x6178933348...`, `0xeb7627b6...`, `0x941012e7...`.

**This task IS the fix.** The NegRiskAdapter contract address + ABI + `[yes, no]` 2-arg `redeemPositions` shape pinned in the frontmatter `summary` are the load-bearing pieces. CP1's worker MUST route any neg-risk position through the NegRiskAdapter (`0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`), not standard CTF. Without that routing change, this task ships another rate-limited bleed instead of a fix.

**Defense in depth — sequenced against the 2-CP plan.**

The active v0.1 bleed produces only level-30 (info) events; `level≥warn` alerts see nothing. **CP1 of this task deletes the legacy sweep AND the legacy `poly.ctf.redeem.ok` event in the same PR.** Bleed-class observability therefore has exactly one transition point: the moment CP1 deploys, the old alert dies and the new structural gate takes over. Both must be in place at that single transition.

1. **Interim Loki alert — ship NOW, standalone, before CP1 work begins.** Belt-and-suspenders against the v0.1 bleed for the duration of CP1 implementation. Auto-retires the moment CP1 deploys (no `poly.ctf.redeem.ok` events from the new code path → no alert signal → dies quietly).

   ```logql
   sum by (condition_id) (
     count_over_time({env="production",service="app"} | json | event="poly.ctf.redeem.ok" [10m])
   ) > 1
   ```

   Same `condition_id` firing ≥2 `.ok` events in 10 min = bleed signature (first redeem didn't burn). Page on-call.

2. **Post-tx burn-verification gate — lands inside CP1, structural successor to #1.** The worker decodes every receipt and asserts ≥1 burn event from funder; absence → `poly.ctf.redeem.bleed_detected` at `level=50` + `abandoned/class:"malformed"`. Once CP1 ships, the legacy event-based alert is replaced by this structural gate — a generic `level≥warn` alert on `bleed_detected` covers the entire bleed class regardless of which contract is wrong. Captured as invariant `REDEEM_REQUIRES_BURN_OBSERVATION` (see Invariants below).

3. **NegRiskAdapter routing — lands inside CP1, dispatch split by `decision.flavor`.** Closes v0.1's specific hole. #2 catches the next routing mistake structurally; #3 fixes the known one. Both ride in CP1 because either alone is a partial fix.

Order matters in absolute time, not in CP sequence: ship #1 (alert) NOW so prod has visibility while #2 + #3 are being built. When CP1 lands, #2 takes over from #1 atomically. If CP1 ships before #1 is filed, there's a window with no bleed visibility at all.

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
- **Finality target N=5 (~12.5 s)** post-Heimdall-v2 (Polygon mainnet 2025-09-16). **Hard-pinned for v0.2; no `finalized` block-tag opt-in.** Two code paths for finality in a state machine that decides money movement is two failure modes to reason about. Tag-based finality is a separate follow-up task with its own 30-day-reorg-telemetry validation. Value lives next to RPC config in `nodes/poly/app/src/shared/env`. (Invariant `FINALITY_IS_FIXED_N`.)
- Startup + daily-cron catch-up: replay historical events from `last_processed_block` to chain head through Capability A. The **only** legitimate sweep in the system, bounded by chain history.
- Manual redeem button (existing `POST /api/v1/poly/wallet/positions/redeem`): inserts a job row, then `await`s the worker outcome with a **30 s** HTTP timeout (matches design § Resolved during review #4; falls back to `202 + job_id` if the worker has not confirmed within the window).
- Deletes from `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`: `sweepInFlight`, `redeemCooldownByConditionId`, `REDEEM_COOLDOWN_MS`, `pendingRedeemMsRemaining`, `markRedeemPending`, `_resetRedeemCooldownForTests`, `_resetSweepMutexForTests`, `redeemAllRedeemableResolvedPositions`, `runRedeemSweep`, `BINARY_REDEEM_INDEX_SETS` import + usages, all `SINGLE_POD_ASSUMPTION` doc-strings.
- Removes the `replicas: 1` constraint from the poly Deployment manifest with a comment pointing at this task.

## Plan — checkpoints

**Two checkpoints.** No transitional bleed-stop CP. The original three-CP plan staged a "stop the bleed first via a sweep-as-enqueue transitional path" CP1 that CP2 immediately deleted — pure throwaway code shaped by bleed urgency rather than architecture. Demoted because the bleed is bounded operator funds (~$0.40/hr), not user funds, and saving ~$10/day of bleed by rushing a transitional CP isn't worth the throwaway sweep-as-enqueue code + extra review/deploy/flight cycle. **The bleed stops as a side effect of CP1 landing the real architecture, not as its own sprint.** Pre-CP1, the interim Loki alert (recording rule, no code) is the only TINY thing worth doing for visibility while the work is in flight.

- [ ] **Pre-CP1 (TINY, ships standalone) — Interim Loki alert against the active v0.1 bleed.** Recording rule + alert: `sum by (condition_id) (count_over_time({env="production",service="app"} | json | event="poly.ctf.redeem.ok" [10m])) > 1`. Pages on-call when the same `condition_id` fires `.ok` ≥2 times in 10 min (the bleed signature: first redeem didn't burn). Auto-retires when CP1 deletes the legacy `poly.ctf.redeem.ok` event (no signal → no alerts → dies quietly). 5 min to file; not a CP, just hygiene.

- [ ] **CP1 — Full event-driven redeem architecture (one PR, one state transition)**
  - Job table `poly_redeem_jobs` + worker draining `WHERE status = 'pending' FOR UPDATE SKIP LOCKED`.
  - **Dispatch split**: `decision.flavor` selects CTF (binary / multi-outcome) vs NegRiskAdapter (neg-risk-parent / neg-risk-adapter) — fixes the v0.1 routing defect.
  - **Post-tx burn-verification gate** (`REDEEM_REQUIRES_BURN_OBSERVATION`): every receipt is decoded; absence of `TransferSingle(from=funder, value>0)` (CTF) or `NegRiskAdapter.PayoutRedemption(redeemer=funder)` → `level=50` Loki + `abandoned/class:malformed`. No retries. Bounds per-user blast radius to one tx of POL on any future routing mistake.
  - **Three viem `watchContractEvent` subscriptions** (CTF `ConditionResolution`, CTF `PayoutRedemption`, NegRiskAdapter `PayoutRedemption`) writing to the job table.
  - **Startup + daily-cron catch-up replay** over `[last_processed_block, head]` — the only legitimate sweep in the system, bounded by chain history. Structural fallback for any subscription gap (reorg edges, viem reconnect bugs).
  - **Sweep + cooldown + mutex deleted in the same PR**: `runRedeemSweep`, `redeemAllRedeemableResolvedPositions`, `sweepInFlight`, `redeemCooldownByConditionId`, `REDEEM_COOLDOWN_MS`, `pendingRedeemMsRemaining`, `markRedeemPending`, mirror-pipeline sweep tick, all `SINGLE_POD_ASSUMPTION` docstrings, `replicas: 1` Deployment constraint.
  - Manual route writes a job row + awaits the worker outcome with 30 s HTTP timeout (falls back to `202 + job_id` past the timeout).
  - **No transitional state** — neither "sweep + subscriptions both enqueue" nor "burn-verify gate without dispatch split." Either both correctness pieces are in, or neither is. The job table's unique key handles dedup across enqueue sources; catch-up replay handles subscription gaps; burn-verify handles routing mistakes.
  - **Validation**: on candidate-a, observe 5 v0.1-bleeding condition_ids (`0x86c171b7…`, `0x18ec34d0…`, `0x6178933348…`, `0xeb7627b6…`, `0x941012e7…`) stop firing redeem txs entirely. After deploy, prod `poly.ctf.redeem.bleed_detected` event count = 0; on-chain ERC-1155 balance for those positions drops to 0 only when payout actually lands.

- [ ] **CP2 — Dashboard projection (dust-state UI)** — independent of CP1's redeem path; can ship together or after.
  - `lifecycle_state` enum column on `poly_redeem_jobs`, written by worker per `decideRedeem` evaluation.
  - `GET /api/v1/poly/wallet/execution` gains `lifecycle_state` per row.
  - Dashboard splits Open vs History on `lifecycle_state ∈ terminal-set`.
  - Redeem button removed from rows where the policy classifies as `skip` or `malformed`.
  - One-shot backfill on first deploy; idempotent on re-run.

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

- [ ] REDEEM_REQUIRES_BURN_OBSERVATION — every `writeContract` receipt is decoded and asserted to contain ≥1 burn event from funder (`TransferSingle(from=funder, value>0)` for CTF; `NegRiskAdapter.PayoutRedemption(redeemer=funder)` for adapter). Absence emits `poly.ctf.redeem.bleed_detected` at level=50 AND transitions the job to `abandoned/class:"malformed"` immediately. **No retries.** This is the structural answer to the bug.0383 / bug.0384 / v0.1-neg-risk pattern: every routing mistake (current OR future) self-limits to one tx of damage. Without this invariant the next adjacent bug class silently bleeds again until Loki catches it externally — see § "🔴 v0.1 bleed is LIVE" for why this matters and § "Per-user wallet exposure" below for why it is non-negotiable. (spec: poly-positions)
- [ ] REDEEM_COMPLETION_IS_EVENT_OBSERVED — `confirmed` status only after observed `PayoutRedemption` from funder at N-block finality (spec: poly-positions)
- [ ] REDEEM_DEDUP_IS_PERSISTED — duplicate-redeem prevention is the unique index `(funder_address, condition_id)` on `poly_redeem_jobs`; no in-memory Maps anywhere (spec: poly-positions)
- [ ] REDEEM_HAS_CIRCUIT_BREAKER — `attempt_count >= 3` OR any malformed-class failure transitions to `abandoned` and emits `poly.ctf.redeem.abandoned` Loki page (spec: poly-positions)
- [ ] REDEEM_RETRY_IS_TRANSIENT_ONLY — only `transient` failures (RPC timeout, gas underpriced, reorg) re-enter `pending`; `malformed` skips the retry loop (spec: poly-positions)
- [ ] FINALITY_IS_FIXED_N — finality depth is hard-pinned to **N=5** for v0.2; no per-deploy `finalized` block-tag opt-in. Two code paths in a state machine that decides money movement is two failure modes to test. Tag-based finality is filed as a follow-up task with its own validation (post-30-day reorg-telemetry observation per § Pre-implement investigations). (spec: poly-positions)
- [ ] SWEEP_IS_NOT_AN_ARCHITECTURE — no periodic Data-API enumerate-and-fire; the only allowed sweep is event-replay catch-up bounded by chain history (spec: poly-positions)
- [ ] SINGLE_POD_REMOVED — poly Deployment manifest has no `replicas: 1` constraint and no `SINGLE_POD_ASSUMPTION` doc-strings remain (spec: poly-positions)
- [ ] BOUNDARY_PLACEMENT — port + domain types + transitions live in `packages/poly-redeem/`; subscription/worker/lifecycle wiring lives in `nodes/poly/app/src/bootstrap/` (spec: packages-architecture)
- [ ] SIMPLE_SOLUTION — uses Postgres-as-queue (chosen library or ~30 LOC `FOR UPDATE SKIP LOCKED`); does not introduce Redis, Temporal, or a new infrastructure dep (spec: architecture)

## Per-user wallet exposure (the safety-net argument)

`task.0318` Phase B shipped per-tenant Privy trading wallets. Every redeem the worker fires through a tenant's wallet spends that tenant's POL — not operator funds. Today's v0.1 bleed (§ "🔴 v0.1 bleed is LIVE") is on the operator's funder; the moment a per-tenant funder hits the same neg-risk routing path, the same bleed pattern drains their wallet at ~$0.40/hour until manual intervention. **Without `REDEEM_REQUIRES_BURN_OBSERVATION` we cannot ethically expose redemption to user-funded wallets.** With it, per-user blast radius is bounded at one tx of POL before the job transitions to `abandoned` and Loki pages on-call. The invariant is therefore a **precondition for any per-user redeem traffic**, not a follow-up nice-to-have — it ships in CP1 alongside the dispatch split.

This is also why CP1 of the plan above bundles the burn-verify gate with the dispatch split — they both ride in the bleed-stop PR, and the gate is what makes "we shipped a routing change" trustworthy without manual on-chain audit.

## Notes

- Blocked by task.0387 — Capability A must land first because this task imports `decideRedeem`. Both can be drafted in parallel; merge order is 0387 → 0388.
- After this task lands, close task.0379 ("Poly redemption sweep — top-0.1% production-grade hardening") as `done` — its scope is fully covered by 0387 + 0388.
- The reorg-handling story (confirmed → submitted on reorg-within-N) needs explicit test coverage in `tests/transitions.test.ts` and an integration test using viem's reorg simulation. Do not skip it — it is `REDEEM_COMPLETION_IS_EVENT_OBSERVED`'s teeth.

## v0.1 prod observations (2026-04-27, post-merge of task.0387)

Two issues confirmed in production after task.0387 deployed (commit `20a42237f`):

1. **Bleed still active.** The other dev validated that `redeemPositions` is still firing no-op txs against neg-risk markets in prod. v0.1's `neg-risk-parent` flavor routes through CTF (not the adapter) — so the structural fix (correct `indexSet`) doesn't help when the contract address itself is wrong. The cooldown rate-limits but does not eliminate. **This task is the real fix:** dispatch split (CTF vs `NegRiskAdapter.redeemPositions(conditionId, amounts)`) per `decision.flavor`. CP1 of this task closes the bleed for real.

2. **Dust losers misclassified in dashboard UI.** Resolved-loser positions (lifecycle state: `dust`) currently render in the **Open** tab with a no-op `Redeem` button, and the **Position History** tab is empty. The user's wallet shows ~14 such rows on candidate-a (all `-$1` to `-$4` cost basis, $0 current value, all `-99.99% / -100%`). The lifecycle design already names this state and its terminal edge; the dashboard does not yet honour it. Fix is a projection, not a chain-read change — see `docs/design/poly-positions.md` § Dust-state UI semantics.

### Adds to this task's scope (CP2 — dashboard projection; see § Plan above)

- New column on `poly_redeem_jobs`: `lifecycle_state` enum mirroring the design-doc state set (`unresolved | open | closing | closed | resolving | winner | redeem_pending | redeemed | loser | dust | abandoned`). Defaults to `unresolved` until the worker classifies.
- Worker writes `lifecycle_state` on every `decideRedeem` evaluation:
  - `redeem` decision → `winner` (becomes `redeem_pending` on tx submit, `redeemed` on confirmation).
  - `skip:losing_outcome` → `loser` (terminal; UI moves to History).
  - `skip:market_not_resolved` → `resolving` (stays in Open with a "Pending resolution" chip).
  - `skip:zero_balance` → `redeemed` if a prior `PayoutRedemption` is on file for `(funder, conditionId)`, else `closed`.
  - `malformed` → `abandoned` (Class-A runbook).
- `GET /api/v1/poly/wallet/execution` contract gains `lifecycle_state` per row; dashboard splits Open vs History on `lifecycle_state ∈ terminal-set`. The Redeem button on rows that resolve to a non-`redeem` decision class is removed entirely (no more "Redeem this losing position" UX trap).
- Backfill: on first deploy, run a one-shot reconciliation that classifies every existing live position via `decideRedeem` and writes `lifecycle_state` rows. Idempotent on re-run.

This is CP2 in the plan above. Folded into this task (vs. a sibling task) because the lifecycle state machine + UI presentation are two views of the same data and shouldn't drift; splitting would risk a release where the worker writes `lifecycle_state` but the API endpoint doesn't surface it (or vice versa).

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
- **N=5 (~12.5 s) hard-pinned for v0.2** — see invariant `FINALITY_IS_FIXED_N`. 2.5× margin over the 5 s upper bound, well under the 30 s HTTP timeout ceiling. **No `finalized` block-tag opt-in** in v0.2 — was previously listed as optional; demoted to a separate follow-up task to keep v0.2 single-code-path. Two code paths for finality in a money-movement state machine = two failure modes to reason about.
- Sources: [forum.polygon.technology v0.3.0 release announcement](https://forum.polygon.technology/t/heimdall-v2-v0-3-0-release-for-mainnet/21270), [Polygon Heimdall-v2 docs](https://docs.polygon.technology/pos/architecture/heimdall/checkpoint/) (vote-extensions section).
- Revisit cadence: after first 30 days of `PayoutRedemption` observation, ratchet down to N=3 (~7.5 s) if zero `confirmed → submitted` reverts; hold at N=5 if any reverts occur. The eventual `finalized` block-tag follow-up task piggybacks on this telemetry.
