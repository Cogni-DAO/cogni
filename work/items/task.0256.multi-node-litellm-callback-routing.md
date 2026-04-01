---
id: task.0256
type: task
title: "Multi-Node LiteLLM Callback Routing: Dynamic Per-Node Billing Ingest"
status: needs_design
priority: 1
rank: 10
estimate: 3
summary: "Route LiteLLM generic_api callbacks to the correct node app when multiple nodes share a single LiteLLM proxy. Each node's billing data must remain sovereign."
outcome: "All nodes sharing one LiteLLM instance receive their own billing callbacks with correct charge_receipt attribution, no cross-node data leakage."
spec_refs: billing-ingest-spec, node-operator-x402-spec, node-operator-contract
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: feat/multi-node-cleanup
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [billing, litellm, multi-node, infra]
external_refs:
---

# Multi-Node LiteLLM Callback Routing: Dynamic Per-Node Billing Ingest

## Context

Today, LiteLLM's `generic_api` callback fires to a single hardcoded endpoint:

```yaml
GENERIC_LOGGER_ENDPOINT=http://app:3000/api/internal/billing/ingest
```

This works for single-node deployments but breaks when multiple nodes (operator `:3000`, poly `:3100`, resy `:3300`) share the same LiteLLM proxy. Only `app:3000` receives callbacks; poly and resy billing data is lost.

**Design constraint (from user):** Use ONE shared LiteLLM instance with dynamic per-node callback routing. Per-node LiteLLM (METERING_IS_LOCAL from x402 spec) is the long-term sovereign vision, but within the operator repo, nodes share infrastructure for resource efficiency. LiteLLM is heavy enough that N instances is undesirable today.

**Spec tension:** `METERING_IS_LOCAL` (x402 invariant 15) says each node runs its own LiteLLM. This task intentionally defers that for operator-repo nodes, which share infra by design. The invariant still holds for sovereign (non-operator) nodes deployed independently.

**Related but orthogonal:** BYO-AI / llama adapter requests should also flow through LiteLLM for unified metering. That work can layer on top of the routing mechanism built here but is out of scope.

## Requirements

- LiteLLM callbacks reach the correct node's `/api/internal/billing/ingest` endpoint based on which node originated the LLM request
- Each node's `charge_receipts` contain only that node's billing data (data sovereignty)
- `CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID` invariant preserved (duplicate callbacks are no-ops)
- `CALLBACK_AUTHENTICATED` invariant preserved (Bearer token auth on ingest endpoint)
- `INGEST_ENDPOINT_IS_INTERNAL` invariant preserved (Docker-internal only, not exposed through Caddy)
- `NO_SYNCHRONOUS_RECEIPT_BARRIER` invariant preserved (user response never blocked on callback)
- Works in both local dev (`pnpm dev:stack:full`) and containerized (`docker:dev:stack`) modes
- No regression to single-node deployments (operator-only still works unchanged)

## Design Questions (needs_design)

These must be answered before moving to `needs_implement`:

### 1. Routing Mechanism

How does the callback know which node to reach? Options to evaluate:

- **A. Node identity in request metadata:** Each node's app includes a `node_id` in LiteLLM request metadata (e.g., `x-litellm-spend-logs-metadata: {"node_id": "poly"}`). LiteLLM passes metadata through to callback. A callback router inspects and forwards.
- **B. LiteLLM virtual keys per node:** Each node gets its own LiteLLM API key. LiteLLM supports per-key team/org configuration -- investigate if per-key callback endpoint is supported.
- **C. Custom LiteLLM callback handler:** Replace `generic_api` with a custom callback (Python) that reads metadata and routes to the correct node endpoint.
- **D. Centralized ingest + fan-out:** One endpoint receives all callbacks, reads node identity from metadata, writes to the correct node's database. Requires the router to have DB connections to all node databases.
- **E. Callback proxy/nginx router:** Lightweight proxy between LiteLLM and nodes that inspects payload and routes.

### 2. Node Identity Propagation

How does each node stamp its identity on outgoing LLM requests so callbacks can be routed back?

- Is `metadata.spend_logs_metadata` the right vehicle? (Already used for `run_id`)
- Should it be a request header (`x-litellm-node-id`) or body metadata?
- Which layer sets this -- the LLM port adapter, the graph executor, or middleware?

### 3. Auth Token Strategy

- Shared `BILLING_INGEST_TOKEN` across all nodes (simpler, current state)?
- Per-node tokens (better isolation, harder to manage)?
- Does the routing mechanism affect this decision?

### 4. Database Routing

- If using centralized ingest (option D), how does the router access each node's DB?
- If using per-node endpoints (options A/B/C/E), each node writes to its own DB -- simpler but requires correct routing.

## Allowed Changes

- `infra/compose/runtime/configs/litellm.config.yaml` -- LiteLLM callback configuration
- `infra/compose/runtime/docker-compose.yml` -- LiteLLM service env vars, potential new router service
- `infra/compose/runtime/docker-compose.dev.yml` -- same for dev
- `nodes/node-template/app/src/app/api/internal/billing/ingest/route.ts` -- if ingest endpoint needs node-aware changes
- `nodes/node-template/app/src/contracts/billing-ingest.internal.v1.contract.ts` -- if contract needs node_id field
- LLM port adapter or middleware layer -- to inject node identity into outgoing requests
- New `infra/compose/runtime/configs/` files if a callback router service is needed
- `docs/spec/billing-ingest.md` -- update invariants if routing changes the contract

## Plan

- [ ] **Design spike:** Investigate LiteLLM's `generic_api` callback capabilities -- can it route to multiple endpoints? Does per-key/per-team callback configuration exist? Check LiteLLM docs and source.
- [ ] **Design spike:** Verify metadata pass-through -- confirm that `metadata.spend_logs_metadata` fields set on the request appear in the callback payload (already partially proven by `run_id` usage).
- [ ] **Design decision:** Choose routing mechanism (A-E above) with rationale. Document in this task.
- [ ] **Design decision:** Choose auth token strategy.
- [ ] **Implement:** Node identity injection -- each node stamps its identity on outgoing LLM requests.
- [ ] **Implement:** Callback routing -- route callbacks to the correct node endpoint.
- [ ] **Implement:** Docker Compose wiring -- update compose files for the new routing.
- [ ] **Test:** Verify poly and resy receive their own callbacks in `dev:stack:full` mode.
- [ ] **Test:** Verify single-node (operator-only) deployment still works unchanged.
- [ ] **Test:** Verify idempotency -- duplicate callbacks are still no-ops per node.
- [ ] **Docs:** Update `billing-ingest.md` spec if invariants change.

## Validation

**Command:**

```bash
# After implementation -- verify callbacks reach correct node
pnpm dev:stack:full
# Trigger LLM call from poly node, verify charge_receipt appears in poly DB
# Trigger LLM call from resy node, verify charge_receipt appears in resy DB
# Trigger LLM call from operator, verify charge_receipt appears in operator DB
```

**Expected:** Each node's `charge_receipts` table contains only its own billing entries. No cross-contamination.

```bash
pnpm check
```

**Expected:** All static checks pass.

## Review Checklist

- [ ] **Work Item:** `task.0256` linked in PR body
- [ ] **Spec:** all invariants of `billing-ingest-spec` upheld (especially CHARGE_RECEIPTS_IDEMPOTENT_BY_CALL_ID, CALLBACK_AUTHENTICATED, INGEST_ENDPOINT_IS_INTERNAL)
- [ ] **Spec:** METERING_IS_LOCAL tension documented -- shared LiteLLM is intentional for operator-repo nodes
- [ ] **Tests:** callback routing verified with multi-node dev stack
- [ ] **Tests:** single-node regression test passes
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: task.0029 (original callback billing implementation)
- Related: task.0247 (multi-node CICD deployment)
- Related: task.0245 (multi-node app architecture)
- Spec: `docs/spec/billing-ingest.md`
- Spec: `docs/spec/node-operator-x402.md` (invariant 15: METERING_IS_LOCAL)

## Attribution

-
