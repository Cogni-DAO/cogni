---
id: task.0412
type: task
title: "Poly CTF redeem pipeline — multi-tenant fan-out (purge single-funder kill switch)"
status: needs_implement
priority: 0
rank: 1
estimate: 1
summary: "Make the event-driven CTF redeem pipeline (task.0388) tenant-aware. Today it bails when >1 active `poly_wallet_connections` row exists, so candidate-a (4 tenants) returns 503 on `/api/v1/poly/wallet/positions/redeem`. Auth + per-tenant Privy signing (task.0318 Phase B/B3) is shipped — the redeem layer just never picked up the per-tenant pattern. Loop active connections at boot, instantiate one (subscriber, worker) per tenant, scope `claimNextPending` by funder, route the route handler's tenant to its own pipeline. Purge stale `task.0318 Phase C` references (Phase C never existed) and the kill-switch dev-debt that this PR replaces with real fan-out."
outcome: "On candidate-a, all 4 onboarded tenants' redeem pipelines run concurrently. Each tenant's `POST /api/v1/poly/wallet/positions/redeem` returns 200 + redeems against THEIR Privy-managed funder. The 29 stuck Polymarket positions on Derek's tenant (~$44) clear. `poly.ctf.redeem.pipeline_skipped reason=multi_tenant_unsupported` is gone from Loki at the deployed SHA across all envs. New `poly.ctf.redeem.pipeline_started` event fires once per active connection. No code path silently picks one tenant from N — either fans out to all, or skips with a per-tenant reason."
spec_refs:
  - poly-positions
  - poly-multi-tenant-auth
  - poly-trader-wallet-port
assignees: [derekg1729]
project: proj.poly-copy-trading
branch: feat/poly-redeem-multi-tenant
created: 2026-04-28
updated: 2026-04-28
deploy_verified: false
labels: [poly, ctf, redeem, multi-tenant, privy, cleanup, kill-switch-removal]
external_refs:
  - work/items/task.0388.poly-redeem-job-queue-capability-b.md
  - work/items/task.0318.poly-wallet-multi-tenant-auth.md
---

# Poly CTF Redeem Pipeline — Multi-Tenant Fan-Out

> Predecessors: [task.0388](task.0388.poly-redeem-job-queue-capability-b.md) shipped the event-driven redeem pipeline as **single-funder v0.2** (one bound `funderAddress` at construction). [task.0318](task.0318.poly-wallet-multi-tenant-auth.md) Phase B/B3 shipped the per-tenant Privy signing primitives that make fan-out trivial. This task wires them together.

## Why

Multi-tenant auth is shipped end-to-end for trade **placement** (`PolyTradeExecutorFactory.getFor(tenantId)` resolves a per-tenant `walletPort.resolve(billingAccountId)` signing context). Multi-tenant **redemption** was never wired. The redeem pipeline at `bootstrap/redeem-pipeline.ts:87-104` enforces a literal "single active `poly_wallet_connections` row" invariant:

```ts
if (activeConnections.length > 1) {
  log.warn({ event: "poly.ctf.redeem.pipeline_skipped", reason: "multi_tenant_unsupported", count }, ...);
  return null;
}
```

Loki ground truth (2026-04-28):

| Env         | Active connections         | Pipeline state                    |
| ----------- | -------------------------- | --------------------------------- |
| production  | 1 (funder `0x95e407…5134`) | running                           |
| preview     | 1                          | running                           |
| candidate-a | 4 tenants                  | **SKIPPED — kill switch tripped** |

Candidate-a has been the multi-tenant proving ground since task.0318 Phase B3 deploy_verified (2026-04-22). The redeem pipeline shipped 5 days later (2026-04-27, task.0388) but ignored that reality and pinned itself to `activeConnections[0]`. With no `ORDER BY` on the SELECT, `[0]` is whichever row Postgres returns first — non-deterministic. The kill switch is a fail-closed guard against silently signing for the wrong tenant. It's legit dev-debt; this task pays it off.

User-visible breakage: `POST /api/v1/poly/wallet/positions/redeem` on candidate-a returns `503 redeem_pipeline_unavailable` for every tenant including Derek's, blocking 29 redeemable positions (~$44 stuck).

## Cleanup Checklist (the explicit "all places" enumeration)

### A. Code — make the pipeline tenant-aware

- [ ] **`nodes/poly/app/src/bootstrap/redeem-pipeline.ts`** — replace single-funder boot with per-tenant fan-out.
  - Delete the `activeConnections.length > 1` kill switch (lines 94-104).
  - Loop over `activeConnections`, call `walletPort.resolve(billingAccountId)` per row, instantiate one `(RedeemSubscriber, RedeemWorker)` pair per tenant.
  - Return `RedeemPipelineHandles[]` (or a registry keyed by `billingAccountId`); update the type and the bootstrap stop-handler to tear all down.
  - Update `SINGLE_FUNDER_V0_2` invariant block + module docstring to reflect new design.
- [ ] **`nodes/poly/app/src/ports/redeem-jobs.port.ts`** — add `funderAddress` filter to the claim API.
  - Change signature: `claimNextPending(funderAddress: 0x${string}): Promise<RedeemJob | null>`.
  - Document the invariant: a worker only ever claims rows tagged with its own funder. Cross-tenant claims are impossible (rather than relying on per-pod single-worker assumptions).
- [ ] **`nodes/poly/app/src/adapters/server/redeem/drizzle-redeem-jobs.adapter.ts`** — implement the funder filter.
  - Add `WHERE funder_address = $1` to the `claimNextPending` CTE (inside the `SKIP LOCKED` `SELECT`, not the outer `UPDATE`, so concurrency stays correct).
  - Update the existing component test for `claimNextPending` to assert per-funder isolation under concurrent claims.
- [ ] **`nodes/poly/app/src/features/redeem/redeem-worker.ts`** — pass `this.deps.funderAddress` to `claimNextPending`. (One-line call-site change after the port signature flips.)
- [ ] **`nodes/poly/app/src/bootstrap/container.ts`** — update `redeemPipeline` getter from a single object to a per-tenant lookup (`redeemPipelineFor(billingAccountId)` or `redeemPipelines: Map<...>`). The route handler needs to pick the calling tenant's pipeline.
- [ ] **`nodes/poly/app/src/app/api/v1/poly/wallet/positions/redeem/route.ts`** — resolve the session's `billingAccountId`, look up the matching pipeline, run the manual redeem against that one. Update the 503 path to fire only when _the calling tenant's_ pipeline is missing (e.g., wallet not yet provisioned), not when _any_ pipeline is missing.
- [ ] **`nodes/poly/app/src/features/redeem/redeem-catchup.ts`** — already takes funder as an arg (per-tenant safe). Verify the caller in `startRedeemPipeline` invokes it inside the per-tenant loop.

### B. Stale `task.0318 Phase C` references (Phase C never existed)

Fix all 6 sites — repoint at this task (`task.0412`) or delete the stale reasoning entirely now that the pipeline is multi-tenant:

- [ ] `nodes/poly/app/src/bootstrap/redeem-pipeline.ts:12` — module docstring `Scope:`
- [ ] `nodes/poly/app/src/bootstrap/redeem-pipeline.ts:21` — invariant `PIPELINE_BINDS_AT_BOOT` (delete; new design re-resolves per tenant at boot, but binding is still per-pod, so still requires restart on re-provision — adjust wording)
- [ ] `nodes/poly/app/src/bootstrap/redeem-pipeline.ts:101` — log message in the kill-switch branch (delete the branch entirely)
- [ ] `nodes/poly/app/src/bootstrap/AGENTS.md:57` — `startRedeemPipeline` description
- [ ] `nodes/poly/app/src/app/api/v1/poly/wallet/positions/redeem/route.ts:9` — `TENANT_SCOPED` invariant comment
- [ ] `nodes/poly/app/src/features/redeem/AGENTS.md:71` — single-funder note
- [ ] `nodes/poly/app/src/adapters/server/db/migrations/0033_poly_redeem_jobs.sql:28` — migration header comment (history file, lower priority but worth a 1-line fix for clarity)

### C. Task / project bookkeeping

- [ ] Update `work/items/task.0318.poly-wallet-multi-tenant-auth.md` — Phase A + B + B3 are all shipped; if `deploy_verified: true`, set `status: done`. There is no Phase C planned.
- [ ] Update `work/projects/proj.poly-copy-trading.md` — mark Phase B / B3 cells as done (currently `In Review`); add this task as the redeem-fan-out follow-up.
- [ ] Update `work/items/task.0388.poly-redeem-job-queue-capability-b.md` — note that the `SINGLE_FUNDER_V0_2` invariant is retired by task.0412.

### D. Tests (where they actually live)

- [ ] **Component test** — `claimNextPending(funderA)` skips a `pending` row for `funderB` even when the funder-B row was enqueued first.
- [ ] **Component test** — `startRedeemPipeline` with 2 active connections returns 2 handles, each bound to its own funder.
- [ ] **Stack test** (if cheap) — POST `/redeem` from session A only triggers signing under funder A's wallet, not B's. Probably out of scope for this PR if it requires new fixture wiring; defer to a follow-up if so.

## Validation

**exercise:**

On candidate-a (`https://test.cognidao.org`), authenticated as a tenant with redeemable positions:

1. `GET /api/v1/poly/wallet/positions` returns ≥1 redeemable position for the calling tenant.
2. `POST /api/v1/poly/wallet/positions/redeem` returns 200 (not 503) and includes job-id(s) for the enqueued redemption(s).
3. Repeat from a second tenant session — independent 200 + independent job-ids.
4. After ~30s, `GET /api/v1/poly/wallet/positions` shows redeemed positions cleared (or `lifecycle_state = redeemed` in the jobs table).

**observability:**

Loki at the deployed SHA:

```logql
{env="candidate-a",service="app"} | json
  | event="poly.ctf.redeem.pipeline_started"
  | sha="<head-sha-of-this-pr>"
```

Expect ≥2 entries (one per active connection on candidate-a), each with a distinct `funder` label.

```logql
{env="candidate-a",service="app"} | json
  | event="poly.ctf.redeem.pipeline_skipped"
  | reason="multi_tenant_unsupported"
```

Expect zero results at the new SHA.

```logql
{env="candidate-a",service="app"} | json
  | event=~"poly.ctf.redeem.(submitted|confirmed)"
  | funder="<derek's funder>"
```

Expect entries for the agent's own redeem call landing on the deployed SHA.

## Out of Scope

- Phase 4 streaming / WebSocket redeem subscriptions — task.0322 territory.
- Operator-driven backfill script for the 29 stuck positions: if this task ships fast enough, the new pipeline drains them on its own. If not, a one-shot script using the per-tenant Privy signer is the fallback (separate task if needed).
- Optimizing 3 RPC subscriptions × N tenants down to 3 shared subs that route by `funderTopic` — a perf nice-to-have, not a correctness gate. Profile first; defer unless needed.
