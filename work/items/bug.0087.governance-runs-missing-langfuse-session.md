---
id: bug.0087
type: bug
title: "Governance runs invisible in Langfuse Sessions — missing sessionId on scheduled caller"
status: done
priority: 1
estimate: 1
summary: Internal graph run route builds LlmCaller without sessionId, so governance traces have no Langfuse session grouping and don't appear in Sessions view. Traces exist but are orphaned.
outcome: Governance runs appear in Langfuse Sessions view grouped by schedule, with same trace quality as user-initiated runs.
spec_refs: [unified-graph-launch, observability]
assignees: []
credit:
project: proj.system-tenant-governance
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-17
labels: [observability, governance, langfuse]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Governance runs invisible in Langfuse Sessions

## Requirements

### Observed

Governance scheduled runs don't appear in Langfuse. Only user-initiated chat runs are visible. The traces DO exist (the `ObservabilityGraphExecutorDecorator` fires for all paths), but they lack `sessionId`, making them invisible in Langfuse's Sessions view and hard to correlate.

**User path** (`src/app/_facades/ai/completion.server.ts:198-209`):

```typescript
const caller: LlmCaller = {
  billingAccountId: billingAccount.id,
  virtualKeyId: billingAccount.defaultVirtualKeyId,
  requestId: ctx.reqId,
  traceId: ctx.traceId,
  userId: input.sessionUser.id,
  // Derive sessionId from stateKey for Langfuse session grouping
  ...(input.stateKey && {
    sessionId: deriveSessionId(billingAccount.id, input.stateKey),
  }),
};
```

**Governance path** (`src/app/api/internal/graphs/[graphId]/runs/route.ts:326-333`):

```typescript
const caller = {
  billingAccountId: grant.billingAccountId,
  virtualKeyId: billingAccount.defaultVirtualKeyId,
  requestId: ctx.reqId,
  traceId: ctx.traceId,
  userId: grant.userId,
  // ← NO sessionId
};
```

The decorator at `src/adapters/server/ai/observability-executor.decorator.ts:118-121` conditionally includes sessionId:

```typescript
const sessionId = truncateSessionId(caller.sessionId);
langfuseTraceId = this.langfuse.createTraceWithIO({
  traceId,
  ...(sessionId && { sessionId }),  // omitted when undefined
```

### Expected

Governance runs should appear in Langfuse Sessions, grouped by schedule ID, with the same trace completeness as user-initiated runs.

### Reproduction

1. Trigger a governance scheduled run (or wait for Temporal schedule to fire)
2. Open Langfuse → Sessions view
3. Observe: only user chat sessions appear; governance runs are absent
4. Open Langfuse → Traces view (all traces) — governance traces ARE there, but orphaned (no session)

### Impact

- Cannot monitor governance run quality, latency, or cost in Langfuse
- Cannot compare governance vs user execution patterns
- Violates unified-graph-launch spec invariant on observability consistency

### Relation to unified-graph-launch.md

This is an **observability inconsistency** that the unified graph launch spec (`docs/spec/unified-graph-launch.md`) identifies in its Context section: "dual-path creates inconsistency in billing, observability, and durability guarantees." The fix is independent of the full Temporal unification — it's a missing field on the caller object in the existing internal route.

## Allowed Changes

- `src/app/api/internal/graphs/[graphId]/runs/route.ts` — add `sessionId` to caller object
- `tests/stack/ai/langfuse-observability.stack.test.ts` — add test coverage for scheduled path sessionId

## Plan

- [ ] Add `sessionId` to caller in internal route, derived from `idempotencyKey` (already computed at line 150, SHA256 hash already computed as `stateKey` at line 352-354)
- [ ] Use `deriveSessionId()` or equivalent pattern: `gov:{billingAccountId}:s:{sha256(idempotencyKey)[0:32]}` — prefix `gov:` distinguishes governance sessions from user sessions
- [ ] Verify traces appear in Langfuse Sessions view after fix

## Validation

**Command:**

```bash
# After fix, run a governance graph and check Langfuse traces have sessionId
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/ai/langfuse-observability.stack.test.ts
```

**Expected:** Governance run traces include sessionId; traces appear in Langfuse Sessions view.

## Review Checklist

- [ ] **Work Item:** `bug.0087` linked in PR body
- [ ] **Spec:** unified-graph-launch observability consistency upheld
- [ ] **Tests:** stack test covers governance caller sessionId
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
