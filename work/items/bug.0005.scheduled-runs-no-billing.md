---
id: bug.0005
type: bug
title: "Scheduled runs invisible in Activity — internal route bypasses RunEventRelay billing"
status: done
priority: 0
estimate: 2
summary: POST /api/internal/graphs/{graphId}/runs drains graph stream without processing usage_report events, so scheduled runs never write charge_receipts. Activity dashboard (now receipts-only) shows no data for recurring runs.
outcome: Scheduled graph runs produce charge_receipts identical to UI chat runs; Activity dashboard shows both trigger types.
spec_refs: graph-execution, unified-graph-launch, temporal-patterns
assignees: derekg1729
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-09
labels: [billing, scheduler, regression]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

## Problem

`/activity` dashboard shows usage data from UI chats only. Recurring scheduled runs are completely invisible — zero rows, zero cost, zero tokens.

## Root Cause

Two distinct execution paths exist for graph runs, but only one has a billing subscriber:

| Path              | Entry                                                                                                         | Billing                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **UI chat**       | `completionStream()` → `createAiRuntime().runChatStream()` → `RunEventRelay` wraps `graphExecutor.runGraph()` | `usage_report` events → `commitUsageFact()` → `recordChargeReceipt()`                                |
| **Scheduled run** | `POST /api/internal/graphs/{graphId}/runs` → `executor.runGraph()` **directly**                               | Stream drained: `for await (const _event of result.stream) {}` — `usage_report` events **discarded** |

The internal route handler (`src/app/api/internal/graphs/[graphId]/runs/route.ts:336-352`) calls `executor.runGraph()` directly, bypassing `createAiRuntime()` and its `RunEventRelay`. The `usage_report` events from graph providers are consumed and thrown away — no billing subscriber processes them.

**Why this wasn't visible before commit 4fe662fd:** The old Activity dashboard queried LiteLLM `/spend/logs` API directly (by `end_user`). LiteLLM records all LLM calls regardless of our billing pipeline. Scheduled runs made LLM calls through LiteLLM, so they appeared in Activity. After 4fe662fd switched Activity to read only from `charge_receipts`, the gap became visible.

## Key Files

| File                                                          | Role                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/app/api/internal/graphs/[graphId]/runs/route.ts:336-352` | **Bug site**: drains stream without billing                           |
| `src/features/ai/services/ai_runtime.ts:184-355`              | `RunEventRelay` — billing subscriber that the internal route bypasses |
| `src/features/ai/services/billing.ts:203-321`                 | `commitUsageFact()` — never called for scheduled runs                 |
| `src/app/_facades/ai/activity.server.ts`                      | Activity facade — now reads charge_receipts only                      |

## Requirements

- Scheduled graph runs MUST produce `charge_receipts` rows identical in structure to UI chat runs
- Activity dashboard (`/activity`) MUST show scheduled runs with cost, tokens, and model
- `AI_BILLING_COMMIT_COMPLETE` structured log event MUST fire for scheduled runs
- Fix MUST be minimal — this is intentionally short-lived; task.0007 makes it redundant
- Per ONE_LEDGER_WRITER: billing MUST go through `commitUsageFact()`, not direct `recordChargeReceipt()`
- Per IDEMPOTENT_CHARGES: `sourceReference` format MUST be `runId/attempt/usageUnitId`

## Allowed Changes

- `src/app/api/internal/graphs/[graphId]/runs/route.ts` — add inline billing drain to the stream consumption loop
- `tests/stack/` — add or extend stack test asserting scheduled runs produce `charge_receipts`
- NO changes to `RunEventRelay`, `billing.ts`, `GraphExecutorPort`, or the factory — those are task.0007's scope

## Plan

- [ ] Read `src/app/api/internal/graphs/[graphId]/runs/route.ts` and locate the `for await (const _event of result.stream) {}` drain loop (~line 353)
- [ ] Import `commitUsageFact` from `@/features/ai/services/billing` (app layer can import features)
- [ ] Build `RunContext` from the handler's existing `runId` and `ingressRequestId` variables
- [ ] Replace the empty drain with an inline billing loop:
  ```typescript
  for await (const event of result.stream) {
    if (event.type === "usage_report") {
      await commitUsageFact(event.fact, runContext, accountService, log);
    }
  }
  ```
- [ ] Resolve `accountService` — use `getContainer().accountService` or pass from the handler's existing billing account resolution
- [ ] Add stack test: trigger scheduled graph run → assert `charge_receipts` row exists with `receipt_kind='llm'`
- [ ] Run `pnpm check` — no type errors
- [ ] Run `pnpm test:stack:dev` — billing stack tests pass

## Validation

```bash
pnpm check                # lint + type + format
pnpm test:stack:dev       # full stack tests (billing assertions)
```

**Expected:** All pass. Scheduled run produces `charge_receipts` row. `AI_BILLING_COMMIT_COMPLETE` log fires.

## Review Checklist

- [ ] **Work Item:** `bug.0005` linked in PR body
- [ ] **Spec:** ONE_LEDGER_WRITER, IDEMPOTENT_CHARGES, BILLING_INDEPENDENT_OF_CLIENT upheld
- [ ] **Tests:** stack test covers scheduled run → charge_receipts
- [ ] **Reviewer:** assigned and approved
- [ ] **Scope:** No RunEventRelay or factory changes (those are task.0007)

## PR / Links

-

## Attribution

-
