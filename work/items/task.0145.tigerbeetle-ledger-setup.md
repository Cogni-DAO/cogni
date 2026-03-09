---
id: task.0145
type: task
title: "TigerBeetle Infrastructure + FinancialLedgerPort"
status: needs_implement
priority: 1
rank: 1
estimate: 3
summary: "Stand up TigerBeetle as the double-entry transaction engine. Create FinancialLedgerPort interface and TigerBeetleAdapter. Wire into existing money-movement paths: credit deposits and AI spend. Postgres keeps metadata; TigerBeetle enforces balanced transfers."
outcome: "TigerBeetle running as a container in dev stack. FinancialLedgerPort wired into creditAccount and recordChargeReceipt. Every credit deposit and AI spend has a corresponding double-entry transfer. Account balances queryable from TigerBeetle."
spec_refs: financial-ledger-spec, billing-evolution-spec
assignees: derekg1729
credit:
project: proj.financial-ledger
branch: task/0145-tigerbeetle-ledger
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

# TigerBeetle Infrastructure + FinancialLedgerPort

## Design

### Outcome

Every credit deposit and AI spend has a corresponding double-entry transfer in TigerBeetle, enforced at the database level. The system can answer "what are our balances?" from a single authoritative source.

### Approach

**Solution**: TigerBeetle as the transaction engine (Apache 2.0, 14k stars, Jepsen-verified, native TypeScript client via N-API). `FinancialLedgerPort` interface in hex architecture. Co-write pattern: existing Postgres operations continue unchanged, TigerBeetle transfer recorded alongside. All co-writes are non-blocking in Crawl — log critical on failure, reconciliation cron catches divergence.

**Reuses**: Existing hex port/adapter pattern (`AccountService`, `DrizzleAccountService`). Existing Docker Compose dev stack. Existing `charge_receipts` and `credit_ledger` as Postgres metadata. `tigerbeetle-node` npm package for TypeScript client.

**Rejected alternatives**:

- **Beancount**: Python dependency, file-based, can't participate in Postgres transactions, requires subprocess for validation. Wrong runtime model for a TypeScript app.
- **Postgres-only double-entry**: Would work but reinvents what TigerBeetle does structurally — balanced transfers, overdraft protection, two-phase commits. Why build when battle-tested OSS exists?
- **Formance Ledger**: Good but adds a Go microservice + REST overhead. TigerBeetle's N-API client is zero-serialization.
- **Medici**: Requires MongoDB. We're Postgres.
- **Fake ledger adapter**: Reimplements balanced transfers in a Map — the exact bespoke accounting code we chose TigerBeetle to avoid. Tests against the real engine in Docker (fast, local, deterministic). Mock the port at call sites for unit tests.

### Invariants

- [ ] DOUBLE_ENTRY_CANONICAL: Every transfer in TigerBeetle is balanced (enforced by engine)
- [ ] LEDGER_PORT_IS_WRITE_PATH: All money-movement goes through FinancialLedgerPort (spec: financial-ledger-spec)
- [ ] POSTGRES_IS_METADATA: TigerBeetle for balances/transfers, Postgres for explanations/refs (spec: financial-ledger-spec)
- [ ] ALL_MATH_BIGINT: TigerBeetle uses u128 natively (spec: financial-ledger-spec)
- [ ] IDEMPOTENT_CHARGE_RECEIPTS: Existing idempotency via source_system/source_reference unchanged (spec: billing-evolution-spec)
- [ ] POST_CALL_NEVER_BLOCKS: FinancialLedgerPort write failure logged but does not block user response (spec: billing-evolution-spec)
- [ ] CO_WRITE_NON_BLOCKING: All TigerBeetle co-writes are fire-and-forget in Crawl — Postgres write is authoritative, TB failure logged critical, reconciliation cron detects divergence
- [ ] SIMPLE_SOLUTION: Leverages TigerBeetle OSS over bespoke accounting code
- [ ] ARCHITECTURE_ALIGNMENT: Follows hex port/adapter pattern (spec: architecture)

### Files

- Create: `packages/financial-ledger/` — new `@cogni/financial-ledger` package (port + domain constants). Follow [New Package Checklist](../../docs/guides/new-packages.md).
  - `src/port.ts` — FinancialLedgerPort interface
  - `src/accounts.ts` — Account ID constants, ledger ID mappings, clearing account IDs, USDC-to-credit conversion
  - `src/index.ts` — barrel export
- Create: `src/adapters/server/ledger/tigerbeetle.adapter.ts` — TigerBeetle implementation (NOT re-exported from barrel — N-API native addon, same pattern as Privy/Sandbox)
- Modify: `src/bootstrap/container.ts` — Wire TigerBeetleAdapter via lazy `require()` (same pattern as PrivyOperatorWalletAdapter)
- Modify: `src/adapters/server/accounts/drizzle.adapter.ts` — Co-write to FinancialLedgerPort in creditAccount/recordChargeReceipt
- Modify: `platform/infra/services/runtime/docker-compose.dev.yml` — Add TigerBeetle container
- Create: `tests/component/ledger/tigerbeetle.adapter.int.test.ts` — Integration tests against real TigerBeetle
- Create: `packages/financial-ledger/tests/accounts.test.ts` — Account mapping + conversion math tests

### N-API Bundler Handling

`tigerbeetle-node` is a native N-API addon. Same issue as `dockerode` (ssh2→cpu-features) and `@privy-io/node` — breaks Turbopack bundling. The adapter MUST NOT be re-exported from `src/adapters/server/index.ts`. Use lazy `require()` in `container.ts` with a comment explaining why. Same pattern as `container.ts:407-412` (Privy).

### Co-Write Failure Semantics (Crawl)

All co-writes are non-blocking. Postgres write is the authoritative path. TigerBeetle write is fire-and-forget:

- `creditAccount()` — Postgres write succeeds → attempt TB linked transfers → on failure, log critical, continue. Deposit succeeds even if TB is down.
- `recordChargeReceipt()` — Postgres write succeeds → attempt TB transfer → on failure, log critical, continue. AI response is never blocked.
- Process crash between writes → reconciliation cron (separate task) detects and alerts on Postgres/TB divergence.

This is explicitly a Crawl limitation. Walk phase adds transactional guarantees.

## Requirements

- **R1**: TigerBeetle running as a container in `docker-compose.dev.yml` with `IPC_LOCK` capability, data volume, format-on-first-boot entrypoint, and healthcheck
- **R2**: `FinancialLedgerPort` interface with `transfer`, `linkedTransfers`, `lookupAccounts`, `getAccountBalance` (Crawl scope — two-phase methods deferred to task.0147)
- **R3**: `TigerBeetleAdapter` implementing FinancialLedgerPort via `tigerbeetle-node`
- **R4**: Accounts hierarchy created on startup (idempotent — handle `exists` and `exists_with_different_fields` explicitly). One TigerBeetle account per logical account with correct ledger IDs per asset type.
- **R5**: `creditAccount()` for deposits co-writes linked TigerBeetle transfers (USDC → clearing → CREDIT) alongside existing Postgres writes. Non-blocking.
- **R6**: `recordChargeReceipt()` co-writes a TigerBeetle transfer (Liability:UserCredits → Revenue:AIUsage) alongside existing Postgres writes. Non-blocking.
- **R7**: `user_data_128` on TigerBeetle transfers links back to Postgres `credit_ledger.id` or `charge_receipts.id` for metadata joins
- **R8**: Integration tests against real TigerBeetle in Docker (same pattern as drizzle adapter int tests against real Postgres). No fake adapter — mock the port at call sites for unit tests.
- **R9**: FinancialLedgerPort failure is non-blocking for all paths in Crawl (log critical, don't throw to user) — matches POST_CALL_NEVER_BLOCKS

## Allowed Changes

- `packages/financial-ledger/` — new `@cogni/financial-ledger` package (port interface + account constants)
- `src/adapters/server/ledger/` — new TigerBeetle adapter (NOT in barrel)
- `src/bootstrap/container.ts` — wire FinancialLedgerPort
- `src/adapters/server/accounts/drizzle.adapter.ts` — co-write integration
- `platform/infra/services/runtime/` — docker-compose TigerBeetle service
- `tests/component/ledger/` — integration tests against real TigerBeetle
- `package.json` — add `tigerbeetle-node` + `@cogni/financial-ledger` dependencies
- `src/shared/env/server-env.ts` — add `TIGERBEETLE_ADDRESS` env var
- Root config files per [New Package Checklist](../../docs/guides/new-packages.md) — tsconfig.json, biome/base.json

## Plan

### Step 1: TigerBeetle Container

- [ ] Add TigerBeetle to `docker-compose.dev.yml` — `ghcr.io/tigerbeetle/tigerbeetle`, `IPC_LOCK` capability, named data volume, format-on-first-boot entrypoint (`tigerbeetle format` if data file doesn't exist), healthcheck
- [ ] Add `TIGERBEETLE_ADDRESS` to `server-env.ts` (optional, default `3000` for dev)

### Step 2: `@cogni/financial-ledger` Package

- [ ] Create `packages/financial-ledger/` per [New Package Checklist](../../docs/guides/new-packages.md)
- [ ] `src/accounts.ts` — ledger ID constants (USDC=2, CREDIT=200, COGNI=100, EUR=3), well-known account ID mappings, clearing account IDs, USDC-to-credit conversion (`credits = micro_usdc * 10`)
- [ ] `src/port.ts` — FinancialLedgerPort interface: `transfer`, `linkedTransfers`, `lookupAccounts`, `getAccountBalance`
- [ ] `tests/accounts.test.ts` — account ID mappings, conversion math

### Step 3: Adapter + Wiring

- [ ] Add `tigerbeetle-node` to package.json dependencies
- [ ] Create `src/adapters/server/ledger/tigerbeetle.adapter.ts` — implements FinancialLedgerPort, idempotent account creation on init. Handle `exists_with_different_fields` explicitly (log error + fail startup).
- [ ] Wire in `src/bootstrap/container.ts` — lazy `require()`, optional (undefined when `TIGERBEETLE_ADDRESS` not set), add `financialLedger: FinancialLedgerPort | undefined` to Container interface
- [ ] Add NOTE comment in `src/adapters/server/index.ts` explaining why TigerBeetleAdapter is not re-exported (N-API native addon)

### Step 4: Credit Deposit Co-Write

- [ ] Modify `DrizzleAccountService.creditAccount()` to call `financialLedgerPort.linkedTransfers()` for deposit reason
- [ ] Linked transfers: Assets:OnChain:USDC → Clearing:USDCtoCredit → Liability:UserCredits:CREDIT (see spec: financial-ledger-spec, Cross-Ledger Transfers section)
- [ ] Conversion: `credits = micro_usdc * 10` (integer math, CREDITS_PER_USD / USDC_SCALE)
- [ ] Set `user_data_128` = credit_ledger entry UUID for metadata linkage
- [ ] Non-blocking: wrap in try/catch, log critical on failure, continue

### Step 5: AI Spend Co-Write

- [ ] Modify `DrizzleAccountService.recordChargeReceipt()` to call `financialLedgerPort.transfer()` after Postgres write
- [ ] Transfer: debit Liability:UserCredits:CREDIT, credit Revenue:AIUsage:CREDIT, amount = chargedCredits
- [ ] Set `user_data_128` = charge_receipt UUID for metadata linkage
- [ ] Non-blocking: wrap in try/catch, log critical on failure, never throw to caller (POST_CALL_NEVER_BLOCKS)

### Step 6: Integration Tests

- [ ] Create `tests/component/ledger/tigerbeetle.adapter.int.test.ts` — integration tests against real TigerBeetle in Docker: single-ledger transfer, linked cross-ledger transfer, idempotent account creation, account balance queries

## Out of Scope (separate tasks)

- **Two-phase transfers** (pending/post/void) — `task.0147` (x402, epoch accruals, operator top-ups)
- **Operator wallet outflows** — wired during proj.ai-operator-wallet implementation, calls FinancialLedgerPort from day one
- **Cherry Servers expense polling** — new external API client + Temporal activity + dedup. Different concern.
- **Attribution epoch accruals** — pending transfer on epoch finalization. Wired when settlement pipeline is built.
- **On-chain claim settlement** — post transfer on MerkleDistributor claim. Walk phase.
- **Reconciliation cron** — TigerBeetle vs Postgres balance comparison + alerting. After co-writes are stable.

## Validation

**Integration tests (requires dev stack with TigerBeetle):**

```bash
pnpm dotenv -e .env.test -- vitest run --config vitest.component.config.mts tests/component/ledger/
```

**Expected:** TigerBeetle adapter creates accounts, executes single-ledger and cross-ledger transfers.

**Package tests:**

```bash
pnpm test packages/financial-ledger/tests/
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
- [ ] **N-API:** TigerBeetleAdapter NOT in server barrel, lazy require in container.ts
- [ ] **Non-blocking:** All co-writes fire-and-forget, log critical on failure

## PR / Links

-

## Attribution

-
