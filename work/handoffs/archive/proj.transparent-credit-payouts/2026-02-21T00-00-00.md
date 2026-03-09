---
id: proj.transparent-credit-payouts
type: handoff
work_item_id: proj.transparent-credit-payouts
status: active
created: 2026-02-20
updated: 2026-02-20
branch: feat/ledger-v0
last_commit: 04554bce
---

# Handoff: Epoch Ledger — Auditable Decision Ledger for Credit Payouts

## Context

- CogniDAO needs transparent, verifiable credit payouts to replace SourceCred's opaque grain scoring
- The system is a **decision ledger for human judgment** — receipts record who approved what, under which policy, with wallet-signed EIP-191 signatures
- Epoch close computes deterministic payouts from approved receipts + pre-recorded pool components — anyone can recompute and verify
- Design complete, design-reviewed, and decomposed into 4 implementation tasks (task.0093–task.0096)
- No implementation code exists yet — branch has design docs only

## Current State

- **Design complete**: [spec](../../docs/spec/epoch-ledger.md) (17 invariants, 6 tables, 9 routes, 5 workflows), [project](../projects/proj.transparent-credit-payouts.md), [fork-vs-build guide](../../docs/guides/ledger-fork-vs-build.md)
- **Design-reviewed**: 3 security fixes applied (issuer role separation, signature domain binding, pool component trust), content boundary cleanup, `user_id` aligned as canonical column
- **Tasks created**: 4 tasks in dependency chain, all `needs_implement`
- **No implementation commits** on `feat/ledger-v0`

## Decisions Made

- **Issuer role separation** — `can_issue` / `can_approve` / `can_close_epoch` flags ([spec: Auth Model](../../docs/spec/epoch-ledger.md#auth-model))
- **Domain-bound signatures** — EIP-191 message includes `chain_id`, `app_domain`, `spec_version` ([spec: Receipt Signing](../../docs/spec/epoch-ledger.md#receipt-signing))
- **Pool pre-recorded** — components recorded during epoch; close reads by reference, never creates budget ([spec: Pool Model](../../docs/spec/epoch-ledger.md#pool-model))
- **Receipts immutable** — no status column; lifecycle via append-only `receipt_events` ([spec: Receipt Lifecycle](../../docs/spec/epoch-ledger.md#receipt-lifecycle))
- **All writes via Temporal** — Next.js returns 202, `scheduler-worker` executes ([spec: Temporal Workflows](../../docs/spec/epoch-ledger.md#temporal-workflows))
- **No server keys** — issuers sign client-side, server verifies via `viem`
- **Fork OSS for signals/UX, build the authority spine** — [guide](../../docs/guides/ledger-fork-vs-build.md)

## Next Actions

Implementation is decomposed into 4 sequential PRs:

- [ ] **task.0093** — DB schema (6 Drizzle tables + append-only triggers) + core domain (payout math, signing, errors) + unit tests
- [ ] **task.0094** — `LedgerStore` port + Drizzle adapter + container wiring + contract tests (blocked by task.0093)
- [ ] **task.0095** — 5 Temporal workflows + activity functions in scheduler-worker (blocked by task.0094)
- [ ] **task.0096** — 9 Zod contracts + 9 API routes + stack tests proving full pipeline (blocked by task.0095)

Each task file has detailed requirements, allowed changes, plan, and validation commands.

## Risks / Gotchas

- Append-only DB triggers require **custom SQL migration** — not expressible in Drizzle schema DSL
- Temporal workflow IDs must be **deterministic** for idempotency (e.g. `ledger-receipt-{idempotencyKey}`)
- `scheduler-worker` uses `@cogni/db-client` for DB access — ledger activities must follow the same `createActivities(deps)` pattern
- `CloseEpochWorkflow` must verify `POOL_REQUIRES_BASE` before computing — at least one `base_issuance` component
- `ledger_issuers` table must be seeded with an admin wallet before any writes work

## Pointers

| File / Resource                                                     | Why it matters                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `docs/spec/epoch-ledger.md`                                         | V0 spec: 17 invariants, 6 tables, 9 routes, 5 workflows        |
| `work/projects/proj.transparent-credit-payouts.md`                  | Roadmap, constraints, definition of done                       |
| `work/items/task.0093.ledger-schema-domain.md`                      | First task — start here                                        |
| `docs/guides/ledger-fork-vs-build.md`                               | What to build vs reuse from OSS                                |
| `docs/spec/decentralized-identity.md`                               | `user_id` (UUID) is canonical for all attribution              |
| `packages/db-schema/src/billing.ts`                                 | Pattern: BIGINT, `.enableRLS()`, idempotency indexes           |
| `services/scheduler-worker/src/workflows/scheduled-run.workflow.ts` | Temporal workflow pattern to replicate                         |
| `services/scheduler-worker/src/activities/index.ts`                 | Activity DI pattern: `createActivities(deps)`                  |
| `src/core/payments/`                                                | Domain model pattern: model.ts, rules.ts, errors.ts, public.ts |
