---
id: story.0081.handoff
type: handoff
work_item_id: story.0081
status: active
created: 2026-02-18
updated: 2026-02-18
branch: fix/docs-n-tweaks
last_commit: cb70eb61
---

# Handoff: Transparent Credit Payouts — story.0081

## Context

- CogniDAO needs verifiable contribution payouts: merged PR → signed WorkReceipt → epoch close computes payouts → signed payout statement anyone can recompute
- This replaces SourceCred's opaque grain scoring with explicit, signed, cryptographically verifiable artifacts
- The project (proj.transparent-credit-payouts) supersedes proj.sourcecred-onchain (now Dropped); SourceCred itself still runs in the stack until P2 migration
- Design spike (spike.0082) is complete — all schema, signing, and architecture decisions are resolved
- V0 is aggressively scoped: 3 tables, 5 API routes, EIP-191 signatures, estimate-based valuation. No Merkle trees, no DID/VC, no automated hooks

## Current State

- **Done**: spike.0082 (research doc + design decisions), project roadmap, story filed, routed to project
- **Not started**: All implementation — no code, no DB migration, no API routes, no tasks decomposed yet
- **story.0081 status**: Backlog (needs `/task` decomposition before implementation)
- **No spec written yet** — project doc has the V0 schema/API contract inline; spec should be created during or before implementation
- **`RECEIPT_ISSUER_PRIVATE_KEY` env var**: Not yet wired — needs addition to `.env.local.example` and `src/shared/env/server.ts`

## Decisions Made

- [Research doc](../docs/research/transparency-log-receipt-design.md) — full options analysis for every design question
- [Project roadmap](../projects/proj.transparent-credit-payouts.md) — V0 schema, API, valuation model, definition of done
- **Signing**: EIP-191 via `viem.signMessage()` (already in deps)
- **Storage**: Postgres append-only (DB trigger), no external log service
- **Valuation**: estimate-based (work_item.estimate 0–5) × role split (author 70%, reviewer 20%, approver 10%)
- **Epoch trigger**: Manual `POST /api/v1/epochs/:id/close` in V0; governance-triggered at P1
- **Idempotency**: `UNIQUE(idempotency_key)` where key = `{work_item_id}:{subject_id}:{role}`
- **proj.sourcecred-onchain**: Dropped, supersession note added

## Next Actions

- [ ] Run `/task` to decompose story.0081 into PR-sized tasks (~3 tasks per project roadmap P0)
- [ ] Create DB migration: `epochs`, `work_receipts`, `payout_statements` tables + append-only trigger
- [ ] Implement core domain: receipt hashing (SHA-256), EIP-191 signing/verification via viem
- [ ] Wire `RECEIPT_ISSUER_PRIVATE_KEY` env var (Zod validation in `server-env.ts`)
- [ ] Implement 5 API routes (see project V0 API table)
- [ ] Create `config/payout-rules.yaml` with category weights + role splits
- [ ] Implement deterministic distribution engine (BIGINT math, largest-remainder rounding)
- [ ] Write spec `docs/spec/work-receipts.md` when code lands

## Risks / Gotchas

- **Biggest risk**: If issuance is not constrained (who can issue, what qualifies), you recreate SourceCred-style opacity with different plumbing. The choke-point is `POST /api/v1/receipts` — must be admin-only
- **BIGINT scaling**: `units` stores post-split values scaled to avoid decimals (e.g., estimate=5, author=70% → units=3500 at 1000x scale). Pick a scale factor and document it in the rules config
- **UUID ordering**: Research doc flagged that `gen_random_uuid()` is not strictly monotonic. For deterministic receipt ordering in payout computation, consider adding a `seq BIGSERIAL` column or always `ORDER BY created_at, id`
- **Rule version**: `rules_version` = git SHA of payout-rules.yaml. Must be captured at receipt issuance AND validated at epoch close (all receipts in epoch must match)
- **SourceCred coexistence**: SourceCred continues running in parallel. No migration needed for V0 — they're independent systems

## Pointers

| File / Resource                                               | Why it matters                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `work/projects/proj.transparent-credit-payouts.md`            | V0 schema, API contract, valuation model, definition of done     |
| `docs/research/transparency-log-receipt-design.md`            | Full options analysis + deferred designs for P1/P2               |
| `work/items/story.0081.work-receipts-transparency-payouts.md` | Parent story (needs task decomposition)                          |
| `work/items/spike.0082.transparency-log-design.md`            | Completed design spike                                           |
| `packages/db-schema/src/billing.ts`                           | Existing `charge_receipts` + `credit_ledger` patterns to mirror  |
| `src/features/governance/services/`                           | Governance feature service pattern (DI via ports, no DB imports) |
| `src/ports/governance-status.port.ts`                         | Port naming convention template                                  |
| `platform/infra/services/sourcecred/instance/config/`         | Current SourceCred config (weights, grain policies)              |
| `docs/spec/sourcecred.md`                                     | SourceCred as-built spec (remains valid during transition)       |
