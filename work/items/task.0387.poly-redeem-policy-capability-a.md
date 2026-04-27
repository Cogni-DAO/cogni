---
id: task.0387
type: task
title: "Capability A — pure redeem policy + fixture audit (stops the bleed)"
status: needs_implement
priority: 0
rank: 1
estimate: 3
summary: "Replace the buggy hardcoded `BINARY_REDEEM_INDEX_SETS = [1, 2]` predicate with a pure `decideRedeem` policy that handles binary, neg-risk-parent, neg-risk-adapter, and multi-outcome correctly. Fixture corpus is built from a Loki audit of the last 30 days of `poly.ctf.redeem.ok` events plus synthetic backfill for any class the audit doesn't cover. Wires into the existing sweep predicate so the bleed stops on merge — Capability B (event-driven queue) ships in task.0388 next."
outcome: "After this PR, the running sweep on candidate-a + production no longer fires `redeemPositions` against already-redeemed positions or with the wrong index set. The Loki signal `poly.ctf.redeem.ok` followed by zero `TransferSingle` from funder goes to zero. Capability A is importable from `packages/market-provider/policy/redeem` and is the single source of redeem-decision truth for both the legacy sweep (this PR) and the future job worker (task.0388)."
spec_refs: [poly-positions, poly-position-exit]
assignees: [derekg1729]
credit:
project: proj.poly-copy-trading
branch: design/poly-positions
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-26
updated: 2026-04-26
labels: [poly, ctf, redeem, policy, bleed-stopper, bug-0384, bug-0383, bug-0376]
external_refs:
---

# Capability A — Pure Redeem Policy + Fixture Audit

## Why

bug.0384's POL bleed is not fundamentally a race; it is a wrong predicate that re-fires forever. The mutex + cooldown bandaid in `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts` slows the bleed; it does not stop it (active incident 2026-04-26). The actual defect: `decideRedeem` returns `ok` for positions where `redeemPositions` produces zero burn — neg-risk markets given the wrong index set, positions already redeemed by a prior tx, multi-outcome edge cases. Capability A is the pure decision function the design doc (`docs/design/poly-positions.md`) calls out as the single redeem-decision authority.

## Outcome

A pure module `packages/market-provider/policy/redeem` exporting `decideRedeem(input) → Decision` where:

- Inputs: `{ balance: bigint, payoutNumerator: bigint, payoutDenominator: bigint, outcomeIndex: number, outcomeSlotCount: number, negativeRisk: boolean }` — all chain-derived, no I/O, no SDK imports.
- Decision: discriminated union
  - `{ kind: 'redeem', flavor: 'binary' | 'neg-risk-parent' | 'neg-risk-adapter', parentCollectionId: \`0x${string}\`, indexSet: bigint[], expectedShares: bigint, expectedPayoutUsdc: bigint }`
  - `{ kind: 'skip', reason: 'zero_balance' | 'losing_outcome' | 'already_redeemed_inferred' | ... }`
  - `{ kind: 'malformed', reason: 'unknown_market_topology' | 'invalid_outcome_index' | ... }`
- 100% unit-tested against the fixture corpus described below. No viem, no clob-client, no env reads.

## Approach

**Solution.** Build the pure policy module + fixture corpus, swap the in-line `decideRedeem` in `poly-trade-executor.ts` for it. Sweep architecture (mutex, cooldown Map, polling loop) stays in this PR — Capability A is correctness for the existing loop. task.0388 rips the loop next.

**Reuses.**

- `PolymarketUserPosition` shape from `packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts` (read-only — for input mapping at the call site, not inside the pure policy).
- CTF + neg-risk adapter ABIs already present in `packages/market-provider/src/adapters/polymarket/polymarket.ctf.ts` (for fixture generation — synthesizing `eth_getTransactionReceipt`-shaped events).
- Existing test infra: `vitest` unit tests in `packages/market-provider/tests/`.

**Rejected.**

- _Touch the sweep loop in this PR._ Out of scope. Big-bang rewrite is task.0388. This task is the bleed-stopper.
- _Loki audit alone._ Without synthetic backfill for any uncovered class, we ship a predicate validated only against the slice of history Loki happens to contain. Review2 explicitly blocked on this.

## Files

- Create: `packages/market-provider/policy/redeem.ts` — the pure `decideRedeem` function + `Decision` discriminated union.
- Create: `packages/market-provider/policy/redeem.fixtures.ts` — fixture corpus (real tx hashes + synthetic edge cases). Each fixture: chain-input snapshot + expected `Decision`.
- Create: `packages/market-provider/tests/redeem-policy.test.ts` — drives every fixture through `decideRedeem`, asserts exact decision match.
- Create: `scripts/experiments/audit-redeem-fixtures.ts` — one-shot Loki query + Polygonscan receipt fetch + classifier; emits a markdown report listing covered and missing classes. Re-runnable.
- Modify: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts` — replace inline `decideRedeem` (lines 189–205) with import from `@cogni/market-provider/policy/redeem`. Remove `BINARY_REDEEM_INDEX_SETS` hardcoding from the call site; use `decision.indexSet` and `decision.parentCollectionId` from the policy output.
- Modify: `packages/market-provider/src/index.ts` (or appropriate export point) — re-export the policy module.

## Validation

`exercise:` Run `scripts/experiments/audit-redeem-fixtures.ts` against production Loki (last 30 days) + Polygon RPC. Output report must show ≥1 fixture covering each of: `binary-winner`, `binary-loser`, `binary-already-redeemed`, `neg-risk-parent`, `neg-risk-adapter`, `multi-outcome-winner`, `multi-outcome-loser`. Any class missing from real history is backfilled in `redeem.fixtures.ts` from contract source. After deploy to candidate-a, exercise: trigger a manual redeem on a known-resolved position via `POST /api/v1/poly/wallet/positions/redeem`; tx must produce `TransferSingle(from=funder)` on the receipt.

`observability:` Loki query `{env="candidate-a"} |= "poly.ctf.redeem" | json` for the deploy SHA must show the `decideRedeem` call's structured log `policy_decision={kind, flavor, reason}`. The malformed-class events from the prior 24 hours (per the bleed incident) must stop appearing within one sweep tick post-deploy. Production Grafana panel "POL spent vs USDC redeemed slope" must show the slopes converging.

## Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] POSITION_IDENTITY_IS_CHAIN_KEYED — Capability A consumes chain reads only; Data API never enters the policy function (spec: poly-positions)
- [ ] WRITE_AUTHORITY_IS_CHAIN_OR_CLOB — call-site reads `payoutNumerator` from chain, never from Data-API `redeemable` (spec: poly-positions)
- [ ] NEG_RISK_REDEEM_IS_DISTINCT — `negativeRisk: true` inputs route to `neg-risk-parent` or `neg-risk-adapter` flavor; never to `binary` (spec: poly-positions)
- [ ] FIXTURE_COVERAGE_COMPLETE — corpus includes ≥1 case for each of the 7 classes listed in `## Validation` (spec: poly-positions § Before /implement)
- [ ] PURE_POLICY_NO_IO — the policy module imports nothing from viem, clob-client, or app/bootstrap; verified by dep-cruiser rule (spec: architecture, packages-architecture)
- [ ] SIMPLE_SOLUTION — leverages existing `vitest` + Polymarket ABI exports; no new test framework, no new RPC client (spec: architecture)

## Plan — checkpoints

- [ ] **Checkpoint 1 — Pure policy module + synthetic fixture corpus (offline-only)**
  - Milestone: `decideRedeem` exists at `packages/market-provider/policy/redeem.ts`, fully unit-tested against synthetic fixtures covering all 7 classes derived from CTF + neg-risk adapter ABIs. No I/O, no network calls. Bleed not yet stopped — predicate is built but not wired.
  - Invariants: `PURE_POLICY_NO_IO`, `NEG_RISK_REDEEM_IS_DISTINCT`, `POSITION_IDENTITY_IS_CHAIN_KEYED`
  - Todos:
    - [ ] Create `packages/market-provider/policy/redeem.ts` — `decideRedeem(input) → Decision` discriminated union per `## Outcome` shape
    - [ ] Create `packages/market-provider/policy/redeem.fixtures.ts` — synthetic fixtures, 1+ per class
    - [ ] Create `packages/market-provider/tests/redeem-policy.test.ts` — drives every fixture through `decideRedeem`
    - [ ] Re-export from `packages/market-provider/src/index.ts`
    - [ ] dep-cruiser rule (or assertion test) blocking imports of `viem`, `@polymarket/clob-client`, `app/bootstrap` from `policy/`
  - Validation/Testing:
    - [ ] What can now function e2e? Nothing user-visible — pure module exists with full unit-test coverage. Bleed still active.
    - Test levels:
      - [ ] unit: `pnpm -F @cogni/market-provider test -- redeem-policy`

- [ ] **Checkpoint 2 — Loki audit script + real-tx fixture backfill**
  - Milestone: `scripts/experiments/audit-redeem-fixtures.ts` runs against production Loki (last 30d of `poly.ctf.redeem.ok`) + Polygon RPC, classifies each `tx_hash` by burn-observed, emits coverage report. Any fixtures derived from real tx hashes added to corpus alongside synthetic ones. **FIXTURE_COVERAGE_COMPLETE** is now provable from real data.
  - Invariants: `FIXTURE_COVERAGE_COMPLETE`, `WRITE_AUTHORITY_IS_CHAIN_OR_CLOB` (script reads from chain, not Data API)
  - Todos:
    - [ ] Create `scripts/experiments/audit-redeem-fixtures.ts` — Loki query via `scripts/loki-query.sh` pattern + viem `getTransactionReceipt` + log-decode classifier
    - [ ] Run the audit, save output to `packages/market-provider/policy/redeem.audit-report.md` (gitignored or tracked — TBD per repo convention)
    - [ ] For every class missing from real data, document the gap in the report and ensure synthetic backfill exists
    - [ ] Per design-doc review criterion: every synthetic fixture cross-checks against a Polygon Mumbai testnet trace of the same shape (or document why no testnet sample exists)
  - Validation/Testing:
    - [ ] What can now function e2e? Nothing user-visible — fixture provenance is now documented + cross-checked.
    - Test levels:
      - [ ] unit: same as Checkpoint 1, now with real-tx fixtures added

- [ ] **Checkpoint 3 — Wire into existing executor (BLEED STOPS)**
  - Milestone: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts` `decideRedeem` (lines 189–205) replaced by import from `@cogni/market-provider/policy/redeem`. Sweep call site (line ~814) uses `decision.indexSet` and `decision.parentCollectionId` instead of hardcoded `BINARY_REDEEM_INDEX_SETS`. **Mutex + cooldown Map stay in this PR** (per task scope; 0388 rips them). Existing executor tests adjusted to assert against new discriminated-union shape.
  - Invariants: `WRITE_AUTHORITY_IS_CHAIN_OR_CLOB`, `NEG_RISK_REDEEM_IS_DISTINCT`, `SIMPLE_SOLUTION`
  - Todos:
    - [ ] Replace inline `decideRedeem` with imported version
    - [ ] Update call site at line ~814 to consume `Decision`
    - [ ] Add structured Loki log `policy_decision={kind, flavor, reason}` at decision site for `## Validation observability`
    - [ ] Update `nodes/poly/app/tests/unit/bootstrap/poly-trade-executor.test.ts` to use new policy fixtures (do NOT delete the bug.0384 race regression tests)
    - [ ] Confirm `BINARY_REDEEM_INDEX_SETS` import is removed from the call site (constant itself stays in market-provider for now, dies in 0388)
  - Validation/Testing:
    - [ ] What can now function e2e? Sweep on candidate-a runs the new predicate. Already-redeemed and wrong-index-set positions are classified `malformed` instead of firing redundant txs. POL bleed stops.
    - Test levels:
      - [ ] unit: `pnpm -F @cogni/poly-app test -- poly-trade-executor`
      - [ ] component: existing executor component tests still green
      - [ ] stack: defer to CI — local stack-test is gated by infra

## Validation block (commit on PR before /closeout)

`exercise:` After candidate-a flight, query Loki for `{env="candidate-a"} |= "policy_decision"` at deploy SHA. Trigger a manual redeem on a known-resolved condition via `POST /api/v1/poly/wallet/positions/redeem`. Receipt must show `TransferSingle(from=funder, value>0)` for binary winners; `malformed` log for already-redeemed cases (no tx fires).

`observability:` Loki query `{app="poly", env="candidate-a"} |= "poly.ctf.redeem"` at deploy SHA shows `policy_decision={kind:"redeem"|"skip"|"malformed", flavor, reason}` per call. Production `poly.ctf.redeem.ok` followed by zero-burn must drop to zero within one sweep tick (~30s) post-deploy. Grafana "POL spent vs USDC redeemed slope" panel shows convergence.

## Notes

- task.0379 ("Poly redemption sweep — top-0.1% production-grade hardening") is the project-management placeholder this work supersedes. After 0387 + 0388 land, close 0379 as `done`.
- Capability A landing alone is sufficient to stop the bleed — the existing sweep + cooldown + mutex bandaid becomes correct (just inefficient) once the predicate stops returning false-positives. task.0388 rips the inefficiency.
- Human-in-the-loop runbook for `redeem_failed → abandoned` lives in `docs/design/poly-positions.md` § Abandoned-position runbook. Capability A's fixture corpus is the artifact step 4 of that runbook updates.
- **Branch sharing with design doc:** This task's branch is `design/poly-positions`, the same branch carrying the `docs/design/poly-positions.md` design doc. PR will bundle design + Capability A. Rationale: design is `trust: draft`, this PR's tests prove its claims; bundling avoids merge-order coupling.
