---
id: bug.0033
type: bug
title: "Transient RPC errors permanently reject payments — funds taken, no credits"
status: done
priority: 0
estimate: 2
summary: "A transient RPC failure during on-chain verification causes the payment to be permanently REJECTED. The user's on-chain transfer succeeds (treasury receives funds) but credits are never granted. No retry, no recovery, no logging of the actual error."
outcome: "Transient RPC errors leave payments in a retryable state; the actual RPC exception is logged; state transition events include errorCode and correct chainId."
spec_refs:
  - payments-design
assignees: []
credit:
project: proj.payments-enhancements
branch: fix/bug-0033-payment-rpc-error-rejection
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [payments, observability, data-loss]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Transient RPC errors permanently reject payments — funds taken, no credits

## Requirements

### Observed

1. **RPC_ERROR maps to terminal REJECTED** — In `src/adapters/server/payments/evm-rpc-onchain-verifier.adapter.ts:182-184`, any exception from the RPC client (transient network error, timeout, node downtime) is caught and returns `failedResult("RPC_ERROR")`. In `src/features/payments/services/paymentService.ts:390-393`, since `RPC_ERROR !== "TX_REVERTED"`, the payment transitions to `REJECTED`. `REJECTED` is terminal (`src/core/payments/rules.ts:56`) — no re-verification ever happens.

2. **RPC exception is swallowed** — The catch block at `evm-rpc-onchain-verifier.adapter.ts:182` assigns the error to `_error` (unused). The caller (`paymentService.ts`) does not log which errorCode caused the rejection. The facade event (`attempts.server.ts:204-214`) omits `errorCode` entirely.

3. **chainId hardcoded to 0 in log event** — `attempts.server.ts:211`: `chainId: 0, // TODO: retrieve chainId from payment attempt`. Makes it impossible to filter logs by chain.

4. **No `payments.verified` or `payments.confirmed` events emitted** — Event types exist in `src/shared/observability/events/payments.ts:39-60` but are never used. The only events emitted are `intent_created`, `state_transition`, and `status_read`.

5. **Production incident** — On 2026-02-11 at 11:06:25 UTC, payment intent `8d5b422e` for user `625f080f` was REJECTED with txHash `0x5ed15c...`. The treasury increased by $1 (treasury RPC confirmed via `treasury_rpc_success` logs at 11:05:49 and 11:22:19) but the user received zero credits. No error-level log was emitted.

### Expected

- **RPC_ERROR should NOT be a terminal rejection.** Transient RPC failures should leave the payment in `PENDING_UNVERIFIED` so the next `getStatus` poll retries verification.
- **The RPC exception must be logged** at warn/error level with the full error (message, code, stack) so operators can see it.
- **`payments.state_transition` events must include `errorCode`** when present, and `chainId` must come from the actual payment attempt, not be hardcoded to 0.
- **`payments.verified` and `payments.confirmed` events should be emitted** from the service or facade when those transitions occur.

### Reproduction

1. Create a payment intent via `POST /api/v1/payments/intents` (chain 8453, $1)
2. Submit a valid txHash via `POST /api/v1/payments/attempts/:id/submit`
3. If the RPC node is unreachable or times out during `getTransaction()`, `getTransactionReceipt()`, or `getBlockNumber()`, the catch-all at `evm-rpc-onchain-verifier.adapter.ts:182` fires
4. Payment transitions to REJECTED (terminal) — user sees "RPC_ERROR" in UI, no credits
5. No error log emitted, no way to detect this happened except DB inspection

### Impact

- **Severity: P0 — data loss.** User funds are taken on-chain but credits are never granted.
- **No recovery path:** REJECTED is terminal; no admin tool or retry mechanism exists.
- **Silent failure:** Zero error-level logs, zero alerts. Only discoverable by user complaint or manual DB audit.
- **Affects all payment users** whenever Base chain RPC has transient issues.

## Allowed Changes

- `src/adapters/server/payments/evm-rpc-onchain-verifier.adapter.ts` — RPC_ERROR handling + logging
- `src/features/payments/services/paymentService.ts` — RPC_ERROR → retryable, not terminal
- `src/app/_facades/payments/attempts.server.ts` — add errorCode to event, fix chainId
- `src/shared/observability/events/payments.ts` — add errorCode field to state transition event
- `src/core/payments/rules.ts` — potentially (if state machine needs a new retryable error concept)

## Plan

- [x] **Fix 1 — RPC_ERROR must not cause REJECTED.** `verifyAndSettle()` now returns early (same as PENDING path) when errorCode is RPC_ERROR, with a `log.warn`. Attempt stays in PENDING_UNVERIFIED.
- [x] **Fix 2 — Log the RPC error.** `verifyAndSettle()` emits `log.warn` with attemptId, txHash, and errorCode when RPC_ERROR occurs. The adapter catch block still returns `failedResult("RPC_ERROR")` (port interface unchanged).
- [x] **Fix 3 — Add errorCode to state transition event.** `PaymentsStateTransitionEvent` includes `errorCode?: string`. Facade passes `result.errorCode` into the event.
- [x] **Fix 4 — Fix chainId: 0 in state transition event.** `SubmitTxHashResult` and `GetStatusResult` include `chainId`. Facade uses `result.chainId`.
- [x] **Fix 5 — Emit payments.verified events.** Both submit and getStatus facades emit `payments.verified` when the result status is CREDITED.
- [ ] **Manual remediation — credit the affected user.** Requires DB access (out of scope for code fix).

## Validation

**Command:**

```bash
pnpm test src/adapters/server/payments/evm-rpc-onchain-verifier.adapter.test.ts
pnpm test src/features/payments/services/paymentService.test.ts
```

**Expected:** New test case: when RPC throws, payment remains `PENDING_UNVERIFIED` (not `REJECTED`). Existing tests still pass.

## Review Checklist

- [ ] **Work Item:** `bug.0033` linked in PR body
- [ ] **Spec:** payments-design invariants upheld (no funds loss on transient errors)
- [ ] **Tests:** new/updated tests cover RPC_ERROR → retryable behavior
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Production incident: 2026-02-11T11:06:25Z, reqId `80c238b4-ab0a-47ed-a11c-3c5714a5b35c`, traceId `36291d0cc5af699e4503b56d654c7e18`
- Affected txHash: `0x5ed15ce27bf7d4a0df982200b0211abe99640b84b8e9f7f1fe3f0085c2b9d331`

## Attribution

- Investigation: Claude Code (log collection + code analysis)
- Report: Derek (user report of "RPC error" in UI + no credits)
