---
id: ledger-fork-vs-build
type: guide
title: "Fork vs Build — V0 Cut-Line"
status: draft
trust: draft
summary: What to fork/reuse from OSS and what to build for the epoch ledger. Anything that decides money must be ours; everything else is replaceable.
read_when: Starting ledger implementation, evaluating OSS tooling, or deciding what's in/out of V0.
owner: derekg1729
created: 2026-02-20
verified:
tags: [governance, transparency, payments, ledger]
---

# Fork vs Build — V0 Cut-Line

> Anything that decides money must be yours; everything else is replaceable.

### References

|             |                                                                                           |                         |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| **Spec**    | [epoch-ledger](../spec/epoch-ledger.md)                                                   | Schema, invariants, API |
| **Project** | [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) | Roadmap and phases      |

## Fork / Reuse (don't reinvent)

- **Process template:** SourceCred-style "epoch run → deterministic artifacts → publish outputs" (cron/Temporal pattern, artifact publishing).
- **Signal UX:** Praise / Coordinape patterns for recognition + peer input → emit receipt candidates.
- **Admin flows:** Simple bounty/task boards (BanklessDAO board) for intake; no payout authority.

## Build (non-negotiable core)

- **Authority ledger:** Signed receipts/events, policy pinning, pool components, deterministic recomputation.
- **Epoch close engine:** Temporal workflow with idempotent close → payout statement.
- **Verifier:** Public recompute endpoint (hashes, signatures, inputs).

## Don't Build (V0)

Full RBAC/admin app, algorithmic valuation models, on-chain signing, Merkle proofs, bespoke UI.

## Interfaces (cut-line)

- **Inputs:** OSS tools produce signals → mapped to receipt proposals.
- **Authority:** Only the ledger can mint approved receipts + close epochs.
- **Outputs:** Publish statement JSON + hashes for third-party verification.

## Migration Path

Start with OSS UX → swap in the ledger as the payout authority → later add multisig signing / Merkle without changing inputs.
