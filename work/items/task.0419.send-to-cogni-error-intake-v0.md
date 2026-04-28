---
id: task.0419
type: task
title: "v0 'Send to Cogni' error intake — UI button → API → Temporal queue"
status: needs_design
priority: 1
rank: 1
estimate: 3
summary: "Simplest end-to-end loop for story.0417: an error UI in operator renders a 'Send to Cogni' button; one click POSTs an error report (stack, route, build SHA, correlation id, timestamp window) to a new intake API; the API enqueues a Temporal workflow; a Temporal worker consumes the queue and persists the report (and pulls the matching Loki window) as a queryable work item the operator can pick up. v0 is operator-only, no node-template wiring yet, no auto-fix-PR — just prove the capture-and-enqueue loop is real."
outcome: "On candidate-a, forcing an error in operator and clicking 'Send to Cogni' results in: (1) a tracking ID in the UI, (2) a row in the error-reports persistence layer, (3) a Loki line at the deployed SHA showing the intake event, (4) a Temporal workflow execution visible in the Temporal UI, (5) the worker having pulled the matching Grafana/Loki window and stored it alongside the report. Story.0417 considers v0 done; ports + auto-fix loop are follow-ups."
spec_refs:
assignees: derekg1729
credit:
project: proj.observability-hardening
branch: feat/task-0419-send-to-cogni-error-intake-v0
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [frontend, observability, temporal, error-handling, agent-ux]
external_refs:
  - work/items/story.0417.ui-send-to-cogni-error-button.md
  - work/projects/proj.observability-hardening.md
  - work/projects/proj.workflow-building-monitoring.md
  - work/projects/proj.scheduler-evolution.md
---

# v0 "Send to Cogni" error intake

## Problem

`story.0417` calls for a UI standard: every error has a "Send to Cogni"
button that captures context and opens a fix loop. Before standardizing
that across nodes, we need to prove the simplest possible
end-to-end capture-and-enqueue loop on operator. Without a working v0,
the standard has no teeth.

## Scope (v0)

- **UI:** one shared `<SendToCogniButton />` rendered inside operator's
  existing `error.tsx` route boundaries (added in task.0403). No
  toast / form / fetch-failure surfaces yet.
- **Capture (client):** error name/message/stack, component stack,
  route, build SHA from `/version`, ISO timestamp, browser correlation
  id, optional free-text "what were you doing?".
- **Intake API:** new operator route, e.g. `POST /api/v1/error-report`.
  Validates a Zod contract; returns `{ trackingId, status: "queued" }`.
- **Queue handoff:** intake API enqueues a Temporal workflow
  (`ErrorReportIngestWorkflow`) — does **not** do the work inline.
- **Temporal worker:** consumes the workflow; activities:
  1. Persist the report (new table / row id = `trackingId`).
  2. Query Loki for the matching window (deployed SHA + ±60s of the
     reported timestamp + correlation id) and attach the result.
  3. Emit a structured Loki line so the loop is self-observable.
- **No** auto-fix PR. **No** work-item creation. **No** node-template
  wiring. **No** breadcrumb/fetch-wrapper plumbing. Those are
  follow-ups.

Open design questions (resolve in `/design`):

- Where does the intake endpoint live — operator's app server, or a
  shared service?
- Is Temporal the right tool for v0, or is a Postgres outbox + a thin
  worker enough? (Derek's framing prefers Temporal; design must justify.)
- Persistence target: new `error_reports` table in operator DB? In
  Doltgres (AI-written data)? Plain Postgres feels right since the
  schema is operational.
- Loki query shape: by `correlation_id` label vs by `(deployed_sha,
ts_window)` — which is more reliable from the worker?

## Allowed Changes

- `nodes/operator/app/**` — `error.tsx` boundaries get the button;
  new API route; new client capture util (small).
- `packages/<shared-ui>/**` — shared `<SendToCogniButton />` if a
  natural home exists; otherwise inline in operator and extract in a
  follow-up.
- `nodes/operator/temporal/**` (or wherever operator's Temporal
  workflows live) — new workflow + activities.
- New schema migration for `error_reports` (Postgres).
- New Zod contract under `src/contracts/`.
- Docs: `docs/spec/` short note pointing to story.0417 as the
  standard; `AGENTS.md` updates in touched dirs.

## Plan

Detailed planning happens in `/design`. High level:

- [ ] `/design` — pick Temporal vs outbox, lock the contract, lock
      the table shape, lock the Loki query shape.
- [ ] `/review-design` — adversarial review before any code.
- [ ] Implement contract + intake API with the workflow stubbed.
- [ ] Implement Temporal workflow + activities (persist + Loki pull).
- [ ] Wire `<SendToCogniButton />` into operator `error.tsx`.
- [ ] Stack test: forced error → POST → workflow runs → row persisted
      with Loki window attached.
- [ ] Flight to candidate-a; force a real error; confirm tracking ID +
      Loki line + Temporal execution + persisted row.

## Validation

**Stack test (pre-merge):**

```bash
pnpm test:stack:dev path/to/error-intake.stack.test.ts
```

Expected: forced error POST → 202 with `trackingId` → Temporal
workflow completes → `error_reports` row exists with `loki_window`
populated.

**On candidate-a (post-flight):**

- `exercise:` Force a 500 in operator; click Send to Cogni; capture
  the response `trackingId`.
- `observability:` Loki query for `{node="operator", build_sha="<sha>",
event="error_report.intake"} | json | tracking_id="<trackingId>"`
  returns ≥1 line at the deployed SHA. Temporal UI shows
  `ErrorReportIngestWorkflow` execution for that `trackingId`. DB row
  exists with `loki_window` non-empty.

`deploy_verified: true` only after Derek (or qa-agent) drives a real
error report through and confirms all four signals.

## Review Checklist

- [ ] **Work Item:** `task.0419` linked in PR body
- [ ] **Spec:** Zod contract is single source of truth; AGENTS.md
      updates in touched dirs
- [ ] **Tests:** unit (contract + capture util) + component
      (`<SendToCogniButton />`) + stack (full intake → Temporal → DB
      → Loki attach) all green
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

- Story: derekg1729 (story.0417)
