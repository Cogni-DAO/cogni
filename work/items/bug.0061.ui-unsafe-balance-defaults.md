---
id: bug.0061
type: bug
title: "UI balance display hides negative with $0 default"
status: done
priority: 2
estimate: 1
summary: "Chat and credits pages default balance to $0 when missing, hiding negative account state. After bug.0050 merges, UI must show actual balances with red styling for negatives."
outcome: "Chat and credits pages display actual balance (including negative in red). No unsafe ?? 0 defaults."
spec_refs: []
assignees: []
credit:
project: proj.payments-enhancements
branch: fix/bug.0061-ui-balance
pr:
reviewer:
created: 2026-02-15
updated: 2026-02-15
labels: [billing, payments, ui, p2]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 2
---

# bug.0061 — UI balance display hides negative

## Requirements

### Observed

**Chat page** (`src/app/(app)/chat/page.tsx:83`):

```typescript
const balance = creditsData?.balanceCredits ?? 0;
```

**Credits page** (`src/app/(app)/credits/CreditsPage.client.tsx:72`):

```typescript
const balanceDisplay = summaryQuery.isLoading
  ? "—"
  : formatDollars(summaryQuery.data?.balanceCredits ?? 0);
```

Both default to $0 when balance missing, deceiving user about true negative state.

### Expected

1. Display actual balance (including negative) without unsafe `?? 0` defaults
2. If balance < 0: render in red with negative symbol (-$X.XX)
3. Chat page: block paid models if balance < 0

### Reproduction

1. Prerequisite: bug.0050 merged (API accepts negative balances)
2. Set account balance < 0
3. Navigate `/chat` and `/credits`
4. Balance shows actual value in red (-$296.36), not $0.00

## Allowed Changes

- `src/app/(app)/chat/page.tsx` — type-safe null handling for balance
- `src/app/(app)/credits/CreditsPage.client.tsx` — type-safe null handling, red styling for negative
- Component tests

## Plan

- [ ] bug.0050 merged first (API accepts negative balances)
- [ ] Chat page: handle `balance` as `number | null`, display raw value
- [ ] Chat: block paid models if `balance <= 0`
- [ ] Credits page: handle `balance` as `number | null`, display raw value
- [ ] Credits: apply red styling (e.g., `text-destructive`) if `balance < 0`
- [ ] Tests: negative balance displays correctly in red

## Validation

```bash
pnpm typecheck && pnpm test:component
```

Expected: Negative balance displays without clamping, styled in red.

## Review Checklist

- [ ] **Work Item**: `bug.0061` linked in PR
- [ ] **Depends on**: bug.0050 merged first
- [ ] **Tests**: negative balance red styling covered
- [ ] **Reviewer**: assigned and approved
