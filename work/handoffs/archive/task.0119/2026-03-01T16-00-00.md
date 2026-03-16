---
id: task.0119.handoff
type: handoff
work_item_id: task.0119
status: active
created: 2026-03-01
updated: 2026-03-01
branch: feat/epoch-signing-ui
last_commit: 7322cee8
---

# Handoff: Epoch Approver UI — EIP-712 Signing + Review/Edit/Finalize Admin Panel

## Context

- The attribution ledger has a complete epoch lifecycle backend (open → review → finalized) with API routes for review, update-allocations, and finalize — all approver-gated via `checkApprover()`
- The governance UI (`/gov/epoch`, `/gov/history`, `/gov/holdings`) exists but is **read-only** — no admin controls for reviewing, editing allocations, or signing epochs
- This task builds a dedicated **`/gov/review` admin page** for authorized approvers and migrates signing from EIP-191 to EIP-712 typed data (better wallet UX, Safe multi-sig forward-compatibility)
- The existing wallet stack (wagmi 2.19.5, RainbowKit 2.2.9, SIWE + NextAuth) is already fully wired — **no new providers or dependencies needed**
- Approvers are configured in `.cogni/repo-spec.yaml` under `activity_ledger.approvers` (currently one address)

## Current State

- **Step 1 DONE**: `buildEIP712TypedData()` pure function added to `packages/attribution-ledger/src/signing.ts`, exported from package index, 7 unit tests passing (commit `7322cee8`)
- **Step 2 NOT STARTED**: Backend verification migration — switch `verifyMessage()` → `verifyTypedData()` in `services/scheduler-worker/src/activities/ledger.ts` (lines 992–996)
- **Step 3 NOT STARTED**: New `GET /api/v1/attribution/epochs/[id]/sign-data` endpoint
- **Steps 4–6 NOT STARTED**: `useSignEpoch` hook, `/gov/review` page, nav update
- **Steps 7–8 NOT STARTED**: Integration tests, cleanup
- `pnpm check` passes on the branch
- `buildCanonicalMessage()` marked `@deprecated` but still used in finalize activity — must switch in Step 2

## Decisions Made

- **EIP-712 over EIP-191** — structured wallet popup + Safe multi-sig compatibility ([task.0119 Design Notes](../items/task.0119.epoch-signer-ui.md#design-notes))
- **Dedicated `/gov/review` page** — admin workflow is separate from the read-only `/gov/epoch` transparency view; different audiences, different intent
- **`chainId` as parameter** — `packages/attribution-ledger` is a pure package with no `src/` imports, so `chainId` is passed in (from `CHAIN_ID` in `src/shared/web3/chain.ts`)
- **Server component approver gate** — page.tsx calls `getLedgerApprovers()` + `auth()`, passes `isApprover` prop; no new API endpoint
- **Follow `usePaymentFlow.ts` state machine pattern** — established signing UX pattern in the codebase

## Next Actions

- [ ] **Step 2**: In `services/scheduler-worker/src/activities/ledger.ts`, replace `verifyMessage()` with `verifyTypedData()` using `buildEIP712TypedData()`. Import `CHAIN_ID` from chain config or pass via workflow input.
- [ ] **Step 3**: Create `GET /api/v1/attribution/epochs/[id]/sign-data/route.ts` — approver-gated, returns EIP-712 typed data payload for epochs in `review` status. Create Zod contract file.
- [ ] **Step 4**: Create `useSignEpoch(epochId)` hook in `src/features/governance/hooks/` — fetch sign-data, call wagmi `useSignTypedData`, POST signature to finalize endpoint
- [ ] **Step 5**: Build `/gov/review` page — server component with approver gate, epoch list (review + finalized), allocation table with editable `finalUnits`, "Sign & Finalize" button, finalized read-only view
- [ ] **Step 6**: Add "Review" tab in `src/app/(app)/gov/layout.tsx`
- [ ] **Step 7**: Write tests — EIP-712 round-trip with viem, contract test for finalize, component test for approver gating
- [ ] **Step 8**: `pnpm check` + file headers + set status to `needs_closeout`

## Risks / Gotchas

- **`packages/attribution-ledger` cannot import from `src/`** — the `CHAIN_ID` must be passed as a parameter, not imported directly in the package
- **scheduler-worker imports viem directly** — `verifyTypedData` is available there but the chain ID needs to be sourced (likely from workflow input or env, not from `src/shared/web3/chain.ts`)
- **Existing finalize route passes signature through** to Temporal — the route itself doesn't need changes, only the worker activity does
- **wagmi/RainbowKit are already installed and wired** — do NOT add new providers or install these packages again
- **The `usePaymentFlow.ts` hook is complex** (state machine with attemptId guards) — the signing hook here is simpler (no polling, no confirmation) but should follow the same pattern conventions

## Pointers

| File / Resource                                               | Why it matters                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `work/items/task.0119.epoch-signer-ui.md`                     | Full requirements, plan, and allowed changes                             |
| `packages/attribution-ledger/src/signing.ts`                  | EIP-712 type builder (done) + deprecated EIP-191 builder                 |
| `services/scheduler-worker/src/activities/ledger.ts:984-1001` | `finalizeEpoch` — where `verifyMessage` → `verifyTypedData` swap happens |
| `src/app/api/v1/attribution/epochs/[id]/finalize/route.ts`    | Finalize endpoint (passes signature to Temporal, no changes needed)      |
| `src/app/api/v1/attribution/epochs/[id]/review/route.ts`      | Review endpoint (open → review transition)                               |
| `src/app/api/v1/attribution/_lib/approver-guard.ts`           | `checkApprover()` — reuse for sign-data endpoint                         |
| `src/shared/web3/chain.ts`                                    | `CHAIN_ID` for EIP-712 domain                                            |
| `src/app/providers/wallet.client.tsx`                         | Existing WagmiProvider wrapping entire app                               |
| `src/features/payments/hooks/usePaymentFlow.ts`               | Signing state machine pattern to follow                                  |
| `src/app/(app)/gov/layout.tsx`                                | Gov nav tabs — add "Review" link here                                    |
| `src/features/governance/hooks/useCurrentEpoch.ts`            | Data fetching pattern to follow for review page                          |
| `tests/unit/packages/attribution-ledger/signing.test.ts`      | Existing + new EIP-712 unit tests                                        |
