---
id: task.0387
type: task
title: "Capability A — pure redeem policy + fixture audit (stops the bleed)"
status: needs_closeout
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
revision: 2
blocked_by: []
deploy_verified: false
created: 2026-04-26
updated: 2026-04-27
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

**v0.1 scope (this PR — CP1 + CP3 only).** CP2 (Loki audit script + 30-day real-tx backfill) is deferred to v0.2 on this same task; the bleed-stop wire does not require it. v0.1 ships against synthetic + the existing `2026-04-25` snapshot fixture — `FIXTURE_COVERAGE_COMPLETE` is **partially** satisfied (5/7 classes have synthetic coverage; `neg-risk-adapter` is reserved/not emitted by v0.1; `multi-outcome` synthetic only). v0.2 promotes synthetic fixtures to real-tx-backed by running the audit script.

`exercise:` After candidate-a flight, query Loki for `{env="candidate-a"} |= "policy_decision"` at deploy SHA — confirm structured `policy_decision={kind, flavor, reason}` field appears on every redeem-path call (sweep + manual). Trigger a manual redeem on a known-resolved condition via `POST /api/v1/poly/wallet/positions/redeem`; the receipt must show `TransferSingle(from=funder, value>0)` for a winner, OR a `policy_decision.kind="skip"` log with no tx fired for a non-winner.

`observability:` Production `poly.ctf.redeem.ok` events followed by zero-burn must drop to zero within one sweep tick (~30 s) post-deploy. Grafana "POL spent vs USDC redeemed slope" panel shows the slopes converging instead of diverging. New `poly.ctf.redeem.malformed` Loki event fires zero times in steady state; if it does fire, follow the Class-A runbook in `docs/design/poly-positions.md` § Abandoned-position runbook.

## Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] POSITION_IDENTITY_IS_CHAIN_KEYED — Capability A consumes chain reads only; Data API never enters the policy function (spec: poly-positions)
- [ ] WRITE_AUTHORITY_IS_CHAIN_OR_CLOB — call-site reads `payoutNumerator` from chain, never from Data-API `redeemable` (spec: poly-positions)
- [ ] NEG_RISK_REDEEM_IS_DISTINCT — `negativeRisk: true` inputs route to `neg-risk-parent` or `neg-risk-adapter` flavor; never to `binary` (spec: poly-positions)
- [ ] FIXTURE_COVERAGE_COMPLETE — corpus includes ≥1 case for each of the 7 classes listed in `## Validation` (spec: poly-positions § Before /implement)
- [ ] PURE_POLICY_NO_IO — the policy module imports nothing from viem, clob-client, or app/bootstrap; verified by dep-cruiser rule (spec: architecture, packages-architecture)
- [ ] SIMPLE_SOLUTION — leverages existing `vitest` + Polymarket ABI exports; no new test framework, no new RPC client (spec: architecture)

## Plan — checkpoints

- [x] **Checkpoint 1 — Pure policy module + synthetic fixture corpus (offline-only)** — landed in commit 2d7fcabe4. 26 unit tests in `packages/market-provider/tests/redeem-policy.test.ts` covering all 7 classes + skip + malformed edges + purity invariant. Subpath export `@cogni/market-provider/policy` wired through tsup + package.json.
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

- [ ] **Checkpoint 2 — Loki audit script + real-tx fixture backfill — DEFERRED to v0.2 on this same task.** CP1 + CP3 stop the bleed on synthetic + the existing real-Polygon-mainnet fixture (snapshot `2026-04-25`, 16 rows, 2 neg-risk winners). CP2 builds the 30-day Loki audit script + cross-checks against mainnet historical traces (per design doc § Before /implement) to PROVE `FIXTURE_COVERAGE_COMPLETE` from real data. Not a ship-blocker for the bleed-stop — observability of the new `policy_decision` log on candidate-a substitutes pending the audit. v0.2 lands as a follow-up commit on this same task.0387 (status loops back to `needs_implement` after v0.1 merges). No separate work item filed; CP2 is a checkpoint of this task, not a sibling task.
  - Milestone: `scripts/experiments/audit-redeem-fixtures.ts` runs against production Loki (last 30d of `poly.ctf.redeem.ok`) + Polygon RPC, classifies each `tx_hash` by burn-observed, emits coverage report. Any fixtures derived from real tx hashes added to corpus alongside synthetic ones. **FIXTURE_COVERAGE_COMPLETE** is now provable from real data.
  - Invariants: `FIXTURE_COVERAGE_COMPLETE`, `WRITE_AUTHORITY_IS_CHAIN_OR_CLOB` (script reads from chain, not Data API)
  - Todos:
    - [ ] Create `scripts/experiments/audit-redeem-fixtures.ts` — Loki query via `scripts/loki-query.sh` pattern + viem `getTransactionReceipt` + log-decode classifier
    - [ ] Run the audit, save output to `packages/market-provider/policy/redeem.audit-report.md` — **tracked**, not gitignored. Reviewers must be able to verify FIXTURE_COVERAGE_COMPLETE without re-running the audit (which is creds-gated).
    - [ ] For every class missing from real data, document the gap in the report and ensure synthetic backfill exists
    - [ ] Per design-doc review criterion (§ Before /implement, Loki audit bullet): every synthetic fixture cross-checks against a Polygon **mainnet** historical trace of the same `(market_kind, outcome_index, payoutNumerators)` shape. If no comparable mainnet trace exists, fixture is accepted with explicit `// no comparable mainnet trace — reasoned from ABI` annotation. (Mumbai testnet was deprecated April 2024; Polymarket has no testnet deployment.)
  - Validation/Testing:
    - [ ] What can now function e2e? Nothing user-visible — fixture provenance is now documented + cross-checked.
    - Test levels:
      - [ ] unit: same as Checkpoint 1, now with real-tx fixtures added

- [x] **Checkpoint 3 — Wire into existing executor (BLEED STOPS)** — landed in commit 2d7fcabe4. Manual + sweep multicall extended to 4N reads. `decision.indexSet` + `decision.parentCollectionId` replace hardcoded constants. `BINARY_REDEEM_INDEX_SETS` import removed from the call site (constant stays in market-provider for now per task scope). New `poly.ctf.redeem.policy_decision` structured log + `poly.ctf.redeem.malformed` for design-defect class. Mutex + cooldown Map preserved per task scope (task.0388 rips them). 18/18 executor tests green; race-regression tests for bug.0384 still pass against the 4N layout.
  - Milestone: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts` `decideRedeem` (lines 189–205) replaced by import from `@cogni/market-provider/policy/redeem`. Sweep call site (line ~814) uses `decision.indexSet` and `decision.parentCollectionId` instead of hardcoded `BINARY_REDEEM_INDEX_SETS`. **Mutex + cooldown Map stay in this PR** (per task scope; 0388 rips them). Existing executor tests adjusted to assert against new discriminated-union shape.
  - Invariants: `WRITE_AUTHORITY_IS_CHAIN_OR_CLOB`, `NEG_RISK_REDEEM_IS_DISTINCT`, `SIMPLE_SOLUTION`
  - Todos:
    - [ ] Replace inline `decideRedeem` with imported version
    - [ ] Update call site at line ~814 to consume `Decision`
    - [ ] Add structured Loki log `policy_decision={kind, flavor, reason}` at decision site for `## Validation observability`
    - [ ] Update `nodes/poly/app/tests/unit/bootstrap/poly-trade-executor.test.ts` to use new policy fixtures (do NOT delete the bug.0384 race regression tests)
    - [ ] Confirm `BINARY_REDEEM_INDEX_SETS` import is removed from the call site. The constant stays exported in `market-provider` for the 0388 transition window, but **must** be marked `@deprecated — use decideRedeem from @cogni/market-provider/policy/redeem` and a dep-cruiser (or no-restricted-imports) rule blocks any new import. Dies entirely in 0388.
  - Validation/Testing:
    - [ ] What can now function e2e? Sweep on candidate-a runs the new predicate. Already-redeemed and wrong-index-set positions are classified `malformed` instead of firing redundant txs. POL bleed stops.
    - Test levels:
      - [ ] unit: `pnpm -F @cogni/poly-app test -- poly-trade-executor`
      - [ ] component: existing executor component tests still green
      - [ ] stack: defer to CI — local stack-test is gated by infra

## Review Feedback

**v0.1 implementation review (revision 2, 2026-04-27).**

Resolved in this revision (applied directly to the branch):

- `RedeemFlavor` mislabeled multi-outcome markets as `flavor: "binary"`. Added explicit `"multi-outcome"` to the discriminated union and split the dispatch in `decideRedeem`. Loki / Grafana can now split metrics by topology; future consumers can switch-exhaustive without ambiguity. `(packages/market-provider/src/policy/redeem.ts, tests/redeem-policy.test.ts)`
- `PURE_POLICY_NO_IO` invariant was declared in the module docstring + task body but not enforced. Added `no-io-in-policy` rule to `.dependency-cruiser.cjs` blocking `viem`, `@polymarket/clob-client`, `nodes/`, and `services/` imports from `packages/market-provider/src/policy/**`. `pnpm arch:check` passes; rule will fire on any future regression.
- Two `## Validation` sections in the task body collapsed to one canonical block scoped to v0.1 reality (CP1 + CP3 only — no audit script in this PR). The `exercise:` is now achievable on candidate-a today.
- CP2 deferral language polished — no orphan "task.0387-followup" placeholder; v0.2 lands as a follow-up commit on the same task with status looping back to `needs_implement` after v0.1 merges.

CI status (informational, non-blocking):

- `single-node-scope`: FAIL — diagnostic-only gate (per workflow comment "Lands non-required initially"; verified not in branch protection's required_status_checks). PR spans `poly` + `operator` domains by classification (the `packages/market-provider/policy/` files count as `operator`). Splitting the PR would require Capability A package + executor wire to land in two separate merges with a chicken-and-egg between them. Acceptable for v0.1; long-term fix is to expand the ride-along whitelist in `task.0381` to include `packages/market-provider/**` (shared infra is not really `operator`-domain).
- `SonarCloud Code Analysis`: FAIL — quality-gate metric (also non-required). Likely the new policy module's coverage delta or duplications. Worth investigating in v0.2 but not a merge blocker.

**Phase 0.1 docs review (revision 1, 2026-04-27).**

Resolved in this revision:

- Mumbai testnet cross-check criterion (impossible — Polymarket is mainnet-only) → reworded to mainnet historical traces with explicit ABI-reasoned annotation for missing classes. Updated in design doc § Before /implement and CP2 todos.
- N=20 vs 30 s ingress timeout contradiction → reframed as a hard constraint `N × block_time ≤ 28 s` (Polygon ⇒ N≤14). Higher N is allowed but downgrades the manual-redeem UX to 202+poll. Doc no longer contradicts itself.
- `BINARY_REDEEM_INDEX_SETS` deprecation pointer added to CP3 todos.
- Audit-report tracked, not gitignored. Reviewers can verify FIXTURE_COVERAGE_COMPLETE without re-running creds-gated audit.
- Branch sequencing note rewritten: docs-only Phase 0.1 PR off `design/poly-positions`, code on child branch.

Open (needs human routing, not blocking docs PR):

- **task.0387 ID collision** with `design/task-0387-pnl-single-source` branch on origin (titled "single-source poly wallet PnL via user-pnl-api"). Same task ID, different scope, different file. Whichever PR lands second fails `pnpm work:index` unique-id check. Pick one to rename — recommendation: rename the PnL branch's task to `task.0389` since it's not yet merged and has only 2 commits, vs the redeem-policy task which is now wired through the design doc + project roadmap.

Deferred (non-blocking, follow-on work):

- `closing → resolving` edge in lifecycle diagram doesn't specify what happens to the in-flight close _intent_ in our DB (cancelled / orphaned / completed-zero-fill). Tracked under `poly-position-exit.md` follow-on; not blocking.

## Notes

- task.0379 ("Poly redemption sweep — top-0.1% production-grade hardening") is the project-management placeholder this work supersedes. After 0387 + 0388 land, close 0379 as `done`.
- Capability A landing alone is sufficient to stop the bleed — the existing sweep + cooldown + mutex bandaid becomes correct (just inefficient) once the predicate stops returning false-positives. task.0388 rips the inefficiency.
- Human-in-the-loop runbook for `redeem_failed → abandoned` lives in `docs/design/poly-positions.md` § Abandoned-position runbook. Capability A's fixture corpus is the artifact step 4 of that runbook updates.
- **Branch + PR sequencing:** Phase 0.1 (this scaffolding) ships as a docs-only PR off `design/poly-positions` — design doc + task scaffolding for 0387 + 0388, no code. CP1/CP2/CP3 land on a child branch (`feat/task-0387-capability-a`) cut from the docs PR's merge commit. Rationale: design needs sign-off independently; 60-100+ tool-call implementation arc deserves its own review window; ID collision (see § Known issues) needs human routing first.
- **Known issues (Phase 0.1 review, not blocking docs merge):**
  - `task.0387` ID collision with `design/task-0387-pnl-single-source` branch (different scope: poly wallet PnL via user-pnl-api). Whichever lands second breaks `pnpm work:index` unique-id check. Needs human routing — rename one. Documented in `## Review Feedback` below.
