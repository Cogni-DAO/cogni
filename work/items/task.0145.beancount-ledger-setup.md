---
id: task.0145
type: task
title: "TigerBeetle Financial Ledger + LedgerPort Integration"
status: needs_implement
priority: 1
rank: 1
estimate: 3
summary: "Stand up TigerBeetle as the double-entry transaction engine. Create LedgerPort interface and TigerBeetleAdapter. Wire into existing money-movement paths: credit deposits (USDC payments), AI spend (charge_receipts), and operator wallet outflows. Postgres keeps metadata; TigerBeetle enforces balanced transfers."
outcome: "TigerBeetle running as a container in dev stack. LedgerPort wired into creditAccount, recordChargeReceipt, and operator wallet flows. Every credit deposit and AI spend has a corresponding double-entry transfer. Account balances queryable from TigerBeetle."
spec_refs: financial-ledger-spec, billing-evolution-spec
assignees: derekg1729
credit:
project: proj.financial-ledger
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-09
labels: [treasury, accounting, governance]
external_refs:
---

# TigerBeetle Financial Ledger + LedgerPort Integration

## Design

### Outcome

Every money-movement operation in the system has a corresponding double-entry transfer in TigerBeetle, enforced at the database level. The system can answer "what's our burn rate?" and "what are our balances?" from a single authoritative source.

### Approach

**Solution**: TigerBeetle as the transaction engine (Apache 2.0, 14k stars, Jepsen-verified, native TypeScript client via N-API). `LedgerPort` interface in hex architecture. Co-write pattern: existing Postgres operations continue unchanged, TigerBeetle transfer recorded alongside.

**Reuses**: Existing hex port/adapter pattern (`AccountService`, `DrizzleAccountService`). Existing Docker Compose dev stack. Existing `charge_receipts` and `credit_ledger` as Postgres metadata. `tigerbeetle-node` npm package for TypeScript client.

**Rejected alternatives**:

- **Beancount**: Python dependency, file-based, can't participate in Postgres transactions, requires subprocess for validation. Wrong runtime model for a TypeScript app.
- **Postgres-only double-entry**: Would work but reinvents what TigerBeetle does structurally — balanced transfers, overdraft protection, two-phase commits. Why build when battle-tested OSS exists?
- **Formance Ledger**: Good but adds a Go microservice + REST overhead. TigerBeetle's N-API client is zero-serialization.
- **Medici**: Requires MongoDB. We're Postgres.
- **Fake ledger adapter**: Reimplements balanced transfers and two-phase commits in a Map — the exact bespoke accounting code we chose TigerBeetle to avoid. Tests against the real engine in Docker (fast, local, deterministic) — same pattern as `drizzle-payment-attempt.adapter.int.test.ts` against real Postgres. Mock the port at call sites for unit tests.

### Invariants

- [ ] DOUBLE_ENTRY_CANONICAL: Every transfer in TigerBeetle is balanced (enforced by engine)
- [ ] LEDGER_PORT_IS_WRITE_PATH: All money-movement goes through LedgerPort (spec: financial-ledger-spec)
- [ ] POSTGRES_IS_METADATA: TigerBeetle for balances/transfers, Postgres for explanations/refs (spec: financial-ledger-spec)
- [ ] ALL_MATH_BIGINT: TigerBeetle uses u128 natively (spec: financial-ledger-spec)
- [ ] IDEMPOTENT_CHARGE_RECEIPTS: Existing idempotency via source_system/source_reference unchanged (spec: billing-evolution-spec)
- [ ] POST_CALL_NEVER_BLOCKS: LedgerPort write failure logged but does not block user response (spec: billing-evolution-spec)
- [ ] SIMPLE_SOLUTION: Leverages TigerBeetle OSS over bespoke accounting code
- [ ] ARCHITECTURE_ALIGNMENT: Follows hex port/adapter pattern (spec: architecture)

### Files

- Create: `src/ports/ledger.port.ts` — LedgerPort interface
- Create: `src/adapters/server/ledger/tigerbeetle.adapter.ts` — TigerBeetle implementation
- Create: `src/core/ledger/accounts.ts` — Account ID constants, ledger ID mappings, clearing account for cross-ledger
- Modify: `src/bootstrap/container.ts` — Wire TigerBeetleAdapter
- Modify: `src/adapters/server/accounts/drizzle.adapter.ts` — Co-write to LedgerPort in creditAccount/recordChargeReceipt
- Modify: `infra/services/runtime/docker-compose.yml` — Add TigerBeetle container
- Create: `tests/component/ledger/tigerbeetle.adapter.int.test.ts` — Integration tests against real TigerBeetle
- Create: `tests/unit/core/ledger/accounts.test.ts` — Account mapping tests

### Cross-Ledger Transfer Design (USDC -> CREDIT)

TigerBeetle transfers operate within a single ledger. A USDC deposit that mints credits requires **two linked transfers** executed atomically:

```
Transfer 1 (ledger 2 / USDC, scale=6):
  debit:  Assets:OnChain:USDC
  credit: Clearing:USDCtoCredit:USDC
  amount: deposit_amount_micro_usdc

Transfer 2 (ledger 200 / CREDIT, scale=0):
  debit:  Clearing:USDCtoCredit:CREDIT
  credit: Liability:UserCredits:CREDIT
  amount: deposit_amount_micro_usdc * CREDITS_PER_USD / 1_000_000
```

Both transfers use TigerBeetle's `linked` flag — if either fails, both fail. The clearing accounts (`Clearing:USDCtoCredit:USDC` and `Clearing:USDCtoCredit:CREDIT`) exist solely to bridge ledgers. Their balances should net to zero over time (reconciliation check).

The conversion ratio uses the existing protocol constant: `CREDITS_PER_USD = 10_000_000`. Since USDC scale=6 (micro-USDC), the math is: `credits = micro_usdc * 10` (integer, no floats).

## Requirements

- **R1**: TigerBeetle running as a container in `docker-compose.yml` (dev + test stacks)
- **R2**: `LedgerPort` interface with `transfer`, `linkedTransfers`, `pendingTransfer`, `postTransfer`, `voidTransfer`, `lookupAccounts`, `getAccountBalance`
- **R3**: `TigerBeetleAdapter` implementing LedgerPort via `tigerbeetle-node`
- **R4**: Accounts hierarchy created on startup (idempotent — handle "already exists with same params" on container restart). One TigerBeetle account per logical account with correct ledger IDs per asset type.
- **R5**: `creditAccount()` for deposits co-writes linked TigerBeetle transfers (USDC -> clearing -> CREDIT) alongside existing Postgres writes
- **R6**: `recordChargeReceipt()` co-writes a TigerBeetle transfer (Liability:UserCredits -> Revenue:AIUsage) alongside existing Postgres writes
- **R7**: `user_data_128` on TigerBeetle transfers links back to Postgres `credit_ledger.id` or `charge_receipts.id` for metadata joins
- **R8**: Integration tests against real TigerBeetle in Docker (same pattern as drizzle adapter int tests against real Postgres). No fake adapter — mock the port at call sites for unit tests.
- **R9**: LedgerPort failure is non-blocking for AI responses (log critical, don't throw to user) — matches POST_CALL_NEVER_BLOCKS
- **R10**: Operator wallet outflows (Splits distribution, OpenRouter top-up) call LedgerPort from day one — wire during proj.ai-operator-wallet implementation, not as a backfill

## Allowed Changes

- `src/ports/` — new `ledger.port.ts`
- `src/adapters/server/ledger/` — new TigerBeetle adapter
- `src/core/ledger/` — account constants, ledger ID mappings, clearing account definitions
- `src/bootstrap/container.ts` — wire LedgerPort
- `src/adapters/server/accounts/drizzle.adapter.ts` — co-write integration
- `infra/services/runtime/` — docker-compose TigerBeetle service
- `tests/component/ledger/` — integration tests against real TigerBeetle
- `tests/unit/core/ledger/` — unit tests
- `package.json` — add `tigerbeetle-node` dependency

## Plan

### Phase 1: TigerBeetle Infrastructure + LedgerPort

- [ ] Add TigerBeetle to `docker-compose.yml` (dev + test) — `ghcr.io/tigerbeetle/tigerbeetle`, `IPC_LOCK` capability, data volume
- [ ] Add `tigerbeetle-node` to package.json dependencies
- [ ] Create `src/core/ledger/accounts.ts` — ledger ID constants (USDC=2, CREDIT=200, COGNI=100, EUR=3), well-known account ID mappings, clearing account IDs for cross-ledger bridges
- [ ] Create `src/ports/ledger.port.ts` — LedgerPort interface
- [ ] Create `src/adapters/server/ledger/tigerbeetle.adapter.ts` — implements LedgerPort, idempotent account creation on init
- [ ] Wire in `src/bootstrap/container.ts`
- [ ] Create `tests/component/ledger/tigerbeetle.adapter.int.test.ts` — integration tests against real TigerBeetle in Docker: single-ledger transfer, linked cross-ledger transfer, pending/post/void, idempotent account creation on restart
- [ ] Create `tests/unit/core/ledger/accounts.test.ts` — account ID mappings, USDC-to-credit conversion math

### Phase 2: Credit Deposit Co-Write (simplest path, proves the pattern)

- [ ] Modify `DrizzleAccountService.creditAccount()` to call `ledgerPort.linkedTransfers()` for deposit reason
- [ ] Linked transfers: Assets:OnChain:USDC -> Clearing:USDCtoCredit -> Liability:UserCredits:CREDIT (see cross-ledger design above)
- [ ] Conversion: `credits = micro_usdc * 10` (integer math, CREDITS_PER_USD / USDC_SCALE)
- [ ] Set `user_data_128` = credit_ledger entry UUID for metadata linkage
- [ ] Integration test: creditAccount -> verify both TigerBeetle transfers exist, balances correct, clearing accounts net to zero

### Phase 3: AI Spend Co-Write (hot path, non-blocking)

- [ ] Modify `DrizzleAccountService.recordChargeReceipt()` to call `ledgerPort.transfer()` after Postgres write
- [ ] Transfer: debit Liability:UserCredits:CREDIT, credit Revenue:AIUsage:CREDIT, amount = chargedCredits
- [ ] Set `user_data_128` = charge_receipt UUID for metadata linkage
- [ ] Non-blocking: wrap in try/catch, log critical on failure, never throw to caller (POST_CALL_NEVER_BLOCKS)
- [ ] Integration test: recordChargeReceipt -> verify TigerBeetle transfer exists + balances correct

### Phase 4: Operator Wallet Outflows (wire from day one)

- [ ] When operator wallet Splits distribution is confirmed, call `ledgerPort.transfer()`: debit Assets:Treasury:USDC, credit Assets:OperatorFloat:USDC
- [ ] When OpenRouter top-up tx is confirmed, call `ledgerPort.transfer()`: debit Assets:OperatorFloat:USDC, credit Expense:AI:OpenRouter:USDC
- [ ] Both wired during proj.ai-operator-wallet implementation — this phase is a coordination note, not a backfill
- [ ] Integration test: operator wallet lifecycle -> verify TigerBeetle balances reflect treasury -> float -> expense flow

## Out of Scope (separate tasks)

- **Cherry Servers expense polling** — new external API client + Temporal activity + dedup. Different concern, separate PR.
- **Attribution epoch accruals** — pending transfer on epoch finalization. Wired when settlement pipeline is built.
- **On-chain claim settlement** — post transfer on MerkleDistributor claim. Walk phase.
- **Reconciliation cron** — TigerBeetle vs Postgres balance comparison + alerting. After co-writes are stable.

## Validation

**Integration tests (requires dev stack with TigerBeetle):**

```bash
pnpm dotenv -e .env.test -- vitest run --config vitest.component.config.mts tests/component/ledger/
```

**Expected:** TigerBeetle adapter creates accounts, executes single-ledger and cross-ledger transfers, handles pending/post/void.

**Stack tests (requires full stack):**

```bash
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ledger/
```

**Expected:** creditAccount -> TigerBeetle linked transfers, recordChargeReceipt -> TigerBeetle transfer, balances match Postgres state.

**Unit tests:**

```bash
pnpm test tests/unit/core/ledger/
```

**Expected:** Account mapping, ledger ID constants, USDC-to-credit conversion verified.

**Lint/type:**

```bash
pnpm check
```

**Expected:** Clean.

## Review Checklist

- [ ] **Work Item:** `task.0145` linked in PR body
- [ ] **Spec:** DOUBLE_ENTRY_CANONICAL, LEDGER_PORT_IS_WRITE_PATH, POSTGRES_IS_METADATA, POST_CALL_NEVER_BLOCKS invariants upheld
- [ ] **Tests:** integration tests against real TigerBeetle for each co-write path
- [ ] **Cross-ledger:** clearing accounts net to zero after deposit + spend cycle
- [ ] **Reviewer:** assigned and approved
- [ ] **TigerBeetle balances**: match expected state after test scenarios

## PR / Links

-

## Attribution

-
