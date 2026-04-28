---
id: task.0419
type: task
title: "v0 'Send to Cogni' error intake — UI button → API → Temporal queue"
status: needs_implement
priority: 1
rank: 1
estimate: 3
summary: "Simplest end-to-end loop for story.0417: an error UI in operator renders a 'Send to Cogni' button; one click POSTs an error report (stack, route, build SHA, correlation id, timestamp window) to a new intake API; the API enqueues a Temporal workflow; a Temporal worker consumes the queue and persists the report (and pulls the matching Loki window) as a queryable work item the operator can pick up. v0 is operator-only, no node-template wiring yet, no auto-fix-PR — just prove the capture-and-enqueue loop is real."
outcome: "On candidate-a, forcing an error in operator and clicking 'Send to Cogni' results in: (1) a tracking ID in the UI, (2) a row in the error-reports persistence layer, (3) a Loki line at the deployed SHA showing the intake event, (4) a Temporal workflow execution visible in the Temporal UI, (5) the worker having pulled the matching Grafana/Loki window and stored it alongside the report. Story.0417 considers v0 done; ports + auto-fix loop are follow-ups."
spec_refs:
  - docs/spec/architecture.md
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

## Design

### Outcome

Operator users hitting an error get a one-click "Send to Cogni"
affordance whose press lands a queryable error report (with the
matching Loki log window already pulled) in the operator DB —
proving the UI → API → Temporal → DB → Loki loop end-to-end on
candidate-a, with zero new infra.

### Approach (resolves the four open questions)

**1. Intake location → operator app, alongside existing patterns.**
New route `nodes/operator/app/src/app/api/v1/error-report/route.ts`,
modeled on `api/v1/attribution/epochs/[id]/finalize/route.ts` (Zod
validate → start Temporal workflow → 202 with tracking id).
**Auth: anonymous-allowed** so `(public)/error.tsx` can submit too;
session userId is read best-effort and stored if present. Compensating
controls: per-IP token-bucket rate limit (in-memory for v0, ~10/min)
plus hard byte caps in the Zod contract (see "Compensating controls"
below). **Reuses:** `wrapRouteHandlerWithLogging`,
`getTemporalWorkflowClient()`. **No new service.**

**2. Temporal vs Postgres outbox → Temporal.** Operator already runs
`@temporalio/client` + a `scheduler-worker` process; adding one
workflow + three activities is small. A Postgres outbox would
introduce a new poller, a new failure mode, and zero reuse. **Workflow
owns all writes** — the route handler does NOT pre-insert a `pending`
row; it mints `trackingId` (uuid) and starts the workflow with the
full payload. Workflow id = `trackingId` so a double-click is deduped
at the Temporal layer (`WorkflowExecutionAlreadyStartedError`
swallowed, returns existing trackingId). Activities run in order:
`persistInitialActivity` (insert with `loki_status=pending`) →
`pullLokiWindowActivity` → `updateLokiResultActivity`. Each retry is
free; no orphan-row class of bug.

**3. Persistence → Postgres, new `error_reports` slice.** The data
is operational (system-written, operator-read), not AI-authored,
so it lives in operator's Postgres alongside attribution / billing
/ scheduling — not Doltgres. New file
`packages/db-schema/src/error-reports.ts`, exported through the
existing barrel; one migration in
`nodes/operator/app/src/adapters/server/db/migrations/`. Row id =
`trackingId` (uuid).

**4. Loki query shape → key on Next.js error `digest`, not a
freshly-minted intake id.** Next.js stamps a server-side `digest` on
every error that crosses an `error.tsx` boundary, and Pino logs
already include it on the original failing request line. That's the
log we actually want to fetch — not the intake POST. The client
reads `error.digest` (already a prop of `error.tsx`) and includes it
in the intake payload. The worker queries
`{node="operator"} | json | digest="<digest>"` over server-received
`ts ± 60s` (server clock, not client). Fallback if zero rows:
`{node="operator", build_sha="<sha>"}` over the same window — bounded
and labelled, no general dump. Result stored as JSON in
`error_reports.loki_window`; status `fetched` / `empty` / `failed`.

**4a. `LokiQueryPort` lives in a shared package, not app code.** The
consumer is `services/scheduler-worker/**` — a different runtime from
the operator app. Per packages-architecture.md (>1 runtime → shared
package), a new minimal `packages/loki-query/` holds the port,
domain types (Zod result schema), and a fetch-based adapter (~60
lines total). Wiring (env-driven `LOKI_URL`) lives in
`services/scheduler-worker/src/main.ts`, not in operator's
`bootstrap/container.ts`. v0 has exactly one consumer; we still place
it as a package because the activity runtime requires it.

### Reuses

- **Temporal client + worker process** — already there; we add one
  workflow file under `packages/temporal-workflows/src/workflows/`
  and one activity file under
  `services/scheduler-worker/src/activities/`. Pattern matches
  `finalize-epoch.workflow.ts` and `enrichment.ts` activity.
- **Zod contract pattern** — new `error-report.v1.contract.ts` in
  `packages/node-contracts/src/`, alongside the existing
  `error.chat.v1.contract.ts`.
- **Drizzle schema slice + barrel export** — same shape as
  `ai.ts`, `attribution.ts`, etc.
- **Pino structured logging** — emits the self-observable Loki
  line for free; no new logging path.
- **Operator `error.tsx` boundaries from task.0403** —
  `(app)/error.tsx` and `(public)/error.tsx`; we render the
  button inside both. The framework-supplied `error.digest` prop
  becomes our Loki join key — no new correlation-id plumbing.
- **Build SHA already on the client** — read from
  `process.env.NEXT_PUBLIC_APP_BUILD_SHA` (already exposed at
  build time per the operator's Next config), not via a runtime
  GET to `/version`. A broken page shouldn't make extra hops.

### Compensating controls (anonymous intake)

Because the route is anonymous-allowed:

- Per-IP token-bucket rate limit (in-memory, ~10/min/IP). Crude is
  fine for v0; revisit when there's a second consumer.
- Hard Zod byte caps: `error_message ≤ 2 KB`, `error_stack ≤ 20 KB`,
  `component_stack ≤ 20 KB`, `user_note ≤ 1 KB`, `route ≤ 512 B`,
  `digest ≤ 256 B`. Truncated client-side before send so a 100 KB
  stack doesn't even leave the browser.
- `user_id` field is best-effort: read from session if present,
  `null` otherwise. Never trusted from the client.
- Bot deterrent for v0: an `Origin` check (must match the operator's
  own host); no captcha.

### Rejected alternatives

- **Postgres outbox (no Temporal).** Rejected — adds a new poller
  - new failure mode, zero reuse of an already-running worker.
- **Inline processing in the route handler.** Rejected — couples
  intake latency to Loki availability; loses Temporal's retry +
  visibility for free.
- **Use Doltgres for `error_reports`.** Rejected — operational
  data, not AI-written; Doltgres is for graph/knowledge state.
- **Build a generic `ObservabilityPort`.** Rejected for v0 —
  speculative scope. The narrow `LokiQueryPort` is ~60 lines of
  fetch + zod parse; generalize when a second caller exists.
- **Place `LokiQueryPort` under `nodes/operator/app/src/ports/`
  (mirroring `metrics-query.port.ts`).** Rejected — the consumer
  is the worker runtime; cross-runtime imports of app code are
  forbidden by packages-architecture.md. New `packages/loki-query/`.
- **Mint a fresh client-side correlation id on click.** Rejected —
  it tags only the intake POST, not the failing request the user
  is trying to report. Use Next's existing `error.digest`.
- **Pre-insert a `pending` row in the route handler before
  starting the workflow.** Rejected — orphans on workflow-start
  failure. Workflow owns all writes via its first activity.
- **Require auth on the intake endpoint.** Rejected — would block
  reports from `(public)/error.tsx`. Anonymous + rate-limit + size
  caps + Origin check is the v0 compromise.
- **GET `/version` from `error.tsx` to learn the build SHA.**
  Rejected — extra round-trip from an already-broken page; the
  SHA is already a build-time constant in `NEXT_PUBLIC_APP_BUILD_SHA`.
- **Extract `<SendToCogniButton />` to a new `packages/ui-*`.**
  Rejected for v0 — no shared UI package exists today; creating
  one is its own project. Live in
  `nodes/operator/app/src/components/` for now; story.0417 leaves
  the cross-node port as a follow-up.
- **Worker pulls Loki via the Grafana MCP.** Rejected — MCP is an
  agent-side tool; calling it from a server-side worker is the
  wrong direction. A direct `query_range` HTTP call is simpler.

### Invariants

- [ ] CONTRACTS_ARE_SOT — `error-report.v1.contract.ts` is the
      only place the request/response shape is declared; route +
      facade + tests use `z.infer<typeof ...>`.
- [ ] HEXAGONAL_LAYERS — `LokiQueryPort` interface, domain types,
      and fetch adapter all live in shared `packages/loki-query/`
      (>1 runtime consumer). Runtime wiring (env-driven `LOKI_URL`)
      lives in the worker's `main.ts`, never in the package.
- [ ] WORKFLOW_OWNS_ALL_WRITES — route handler does not write to
      `error_reports`; the workflow's first activity does. Route
      handler mints `trackingId` and starts the workflow only.
- [ ] BOUNDED_INTAKE — Zod contract enforces hard byte caps on every
      string field; client truncates before send; per-IP rate limit
      is wired before workflow start.
- [ ] DIGEST_IS_CORRELATION_KEY — the Loki join key is the Next.js
      `error.digest`, propagated client → API → Pino log line on
      the failing request → worker query.
- [ ] SINGLE_NODE_SCOPE — touches only `nodes/operator/**` plus
      shared `packages/{temporal-workflows,node-contracts,db-schema}`
      and `services/scheduler-worker/**`. No other node touched.
- [ ] NO_DOLTGRES_FOR_OPERATIONAL_DATA — `error_reports` lives in
      Postgres.
- [ ] SIMPLE_SOLUTION — uses existing Temporal worker, existing
      Drizzle pattern, existing Pino → Loki path. No new
      infrastructure.
- [ ] ARCHITECTURE_ALIGNMENT — route handler matches the
      finalize-epoch enqueue pattern; activity matches the
      enrichment-activity shape.
- [ ] VALIDATION_REQUIRED — exercise + observability block on
      this item before `/closeout`.

### Files

**Create:**

- `packages/node-contracts/src/error-report.v1.contract.ts` —
  Zod request/response shape (error fields, route, build SHA,
  correlation id, ISO timestamp, optional free text).
- `packages/db-schema/src/error-reports.ts` — Drizzle schema slice:
  `id (uuid pk)`, `created_at`, `node`, `build_sha`,
  `correlation_id`, `route`, `error_name`, `error_message`,
  `error_stack (text)`, `component_stack (text, nullable)`,
  `user_note (text, nullable)`, `loki_window (jsonb, nullable)`,
  `loki_status (enum: pending|fetched|failed)`,
  `temporal_workflow_id`.
- `nodes/operator/app/src/app/api/v1/error-report/route.ts` —
  POST handler: Origin check → per-IP rate limit → Zod parse →
  best-effort session userId → mint `trackingId` (uuid) → start
  `ErrorReportIngestWorkflow` (workflowId = trackingId; idempotent
  on retry) → return 202 `{ trackingId, status: "queued" }`. **No
  DB write here.**
- `packages/loki-query/package.json` + `src/index.ts` — exports
  `LokiQueryPort` interface, `LokiQueryResultSchema` (Zod), and
  `createLokiHttpAdapter({ baseUrl, fetch? })`. Fetch-based impl
  hitting `${LOKI_URL}/loki/api/v1/query_range`. ~60 lines total.
- `packages/temporal-workflows/src/workflows/error-report-ingest.workflow.ts`
  — single workflow: `persistInitialActivity` →
  `pullLokiWindowActivity` → `updateLokiResultActivity`. Standard
  retry policy on each.
- `services/scheduler-worker/src/activities/error-report.ts` —
  the three activities. Constructs `LokiQueryAdapter` once at
  module load using `LOKI_URL` from worker env; DB writes via the
  worker's existing Drizzle client.
- `nodes/operator/app/src/components/SendToCogniButton.tsx` —
  client component. Reads `error.digest` + the error itself from
  props, reads build SHA from `process.env.NEXT_PUBLIC_APP_BUILD_SHA`,
  truncates stack/message client-side, POSTs
  `/api/v1/error-report`, shows tracking id on success / inline
  error on fail.
- `nodes/operator/app/src/adapters/server/db/migrations/<ts>_error_reports.sql`
  — generated migration.
- `docs/spec/observability.md` — append a 5–10 line section
  pointing at the contract, the table, and `digest` as the
  correlation key. Story.0417 referenced as the standard.

**Modify:**

- `nodes/operator/app/src/app/(app)/error.tsx` and
  `(public)/error.tsx` — render `<SendToCogniButton />` inside
  the existing recovery UI; pass `error`, `error.digest`, and
  the route through.
- Operator's Pino log enricher — ensure the `digest` field is on
  the failing-request log line so the worker's Loki query can
  join on it. (Likely already there via Next's default error
  logging; confirm in implementation.)
- `packages/db-schema/src/index.ts` (or barrel) — re-export
  `error-reports`.
- `packages/temporal-workflows/src/activity-types.ts` — add the
  three new activity signatures.
- `services/scheduler-worker/src/worker.ts` — register the new
  activities; instantiate the Loki adapter from env.
- `nodes/operator/app/next.config.*` — confirm
  `NEXT_PUBLIC_APP_BUILD_SHA` is exposed (almost certainly
  already is; if not, expose it).
- AGENTS.md updates in: `nodes/operator/app/src/`,
  `packages/temporal-workflows/src/workflows/`,
  `services/scheduler-worker/src/activities/`,
  `packages/db-schema/src/`.

**Test:**

- `packages/node-contracts/src/error-report.v1.contract.test.ts`
  — unit: contract round-trips; rejects oversize stack.
- `nodes/operator/app/src/components/SendToCogniButton.test.tsx`
  — component: click → POST called with correct body; shows
  tracking id on success.
- `nodes/operator/app/src/adapters/server/loki-query.adapter.test.ts`
  — unit: builds correct `query_range` URL; parses Loki
  response.
- `nodes/operator/app/src/app/api/v1/error-report/route.stack.test.ts`
  — stack: forced POST → 202 → Temporal workflow completes →
  row in `error_reports` with `loki_status=fetched` and a
  non-empty `loki_window` (against dev Loki).

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
