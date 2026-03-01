---
id: task.0119
type: task
title: "Epoch approver UI — EIP-712 signing, review/edit/finalize admin panel"
status: needs_implement
priority: 1
rank: 1
estimate: 4
summary: "Build a dedicated approver-gated admin page (`/gov/review`) for reviewing, editing, and signing epochs in review status. Migrate signing from EIP-191 to EIP-712 typed data for wallet UX and multi-sig forward-compatibility."
outcome: "An authorized approver can navigate to `/gov/review`, see epochs in review status, adjust final_units, sign with EIP-712, and finalize. The existing `/gov/epoch` page remains a read-only transparency view. Backend verifies EIP-712 typed data signatures."
spec_refs:
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/epoch-signing-ui
pr: https://github.com/Cogni-DAO/node-template/pull/502
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-01
updated: 2026-03-01
labels: [governance, ui, web3, signing]
external_refs:
---

# Epoch Approver UI — EIP-712 Signing + Review/Edit/Finalize Admin Panel

## Context

The backend for epoch lifecycle (open → review → finalized) is complete (task.0100, task.0102). API routes exist for review, update-allocations, and finalize — all approver-gated via `checkApprover()`. The governance UI (`/gov/epoch`, `/gov/history`, `/gov/holdings`) exists as **read-only transparency views**.

The existing wallet infrastructure is mature: wagmi `2.19.5`, RainbowKit `2.2.9`, SIWE + NextAuth are all installed and wired into the provider tree at `src/app/providers/wallet.client.tsx`. Signing patterns exist in `usePaymentFlow.ts` and `useDAOFormation.ts`. No new providers or dependencies are needed.

This task builds a **dedicated approver admin page** (`/gov/review`) and migrates signing from EIP-191 to EIP-712 typed data for:

- Better wallet UX (structured data in signing popup instead of raw string)
- Forward-compatibility with Safe multi-sig (Safe uses EIP-712 internally)

### Key design decision

The `/gov/epoch` page remains a **read-only transparency view** showing the current open epoch. The admin review/edit/sign flow lives on a **separate `/gov/review` page** that only shows epochs in `review` or `finalized` status. These are distinct workflows with distinct audiences.

### OSS references studied

- **Safe wallet monorepo** (`safe-global/safe-wallet-monorepo`) — transaction review + multi-signer approval UI (Next.js)
- **Coordinape** (`coordinape/coordinape`) — epoch-based contribution allocation + admin sign-off pattern
- wagmi `useSignTypedData` — standard hook for EIP-712 (already available via existing `WagmiProvider`)

## Requirements

### Backend: EIP-712 migration

- [ ] Define EIP-712 domain separator and `PayoutStatement` type in `packages/attribution-ledger/src/signing.ts`
- [ ] Domain: `{ name: "Cogni Attribution", version: "1", chainId }` — use `CHAIN_ID` from `src/shared/web3/chain.ts`
- [ ] Type: `PayoutStatement { nodeId, scopeId, epochId, allocationSetHash, poolTotalCredits }`
- [ ] New `buildEIP712TypedData(params)` pure function returning `{ domain, types, primaryType, message }` (viem `SignTypedDataParameters` shape)
- [ ] Update `FinalizeEpochWorkflow` activity to verify via `viem.verifyTypedData()` instead of `verifyMessage()`
- [ ] Keep `buildCanonicalMessage()` as deprecated export for one release cycle (backward compat)
- [ ] Add `GET /api/v1/attribution/epochs/[id]/sign-data` route — returns the EIP-712 typed data payload (domain + types + message + chainId) for a given epoch in `review` status. Approver-gated.

### Frontend: hooks (using existing wagmi/RainbowKit infra)

- [ ] Approver check: server component in `/gov/review/page.tsx` calls `getLedgerApprovers()` + `auth()`, passes `isApprover: boolean` as prop. No new API endpoint needed.
- [ ] `useSignEpoch(epochId)` hook in `src/features/governance/hooks/` — fetches sign-data, calls wagmi's `useSignTypedData`, returns `{ sign, signature, isLoading, error }`. Follow state machine pattern from `usePaymentFlow.ts`.

### Frontend: `/gov/review` admin page

- [ ] New route: `src/app/(app)/gov/review/page.tsx` + `view.tsx`
- [ ] Server component gates access: if not approver, render "not authorized" or redirect
- [ ] Nav link in `/gov/layout.tsx` (visible to all, access-gated at page level)
- [ ] **Epoch list**: show epochs in `review` status (and recently `finalized` for reference)
- [ ] **Review detail** (epoch status === "review"):
  - Allocation table with `proposedUnits` and editable `finalUnits` column
  - "Adjust" action per row — calls `PATCH /epochs/[id]/allocations` (existing route)
  - Unresolved activity warning banner (count + platform logins) from existing `unresolvedCount` data
  - Pre-sign checklist: pool components recorded, no unresolved activity (warnings, not blockers)
  - Summary card: epoch ID, period, allocation hash, pool total, approver set hash
  - "Sign & Finalize" button:
    1. Fetches EIP-712 typed data from `/epochs/[id]/sign-data`
    2. Triggers wallet popup via wagmi `useSignTypedData`
    3. POSTs signature to `/epochs/[id]/finalize`
    4. Shows workflow ID + status feedback
- [ ] **Finalized detail** (epoch status === "finalized"):
  - Read-only statement view with signature metadata (signer address, timestamp)

### Tests

- [ ] Unit: `buildEIP712TypedData()` produces deterministic output matching viem `hashTypedData`
- [ ] Unit: `verifyTypedData()` round-trips with a test wallet signing the typed data
- [ ] Contract: finalize endpoint accepts EIP-712 signature
- [ ] Component: admin page renders for approver, shows "not authorized" for non-approver

## Allowed Changes

- `packages/attribution-ledger/src/signing.ts` — add EIP-712 typed data builder
- `packages/attribution-ledger/src/signing.test.ts` — new tests
- `src/contracts/attribution.finalize-epoch.v1.contract.ts` — update description (schema unchanged)
- `src/app/api/v1/attribution/epochs/[id]/sign-data/` — **new** GET endpoint
- `services/scheduler-worker/src/activities/ledger.ts` — switch `verifyMessage` → `verifyTypedData`
- `src/features/governance/hooks/` — new `useSignEpoch` hook
- `src/app/(app)/gov/review/` — **new** admin page (page.tsx + view.tsx)
- `src/app/(app)/gov/layout.tsx` — add nav link for review page
- Test files under `tests/`

## Plan

- [ ] Step 1: EIP-712 type definition — Define domain, types, and `buildEIP712TypedData()` in `signing.ts`. Use `CHAIN_ID` from `src/shared/web3/chain.ts`. Write unit tests.
- [ ] Step 2: Backend verification migration — Update `finalizeEpoch` activity in scheduler-worker to use `verifyTypedData()`. Keep `buildCanonicalMessage()` as deprecated.
- [ ] Step 3: Sign-data endpoint — New `GET /epochs/[id]/sign-data` route returning EIP-712 payload for epochs in review status. Approver-gated.
- [ ] Step 4: `useSignEpoch` hook — New hook in `src/features/governance/hooks/` using wagmi's existing `useSignTypedData`. Follow `usePaymentFlow.ts` state machine pattern.
- [ ] Step 5: `/gov/review` page — Server component with approver gate. List epochs in review/finalized. Review detail with allocation editing + sign & finalize button. Finalized detail with read-only statement.
- [ ] Step 6: Nav update — Add "Review" link in `/gov/layout.tsx`.
- [ ] Step 7: Tests — Unit tests for EIP-712. Contract test for finalize. Component test for approver gating.
- [ ] Step 8: Cleanup — Ensure `pnpm check` passes. Update file headers.

## Validation

**Command:**

```bash
pnpm check && pnpm test && pnpm test:contract
```

**Expected:** All tests pass. `buildEIP712TypedData()` unit tests verify deterministic output. Finalize contract test verifies EIP-712 signature acceptance.

## Design Notes

### EIP-712 vs EIP-191

EIP-712 provides:

1. **Structured wallet popup** — users see typed fields (nodeId, epochId, etc.) instead of a raw text blob
2. **Safe compatibility** — Safe multi-sig uses EIP-712 internally; signatures are natively compatible
3. **Domain binding** — `chainId` in domain separator prevents cross-chain replay

The migration is backward-compatible at the wire level (signature is still a hex string). Only the verification method changes on the backend.

### Existing wallet infra (do not duplicate)

The app already has a complete wallet stack — no new providers or dependencies needed:

- **wagmi `2.19.5`** + **RainbowKit `2.2.9`** installed, configured via `getDefaultConfig()` at `src/shared/web3/wagmi.config.ts`
- **`WagmiProvider`** wraps entire app at `src/app/providers/wallet.client.tsx`
- **SIWE + NextAuth** fully wired via `RainbowKitSiweNextAuthProvider`
- **`WalletConnectButton`** + **`SignInDialog`** exist at `src/components/kit/auth/`
- **Signing patterns** established in `usePaymentFlow.ts` (ERC20) and `useDAOFormation.ts` (Aragon)
- **Chain config** at `src/shared/web3/chain.ts` — use `CHAIN_ID` for EIP-712 domain

### Multi-sig upgrade path (future, not this task)

1. Deploy 1-of-1 Safe using `@safe-global/protocol-kit`
2. Add owners + bump threshold
3. Safe Transaction Service handles off-chain signature collection
4. UI adds "pending signatures" view

## Review Feedback (revision 1)

### Blocking Issues

1. **B1 — Transaction wrapping for subject-override writes** (`drizzle-attribution.adapter.ts:1341-1396`): `upsertSubjectOverride` and `deleteSubjectOverride` acquire `SELECT ... FOR UPDATE` lock but the subsequent write is not in the same `db.transaction()`. Lock is released before the INSERT/DELETE, so the PATCH↔finalize race is not actually prevented. **Fix:** Wrap lock + write in `this.db.transaction()`.

2. **B2 — Non-atomic batch upsert** (`subject-overrides/route.ts:245-257`): Overrides upserted one-by-one in a loop without transaction wrapping. Partial failure leaves inconsistent state. **Fix:** Wrap in a transaction.

3. **B3 — Negative `overrideUnits` accepted** (`attribution.subject-overrides.v1.contract.ts:23`): `zBigint` regex `/^-?\d+$/` allows negative values. `expandClaimantUnits` silently excludes units <= 0. **Fix:** Change to `/^\d+$/`.

4. **B4 — Missing EIP-712 round-trip test** (`signing.test.ts`): No test signs typed data with a private key and verifies with `verifyTypedData`. The finalize test mocks verification as always-true. Use `viem/accounts` `privateKeyToAccount` + `signTypedData` for a pure-crypto round-trip test.

5. **B5 — Zero adapter integration tests for subject-override methods** (`drizzle-attribution.adapter.int.test.ts`): `upsertSubjectOverride`, `deleteSubjectOverride`, `getSubjectOverridesForEpoch` have no adapter-level tests. Status-gate, upsert conflict, scope isolation, and JSONB round-trip are untested.

### Non-blocking (address if time permits)

- `useSubjectOverrides.ts:68-73`: `overridesByRef` Map created outside `useMemo` — cascading re-renders.
- `view.tsx:252-260`: Unhandled promise rejection in `handleSave`/`handleRemove`.
- `view.tsx:276`: `colSpan={6}` should be `colSpan={7}` to match parent table.
- `sign-data/route.ts:70-104`: Logic duplicated from `finalizeEpoch` — consider shared helper.
- `ExpandableTableRow.tsx:51-57`: Missing keyboard accessibility (`tabIndex`, `role`, `onKeyDown`, `aria-expanded`).

## Review Checklist

- [ ] **Work Item:** `task.0119` linked in PR body
- [ ] **Spec:** SIGNATURE_SCOPE_BOUND, APPROVERS_PINNED_AT_REVIEW, WRITE_ROUTES_APPROVER_GATED upheld
- [ ] **Tests:** EIP-712 round-trip, approver gating, admin panel render tests
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0119.handoff.md)

## Attribution

-
