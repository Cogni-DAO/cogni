---
id: task.0119
type: task
title: "Epoch approver UI — EIP-712 signing, review/edit/finalize admin panel"
status: needs_implement
priority: 1
rank: 1
estimate: 4
summary: "Build an approver-gated admin page for reviewing, editing, and signing epochs. Migrate signing from EIP-191 to EIP-712 typed data for wallet UX and multi-sig forward-compatibility. Add wagmi hooks for client-side signing."
outcome: "An authorized approver can connect their wallet, review epoch allocations, adjust final_units, transition open→review, sign with EIP-712, and finalize — all from the UI. Non-approvers see read-only epoch data. Backend verifies EIP-712 typed data signatures."
spec_refs:
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/claimant-share-ownership
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-01
updated: 2026-03-01
labels: [governance, ui, web3, signing]
external_refs:
---

# Epoch Approver UI — EIP-712 Signing + Review/Edit/Finalize Admin Panel

## Context

The backend for epoch lifecycle (open → review → finalized) is complete (task.0100, task.0102). API routes exist for review, update-allocations, and finalize — all approver-gated via `checkApprover()`. The governance UI (`/gov/epoch`, `/gov/history`, `/gov/holdings`) exists but is **read-only** with no admin controls.

This task builds the approver-facing admin panel and migrates signing from EIP-191 `personal_sign` to EIP-712 typed data for:

- Better wallet UX (structured data in signing popup instead of raw string)
- Forward-compatibility with Safe multi-sig (Safe uses EIP-712 internally)

### OSS references studied

- **Safe wallet monorepo** — transaction review + multi-signer approval UI (Next.js)
- **Coordinape** — epoch-based contribution allocation + admin sign-off pattern
- **wagmi/viem** — standard `useSignTypedData` hook for EIP-712

## Requirements

### Backend: EIP-712 migration

- [ ] Define EIP-712 domain separator and `PayoutStatement` type in `packages/attribution-ledger/src/signing.ts`
- [ ] Domain: `{ name: "Cogni Attribution", version: "1", chainId }` — chainId from config
- [ ] Type: `PayoutStatement { nodeId, scopeId, epochId, allocationSetHash, poolTotalCredits }`
- [ ] New `buildEIP712TypedData(params)` pure function returning `{ domain, types, primaryType, message }` (viem `SignTypedDataParameters` shape)
- [ ] Update `FinalizeEpochWorkflow` activity to verify via `viem.verifyTypedData()` instead of `verifyMessage()`
- [ ] Update `attribution.finalize-epoch.v1.contract.ts` to accept EIP-712 signature (hex format unchanged — only verification method changes)
- [ ] Keep `buildCanonicalMessage()` as deprecated export for one release cycle (backward compat)
- [ ] Add `/api/v1/attribution/epochs/[id]/sign-data` GET route — returns the EIP-712 typed data payload for the given epoch so the UI doesn't need to reconstruct it client-side

### Frontend: wagmi integration

- [ ] Add `wagmi`, `@wagmi/core` to project dependencies (viem already a dep)
- [ ] Create wagmi config provider (`src/features/governance/providers/WagmiProvider.tsx`) with `injected` connector (reuse existing SIWE session — no new wallet connect flow needed)
- [ ] Create `useIsApprover()` hook — reads session wallet address, checks against approvers via a lightweight API endpoint or server component prop
- [ ] Create `useSignEpoch(epochId)` hook — fetches sign-data, calls `useSignTypedData`, returns `{ sign, signature, isLoading, error }`

### Frontend: approver admin panel

- [ ] New route or conditionally rendered section on existing `/gov/epoch` page
- [ ] Gate visibility: only render admin controls when `useIsApprover()` returns true
- [ ] **Review section** (epoch status === "open"):
  - Display allocation table with `proposedUnits` and editable `finalUnits` column
  - "Adjust" action per row — calls `PATCH /epochs/[id]/allocations` (existing route)
  - "Close Ingestion → Review" button — calls `POST /epochs/[id]/review` (existing route)
  - Unresolved activity warning banner (count + platform logins) from existing `unresolvedCount` data
- [ ] **Sign & Finalize section** (epoch status === "review"):
  - Summary card: epoch ID, period, allocation hash, pool total, approver set hash
  - "Sign & Finalize" button:
    1. Fetches EIP-712 typed data from `/epochs/[id]/sign-data`
    2. Triggers wallet popup via `useSignTypedData`
    3. POSTs signature to `/epochs/[id]/finalize`
    4. Shows workflow ID + status feedback
  - Pre-sign checklist: pool components recorded, no unresolved activity (warnings, not blockers)
- [ ] **Finalized section** (epoch status === "finalized"):
  - Read-only statement view with signature metadata (signer address, timestamp)
  - Link to statement details

### Tests

- [ ] Unit: `buildEIP712TypedData()` produces deterministic output matching viem `hashTypedData`
- [ ] Unit: `verifyTypedData()` round-trips with a test wallet signing the typed data
- [ ] Contract: finalize endpoint accepts EIP-712 signature and rejects EIP-191 after migration
- [ ] Component: `useIsApprover` returns true/false correctly based on session wallet
- [ ] Component: admin panel renders for approver, hidden for non-approver

## Allowed Changes

- `packages/attribution-ledger/src/signing.ts` — add EIP-712 typed data builder
- `packages/attribution-ledger/src/signing.test.ts` — new tests
- `src/contracts/attribution.finalize-epoch.v1.contract.ts` — update description (schema unchanged)
- `src/app/api/v1/attribution/epochs/[id]/sign-data/` — **new** GET endpoint
- `services/scheduler-worker/src/activities/ledger.ts` — switch `verifyMessage` → `verifyTypedData`
- `src/features/governance/` — new hooks, providers, components for admin panel
- `src/app/(app)/gov/epoch/` — admin UI components/routes
- `package.json` — wagmi dependency
- Test files under `tests/`

## Plan

- [ ] Step 1: EIP-712 type definition — Define domain, types, and `buildEIP712TypedData()` in `signing.ts`. Write unit tests.
- [ ] Step 2: Backend verification migration — Update `finalizeEpoch` activity in scheduler-worker to use `verifyTypedData()`. Keep `buildCanonicalMessage()` as deprecated.
- [ ] Step 3: Sign-data endpoint — New `GET /epochs/[id]/sign-data` route that returns the EIP-712 payload (domain + types + message) for a given epoch in review status.
- [ ] Step 4: Approver check hook — `useIsApprover()` hook (server-component prop or lightweight API).
- [ ] Step 5: wagmi provider + sign hook — Minimal wagmi config, `useSignEpoch` hook using `useSignTypedData`.
- [ ] Step 6: Admin panel UI — Review section (allocation table + adjust + close-ingestion), Sign & Finalize section, Finalized read-only section. Gate behind approver check.
- [ ] Step 7: Integration tests — Contract test for finalize with EIP-712 signature. Component tests for approver gating.
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

### Multi-sig upgrade path (future, not this task)

1. Deploy 1-of-1 Safe using `@safe-global/protocol-kit`
2. Add owners + bump threshold
3. Safe Transaction Service handles off-chain signature collection
4. UI adds "pending signatures" view

### wagmi vs raw viem

wagmi is preferred over raw `viem` for the UI because:

- `useSignTypedData` manages wallet state, loading, errors
- `useAccount` provides reactive connection state
- Pairs with existing `@tanstack/react-query` (already a dep)
- RainbowKit can be added later for a polished connect experience

## Review Checklist

- [ ] **Work Item:** `task.0119` linked in PR body
- [ ] **Spec:** SIGNATURE_SCOPE_BOUND, APPROVERS_PINNED_AT_REVIEW, WRITE_ROUTES_APPROVER_GATED upheld
- [ ] **Tests:** EIP-712 round-trip, approver gating, admin panel render tests
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
