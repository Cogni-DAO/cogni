# features/redeem · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** stable

## Purpose

Event-driven CTF redeem pipeline (task.0388). Replaces the deleted polling sweep + in-process cooldown Map + sweep mutex with a Postgres-backed job queue driven by viem `watchContractEvent` subscriptions on the Polymarket CTF + NegRiskAdapter contracts. One subscriber + one worker per pod; `FOR UPDATE SKIP LOCKED` claim is multi-pod safe.

## Pointers

- [Design — Poly Positions](../../../../../../docs/design/poly-positions.md) — lifecycle diagram, four-authority rule, abandoned-position runbook
- [Bootstrap wiring](../../bootstrap/redeem-pipeline.ts) — boot helper that constructs and starts the pipeline
- [Port](../../ports/redeem-jobs.port.ts) — `RedeemJobsPort` contract
- [Adapter](../../adapters/server/redeem/drizzle-redeem-jobs.adapter.ts) — Postgres implementation

## Boundaries

```json
{
  "layer": "features",
  "may_import": ["ports", "core", "shared", "types", "contracts"],
  "must_not_import": [
    "app",
    "adapters/server",
    "adapters/worker",
    "bootstrap",
    "styles"
  ]
}
```

## Public Surface

- **Exports** (via `index.ts`):
  - `RedeemSubscriber` / `RedeemSubscriberDeps` — long-lived class wrapping three viem `watchContractEvent` subscriptions: CTF `ConditionResolution` (enumerate funder positions, run Capability A, enqueue), CTF `PayoutRedemption` (match `redeemer == funder` ⇒ confirm), NegRiskAdapter `PayoutRedemption` (same; distinct topic hash). Public `enqueueForCondition(conditionId)` is reused by catch-up + boot backfill.
  - `RedeemWorker` / `RedeemWorkerDeps` — long-lived class with two responsibilities per tick: (1) drain one `claimed` row → submit tx → decode receipt for funder-burn (persisted as observational only) → `markSubmitted`; (2) reap `submitted` rows past N=5 finality by querying chain truth — batched `getLogs` for `PayoutRedemption(redeemer=funder)` per flavor (CTF for binary/multi, NegRiskAdapter for neg-risk-\*) + `balanceOf` per condition that didn't match. Dispatches `reaper_chain_evidence`: `payoutObserved` ⇒ confirmed; `!payoutObserved && balance>0` ⇒ `bleed_detected@50` + abandoned/malformed; `!payoutObserved && balance==0` ⇒ confirmed defensively at warn-level (off-pipeline settlement). Replaces the receipt-burn-flag reaper that was vulnerable to no-op-retry corruption (bug.0403).
  - `runRedeemCatchup(deps)` / `RedeemCatchupDeps` — startup + cron event-replay over `[lastProcessedBlock, head]`. The only legitimate sweep in the system, bounded by chain history.
  - `resolveRedeemCandidatesForCondition(deps)` / `ResolvedRedeemCandidate` — shared `(funder, conditionId) → ResolvedRedeemCandidate[]` helper that runs the Data-API position lookup + multicall(4) of CTF reads + Capability A `decideRedeem`.
- **Internal helpers (not exported)**:
  - `decisionToEnqueueInput(funder, candidate)` — translates Capability A's discriminated decision into the port's `EnqueueRedeemJobInput` shape. `redeem` ⇒ pending/winner; `skip:*` ⇒ skipped/loser|redeemed|resolving|unresolved; `malformed` ⇒ null (Class-A page).
  - `buildSubmitArgs(job, ctx)` — pure-ish boundary helper for the worker's CTF-vs-NegRiskAdapter dispatch (parameterised over `readBalance`).
- **Env/Config keys:** none directly; consumes `POLYGON_RPC_URL` via the bootstrap helper.

## Ports

- **Uses ports:** `RedeemJobsPort` (from `@/ports`)
- **Implements ports:** none

## Responsibilities

- This directory **does**: chain-event subscriptions, worker tx submission + burn-decode, finality reaping, catch-up replay, lifecycle classification of every funder position.
- This directory **does not**: own the persistence layer (delegates to `RedeemJobsPort`); decide the redeem policy (defers to `@cogni/market-provider/policy:decideRedeem`); place CLOB orders.

## Invariants

- **REAPER_QUERIES_CHAIN_TRUTH** — at N=5 the reaper consults `getLogs` for `PayoutRedemption(redeemer=funder)` and `balanceOf(funder, positionId)`, then dispatches `reaper_chain_evidence`. The receipt-burn flag set at submission time is observational only and never decides confirm-vs-bleed (bug.0403 — flag was previously corrupted by no-op retries, producing false bleed alerts).
- **REDEEM_REQUIRES_BURN_OBSERVATION** — bleed is detected when no `PayoutRedemption` was emitted for the funder AND `balanceOf > 0` at N=5. Bleed ⇒ `poly.ctf.redeem.bleed_detected@50` + abandoned/malformed. `balance==0` with no payout ⇒ confirmed defensively at warn-level (off-pipeline settlement).
- **REDEEM_COMPLETION_IS_EVENT_OBSERVED** — both subscriber `payout_redemption_observed` and reaper `reaper_chain_evidence` (with `payoutObserved`) flip rows to `confirmed`. Reorg-removed logs revert `confirmed → submitted` via the subscriber.
- **REDEEM_DEDUP_IS_PERSISTED** — unique `(funder_address, condition_id)` index on `poly_redeem_jobs`. No in-memory dedup.
- **REDEEM_HAS_CIRCUIT_BREAKER** — three transient failures escalate to `abandoned/transient_exhausted`.
- **FINALITY_IS_FIXED_N=5** — single hard-pinned constant for v0.2; no `finalized` block-tag opt-in.
- **SWEEP_IS_NOT_AN_ARCHITECTURE** — no Data-API enumerate-and-fire; the only sweep is the catch-up replay bounded by `last_processed_block`.

## Notes

- The pipeline is single-funder for v0.2 (one active `poly_wallet_connections` row). Multi-tenant fan-out is task.0318 Phase C.
- Skip-classification rows (`status='skipped'`) carry no work for the worker; they exist purely to back the dashboard's lifecycle projection (`/api/v1/poly/wallet/execution`).
