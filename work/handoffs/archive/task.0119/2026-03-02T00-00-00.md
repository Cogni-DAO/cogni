---
id: task.0119.handoff
type: handoff
work_item_id: task.0119
status: active
created: 2026-03-01
updated: 2026-03-01
branch: feat/epoch-signing-ui
last_commit: 5fd356f9
---

# Handoff: Epoch Approver UI — EIP-712 Signing + Review/Edit/Finalize Admin Panel

## Context

- The attribution ledger backend has a complete epoch lifecycle (open → review → finalized) with approver-gated API routes
- The governance UI (`/gov/epoch`, `/gov/history`, `/gov/holdings`) is **read-only** — no admin controls exist
- This task builds a `/gov/review` admin page for approvers to review allocations, sign with EIP-712, and finalize epochs
- Signing was migrated from EIP-191 to EIP-712 for structured wallet UX and Safe multi-sig forward-compatibility
- The existing wallet stack (wagmi, RainbowKit, SIWE) is fully wired — no new providers needed

## Current State

- **Steps 1–3 DONE** (4 commits on branch):
  - `buildEIP712TypedData()` pure function in `packages/attribution-ledger/src/signing.ts` (7 unit tests)
  - Backend `verifyMessage` → `verifyTypedData` swap in scheduler-worker activity
  - `CHAIN_ID` added to worker env schema + injected via `AttributionActivityDeps` (aligned with `nodeId`/`scopeId` pattern)
  - `GET /api/v1/attribution/epochs/[id]/sign-data` endpoint with Zod contract — mirrors finalizeEpoch hash computation exactly
- **Steps 4–6 NOT STARTED**: `useSignEpoch` hook, `/gov/review` page, nav tab
- **Steps 7–8 NOT STARTED**: Integration tests, cleanup
- `pnpm check` passes on the branch
- `buildCanonicalMessage()` marked `@deprecated` but retained for one release cycle

## Decisions Made

- **EIP-712 over EIP-191** — structured wallet popup + Safe multi-sig compatibility
- **`chainId` via worker env** (not workflow input) — aligns with how `nodeId`/`scopeId` flow: env → container → deps. Added `CHAIN_ID` to `services/scheduler-worker/src/bootstrap/env.ts`
- **sign-data mirrors finalizeEpoch exactly** — uses same `loadFinalizedClaimantSubjects` logic (claimant shares eval → `buildClaimantAllocations` → `computeClaimantAllocationSetHash`) to ensure hash match
- **Dedicated `/gov/review` page** — separate from read-only `/gov/epoch`; different audience, different intent
- **Server component approver gate** — page.tsx calls `getLedgerApprovers()` + `auth()`, passes `isApprover` prop
- **Follow `usePaymentFlow.ts` state machine pattern** for signing hook

## Next Actions

- [ ] **Step 4**: Create `useSignEpoch(epochId)` hook in `src/features/governance/hooks/` — fetch sign-data, wagmi `useSignTypedData`, POST signature to finalize
- [ ] **Step 5**: Build `/gov/review` page — server component approver gate, epoch list (review + finalized), allocation table with editable `finalUnits`, "Sign & Finalize" button, finalized read-only view
- [ ] **Step 6**: Add "Review" tab in `src/app/(app)/gov/layout.tsx`
- [ ] **Step 7**: Tests — EIP-712 round-trip with viem, component test for approver gating
- [ ] **Step 8**: `pnpm check` + file headers + set status to `needs_closeout`

## Risks / Gotchas

- **`packages/attribution-ledger` cannot import from `src/`** — `CHAIN_ID` must be passed as parameter, not imported
- **sign-data hash must match finalizeEpoch hash exactly** — any divergence means wallet signature won't verify. Both paths must use identical claimant allocation logic
- **wagmi/RainbowKit already installed** — do NOT add new providers or reinstall
- **`usePaymentFlow.ts` is complex** (attemptId guards, polling) — the signing hook is simpler (no polling) but should follow the same state machine conventions
- **Worker requires `CHAIN_ID` env var** — ledger worker won't start without it (alongside `NODE_ID` and `SCOPE_ID`)

## Pointers

| File / Resource                                               | Why it matters                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `work/items/task.0119.epoch-signer-ui.md`                     | Full requirements, plan, and allowed changes                     |
| `packages/attribution-ledger/src/signing.ts`                  | EIP-712 type builder + deprecated EIP-191 builder                |
| `services/scheduler-worker/src/activities/ledger.ts:985-1001` | `finalizeEpoch` — `verifyTypedData` + `buildEIP712TypedData`     |
| `services/scheduler-worker/src/bootstrap/env.ts`              | `CHAIN_ID` env var definition                                    |
| `src/app/api/v1/attribution/epochs/[id]/sign-data/route.ts`   | Sign-data endpoint (mirrors finalizeEpoch hash logic)            |
| `src/contracts/attribution.sign-data.v1.contract.ts`          | Zod contract for sign-data response                              |
| `src/app/api/v1/attribution/epochs/[id]/finalize/route.ts`    | Finalize endpoint (receives signature, starts Temporal workflow) |
| `src/app/api/v1/attribution/_lib/approver-guard.ts`           | `checkApprover()` — reuse for page-level gating                  |
| `src/features/payments/hooks/usePaymentFlow.ts`               | Signing state machine pattern to follow                          |
| `src/app/(app)/gov/layout.tsx`                                | Gov nav tabs — add "Review" link here                            |
| `tests/unit/packages/attribution-ledger/signing.test.ts`      | 19 unit tests (EIP-191 + EIP-712)                                |
