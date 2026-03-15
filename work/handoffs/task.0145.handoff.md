---
id: task.0145.handoff
type: handoff
work_item_id: task.0145
status: active
created: 2026-03-09
updated: 2026-03-09
branch: task/0145-tigerbeetle-ledger
last_commit: 825c2cbe
---

# Handoff: TigerBeetle Infrastructure + FinancialLedgerPort

## Context

- **What**: Stand up TigerBeetle as a double-entry transaction engine alongside existing Postgres billing. Create `@cogni/financial-ledger` capability package with `FinancialLedgerPort` interface + `TigerBeetleAdapter`. Wire co-writes into `creditAccount()` and `recordChargeReceipt()`.
- **Why**: Every credit deposit and AI spend needs a corresponding double-entry transfer enforced at the database level. TigerBeetle (Apache 2.0, Jepsen-verified) does this structurally — balanced transfers, overdraft protection — instead of bespoke accounting code.
- **Parent**: `proj.financial-ledger` (Crawl P0 deliverable)
- **Specs**: [financial-ledger-spec](../../docs/spec/financial-ledger.md), [billing-evolution-spec](../../docs/spec/billing-evolution.md)
- **Follow-up**: `task.0147` (two-phase transfers for x402/operator top-ups) is at `needs_design`, blocked by this task.

## Current State

- **Package scaffold complete**: `packages/financial-ledger/` created with port interface, domain constants, TigerBeetleAdapter, barrel + subpath exports. Builds and validates (`pnpm packages:build` passes, 15/15 packages).
- **Unit tests pass**: 13 domain tests (conversion math, account mappings, UUID-to-bigint). Run: `npx vitest run packages/financial-ledger/tests/domain.test.ts`
- **Docker compose updated**: TigerBeetle service + format-on-first-boot init container added. Volume `tigerbeetle_data` added.
- **App wiring started**: `container.ts` has lazy require + `financialLedger` on Container interface. `drizzle.adapter.ts` has co-write calls in both `recordChargeReceipt()` and `creditAccount()` (both User and Service variants).
- **Typecheck passes**: `pnpm typecheck` clean.
- **NOT committed**: All implementation changes (8 modified files + new package) are unstaged. Only the design docs are committed (2 commits on branch).
- **NOT validated**: `pnpm check` has not been run on the full implementation. Integration tests not yet written.
- **NOT tested end-to-end**: Co-writes untested (require running TigerBeetle + Postgres).

## Decisions Made

- **FinancialLedgerPort** (not LedgerPort) — avoids confusion with AttributionLedger. See [design review commit `61034592`](../../docs/spec/financial-ledger.md).
- **Capability Package Shape** — port + domain + adapter all in one package per [packages-architecture spec](../../docs/spec/packages-architecture.md#capability-package-shape). Adapter via subpath export `@cogni/financial-ledger/adapters` (N-API isolation).
- **Co-write non-blocking** — Postgres write is authoritative. TigerBeetle writes are fire-and-forget with `logger.error()` on failure. Per `CO_WRITE_NON_BLOCKING` invariant.
- **No balance flags in Crawl** — TigerBeetle accounts have `flags: 0`. Overdraft protection deferred to Walk phase.
- **Bootstrap profile for format** — `tigerbeetle-format` uses `profiles: [bootstrap]`, same pattern as `db-provision`. Must run `docker compose --profile bootstrap up` on first setup.
- **`as any` for TB client** in container.ts — `tigerbeetle-node` types not in app tsconfig (package-only dep). Type safety validated within the package itself.

## Next Actions

- [ ] Run `pnpm check` — lint + format + typecheck validation on full implementation
- [ ] Fix any lint/format issues from `pnpm check`
- [ ] Write integration tests: `packages/financial-ledger/tests/tigerbeetle.adapter.int.test.ts` — single-ledger transfer, linked cross-ledger transfer, idempotent account creation, balance queries (R8)
- [ ] Test the Docker compose TigerBeetle setup (pull image, format data, start)
- [ ] Stage all changes and commit implementation
- [ ] Update task status to `needs_closeout`
- [ ] Run `/closeout task.0145` (docs pass + PR creation)

## Risks / Gotchas

- **TigerBeetle Docker image has no shell** — `ghcr.io/tigerbeetle/tigerbeetle` is a static binary on minimal base. The format init container uses the `command: ["format", ...]` override directly (no `sh -c`). If format fails (file already exists), the container exits non-zero — this is expected on re-runs, hence `profiles: [bootstrap]`.
- **Port 3000 conflict** — TigerBeetle defaults to port 3000 internally. Host-mapped to `127.0.0.1:3010` to avoid Next.js conflict. Docker-internal address is `tigerbeetle:3000`.
- **`creditAccount` co-write requires `metadata.microUsdc`** — The USDC→CREDIT linked transfers only fire when `reason === "deposit"` AND `metadata.microUsdc` is present. Callers must pass `microUsdc` in metadata for the co-write to trigger. Existing callers may not set this field yet.
- **`pnpm install` updated lockfile** — Adding `tigerbeetle-node` required `pnpm install` (not `--frozen-lockfile`). The lockfile diff is in the unstaged changes.

## Pointers

| File / Resource                                                 | Why it matters                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `work/items/task.0145.tigerbeetle-ledger-setup.md`              | Work item with full plan, requirements, invariants                                   |
| `docs/spec/financial-ledger.md`                                 | Spec: accounts hierarchy, ledger IDs, co-write semantics                             |
| `packages/financial-ledger/src/port/financial-ledger.port.ts`   | Port interface: `transfer`, `linkedTransfers`, `lookupAccounts`, `getAccountBalance` |
| `packages/financial-ledger/src/domain/accounts.ts`              | Well-known account IDs, ledger IDs, account definitions                              |
| `packages/financial-ledger/src/domain/conversion.ts`            | `microUsdcToCredits()`, `uuidToBigInt()`                                             |
| `packages/financial-ledger/src/adapters/tigerbeetle.adapter.ts` | TigerBeetleAdapter with lazy init, idempotent account creation                       |
| `src/bootstrap/container.ts`                                    | Lazy require pattern (lines ~284-304), Container interface                           |
| `src/adapters/server/accounts/drizzle.adapter.ts`               | Co-write calls in `recordChargeReceipt` and `creditAccount`                          |
| `platform/infra/services/runtime/docker-compose.dev.yml`        | TigerBeetle + format services                                                        |
| `work/items/task.0147.tigerbeetle-two-phase-transfers.md`       | Follow-up: pending/post/void for x402                                                |
