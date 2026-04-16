---
id: task.0212
type: task
title: "Unified usage reporting — emit usage_report for all LLM providers (platform, codex, openai-compatible)"
status: done
priority: 1
rank: 4
estimate: 2
summary: "BYO runs (codex, openai-compatible) produce zero usage records — inproc adapter gates on litellmCallId, billing decorator defers to LiteLLM callback that never fires. Fix: always emit usage_report, write receipts directly for non-platform sources."
outcome: "Every LLM call — platform or BYO — writes a charge_receipt with standardized token counts and source attribution. Dashboard shows all runs. BYO receipts show $0 platform cost with real token usage."
spec_refs: [multi-provider-llm, billing-ingest-spec]
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: feat/task-0212-unified-usage
pr: https://github.com/Cogni-DAO/node-template/pull/652
reviewer:
created: 2026-03-27
updated: 2026-03-28
labels: [ai, byo-ai, billing, observability]
external_refs: []
revision: 0
blocked_by: []
deploy_verified: false
---

## Design

### Outcome

Every LLM call writes a `charge_receipt` with standardized fields (tokens, model, source, provider) regardless of backend. Dashboard `/api/v1/activity` shows BYO runs alongside platform runs. BYO receipts have `charged_credits: 0` and `response_cost_usd: 0` — accurate, not missing.

### Problem

Three bugs conspire to make BYO runs invisible:

1. **InProc adapter gates on `litellmCallId`** (`inproc-completion-unit.adapter.ts:293`) — BYO adapters don't return one, so no `usage_report` event is emitted.
2. **Billing decorator defers to LiteLLM callback** (`CALLBACK_IS_SOLE_WRITER`) — but no callback fires for non-LiteLLM providers, so nothing is ever written.
3. **`commitUsageFact` treats non-litellm unknown cost as invariant violation** (`billing.ts:123-130`) — even though BYO cost is legitimately $0 to the platform.

All three adapters already return token counts in `LlmCompletionResult.usage`. The data exists — it's just not flowing to receipts.

### Approach

**Solution**: Three surgical changes to the existing pipeline — no new services, no new tables, no new endpoints.

**Change 1 — InProc adapter: always emit usage_report**

Remove the `if (result.litellmCallId)` gate. Emit for all runs:

```ts
// After awaiting final result:
const usageSource = scope.usageSource; // NEW field on ExecutionScope
// DETERMINISTIC_BYO_USAGE_ID: BYO usageUnitId must be deterministic for retry
// idempotency. crypto.randomUUID() would generate a new key per stream consumption,
// defeating the DB unique constraint on (source_system, source_reference).
const usageUnitId = result.litellmCallId ?? `${runId}/${attempt}/byo`;
const fact: UsageFact = {
  runId, attempt, graphId,
  source: usageSource,          // from scope, not hardcoded "litellm"
  executorType: "inproc",
  usageUnitId,                  // deterministic key for BYO
  inputTokens: result.usage?.promptTokens,
  outputTokens: result.usage?.completionTokens,
  ...(result.model && { model: result.model }),
  // Respect any cost the adapter reports (future pay-per-token providers),
  // default to 0 when absent (BYO = zero platform cost).
  costUsd: result.providerCostUsd ?? 0,
};
yield { type: "usage_report", fact };
```

Platform runs with missing `litellmCallId` remain a CRITICAL error (existing behavior). BYO runs get a deterministic key — the strict Zod schema passes, and the idempotency constraint survives retries.

**Change 2 — ExecutionScope: carry `usageSource`**

Add `usageSource: SourceSystem` to `ExecutionScope`. The factory sets it from `provider.usageSource` when creating the scope. The provider already declares this field (`ModelProviderPort.usageSource`).

**Change 3 — Rename billing decorator to usage commit point**

The decorator's current contract says "validates but does not persist" — that contract is broken by this change, so we redefine it cleanly rather than sneaking in a side-effect.

Rename class: `BillingGraphExecutorDecorator` → `UsageCommitDecorator`. Update file header, class doc, and invariant comment to reflect the new contract: **"Validates usage_report events. For non-platform sources, commits receipts directly. For platform sources, defers to LiteLLM callback."**

The decorator needs `accountService` and `RunContext` injected (two new constructor parameters).

After validation passes:

- `source !== "litellm"` → call `commitUsageFact()` directly (synchronous in stream — `BILLING_NEVER_THROWS` guarantees no exception). This adds ~<50ms DB write latency before the `done` event. Acceptable for BYO; if it becomes a problem, fire-and-forget with `.catch(log.error)`.
- `source === "litellm"` → defer to callback (existing behavior, unchanged).

```
Platform:  usage_report → validate → consume → (async) LiteLLM callback → commitUsageFact ✅
BYO:       usage_report → validate → commitUsageFact → consume ✅
```

`commitUsageFact` handles idempotency via DB unique constraint — safe against double-writes.

**Reuses**:

- Existing `UsageFact` type and `UsageFactStrictSchema` — no schema changes
- Existing `commitUsageFact()` — already handles `costUsd: 0` correctly (`typeof 0 === "number"` passes)
- Existing `charge_receipts` table — `source_system` column already supports "codex" and "ollama"
- Existing `ModelProviderPort.usageSource` — already declared on all three providers
- Existing `/api/v1/activity` — queries charge_receipts, will show BYO runs automatically

**Rejected**:

- **Separate BYO billing pipeline**: More moving parts, same outcome. The existing pipeline works — we just need to remove the LiteLLM-only gate.
- **New UsageIngestPort abstraction**: Over-engineering. `commitUsageFact()` is already the universal writer. Adding a second caller (the decorator) is sufficient.
- **BYO-specific Zod schema**: Unnecessary. Deterministic keys satisfy the strict schema. Keep one validation path.
- **crypto.randomUUID() for BYO usageUnitId**: Breaks retry idempotency — a new UUID per stream consumption means the DB unique constraint can't dedup retries. Deterministic `${runId}/${attempt}/byo` is equally simple and survives Temporal retries.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] PROVIDER_AWARE_USAGE: `UsageFact.source` reflects actual provider via `scope.usageSource`, never hardcoded "litellm" (spec: multi-provider-llm)
- [ ] BYO_ZERO_PLATFORM_COST: Non-platform runs emit `costUsd: 0` — not undefined, not omitted. Zero is a real value. (spec: multi-provider-llm — BILLING_VOCABULARY)
- [ ] USAGE_ALWAYS_EMITTED: InProc adapter emits `usage_report` for every successful completion, regardless of provider. No conditional skip. (spec: multi-provider-llm — PROVIDER_AWARE_USAGE)
- [ ] PLATFORM_CALLID_STILL_REQUIRED: Missing `litellmCallId` on platform runs remains a CRITICAL error (spec: billing-ingest — ONE_BILLING_PATH)
- [ ] ONE_LEDGER_WRITER: `commitUsageFact()` remains the sole caller of `recordChargeReceipt()`. Two callers of commitUsageFact (ingest route for platform, decorator for BYO) is fine. (spec: billing-ingest)
- [ ] DETERMINISTIC_BYO_USAGE_ID: BYO `usageUnitId` is `${runId}/${attempt}/byo` — deterministic, survives retries. Never `crypto.randomUUID()`. (spec: billing-ingest — CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID)
- [ ] SIMPLE_SOLUTION: Three surgical edits to existing files. No new services, tables, endpoints, or abstractions.
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal pattern — scope carries provider metadata, decorator handles billing concern (spec: architecture)

### Spec Update

Update `docs/spec/billing-ingest.md` invariant table:

- **CALLBACK_IS_SOLE_WRITER** → rename to **CALLBACK_WRITES_PLATFORM_RECEIPTS**: "LiteLLM callback writes receipts for platform runs. BYO receipts are written directly by `UsageCommitDecorator` via `commitUsageFact()`. Both paths converge on the same idempotent writer."
- **ADAPTERS_NEVER_BILL** — unchanged. Adapters emit usage events; the decorator commits. Adapters don't call commitUsageFact.

Update `docs/spec/multi-provider-llm.md` — mark PROVIDER_AWARE_USAGE as implemented.

### Files

#### Modify — execution scope

- Modify: `apps/operator/src/adapters/server/ai/execution-scope.ts` — add `usageSource: SourceSystem` to `ExecutionScope`

#### Modify — factory (sets usageSource on scope)

- Modify: `apps/operator/src/bootstrap/graph-executor.factory.ts` — pass `provider.usageSource` to scope when creating `ExecutionScope`

#### Modify — inproc adapter (always emit usage_report)

- Modify: `apps/operator/src/adapters/server/ai/inproc-completion-unit.adapter.ts` — remove `if (result.litellmCallId)` gate, read `usageSource` from scope, deterministic `${runId}/${attempt}/byo` when no `litellmCallId`, `costUsd: result.providerCostUsd ?? 0`

#### Modify — billing decorator → usage commit decorator

- Rename: `apps/operator/src/adapters/server/ai/billing-executor.decorator.ts` → `usage-commit.decorator.ts` — redefine contract from "validate only" to "validate + commit for non-platform". Inject `accountService` + `RunContext`. Update file header, class doc, invariant comments.
- Modify: `apps/operator/src/bootstrap/graph-executor.factory.ts` — pass `accountService` + `RunContext` to decorator constructor, update import

#### Modify — specs

- Modify: `docs/spec/billing-ingest.md` — update CALLBACK_IS_SOLE_WRITER invariant
- Modify: `docs/spec/multi-provider-llm.md` — mark PROVIDER_AWARE_USAGE implemented

#### Test

- Test: `apps/operator/tests/unit/adapters/server/ai/inproc-completion-unit.test.ts` — verify usage_report emitted for codex/ollama sources with deterministic usageUnitId and costUsd: 0
- Test: `apps/operator/tests/unit/adapters/server/ai/usage-commit.decorator.test.ts` — verify commitUsageFact called directly for non-litellm, deferred for litellm

## Validation

- [ ] BYO (codex) run: `charge_receipts` row exists with `source_system='codex'`, `charged_credits=0`, token counts populated
- [ ] BYO (openai-compatible) run: `charge_receipts` row exists with `source_system='ollama'`, `charged_credits=0`, token counts populated
- [ ] Platform run: unchanged behavior — callback writes receipt, `source_system='litellm'`
- [ ] Platform run missing litellmCallId: still throws CRITICAL error
- [ ] `/api/v1/activity`: BYO runs visible alongside platform runs
- [ ] No duplicate receipts on retry (deterministic `${runId}/${attempt}/byo` key deduplicates)
- [ ] `pnpm check` passes

## Notes

- `OpenAiCompatibleModelProvider.usageSource` is currently `"ollama"` — semantically imprecise but pragmatically fine. Renaming `SourceSystem` values is a future concern, not a blocker.
- This task implements the `PROVIDER_AWARE_USAGE` invariant from task.0209 / multi-provider-llm spec that was left unfinished.

## Design Review Fixes (2026-03-27)

Three issues caught in review, all addressed:

1. **`crypto.randomUUID()` → deterministic key**: Random UUIDs break retry idempotency. Switched to `${runId}/${attempt}/byo` — stable across retries, deduplicates via DB unique constraint.
2. **`costUsd: 0` hardcoded → `result.providerCostUsd ?? 0`**: Respects any cost the adapter reports (future pay-per-token providers), defaults to 0 when absent. Same behavior today, future-safe.
3. **Decorator contract redefinition**: Renamed `BillingGraphExecutorDecorator` → `UsageCommitDecorator`. The old name and doc said "validates only, never persists" — adding writes without renaming would leave a half-broken contract. New name makes the responsibility explicit.
