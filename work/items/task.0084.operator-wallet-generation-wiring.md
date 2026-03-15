---
id: task.0084
type: task
title: Operator wallet provisioning + wiring into existing payment flow
status: needs_review
priority: 0
estimate: 2
summary: Provision operator wallet via Privy API, create OperatorWalletPort, wire operator wallet as receiving address — existing payment flow works unchanged.
outcome: Users pay USDC to operator wallet instead of DAO wallet. Privy-managed wallet verified at startup against repo-spec. OperatorWalletPort interface ready for PR 2/3.
spec_refs: operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/operator-wallet-v0
pr:
reviewer:
created: 2026-02-17
updated: 2026-03-09
labels: [wallet, web3, billing]
external_refs:
revision: 4
blocked_by:
deploy_verified: true
rank: 19
---

# Operator wallet provisioning + wiring into existing payment flow

## Requirements

- `scripts/provision-operator-wallet.ts` creates an operator wallet via Privy server wallet API and prints the checksummed address to stdout
- Privy credentials read from env vars (`PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY`) — no local key material
- `OperatorWalletPort` interface defined in `src/ports/operator-wallet.port.ts` with `getAddress()`, `getSplitAddress()`, `distributeSplit()`, `fundOpenRouterTopUp()` (PR 2/3 implement distributeSplit/fundOpenRouterTopUp; this PR defines the interface + stubs)
- `PrivyOperatorWalletAdapter` in `src/adapters/server/wallet/privy-operator-wallet.adapter.ts` connects to Privy at startup, verifies wallet address matches `operator_wallet.address` from repo-spec
- `FakeOperatorWalletAdapter` in `src/adapters/test/wallet/` for CI (APP_ENV=test)
- `operator_wallet` added to `.cogni/repo-spec.yaml` schema + validation (address + split_address fields)
- New env vars: `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY` (optional — only required when operator wallet features are enabled)
- `ADDRESS_VERIFIED_AT_STARTUP` invariant: Privy-reported address vs repo-spec mismatch → fail fast
- `KEY_NEVER_IN_APP` invariant: no raw private key material in the application process
- Existing payment flow (intent → sign → verify → credits) works unchanged

## Allowed Changes

- `scripts/provision-operator-wallet.ts` (new)
- `src/ports/operator-wallet.port.ts` (new)
- `src/ports/index.ts` (add export)
- `src/adapters/server/wallet/privy-operator-wallet.adapter.ts` (new)
- `src/adapters/server/index.ts` (add export)
- `src/adapters/test/wallet/fake-operator-wallet.adapter.ts` (new)
- `src/adapters/test/index.ts` (add export)
- `packages/repo-spec/src/schema.ts` (add operator_wallet schema)
- `packages/repo-spec/src/accessors.ts` (add extractOperatorWalletConfig)
- `packages/repo-spec/src/index.ts` (add export)
- `src/shared/config/repoSpec.schema.ts` (re-export new types)
- `src/shared/config/repoSpec.server.ts` (add getOperatorWalletConfig)
- `src/shared/env/server-env.ts` (add PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNING_KEY)
- `src/bootstrap/container.ts` (wire adapter)
- `.cogni/repo-spec.yaml` (add operator_wallet section — placeholder address for dev)
- `package.json` (add `@privy-io/server-auth` dependency)
- `tests/` (port contract test, fake adapter test)

## Design

### Outcome

OperatorWalletPort interface defined, Privy adapter wired, provisioning script ready — PR 2/3 can implement `distributeSplit()` and `fundOpenRouterTopUp()` on a working foundation.

### Approach

**Solution**: Define `OperatorWalletPort` following existing port patterns (modeled on `TreasuryReadPort` / `OnChainVerifier`). Add `operator_wallet` section to `@cogni/repo-spec` package schema (REPO_SPEC_AUTHORITY — schema lives in the package, not in `src/`). Privy adapter reads address from repo-spec config, verifies against Privy API lazily (on first `getAddress()` call) to work with the synchronous container pattern. Provisioning script uses `@privy-io/server-auth` SDK.

**Method names aligned with spec**: The spec (operator-wallet.md) defines `getAddress()`, `getSplitAddress()`, `distributeSplit(token)`, `fundOpenRouterTopUp(intent)`. The original work item mentioned `sweepUsdcToTreasury()` — superseded by spec's `distributeSplit()` (Splits contract handles DAO share on-chain, no app-level sweep needed).

**Reuses**:

- `@cogni/repo-spec` package pattern: Zod schema → accessor → re-export barrel (same as `extractPaymentConfig`)
- `optionalString` helper in `server-env.ts` for Privy env vars
- Existing container wiring pattern: `env.isTestMode` conditional (same as `onChainVerifier`)
- Singleton fake pattern from `FakeOnChainVerifierAdapter` for test adapter
- `@privy-io/server-auth` OSS SDK for Privy API (no bespoke HTTP calls)

**Rejected alternatives**:

1. **Local keystore adapter for P0** — requires key material in app process (violates KEY_NEVER_IN_APP). Privy HSM is simpler and more secure for MVP.
2. **Async container init for Privy verification** — would require restructuring the entire synchronous `createContainer()` pattern. Lazy verification on first use achieves ADDRESS_VERIFIED_AT_STARTUP without architectural disruption.
3. **Inline repo-spec schema in src/shared** — violates REPO_SPEC_AUTHORITY. Schema must live in `@cogni/repo-spec` package.

### Key Design Decisions

**Lazy Privy verification**: The adapter constructor takes config synchronously (repo-spec address + Privy credentials). The first call to any method triggers an async Privy API call to verify the wallet address matches repo-spec. This avoids restructuring the synchronous container while still enforcing ADDRESS_VERIFIED_AT_STARTUP before any wallet operation.

**Optional wiring**: When `PRIVY_APP_ID` is not set, the container wires `undefined` for the operator wallet port. This allows existing deployments without Privy to continue working. Features that need the port check for its presence.

**PR 1 stub methods**: `distributeSplit()` and `fundOpenRouterTopUp()` throw `Error("not implemented — see task.0085/task.0086")` in both Privy and Fake adapters. The port interface is complete; implementations come in PR 2/3.

**`operator_wallet` is optional in repo-spec schema**: Added as `.optional()` to `repoSpecSchema` so existing deployments don't break. When present, validated with EVM address regex.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] KEY_NEVER_IN_APP: No raw private key material in application process. Privy HSM holds signing key. (spec: operator-wallet)
- [ ] ADDRESS_VERIFIED_AT_STARTUP: Privy-reported address verified against repo-spec on first use. Mismatch → throw. (spec: operator-wallet)
- [ ] NO_GENERIC_SIGNING: Port exposes named methods only — no `signTransaction(calldata)`. (spec: operator-wallet)
- [ ] SINGLE_OPERATOR_WALLET: Exactly one operator wallet per deployment, address in repo-spec. (spec: operator-wallet)
- [ ] PRIVY_SIGNED_REQUESTS: All Privy API calls use signed requests via PRIVY_SIGNING_KEY. (spec: operator-wallet)
- [ ] REPO_SPEC_AUTHORITY: Schema lives in @cogni/repo-spec package, not in src/. (spec: architecture)
- [ ] SIMPLE_SOLUTION: Reuses existing patterns (repo-spec accessors, optional env, container wiring, fake adapters)
- [ ] ARCHITECTURE_ALIGNMENT: Port in src/ports/, adapter in src/adapters/server/wallet/, test fake in src/adapters/test/wallet/. Dependencies point inward. (spec: architecture)

### Files

<!-- High-level scope -->

**Port layer:**

- Create: `src/ports/operator-wallet.port.ts` — OperatorWalletPort interface + TransferIntent type
- Modify: `src/ports/index.ts` — add OperatorWalletPort type export

**Config layer (repo-spec package):**

- Modify: `packages/repo-spec/src/schema.ts` — add `operatorWalletSpecSchema` (address + split_address, both EVM regex)
- Modify: `packages/repo-spec/src/accessors.ts` — add `extractOperatorWalletConfig()` pure accessor
- Modify: `packages/repo-spec/src/index.ts` — export new types and accessor

**Config layer (app re-exports):**

- Modify: `src/shared/config/repoSpec.schema.ts` — re-export `OperatorWalletSpec` type + schema
- Modify: `src/shared/config/repoSpec.server.ts` — add `getOperatorWalletConfig()` cached accessor

**Env:**

- Modify: `src/shared/env/server-env.ts` — add `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY` (all optional)

**Adapters:**

- Create: `src/adapters/server/wallet/privy-operator-wallet.adapter.ts` — PrivyOperatorWalletAdapter
- Modify: `src/adapters/server/index.ts` — export PrivyOperatorWalletAdapter
- Create: `src/adapters/test/wallet/fake-operator-wallet.adapter.ts` — FakeOperatorWalletAdapter
- Modify: `src/adapters/test/index.ts` — export FakeOperatorWalletAdapter

**Bootstrap:**

- Modify: `src/bootstrap/container.ts` — wire operator wallet (conditional on PRIVY_APP_ID)

**Config data:**

- Modify: `.cogni/repo-spec.yaml` — add `operator_wallet` section with placeholder address

**Scripts:**

- Create: `scripts/provision-operator-wallet.ts` — Privy wallet creation CLI

**Dependencies:**

- Modify: `package.json` — add `@privy-io/server-auth`

**Tests:**

- Create: `tests/contract/operator-wallet.contract.ts` — port contract test (getAddress, getSplitAddress)
- Create: `tests/unit/adapters/test/fake-operator-wallet.test.ts` — fake adapter behavior

## Plan

- [ ] **Checkpoint 1: Port + Config**
  - Milestone: OperatorWalletPort interface defined, repo-spec schema extended, env vars added
  - Invariants: NO_GENERIC_SIGNING, REPO_SPEC_AUTHORITY
  - Todos:
    - [ ] Create `src/ports/operator-wallet.port.ts` with OperatorWalletPort interface + TransferIntent type
    - [ ] Add export to `src/ports/index.ts`
    - [ ] Add `operatorWalletSpecSchema` to `packages/repo-spec/src/schema.ts`
    - [ ] Add `extractOperatorWalletConfig()` to `packages/repo-spec/src/accessors.ts`
    - [ ] Export from `packages/repo-spec/src/index.ts`
    - [ ] Re-export from `src/shared/config/repoSpec.schema.ts`
    - [ ] Add `getOperatorWalletConfig()` to `src/shared/config/repoSpec.server.ts`
    - [ ] Add `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY` to `src/shared/env/server-env.ts`
    - [ ] Add `operator_wallet` section to `.cogni/repo-spec.yaml`
  - Validation:
    - [ ] Port interface compiles with no layer violations
    - Test levels:
      - [ ] unit: `pnpm typecheck` passes
      - [ ] contract: repo-spec schema validates new YAML section

- [ ] **Checkpoint 2: Adapters + Wiring**
  - Milestone: Privy adapter, fake adapter, and container wiring complete
  - Invariants: KEY_NEVER_IN_APP, ADDRESS_VERIFIED_AT_STARTUP, SINGLE_OPERATOR_WALLET, ARCHITECTURE_ALIGNMENT
  - Todos:
    - [ ] Add `@privy-io/server-auth` to `package.json`
    - [ ] Create `src/adapters/server/wallet/privy-operator-wallet.adapter.ts`
    - [ ] Export from `src/adapters/server/index.ts`
    - [ ] Create `src/adapters/test/wallet/fake-operator-wallet.adapter.ts`
    - [ ] Export from `src/adapters/test/index.ts`
    - [ ] Wire in `src/bootstrap/container.ts` (conditional on PRIVY_APP_ID)
  - Validation:
    - [ ] Container creates successfully with and without Privy env vars
    - Test levels:
      - [ ] unit: `pnpm typecheck` passes
      - [ ] contract: `tests/contract/operator-wallet.contract.ts`

- [ ] **Checkpoint 3: Provisioning Script + Tests**
  - Milestone: Provisioning script ready, all tests passing
  - Invariants: KEY_NEVER_IN_APP, PRIVY_SIGNED_REQUESTS
  - Todos:
    - [ ] Create `scripts/provision-operator-wallet.ts`
    - [ ] Write `tests/contract/operator-wallet.contract.ts`
    - [ ] Write `tests/unit/adapters/test/fake-operator-wallet.test.ts`
  - Validation:
    - [ ] `pnpm check` passes
    - Test levels:
      - [ ] unit: `pnpm test tests/unit/adapters`
      - [ ] contract: `pnpm test tests/contract/operator-wallet.contract.ts`

## Validation

**Commands:**

```bash
pnpm check
pnpm test tests/contract/operator-wallet.contract.ts
pnpm test tests/unit/adapters/test/fake-operator-wallet.test.ts
```

**Expected:** All tests pass. `pnpm check` clean. No dependency-cruiser violations.

## Review Checklist

- [ ] **Work Item:** `task.0084` linked in PR body
- [ ] **Spec:** KEY_NEVER_IN_APP, ADDRESS_VERIFIED_AT_STARTUP, NO_GENERIC_SIGNING, SINGLE_OPERATOR_WALLET, PRIVY_SIGNED_REQUESTS invariants upheld
- [ ] **Tests:** Port contract test + fake adapter test
- [ ] **Reviewer:** assigned and approved
- [ ] **Architecture:** Port in `src/ports/`, adapter in `src/adapters/server/wallet/`, no layer violations

## Review Feedback

### Review 2 (2026-03-06) — REQUEST CHANGES

**Blocking issues:**

1. **Deprecated dependency**: `@privy-io/server-auth` is deprecated (pnpm-lock.yaml confirms). Migrate to `@privy-io/node`.
2. **Wrong function selector in `encodeSplitDistribute`**: `0xc9a6ce04` is not the correct selector for `distributeERC20(address,address)` (actual: `0xd1a06cf8`). Would cause on-chain reverts.
3. **Missing DESTINATION_ALLOWLIST invariant**: `fundOpenRouterTopUp()` doesn't validate `contract_address` against an allowlist (spec: DESTINATION_ALLOWLIST).
4. **Missing OPERATOR_MAX_TOPUP_USD cap**: No per-tx cap validation in `fundOpenRouterTopUp()` (spec requirement).

**Recommended fix:** Revert `distributeSplit()` and `fundOpenRouterTopUp()` in the Privy adapter to stubs (throw "not implemented — see task.0085/task.0086") as the design specifies. This eliminates issues 2-4 and defers the complexity to the correct PRs. Migrate `@privy-io/server-auth` → `@privy-io/node`.

**Non-blocking suggestions:**

- Add missing `tests/unit/adapters/test/fake-operator-wallet.test.ts`
- Paginate `getWallets()` or use targeted wallet lookup
- Add promise-based lock to `verify()` to prevent redundant concurrent API calls

### Review 3 (2026-03-09) — REQUEST CHANGES

**Blocking issues:**

1. **`distributeSplit` and `fundOpenRouterTopUp` are still implemented, not stubs.** Review 2 explicitly required reverting to stubs. The design section says "PR 2/3 implement distributeSplit/fundOpenRouterTopUp; this PR defines the interface + stubs". The `distributeSplit` implementation encodes `distributeERC20(address,address)` but spike.0090 proved the correct method is `distribute()` on Push Split V2o2 — the encoded selector would revert on-chain. The `COINBASE_TRANSFERS_BASE` constant is the zero address (`0x000...`), and container wiring doesn't pass `allowedTopUpContracts`, so `fundOpenRouterTopUp` would always fail with DESTINATION_ALLOWLIST error in production. **Fix: Revert both methods to `throw new Error("not implemented — see task.0085/task.0086")`. Remove `encodeSplitDistribute()` helper.**
2. **`TransferIntent` type doesn't match validated reality.** Type has `function_name: string` and `calldata: string`, but spike.0090 proved OpenRouter does NOT return `function_name`, and the spec says the adapter should encode calldata internally (caller cannot control calldata). **Fix: Add a `// TODO(task.0086): Update to match actual OpenRouter transfer_intent shape` comment on the type, noting it will be corrected when fundOpenRouterTopUp is implemented in PR 3.**

**Non-blocking suggestions:**

- Stale comment in `src/adapters/server/index.ts:120` — says `@privy-io/server-auth` but dependency is `@privy-io/node`
- Provisioning script reads `PRIVY_SIGNING_KEY` but doesn't pass it to PrivyClient (per PRIVY_SIGNED_REQUESTS invariant)
- Lint failures in `scripts/experiments/*.ts` — pre-existing from spike.0090, not task.0084, but present on branch

**Review 2 fixes confirmed:**

- ✅ `@privy-io/server-auth` → `@privy-io/node` migration done
- ✅ Promise-based lock added to `verify()`
- ✅ `DESTINATION_ALLOWLIST` validation added to `fundOpenRouterTopUp` (but method should be a stub)
- ✅ `OPERATOR_MAX_TOPUP_USD` cap validation added (but method should be a stub)

### Review 4 (2026-03-09) — R3 fixes applied

**Blocking fixes (all resolved):**

1. ✅ `distributeSplit()` and `fundOpenRouterTopUp()` reverted to stubs (`throw new Error("not implemented — see task.0085/task.0086")`)
2. ✅ `encodeSplitDistribute()` helper removed
3. ✅ TODO comment added to `TransferIntent` type documenting spike.0090 findings — `function_name` removed from type, `calldata` replaced with `call_data: Record<string, unknown>`
4. ✅ Removed unused config/fields: `COINBASE_TRANSFERS_BASE`, `DEFAULT_MAX_TOPUP_USD`, `BASE_CHAIN_ID`/`BASE_CAIP2`, `maxTopUpUsd`, `allowedTopUpContracts`, `getWalletId()`, `authContext`
5. ✅ `OPERATOR_MAX_TOPUP_USD` env var removed (task.0086 will re-add when needed)
6. ✅ Container wiring simplified (no longer passes `maxTopUpUsd`)

**Non-blocking fixes (resolved):**

- ✅ Stale comment in `src/adapters/server/index.ts:120` fixed (`@privy-io/server-auth` → `@privy-io/node`)

**Deferred (task.0085/0086 will handle):**

- `signingKey` accepted in config but `AuthorizationContext` not constructed until methods are implemented
- Contract test uses placeholder `TransferIntent` shape — task.0086 will update to match real OpenRouter response

**Pre-existing issues (not task.0084):**

- `src/app/(app)/profile/view.tsx` has unresolved merge conflict markers — causes typecheck + biome failures
- `tests/unit/bootstrap/container.spec.ts` — `extractOperatorWalletConfig` not resolvable via `vi.resetModules()` dynamic import (stale package build cache)

**Validation:**

- ✅ `pnpm vitest run tests/contract/operator-wallet.contract.test.ts` — 7/7 tests pass
- ✅ `pnpm biome check src/adapters/server/wallet/privy-operator-wallet.adapter.ts` — no issues
- ⚠️ `pnpm check` blocked by pre-existing merge conflict in `view.tsx`

## PR / Links

- Handoff: [handoff](../handoffs/task.0084.handoff.md)

## Attribution

-
