# Observability Finish Pass (Generic, Post-PR)

Goal: add **minimal, high-signal** logging/metrics for the changes in this branch. **No refactors** and **no observability redesign**.

## 0) Scope + budget (non-negotiable)

- Touch only files in the service you changed:
  - Next.js app: `src/app/**` (route/controller), `src/features/**` (use-case/service), `src/adapters/**` (external IO).
  - Services (`services/<name>/src/`): activities, bootstrap, adapters.
- **Max 3 logs/request** (4 only if streaming).
- **Event names must come from the service's event registry.** No inline strings.
  - Next.js app: `src/shared/observability/events/index.ts` (`EVENT_NAMES`)
  - scheduler-worker: `services/scheduler-worker/src/observability/events.ts` (`WORKER_EVENT_NAMES`)
  - Other services: find `**/observability/events.ts` — if none exists, create one following the worker pattern.
- Use the service's typed log helper (`logEvent()` for app, `logWorkerEvent()` for worker). Only call `logger.warn/error/fatal` directly for non-info levels.

## 1) Decide what to instrument (pick one)

- Endpoint behavior changed → add **route COMPLETE log** (+ rely on existing `http_*` metrics).
- Business logic changed → add **feature COMPLETE log** (only if route can’t capture the key outcome fields).
- External dependency changed → add **adapter ERROR log** (errors only).
- Pure refactor → usually add nothing.

## 2) Required logs (minimum set)

- Route/controller: `feature.<name>.complete`
  - Fields: `reqId` + `routeId` (app routes), or `workflowId` + `temporalRunId` (worker activities), plus `status`, `durationMs`, `outcome: success|error`, and **counts only**.
- Adapter (only on failure): `adapter.<dep>.error`
  - Fields: `dep`, `reasonCode`, `status?`, `durationMs`, `reqId?`.
- When outcome=error, you must include errorCode (enum from the event registry) identifying the failure class; counts alone are not sufficient. Do not log raw error messages.
- External SDKs that print their own failures must be configured or wrapped before production use. If the SDK emits raw request diagnostics, **drop the entire SDK diagnostic before stdout/stderr/console**; do not sanitize-and-forward raw config, headers, URLs, HTML bodies, or message text. Emit a separate first-party adapter error with only stable fields (`reasonCode` / `error_code`, HTTP status, response key names, counts, duration).
- One-time secret rotation paths belong on internal ops endpoints or scripts, not product UI. Their terminal log should be a single COMPLETE event with target/rotated/skipped/failed counts and an aggregate stable errorCode. Return per-target ids only to the authenticated operator response, not to prod logs.

## 3) Metrics rule

- Add a metric only if you will **alert/graph** it.
- Default: do **not** add feature metrics if existing `http_*` already covers the endpoint.
- Services with their own `/metrics` endpoint (e.g., scheduler-worker) define metrics in `src/observability/metrics.ts`. Check if the service already has a Prometheus registry before adding new metrics.
- Verify the service's `/metrics` is scraped in `infra/compose/configs/alloy-config.metrics.alloy`. If not, add a `prometheus.scrape` block.
- Allowed labels only: `route`, `method`, `statusBucket`, `env`, `provider`, `model_class`, `error_code`, `activity`, `task_queue`.
- Forbidden labels: `reqId`, `userId`, wallet, API key, raw path/query, user agent, modelId.

## 4) Privacy + payload safety

Never log: secrets, headers, tokens, signatures, passphrases, raw request config, full URLs, request/response bodies, prompts/content.
Only log: enums, booleans, counts, durations, coarse status buckets.

## 5) Deliverables (in PR description)

- Events added/used (name + fields)
- Metrics added (name + labels) or “none”
- Files changed
