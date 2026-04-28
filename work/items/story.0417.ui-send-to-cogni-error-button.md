---
id: story.0417
type: story
title: 'UI standard: every error surface has a "Send to Cogni" button that captures context and opens a fix loop'
status: done
priority: 1
rank: 99
estimate: 5
summary: "Make 'Send to Cogni' a first-class, repo-wide UI standard: anywhere a user-visible error appears (error boundaries, toast errors, form failures, API failures, empty/failed states), a button captures the full error context — stack, route, request/response, user action, current app state, build SHA — and submits it to Cogni so an agent can debug, capture the precise change, and ship a fix. Core scope: node-template + operator first; pattern then ports to poly/resy."
outcome: "Every error UI in operator + node-template renders a 'Send to Cogni' affordance using a single shared component. One click submits a structured error report to a Cogni intake endpoint, returns a tracking ID to the user, and triggers an internal flow (work item + agent) that can land a fix PR. The component, the contract, and the intake endpoint are documented as the standard so all other nodes adopt it mechanically."
spec_refs:
assignees: derekg1729
credit:
project: proj.observability-hardening
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [frontend, ux, observability, agent-ux, error-handling]
external_refs:
  - work/items/task.0403.operator-loading-error-boundaries.md
  - work/items/task.0408.port-loading-error-boundaries-other-nodes.md
  - work/items/bug.0072.error-metrics-blind-spot.md
---

# UI standard: "Send to Cogni" on every error

> **Triaged 2026-04-28** → `proj.observability-hardening`. v0 implementation
> tracked in `task.0419` (capture-and-enqueue end-to-end loop). This story is
> the durable intent record; status flips to `done` per story lifecycle.

## Problem

When a user hits an error in any Cogni UI today, the failure is a
dead-end. The user either reloads, files a bug by hand (with no
context), or gives up. Meanwhile the agents that _could_ fix it have no
idea it happened — there's no signal carrying the stack, the request,
the page state, or the deployed SHA back to the system that can act on
it.

We already invest heavily in self-validating agents and Loki-backed
observability, but the "user saw something break" event never enters
that loop. The error boundaries added in task.0403 / task.0408 catch
errors but only render a generic recovery UI.

## Why now

- **Fastest possible feedback loop.** A user-reported error with full
  context is the highest-signal input the operator can receive.
- **Cogni's edge is agentic git-management.** Closing the loop from
  "user clicked → error → agent opens fix PR" is the demo.
- **Standardizing now is cheap.** The error-boundary work in
  task.0403/0408 just landed; the wrapper component slots in once and
  every node inherits it.

## Requirements

### User-facing

- Every user-visible error UI renders a "Send to Cogni" button. This
  includes: route-level `error.tsx` boundaries, global toast errors,
  form submission failures, API call failures, and empty-state errors.
- One click submits — no required fields. Optional free-text "what
  were you doing?" input.
- After submit, the user sees a tracking ID and a link they can follow
  to see status (later: PR link when fix lands).

### Captured context (automatic, no PII beyond the user's own session)

- Error: `name`, `message`, `stack`, component stack (where available).
- Page: route, query, referrer, build SHA from `/version`.
- Request: most recent failing fetch (URL, method, status, response
  body trimmed) — picked up via a fetch wrapper, not requiring callers
  to plumb it.
- App state: current user (id only), node, feature flags, recent UI
  actions (last N — bounded breadcrumb trail).
- Environment: candidate-a / preview / prod, browser UA, viewport.

### System-side

- A single intake endpoint accepts the report, persists it, and emits
  a structured Loki line so agents can self-query.
- Each report becomes (or attaches to) a work item the operator can
  pick up. The agent that fixes it must produce a real PR — not just a
  triage note.
- Rate-limited per session to prevent flooding.

### Standard / reuse

- Single shared component lives in a place every node imports from.
- Documented as the error-UI standard so any future error surface
  _must_ use it (lint or arch:check rule is a stretch goal).

## Allowed Changes

- Shared UI primitive (likely `packages/ui-*` or equivalent shared
  frontend lib) for the button + submission flow.
- `nodes/operator/app/**` and `nodes/node-template/app/**` — wire the
  button into all existing error surfaces.
- New intake endpoint (location TBD in `/triage` — likely operator,
  since operator owns the agent dispatch surface).
- Frontend fetch wrapper / breadcrumb util to capture context without
  per-callsite plumbing.
- Docs: `docs/spec/` standard + `AGENTS.md` updates in touched dirs.
- Out of scope (this story): porting to poly + resy. That's a
  follow-up task once the standard is proven on operator +
  node-template.

## Plan

High-level only — `/task` will decompose this.

- [ ] `/triage` to assign project + decide if a `spike` is needed for
      the intake-endpoint design and the fetch-wrapper /
      breadcrumb-capture approach.
- [ ] Likely spike: where should the intake live (operator vs each
      node's own backend), and what's the report → work item → agent
      handoff shape?
- [ ] `/design` the shared component contract + intake schema.
- [ ] Implement the shared component + fetch/breadcrumb capture.
- [ ] Wire into operator error surfaces.
- [ ] Wire into node-template error surfaces.
- [ ] Document as the standard. Add follow-up task for poly + resy
      port.

## Validation

User-level proof on candidate-a:

- Force an error in operator (e.g., 500 on a known route).
- Click "Send to Cogni" → receive a tracking ID.
- Query Loki at the deployed SHA for the structured intake event;
  confirm the captured stack + request + route are present.
- Confirm a work item was created (or a designated agent received the
  payload).
- Repeat on node-template.

`deploy_verified: true` only after a real human-driven error report
has produced a tracking ID _and_ shown up in Loki at the candidate-a
SHA.

## Review Checklist

- [ ] **Work Item:** `story.0417` linked in PR body
- [ ] **Spec:** error-UI standard documented; AGENTS.md updates in
      touched dirs
- [ ] **Tests:** unit tests for capture util + breadcrumb buffer;
      component test for the button; stack test for the intake
      endpoint
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

- Idea: derekg1729
