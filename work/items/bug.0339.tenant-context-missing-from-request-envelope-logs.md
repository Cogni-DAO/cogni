---
id: bug.0339
type: bug
title: Tenant context missing from request-envelope logs — Loki can't slice by user/billing
status: needs_merge
priority: 2
rank: 30
estimate: 1
summary: "`wrapRouteHandlerWithLogging` emits `request received` / `request complete` / `request warning handled` / `request failed` per HTTP request with `routeId + reqId + method + status + durationMs`, but NOT `billing_account_id` or `user_id`. Domain events layered on top (e.g. `poly.copy_trade.targets.create_success`) carry `target_wallet + target_id` but also lack tenant. Result: Loki queries can't slice `/api/v1/poly/copy-trade/targets` by tenant without parsing POST bodies. Surfaced while validating bug.0338 on candidate-a — I had to correlate my own bearer-token timestamps against `create_success` events to attribute POSTs to tenants, because neither the envelope nor the domain event carries `user_id`."
outcome: "Every log line inside a request handler (envelope start/end/warn/error AND any feature/domain logs) carries `user_id` (and `billing_account_id` when resolved) without each route re-remembering to add them. Ops can filter Loki by tenant with a single `|~ <user_id>` without touching route code."
spec_refs:
  - observability
assignees: derekg1729
credit:
project:
branch: fix/bug-0339-tenant-context-envelope-logs
pr: https://github.com/Cogni-DAO/node-template/pull/962
deploy_verified: true
reviewer:
revision: 0
blocked_by:
created: 2026-04-20
updated: 2026-04-20
labels: [observability, logging, multi-tenant, request-context]
external_refs:
  - nodes/poly/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts
  - packages/node-shared/src/observability/server/helpers.ts
  - work/items/bug.0338.poly-phase-a-drops-system-tenant-target-wallets.md
---

# Tenant context missing from request-envelope logs

> Surfaced during bug.0338 candidate-a validation on 2026-04-20. Two tenants POSTed to `/api/v1/poly/copy-trade/targets` in the same window; Loki couldn't distinguish their rows because `create_success` carried only `target_wallet + target_id`, not `user_id` or `billing_account_id`. The request envelope (`routeId + reqId + method`) didn't help either.

## Reproducer

1. Agent A + Agent B both register via `/api/v1/agent/register` (distinct tenants).
2. Both POST a target to `/api/v1/poly/copy-trade/targets` within seconds.
3. `{app="cogni-template", namespace="cogni-candidate-a"} |~ "poly.copy_trade.targets.create_success"` returns two lines — indistinguishable by tenant without cross-referencing bearer timestamps.

## Fix shape

`wrapRouteHandlerWithLogging` already binds `routeId + reqId + method` into the child logger at request start. Extend the same binding to include `user_id` (and `billing_account_id` when cheaply resolvable) after auth resolves — pino `child()` semantics mean every subsequent log line on that logger inherits the fields for free. No per-route boilerplate, no new domain events, zero new log volume.

- After `getSessionUser()` returns in the wrap handler, rebind `ctx.log = ctx.log.child({ user_id: sessionUser.id })`.
- `billing_account_id` is NOT always resolved per-request (some routes never look it up). Leave tenant resolution to route-level code; `user_id` alone is sufficient to slice by RLS key (the 1:1 billing ↔ user model in Phase A).
- Optional: feature helper `bindBillingContext(ctx, billingAccountId)` for routes that do resolve it (POST `/targets` already does).

## Not in scope

- Per-domain event inventory. The envelope already emits `request complete {status, durationMs}` with enough fields to be the terminal event per request. Domain `*_success` / `*_failed` events on top of that are usually duplicate instrumentation — a separate cleanup.
- Adding `user_id` as a Prometheus label. Cardinality forbids it; Loki slicing is the correct plane.

## Design

### Outcome

Every log line inside any instrumented HTTP request handler (envelope `request received` / `request complete` / `request warning handled` / `request failed` **plus** every downstream feature/domain log emitted via `ctx.log`) carries `userId` when the request is authenticated. Ops slice Loki by tenant with `|~ "<userId>"` — no per-route boilerplate, no new domain events, zero added log volume.

### Approach

**Solution**: One-line change in the shared `createRequestContext` factory. Today it already receives `meta.session?: SessionUser` and constructs a pino child logger with `reqId + traceId + route + method`. Add `userId: meta.session?.id` to that same `.child({...})` call. Pino drops `undefined` fields, so anonymous / `mode: "none"` requests emit the envelope exactly as before; authenticated requests ride `userId` through every descendant logger for free (pino child semantics).

**Reuses**:

- Existing `SessionUser.id` (`packages/node-shared/src/auth/session.ts` — "Primary database identifier (UUID)").
- Existing `session` parameter already wired through all four node wrap handlers (`nodes/{node-template,operator,poly,resy}/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts:149`, `nodes/node-template/...:180`).
- Existing observability spec convention (`docs/spec/observability.md:120` — `userId` is already listed as a high-cardinality JSON field).

**Rejected**:

- _Rebind `ctx.log` in each node's `wrapRouteHandlerWithLogging` after auth resolves_ (the shape the bug report initially proposed). Rejected: duplicates the same 3-line change across 4 nodes, and `createRequestContext` already has `session` in hand at construction time — rebinding later is strictly redundant.
- _Add `billingAccountId` to the envelope._ Rejected: not cheaply resolvable per-request; many routes never look it up. Leave to route-local code, per bug item "Not in scope".
- _Emit a new `tenant_bound` domain event._ Rejected: adds log volume without improving sliceability beyond what child-logger inheritance gives us for free.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] ENVELOPE_CARRIES_USERID: When `session` is provided to `createRequestContext`, every log line emitted via `ctx.log` (or any `.child()` of it) includes `userId`. Anonymous / `mode:"none"` requests are unchanged — no `userId` field.
- [ ] NO_PER_ROUTE_BOILERPLATE: Fix lives in one shared factory. No node's `wrapRouteHandlerWithLogging.ts` needs editing.
- [ ] FIELD_NAMING: Uses `userId` (camelCase), matching `docs/spec/observability.md:120` and existing envelope fields (`reqId`, `traceId`, `routeId`).
- [ ] NO_NEW_EVENTS: No new domain log events added; no `logRequestStart/End/Warn/Error` signature changes.
- [ ] SIMPLE_SOLUTION: Leverages pino `.child({...})` inheritance over bespoke per-route rebinding (spec: architecture).
- [ ] ARCHITECTURE_ALIGNMENT: Shared factory remains the single source of request-scoped logger construction (spec: observability).

### Files

<!-- High-level scope -->

- Modify: `packages/node-shared/src/observability/context/factory.ts` — add `userId: meta.session?.id` to the `.child({...})` call in `createRequestContext`.
- Test: `packages/node-shared/src/observability/context/factory.test.ts` — new unit test covering (a) `userId` appears on child logger bindings when session is provided, (b) `userId` absent when session is omitted.

## Validation

- **exercise**: Two agents POST a target within 10s of each other on candidate-a.
- **observability**: `{...} |~ "request complete" |~ "<agent-A userId>"` returns only agent A's request line; same query with agent B's `userId` returns only agent B's. Same applies to `request warning handled` / `request failed`.
