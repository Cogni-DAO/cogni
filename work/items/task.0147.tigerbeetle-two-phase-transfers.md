---
id: task.0147
type: task
title: "FinancialLedgerPort Two-Phase Transfers (x402 + Operator Top-ups)"
status: needs_design
priority: 2
rank: 99
estimate: 2
summary: "Add pendingTransfer/postTransfer/voidTransfer to FinancialLedgerPort. Wire into x402 upto authorization, operator wallet top-ups, and epoch accrual paths. Extends the Crawl foundation from task.0145."
outcome: "FinancialLedgerPort supports two-phase commit pattern. x402 upto creates pending transfer, settlement posts or voids. Operator top-ups use pending→post on tx confirmation."
spec_refs: financial-ledger-spec
assignees:
credit:
project: proj.financial-ledger
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0145
deploy_verified: false
created: 2026-03-09
updated: 2026-03-09
labels: [treasury, accounting, governance]
external_refs:
---

# FinancialLedgerPort Two-Phase Transfers (x402 + Operator Top-ups)

Extends `FinancialLedgerPort` (task.0145) with TigerBeetle's pending → posted/voided pattern for operations that need reservation semantics.

## Requirements

- **R1**: Add `pendingTransfer`, `postTransfer`, `voidTransfer` methods to FinancialLedgerPort
- **R2**: TigerBeetleAdapter implements two-phase methods
- **R3**: x402 `upto` authorization creates pending transfer (reserve max amount), settlement posts with actual cost or voids on cancel
- **R4**: Operator wallet top-up uses pending→post on tx confirmation
- **R5**: Optional epoch accrual as pending transfer on finalization
- **R6**: Integration tests for pending/post/void lifecycle

## Allowed Changes

- `src/ports/financial-ledger.port.ts` — add two-phase methods
- `src/adapters/server/ledger/tigerbeetle.adapter.ts` — implement two-phase methods
- `tests/component/ledger/` — two-phase integration tests

## Plan

- [ ] Design: identify exact call sites for each two-phase path
- [ ] Add methods to port interface
- [ ] Implement in adapter
- [ ] Wire into x402 facilitator (when x402 is built)
- [ ] Wire into operator wallet top-up confirmation
- [ ] Integration tests: pending → post, pending → void, timeout behavior

## Validation

```bash
pnpm dotenv -e .env.test -- vitest run --config vitest.component.config.mts tests/component/ledger/
```

**Expected:** Two-phase transfer lifecycle tests pass.

## Review Checklist

- [ ] **Work Item:** `task.0147` linked in PR body
- [ ] **Spec:** two-phase pattern matches financial-ledger-spec § Two-Phase Transfers
- [ ] **Tests:** pending/post/void lifecycle tested against real TigerBeetle

## PR / Links

-

## Attribution

-
