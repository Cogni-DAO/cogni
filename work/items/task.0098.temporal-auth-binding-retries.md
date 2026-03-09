---
id: task.0098
type: task
title: "Temporal retry workflow for failed identity bindings + scheduled backstop"
status: needs_triage
priority: 3
rank: 99
estimate: 1
summary: "On SIWE binding failure, enqueue a RetryIdentityBindingWorkflow via Temporal with deterministic workflowId. Add hourly schedule scanning for users missing bindings."
outcome: "Auth login never blocked by binding failures. Missed bindings retried automatically via Temporal. Hourly backstop catches any gaps."
spec_refs:
  - decentralized-identity
assignees: []
credit:
project: proj.decentralized-identity
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0089
deploy_verified: false
created: 2026-02-21
updated: 2026-02-21
labels: [identity, auth, temporal]
external_refs:
---

# Temporal Retry Workflow for Failed Identity Bindings

## Problem

In `src/auth.ts`, `createBinding()` is wrapped in try/catch so login isn't blocked by binding failures. But a failed binding means the user has no `user_bindings` row — identity resolution in the ledger pipeline won't find them. Currently this is a silent gap.

## Requirements

- On `createBinding()` failure in auth callback, start a `RetryIdentityBindingWorkflow` via Temporal
  - Deterministic workflow ID: `bind:{provider}:{externalId}` (idempotent — duplicate starts are no-ops)
  - Workflow runs an Activity calling the same `createBinding()` with Temporal retry/backoff policy
  - On success: done. On persistent failure: Temporal keeps retrying per policy
- Add a scheduled backstop (hourly Temporal Schedule):
  - Scan for `users` rows with `wallet_address IS NOT NULL` but no matching `user_bindings` row
  - Enqueue `RetryIdentityBindingWorkflow` for each missing binding
  - Covers missed workflow starts (process crash, Temporal unavailable at auth time)

## Allowed Changes

- `src/auth.ts` — in the catch block, enqueue Temporal workflow
- `services/scheduler-worker/src/workflows/retry-identity-binding.workflow.ts` (new)
- `services/scheduler-worker/src/activities/identity.ts` (new)
- `services/scheduler-worker/src/worker.ts` — register workflow

## Plan

- [ ] Create `RetryIdentityBindingWorkflow` with single `createBinding` Activity
- [ ] Wire deterministic workflow start into auth.ts catch block
- [ ] Create hourly schedule scanning for missing bindings
- [ ] Register workflow in scheduler-worker

## Validation

```bash
pnpm check
pnpm --filter scheduler-worker build
```

## PR / Links

-

## Attribution

-
