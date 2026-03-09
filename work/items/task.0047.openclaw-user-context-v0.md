---
id: task.0047
type: task
title: "OpenClaw user context v0 — inject PII-safe identity into gateway agent messages"
status: needs_design
priority: 1
estimate: 2
summary: Prepend server-generated <user-context> block (opaque ID, trust tier, style, medium) to OpenClaw gateway agent messages
outcome: Gateway agent sees caller identity and trust level on every session; no PII leaks; trust tier derived from billing account tenure + interaction count
spec_refs: user-context
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [openclaw, auth, identity]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 19
---

# OpenClaw User Context v0

## Requirements

- `UserContext` type and `deriveTrustTier()` pure function exist in `src/core/identity/`
- `formatContextBlock(ctx: UserContext): string` produces `<user-context>` block with all fields
- `SandboxGraphProvider.createGatewayExecution()` prepends context block to user message before `gatewayClient.runAgent()`
- Completion facade resolves `UserContext` inputs (billing account created_at, charge_receipts count) and passes them to the provider
- Gateway `SOUL.md` instructs the agent how to interpret and use the context block
- `communication_style` column added to `users` table (nullable text, migration)
- No PII in context block: no wallet address, no email, no real name, memberSince coarsened to YYYY-MM
- Trust tier is one of 4 bucketed labels, never a raw count or score
- Agent functions correctly when `communicationStyle` is null

## Allowed Changes

- `src/core/identity/` — new directory: `UserContext` type, `deriveTrustTier()`, `formatContextBlock()`
- `src/adapters/server/sandbox/sandbox-graph.provider.ts` — prepend context block in `createGatewayExecution()`
- `src/app/_facades/ai/completion.server.ts` — resolve interaction count, pass to provider
- `packages/db-schema/src/refs.ts` — add `communication_style` column to `users`
- `src/adapters/server/db/migrations/` — migration for new column
- `services/openclaw-gateway/gateway-workspace/SOUL.md` — context usage instructions
- `tests/unit/core/identity/` — unit tests

## Plan

- [ ] Add `communication_style text` column to `users` table (schema + migration)
- [ ] Create `src/core/identity/user-context.ts` with `UserContext` type, `TrustTier` type, `deriveTrustTier()`, `formatContextBlock()`
- [ ] Create `src/core/identity/founder-set.ts` with hardcoded founder wallet addresses
- [ ] Write unit tests for `deriveTrustTier()` (boundary values: 10/7, 100/30, founder match)
- [ ] Write unit tests for `formatContextBlock()` (PII checks: no wallet pattern, no email pattern, YYYY-MM only)
- [ ] Add interaction count query to completion facade or accounts service
- [ ] Modify `SandboxGraphProvider.createGatewayExecution()` to resolve context and prepend block
- [ ] Update gateway `SOUL.md` with user context interpretation instructions
- [ ] Verify with manual gateway test: send message, confirm agent acknowledges trust tier

## Validation

**Command:**

```bash
pnpm test tests/unit/core/identity/
```

**Expected:** All trust tier derivation and context block format tests pass. No wallet addresses or emails in formatted output.

**Command:**

```bash
pnpm check:docs
```

**Expected:** Docs validation passes.

## Review Checklist

- [ ] **Work Item:** `task.0047` linked in PR body
- [ ] **Spec:** all invariants from `user-context.md` upheld (CONTEXT_NO_PII, CONTEXT_OPAQUE_ID, TRUST_TIER_IS_BUCKETED, etc.)
- [ ] **Tests:** unit tests for deriveTrustTier boundary values and formatContextBlock PII safety
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
