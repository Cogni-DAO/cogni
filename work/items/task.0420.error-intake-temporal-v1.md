---
id: task.0420
type: task
title: "v1 'Send to Cogni' error intake — Temporal worker + shared LokiQueryPort"
status: needs_implement
priority: 1
rank: 5
estimate: 3
summary: "Follow-up to task.0423's v0-of-v0 (which ships UI + intake API + inline DB write + inline Loki pull, single PR). v1 hardens the loop: extracts the Loki adapter to a shared package, moves the work off the request path into a Temporal workflow, and adds a stack test. No user-visible change; reliability + observability + boundary cleanup."
outcome: "Same UX as v0-of-v0, but: (1) `LokiQueryPort` + adapter live in `packages/loki-query/`; (2) the intake API does NOT do the Loki query inline — it starts `ErrorReportIngestWorkflow`; (3) three activities own the writes (initial insert → Loki pull → update); (4) a stack test covers the full intake → workflow → DB → Loki path against dev infra. After this lands, the v0-of-v0 inline code paths are deleted (no shim, no compat — single source of truth wins)."
spec_refs:
  - docs/spec/architecture.md
  - docs/spec/packages-architecture.md
assignees: derekg1729
credit:
project: proj.observability-hardening
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0423]
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [observability, temporal, error-handling, packages, refactor]
external_refs:
  - work/items/task.0423.send-to-cogni-error-intake-v0.md
  - work/items/story.0417.ui-send-to-cogni-error-button.md
  - work/projects/proj.observability-hardening.md
---

# v1 "Send to Cogni" error intake — Temporal + shared LokiQueryPort

## Problem

`task.0423` ships v0-of-v0 in a single PR by collapsing the Loki query
and DB write into the route handler. That's the right call to prove
the _user-visible_ loop on candidate-a fast — but it leaves three
debts:

1. The Loki adapter lives in operator app code; the proper home is a
   shared package because the worker (a different runtime) will
   consume it. Per `packages-architecture.md` >1-runtime rule.
2. Loki latency / failure couples to the intake request — slow Loki
   slows the click; failed Loki bricks the intake even though the
   error report is independently valuable.
3. No retry, no replay, no execution visibility for ops. Temporal
   gives all three for free.

This task pays the debt without changing the UX.

## Scope

### In

- **New package** `packages/loki-query/` — `LokiQueryPort` interface,
  Zod result schema, fetch-based adapter. Move the inline impl from
  `nodes/operator/app/src/adapters/server/loki-query.ts` into this
  package. Delete the operator-side file (no shim).
- **New workflow** `packages/temporal-workflows/src/workflows/error-report-ingest.workflow.ts`
  with three activities, in order:
  1. `persistInitialActivity` — insert row with `loki_status=pending`.
  2. `pullLokiWindowActivity` — query Loki via `LokiQueryPort`.
  3. `updateLokiResultActivity` — write back `loki_window` +
     `loki_status` (`fetched` / `empty` / `failed`).
- **Activities module** `services/scheduler-worker/src/activities/error-report.ts`
  - worker registration + DI (Loki adapter constructed once from env;
    DB writes via the worker's existing Drizzle client).
- **Activity types** added to `packages/temporal-workflows/src/activity-types.ts`.
- **Switch the route handler** in
  `nodes/operator/app/src/app/api/v1/error-report/route.ts` from
  inline insert + Loki call → mint `trackingId`, `client.workflow.start("ErrorReportIngestWorkflow", { workflowId: trackingId, ... })`,
  return 202. Delete the inline insert + Loki helper call.
- **Stack test** `nodes/operator/app/src/app/api/v1/error-report/route.stack.test.ts`
  — forced POST → workflow runs → row exists with `loki_status=fetched`
  and non-empty `loki_window`. Uses dev Loki + dev Temporal.

### Out

- Any UX change. The button, the dev forced-error route, and the
  `error.tsx` integration ship in v0-of-v0 and are not retouched.
- Auto-fix-PR loop. Still a follow-up.
- Cross-node port (poly / resy / node-template adopting the
  standard). Tracked in story.0417.
- Generic `ObservabilityPort`. Build it when a second consumer
  exists.

## Allowed Changes

- New `packages/loki-query/` (full package: `package.json`,
  `tsconfig.json`, `tsup.config.ts`, `src/**`, `vitest.config.ts`).
- `packages/temporal-workflows/src/workflows/error-report-ingest.workflow.ts`
  - edits to `activity-types.ts`.
- `services/scheduler-worker/src/activities/error-report.ts`
  - edits to the worker registration and `main.ts`/wiring as
    needed for DB + Loki adapter injection.
- `nodes/operator/app/src/app/api/v1/error-report/route.ts` —
  switch from inline → Temporal-start.
- Delete: `nodes/operator/app/src/adapters/server/loki-query.ts`
  (replaced by package; verify no other importers first).
- Add: stack test under `nodes/operator/app/src/app/api/v1/error-report/`.
- AGENTS.md updates in: `packages/loki-query/`,
  `packages/temporal-workflows/src/workflows/`,
  `services/scheduler-worker/src/activities/`.

## Plan

- [ ] Create `packages/loki-query/` skeleton + move adapter
      verbatim; add unit tests for query-string assembly + response
      parse.
- [ ] Wire it through `pnpm install` + workspace exports + tsconfig
      project refs.
- [ ] Write `error-report-ingest.workflow.ts` against
      `activity-types.ts`.
- [ ] Implement the three activities as a factory
      (`createErrorReportActivities({ db, loki, logger })`),
      mirroring the `createEnrichmentActivities` shape.
- [ ] Register activities in the scheduler worker's bootstrap
      (`services/scheduler-worker/src/main.ts` or `worker.ts`),
      injecting the Loki adapter from `LOKI_URL` env.
- [ ] Switch the route handler to start the workflow; delete the
      inline DB insert + Loki helper invocation.
- [ ] Delete `nodes/operator/app/src/adapters/server/loki-query.ts`
      after grep confirms no other importers.
- [ ] Stack test against `pnpm dev:stack:test`.
- [ ] Flight to candidate-a; force an error; confirm Temporal
      execution + DB row + Loki window match v0-of-v0 behavior.

## Validation

**Stack test:**

```bash
pnpm test:stack:dev nodes/operator/app/src/app/api/v1/error-report/route.stack.test.ts
```

Expected: forced POST → 202 with `trackingId` → workflow completes →
`error_reports` row exists with `loki_status=fetched` and non-empty
`loki_window`.

**On candidate-a (post-flight):**

- `exercise:` Hit `/dev/boom` (or whatever v0 ships); click "Send
  to Cogni"; capture `trackingId`.
- `observability:` Loki query for the intake event line at the
  deployed SHA; Temporal UI shows
  `ErrorReportIngestWorkflow:<trackingId>` execution; DB row has
  `loki_status=fetched`. Same end state as v0-of-v0, now via
  Temporal.

`deploy_verified: true` only after a real driven report goes
through the workflow path on candidate-a.

## Review Checklist

- [ ] **Work Item:** `task.0420` linked in PR body
- [ ] **Spec:** package follows `packages-architecture.md`;
      AGENTS.md updates in touched dirs
- [ ] **Tests:** unit (Loki adapter) + stack (full path) green
- [ ] **No shim:** v0-of-v0 inline path is deleted, not deprecated
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

- Story: derekg1729 (story.0417)
- v0-of-v0: task.0423
