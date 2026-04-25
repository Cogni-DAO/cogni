---
id: proj.poly-web3-security-hardening
type: project
primary_charter:
title: Poly Web3 Security Hardening
state: Active
priority: 0
estimate: 5
summary: Drive the poly node's on-chain integration surface from "stop-the-bleed" toward top-0.1% crypto-app practice. Cover the autonomous redemption sweep, CTF read/write usage, signing seams, and operator-wallet drain protections behind written invariants, on-chain pre/post-flight checks, idempotency, and chain-real regression tests.
outcome: Every on-chain write the poly node performs (redeem, exit, approve, mirror-buy/sell) is gated by enumerated pre-flight checks, post-flight receipt verification, idempotent across pod restarts, and covered by an anvil-fork regression test. Every such flow has a written spec with stable invariants. Operator wallet POL/USDC.e drains caused by code bugs become impossible by construction, not by code review.
assignees: []
created: 2026-04-25
updated: 2026-04-25
labels: [poly, security, web3, gas, crypto]
---

# Poly Web3 Security Hardening

## Goal

The bug.0376 incident exposed a structural gap: the poly node performs on-chain
writes (redeem, exit, approvals, mirror buys/sells) without the safety
discipline that production-grade crypto apps treat as table stakes —
enumerated pre-flight checks against chain state, post-flight receipt
verification, idempotency keys deterministic across restarts, anvil-fork
regression tests, and written spec-level invariants. We patched the immediate
bleed; this project hardens the whole on-chain surface so the next bug like
0376 is impossible by construction.

## Roadmap

### Crawl (P0)

**Goal:** Top the redemption sweep into top-0.1% shape — the surface that
just drained the operator wallet.

| Deliverable                                                 | Status      | Est | Work Item |
| ----------------------------------------------------------- | ----------- | --- | --------- |
| Production-grade autonomous redemption sweep (B1 + B2 + B3) | In Review   | 3   | task.0379 |
| Sweep architecture refactor (reactive on resolution event)  | Not Started | 3   | task.0377 |
| Anvil-fork test harness (real-chain regression gate)        | Not Started | 3   | task.0378 |
| Bug.0376 stop-the-bleed predicate inversion                 | In Review   | 2   | bug.0376  |

### Walk (P1)

**Goal:** Apply the same discipline to the rest of the on-chain write surface.

| Deliverable                                                      | Status      | Est | Work Item            |
| ---------------------------------------------------------------- | ----------- | --- | -------------------- |
| CTF approval flow audit + invariants spec                        | Not Started | 2   | (create at P1 start) |
| Mirror placement: idempotency + receipt verification             | Not Started | 3   | (create at P1 start) |
| Per-tenant exit (`/positions/close`, `/exit`) hardening pass     | Not Started | 2   | (create at P1 start) |
| Operator-wallet drain monitor + Loki alert (POL balance < N POL) | Not Started | 1   | (create at P1 start) |

### Run (P2+)

**Goal:** Systematize. Make the safety discipline a default for any future
on-chain write surface in any node.

| Deliverable                                                                                    | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Shared `OnChainWritePort` capability (pre-flight gates, idempotency key, receipt verification) | Not Started | 5   | (create at P2 start) |
| Anvil-fork regression test scaffold reusable across nodes                                      | Not Started | 3   | (create at P2 start) |
| Top-0.1% on-chain write checklist as ARCH spec invariant                                       | Not Started | 2   | (create at P2 start) |

## Constraints

- **Stop-the-bleed first.** bug.0376's predicate inversion ships before this
  project's hardening lands. Operator wallet stays empty until task.0378's
  anvil-fork validation is green.
- **No env flags as safety nets.** The fix is correctness-by-construction or
  it isn't a fix. No `POLY_*_ENABLED` toggles to "calm" a misbehaving sweep —
  the predicate must be right.
- **Spec-first.** Every deliverable lands a `docs/spec/poly-*.md` invariant
  block before the code that implements it merges. Code without spec
  invariants is rejected by review for this project.
- **Anvil-fork or it didn't happen.** Mocked unit tests are necessary but not
  sufficient. Every on-chain write surface gets at least one fork-test that
  exercises the chain semantic the bug class depends on.

## Dependencies

- [ ] Anvil binary (foundry) installed in CI runner that runs poly
      integration tests, OR `@viem/anvil` adopted as a devDependency.
- [ ] Polymarket Data-API contract reference pinned for read-only reference
      (we now distrust it as authority; we still use it as enumeration).
- [ ] Operator-wallet RPC plumbing already in place via existing
      `SHARED_PUBLIC_CLIENT` in `poly-trade-executor.ts`.

## As-Built Specs

<!-- Specs land alongside their implementing PR. -->

- (none yet — `docs/spec/poly-autonomous-redemption-sweep.md` lands with
  task.0379)

## Design Notes

### Why this project exists (the bug.0376 retrospective in one paragraph)

The mirror-pipeline redeem sweep used `Position.redeemable` from the
Polymarket Data-API as the trigger for calling on-chain `redeemPositions`.
The Data-API kept reporting `redeemable: true` for already-redeemed
positions; CTF `redeemPositions` succeeds-as-no-op when there's nothing to
redeem, costing ~0.0085 POL per call. The sweep ticked every 30s, so the
operator wallet drained ~30 POL/day until empty. bug.0376 swapped the
predicate from Data-API to on-chain `balanceOf > 0`. That stops the
_specific_ loop, but it doesn't gate on resolution (`payoutDenominator`),
doesn't gate on payout side (`payoutNumerators`), doesn't deduplicate
in-flight ticks across the ~2s tx-confirmation window, doesn't verify the
receipt's USDC.e Transfer event, has no spec, and was deploy-validated on a
candidate-a env that has zero resolved+held positions — i.e. the actual
happy path was never exercised against real chain state. This project owns
the gap.

### Top-0.1% on-chain write checklist (reference)

Every on-chain write surface in scope MUST satisfy:

1. **Pre-flight: enumerated chain-state gates.** Each gate is a free
   `eth_call`. Examples for redeem: `payoutDenominator(conditionId) > 0`
   (resolution), `payoutNumerators(conditionId, indexSet) > 0` (winning
   side), `balanceOf(funder, asset) > 0` (held). All batched via multicall.
2. **Idempotency key.** Deterministic hash of `(funder, conditionId,
resolution-block-or-equivalent)` so a pod restart mid-flight does not
   double-submit.
3. **Single-flight per key.** In-process map of in-flight tx hashes; a
   second tick observing the same key while a tx is unconfirmed returns
   early.
4. **Post-flight: receipt event verification.** Parse the tx receipt for
   the expected event (`USDC.e Transfer` for redeem, `LimitOrderFilled` for
   CLOB, etc.). Refuse to mark the operation "done" without the matching
   event; emit a structured anomaly log if the event is missing.
5. **Anvil-fork regression test.** Forks the chain at a known buggy state,
   runs the flow, asserts the gates hold and the receipt verifies. Lives in
   CI.
6. **Spec.** `docs/spec/poly-<surface>.md` enumerates the invariants above
   so the next agent can review against a fixed bar.

### Why not just "audit everything" with a security firm?

Eventually yes — but a third-party audit on a control loop with no spec,
no enumerated invariants, and no anvil-fork regression scaffold is wasted
budget. This project builds the substrate an audit can grade against. P2
deliverables include "ready to audit."
