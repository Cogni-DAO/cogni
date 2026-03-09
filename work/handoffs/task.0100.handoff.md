---
id: task.0100.handoff
type: handoff
work_item_id: task.0100
status: active
created: 2026-02-23
updated: 2026-02-23
branch: feat/task-0100-epoch-state-machine
last_commit: 7ec85db8
---

# Handoff: Epoch 3-Phase State Machine + Approvers + Canonical Signing

## Context

- Epochs gain the `open -> review -> finalized` lifecycle (was `open -> closed`)
- Curation stays mutable during `review`, freezes only at `finalized` (DB trigger)
- Approver set is pinned (SHA-256 hash) on the epoch row at the `open -> review` transition
- `buildCanonicalMessage()` + `computeApproverSetHash()` are pure functions in `ledger-core` for EIP-191 signing
- This unblocks task.0102 (allocation computation + FinalizeEpochWorkflow) and the finalize API route

## Current State

- **Checkpoint 1 (Schema + Model + Port)**: DONE. 3-phase CHECK constraint, `approverSetHash` column, migrations edited in place, store port updated
- **Checkpoint 2 (Adapter + Signing + Callers)**: DONE. Adapter implements `closeIngestion` + `finalizeEpoch`, all callers updated from `closeEpoch`/`"closed"`, 12 signing unit tests pass
- **Checkpoint 3 (API Route + Contract)**: DONE. `POST /api/v1/attribution/epochs/{id}/review` — SIWE + approver-gated, pins approverSetHash
- **3 commits on branch**, all pass `pnpm check`
- **Blocker 1 fix (wrong-state guard)**: Code is written but UNCOMMITTED — adapter now throws `EpochNotOpenError` instead of silently returning on wrong-state calls. Needs format fix + commit.
- **Blocker 2 (spec says ONE_ACTIVE_EPOCH, code uses ONE_OPEN_EPOCH)**: Spec change needed — `WHERE status = 'open'` is the correct design (allows review + open to coexist, avoids deadlocking Temporal). Spec file `docs/spec/attribution-ledger.md` has uncommitted edits but they are broader reformatting — only the ONE_ACTIVE_EPOCH -> ONE_OPEN_EPOCH rename matters.
- **Blocker 3 (spec says INGESTION_CLOSED_ON_REVIEW is a DB trigger)**: Spec is wrong. No such trigger exists or is planned — `activity_events` has no `epoch_id` column, making a trigger impractical. App-level enforcement (workflow skips when `status != 'open'`) is the design. Spec must say "app-level".

## Decisions Made

- Route path is `/review` (not `/close-ingestion`) — state-machine-aligned, symmetric with future `/finalize`
- Contract is `ledger.review-epoch.v1` reusing `EpochSchema` from `ledger.list-epochs.v1`
- No sign route in V0 — signature passed inline to finalize (task.0102)
- DB index is `WHERE status = 'open'` not `WHERE status != 'finalized'` — see task.0100 work item "Rejected" section #4 and invariant ONE_OPEN_EPOCH

## Next Actions

- [ ] Run `pnpm format` on adapter file, then commit the blocker-1 fix (wrong-state guard in `closeIngestion`/`finalizeEpoch`)
- [ ] Update `docs/spec/attribution-ledger.md`: rename `ONE_ACTIVE_EPOCH` -> `ONE_OPEN_EPOCH`, change constraint description to `WHERE status = 'open'`
- [ ] Update `docs/spec/attribution-ledger.md`: change `INGESTION_CLOSED_ON_REVIEW` description from "DB trigger" to "app-level enforcement"
- [ ] Add component test for `finalizeEpoch` on an `open` epoch (should throw `EpochNotOpenError`)
- [ ] Add component test for `closeIngestion` on a `finalized` epoch (should return idempotently)
- [ ] Add component test for curation mutable during `review` status
- [ ] Update task.0100 work item status to `needs_closeout` and bump revision
- [ ] Create PR via `/closeout`

## Risks / Gotchas

- The `docs/spec/attribution-ledger.md` file has uncommitted broader formatting changes mixed with the needed spec fixes — be selective about what to stage
- `work/items/task.0102...md` also has uncommitted changes (not part of task.0100) — do not stage
- The `approver-guard.ts` template literal fix (line 39) is included in commit 2 — it's a pre-existing lint fix, not a functional change
- `EpochNotOpenError` is reused for the "wrong state" error in `finalizeEpoch` (epoch is `open` when it should be `review`) — the error message says "not open" which is slightly misleading. Consider a more specific error if task.0102 needs to distinguish states.

## Pointers

| File / Resource                                                  | Why it matters                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| `work/items/task.0100.epoch-signing-state-machine.md`            | Full spec, invariants, rejected alternatives            |
| `packages/attribution-ledger/src/signing.ts`                     | `buildCanonicalMessage()` + `computeApproverSetHash()`  |
| `packages/attribution-ledger/src/store.ts`                       | Port interface with `closeIngestion` + `finalizeEpoch`  |
| `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` | Adapter implementation (has uncommitted blocker-1 fix)  |
| `src/app/api/v1/attribution/epochs/[id]/review/route.ts`         | Review route (SIWE + approver-gated)                    |
| `src/contracts/ledger.review-epoch.v1.contract.ts`               | Zod contract                                            |
| `tests/unit/packages/attribution-ledger/signing.test.ts`         | 12 signing unit tests                                   |
| `tests/component/db/drizzle-attribution.adapter.int.test.ts`     | Adapter integration tests (needs new wrong-state tests) |
| `work/items/task.0102.allocation-computation-epoch-close.md`     | Downstream task that depends on this                    |
