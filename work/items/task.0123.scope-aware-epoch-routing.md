---
id: task.0123
type: task
title: "Scope-aware epoch API routing"
status: needs_design
priority: 1
rank: 10
estimate: 3
summary: "Refactor epoch API routes from `/epochs/[id]/...` to `/scopes/[scopeId]/epochs/[id]/...` so the URL explicitly declares scope context. Required before multi-scope support."
outcome: "All epoch endpoints are nested under a scope prefix. The adapter is constructed per-request from the URL's scopeId instead of a server-wide singleton. Existing single-scope deployments continue to work."
spec_refs: attribution-ledger
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-02
updated: 2026-03-02
labels: [governance, multi-scope, routing]
external_refs:
---

# Scope-aware epoch API routing

## Context

Current epoch endpoints use `/api/v1/attribution/epochs/[id]/...` with scope resolved from a server-wide singleton (`getScopeId()` from repo-spec). This works for V0 (single scope per node) but breaks when multiple scopes exist:

- **No caller intent**: The server can't distinguish which scope context a request targets
- **DI bottleneck**: `DrizzleAttributionAdapter` is constructed once with a fixed `scopeId` — can't serve multiple scopes
- **Signing ambiguity**: Different scopes have different approver sets; `/epochs/3/finalize` doesn't declare which approver set to validate against

This task is a **prerequisite for multi-scope support**. Without it, adding a second scope to a node has no way to route requests correctly.

## Requirements

- Scopes may be discovered dynamically via operator node registration (task.0122 §Scope Reconciliation), not only known at boot time. The routing layer must not assume a static set of scopes.
- All epoch endpoints move under `/api/v1/attribution/scopes/[scopeId]/epochs/[id]/...`
- Public epoch endpoints move under `/api/v1/public/attribution/scopes/[scopeId]/epochs/[id]/...`
- The `scopeId` URL param is validated (UUID format) and used to construct the adapter per-request
- Scope mismatch (epoch exists but belongs to different scope) returns 404 — no information leakage (existing `SCOPE_GATED_QUERIES` invariant preserved)
- The EIP-712 signing domain continues to embed `scopeId` (already does — `SIGNATURE_SCOPE_BOUND`)
- Old `/epochs/[id]/...` routes return 301 redirects to the scope-prefixed URL (using the node's default scope) for backwards compatibility during transition, or are removed if no external consumers exist
- Zod contracts updated to reflect new route structure
- Existing tests updated to use new route paths
- `pnpm check` passes

## Allowed Changes

- `src/app/api/v1/attribution/` — route restructuring (new `scopes/[scopeId]/epochs/` directory)
- `src/app/api/v1/public/attribution/` — same restructuring for public routes
- `src/contracts/attribution.*.v1.contract.ts` — route path updates
- `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — no structural changes, but factory/construction may change
- `tests/` — update route paths in all attribution tests
- `docs/spec/attribution-ledger.md` — update API route table

## Plan

- [ ] Design: decide redirect strategy vs. hard cut for old routes (check if any external consumers exist)
- [ ] Move authenticated epoch route handlers from `epochs/[id]/` to `scopes/[scopeId]/epochs/[id]/`
- [ ] Move public epoch route handlers similarly
- [ ] Update adapter construction to derive `scopeId` from the URL param instead of `getScopeId()` singleton
- [ ] Update Zod contracts with new route paths
- [ ] Update all unit/stack/contract tests to use new paths
- [ ] Update attribution-ledger spec API route table
- [ ] Validate: `pnpm check` clean, all attribution tests pass

## Validation

**Command:**

```bash
pnpm check
pnpm test -- --grep "epoch\|attribution"
```

**Expected:** All checks and attribution-related tests pass with new route structure.

## Review Checklist

- [ ] **Work Item:** `task.0123` linked in PR body
- [ ] **Spec:** SCOPE_GATED_QUERIES, SIGNATURE_SCOPE_BOUND invariants upheld
- [ ] **Tests:** all existing epoch tests migrated to new routes
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
