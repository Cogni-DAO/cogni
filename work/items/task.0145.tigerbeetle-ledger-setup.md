---
id: task.0145
type: task
title: "TigerBeetle Infrastructure + FinancialLedgerPort"
status: done
priority: 1
rank: 1
estimate: 3
summary: "Stand up TigerBeetle as the double-entry transaction engine. Create FinancialLedgerPort interface and TigerBeetleAdapter. Wire into existing money-movement paths: credit deposits and AI spend. Postgres keeps metadata; TigerBeetle enforces balanced transfers."
outcome: "TigerBeetle running as a container in dev stack. FinancialLedgerPort wired into creditAccount and recordChargeReceipt. Every credit deposit and AI spend has a corresponding double-entry transfer. Account balances queryable from TigerBeetle."
spec_refs: financial-ledger-spec, billing-evolution-spec
assignees: derekg1729
credit:
project: proj.financial-ledger
branch: task/0145-tigerbeetle-v2
pr: https://github.com/Cogni-DAO/node-template/pull/559
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-24
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

- Create: `packages/financial-ledger/` — new `@cogni/financial-ledger` capability package. Follow [New Package Checklist](../../docs/guides/new-packages.md) and [Capability Package Shape](../../docs/spec/packages-architecture.md#capability-package-shape).
  - `src/port/` — FinancialLedgerPort interface + domain error types
  - `src/domain/` — Account ID constants, ledger ID mappings, clearing account IDs, USDC-to-credit conversion
  - `src/adapters/tigerbeetle.adapter.ts` — TigerBeetle implementation (takes client as constructor arg, no env loading)
  - `src/index.ts` — barrel export (port + domain only; adapter via subpath `@cogni/financial-ledger/adapters` to avoid pulling N-API into all importers)
  - `tests/` — account mapping, conversion math, adapter integration tests
- Modify: `src/bootstrap/container.ts` — lazy `require("@cogni/financial-ledger/adapters")`, create TB client, pass to adapter constructor
- Modify: `src/adapters/server/accounts/drizzle.adapter.ts` — Co-write to FinancialLedgerPort in creditAccount/recordChargeReceipt
- Modify: `platform/infra/services/runtime/docker-compose.dev.yml` — Add TigerBeetle container

### N-API Bundler Handling

`tigerbeetle-node` is a native N-API addon. Same issue as `dockerode` (ssh2→cpu-features) and `@privy-io/node` — breaks Turbopack bundling. The adapter lives in the package at `src/adapters/` but is exported via a **subpath** (`@cogni/financial-ledger/adapters`) so importing the main barrel (`@cogni/financial-ledger`) does NOT pull in the native addon. `container.ts` uses lazy `require("@cogni/financial-ledger/adapters")` — same pattern as Privy (`container.ts:407-412`).

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
- **R5**: `creditAccount()` for deposits co-writes a TigerBeetle transfer (Equity:CreditIssuance → Liability:UserCredits on CREDIT ledger) alongside existing Postgres writes. Non-blocking.
- **R6**: `recordChargeReceipt()` co-writes a TigerBeetle transfer (Liability:UserCredits → Revenue:AIUsage) alongside existing Postgres writes. Non-blocking.
- **R7**: `user_data_128` on TigerBeetle transfers links back to Postgres `credit_ledger.id` or `charge_receipts.id` for metadata joins
- **R8**: Integration tests against real TigerBeetle in Docker (same pattern as drizzle adapter int tests against real Postgres). No fake adapter — mock the port at call sites for unit tests.
- **R9**: FinancialLedgerPort failure is non-blocking for all paths in Crawl (log critical, don't throw to user) — matches POST_CALL_NEVER_BLOCKS

## Allowed Changes

- `packages/financial-ledger/` — new `@cogni/financial-ledger` capability package (port + domain + adapter)
- `src/bootstrap/container.ts` — wire FinancialLedgerPort
- `src/adapters/server/accounts/drizzle.adapter.ts` — co-write integration
- `platform/infra/services/runtime/` — docker-compose TigerBeetle service
- `package.json` (root) — add `@cogni/financial-ledger` workspace dependency
- `src/shared/env/server-env.ts` — add `TIGERBEETLE_ADDRESS` env var
- Root config files per [New Package Checklist](../../docs/guides/new-packages.md) — tsconfig.json, biome/base.json

## Plan

### Step 1: TigerBeetle Container

- [ ] Add TigerBeetle to `docker-compose.dev.yml` — `ghcr.io/tigerbeetle/tigerbeetle`, `IPC_LOCK` capability, named data volume, format-on-first-boot entrypoint (`tigerbeetle format` if data file doesn't exist), healthcheck
- [ ] Add `TIGERBEETLE_ADDRESS` to `server-env.ts` (optional, default `3000` for dev)

### Step 2: `@cogni/financial-ledger` Package

- [ ] Create `packages/financial-ledger/` per [New Package Checklist](../../docs/guides/new-packages.md) + [Capability Package Shape](../../docs/spec/packages-architecture.md#capability-package-shape)
- [ ] `src/port/` — FinancialLedgerPort interface: `transfer`, `linkedTransfers`, `lookupAccounts`, `getAccountBalance`
- [ ] `src/domain/` — ledger ID constants (USDC=2, CREDIT=200, COGNI=100, EUR=3), well-known account ID mappings, clearing account IDs, USDC-to-credit conversion (`credits = micro_usdc * 10`)
- [ ] `src/adapters/tigerbeetle.adapter.ts` — implements FinancialLedgerPort, takes TB client as constructor arg, idempotent account creation on init. Handle `exists_with_different_fields` explicitly (log error + fail startup).
- [ ] `src/index.ts` — barrel (port + domain). Adapter via subpath export to isolate N-API.
- [ ] `tigerbeetle-node` as package dependency (not root)
- [ ] `tests/` — account ID mappings, conversion math

### Step 3: Wiring

- [ ] Wire in `src/bootstrap/container.ts` — lazy `require("@cogni/financial-ledger/adapters")`, optional (undefined when `TIGERBEETLE_ADDRESS` not set), add `financialLedger: FinancialLedgerPort | undefined` to Container interface

### Step 4: Credit Deposit Co-Write

- [x] Modify `DrizzleAccountService.creditAccount()` to call `financialLedgerPort.transfer()` for deposit reason
- [x] Transfer: Equity:CreditIssuance → Liability:UserCredits on CREDIT ledger (MVP 5-account model, no clearing accounts)
- [ ] Set `user_data_128` = credit_ledger entry UUID for metadata linkage
- [ ] Non-blocking: wrap in try/catch, log critical on failure, continue

### Step 5: AI Spend Co-Write

- [ ] Modify `DrizzleAccountService.recordChargeReceipt()` to call `financialLedgerPort.transfer()` after Postgres write
- [ ] Transfer: debit Liability:UserCredits:CREDIT, credit Revenue:AIUsage:CREDIT, amount = chargedCredits
- [ ] Set `user_data_128` = charge_receipt UUID for metadata linkage
- [ ] Non-blocking: wrap in try/catch, log critical on failure, never throw to caller (POST_CALL_NEVER_BLOCKS)

### Step 6: Integration Tests

- [x] Create `apps/operator/tests/stack/payments/tigerbeetle-adapter.stack.test.ts` — stack integration tests against real TigerBeetle: single-ledger transfer, linked transfers, idempotent account creation, account balance queries

## Out of Scope (separate tasks)

- **Two-phase transfers** (pending/post/void) — `task.0147` (x402, epoch accruals, operator top-ups)
- **Operator wallet outflows** — wired during proj.ai-operator-wallet implementation, calls FinancialLedgerPort from day one
- **Cherry Servers expense polling** — new external API client + Temporal activity + dedup. Different concern.
- **Attribution epoch accruals** — pending transfer on epoch finalization. Wired when settlement pipeline is built.
- **On-chain claim settlement** — post transfer on MerkleDistributor claim. Walk phase.
- **Reconciliation cron** — TigerBeetle vs Postgres balance comparison + alerting. After co-writes are stable.

## Validation

**Package tests (unit + integration):**

```bash
pnpm test packages/financial-ledger/tests/
```

**Expected:** Account mapping, conversion math, TigerBeetle adapter creates accounts, executes transfers.

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
- [ ] **N-API:** Adapter via subpath export, lazy require in container.ts
- [ ] **Non-blocking:** All co-writes fire-and-forget, log critical on failure

## Review Feedback

### Revision 1 (2026-03-12)

**Blocking:**

1. **R5 requirement text stale after MVP simplification.** R5 says "co-writes linked TigerBeetle transfers (USDC → clearing → CREDIT)" but code does single-ledger `EQUITY_CREDIT_ISSUANCE → LIABILITY_USER_CREDITS` on CREDIT ledger only. The 5-account MVP dropped clearing accounts. **Fix:** Update R5 text to match MVP: "creditAccount() for deposits co-writes a TigerBeetle transfer (Equity:CreditIssuance → Liability:UserCredits on CREDIT ledger)."

2. **R8: No integration tests against real TigerBeetle.** Task plan step 6 requires `tigerbeetle.adapter.int.test.ts`. Domain tests exist, but adapter behavior (account creation, transfers, idempotency, linked transfers) is untested. **Fix:** Write integration tests or explicitly defer to a follow-up task.

**Suggestions (non-blocking):**

- `LINKED_FLAG = 1` magic number in `tigerbeetle.adapter.ts:174` — consider importing `TransferFlags` from `tigerbeetle-node` if available.
- `AccountBalance` TSDoc (`financial-ledger.port.ts:54`) describes only one field but interface has four.

## PR / Links

-

## Attribution

-
