---
id: task.0146
type: task
title: Extract payments application orchestration + billing ports into packages
status: needs_design
priority: 3
estimate: 3
summary: Extract the payments application layer (confirmCreditsPurchase orchestrator), TreasurySettlementPort, and billing ports (AccountService, ServiceAccountService) from src/ into standalone packages.
outcome: Payments application orchestration lives in a package independent of the Next.js app. Billing ports and treasury settlement port are package-level, enabling reuse by scheduler-worker and other services.
spec_refs: operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
created: 2026-03-09
updated: 2026-03-09
labels: [wallet, billing, architecture]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 80
---

# Extract payments application orchestration + billing ports into packages

> Follow-up from task.0085 checkpoint 3. The treasury settlement wiring is app-local today; this task extracts it (and its billing dependencies) to packages.

## Context

Task.0085 introduced:

- `src/ports/treasury-settlement.port.ts` — semantic settlement port
- `src/features/payments/application/confirmCreditsPurchase.ts` — application orchestrator
- `src/adapters/server/treasury/split-treasury-settlement.adapter.ts` — adapter

These are app-local (`src/`) because the orchestrator depends on billing ports (`AccountService`, `ServiceAccountService`) which are also app-local. Extracting the orchestrator to a package requires extracting the billing ports too.

## Requirements

- Extract `TreasurySettlementPort` to a package (e.g., `packages/treasury-settlement`)
- Extract `AccountService` and `ServiceAccountService` port interfaces to a package (e.g., `packages/billing-ports`)
- Extract `confirmCreditsPurchase` orchestrator to a package (e.g., `packages/payments-application`)
- App (`src/`) re-exports from packages (thin wrappers)
- No behavioral changes — pure extraction

## Why

- Payments orchestration should be independent of the Next.js app
- Scheduler-worker and other services may need to trigger the same flows
- Clean package boundaries per `docs/spec/packages-architecture.md`

## Plan

- [ ] Assess billing port dependencies (what else imports AccountService, ServiceAccountService)
- [ ] Create packages with port interfaces + orchestrator
- [ ] Update `src/` to re-export from packages
- [ ] Update dep-cruiser rules if needed
- [ ] `pnpm check` passes

## Validation

```bash
pnpm check
pnpm test tests/unit/features/payments/
```
