---
id: proj.observability-hardening
type: project
primary_charter:
title: Observability Hardening
state: Paused
priority: 2
estimate: 3
summary: Improve observability coverage — activity metrics, test doubles, LLM error handling, structured logging
outcome: Sub-day activity bucketing, FakeUsageAdapter for CI, structured LLM error types, and actionable error UX
assignees: derekg1729
created: 2026-02-06
updated: 2026-02-06
labels: [data, testing]
---

# Observability Hardening

## Goal

Improve observability infrastructure across four axes: (1) finer-grained activity metrics (sub-day bucketing), (2) test doubles that eliminate LiteLLM dependency in CI, (3) integration test coverage for the activity endpoint, and (4) structured LLM error handling with typed errors, actionable user messages, and model-level monitoring.

## Roadmap

### Crawl (P0) — Current State

**Goal:** Activity dashboard with day-level aggregation and LiteLLM dependency.

| Deliverable                                                  | Status | Est | Work Item |
| ------------------------------------------------------------ | ------ | --- | --------- |
| Activity dashboard joins LiteLLM telemetry + charge_receipts | Done   | 1   | —         |
| `ActivityUsagePort` interface for LiteLLM `/spend/logs`      | Done   | 1   | —         |
| Zod schemas for LiteLLM response validation                  | Done   | 1   | —         |
| Activity service aggregation logic                           | Done   | 1   | —         |

### Walk (P1) — Test Infrastructure & Granularity

**Goal:** Remove LiteLLM CI dependency; add sub-day bucketing.

| Deliverable                                                                                               | Status      | Est | Work Item            |
| --------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Hourly bucketing: currently only day-level aggregation; need sub-day buckets for "Last Hour" view         | Not Started | 2   | (create at P1 start) |
| `FakeUsageAdapter` for stack tests: test double for `ActivityUsagePort` to avoid LiteLLM dependency in CI | Not Started | 2   | (create at P1 start) |
| Stack tests for Activity: integration tests for activity endpoint with real data flow                     | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Advanced Observability

**Goal:** Full observability pipeline with alerting, dashboards, traces, and log filtering.

| Deliverable                                                         | Status      | Est | Source                           | Work Item            |
| ------------------------------------------------------------------- | ----------- | --- | -------------------------------- | -------------------- |
| Reconciliation monitoring dashboards (from payments initiative)     | Not Started | 2   | ACTIVITY_METRICS.md              | (create at P2 start) |
| Alert on LiteLLM `/spend/logs` degradation or unavailability        | Not Started | 1   | ACTIVITY_METRICS.md              | (create at P2 start) |
| Log filtering: drop probe logs (`/livez`, `/readyz`, `/metrics`)    | Not Started | 1   | ALLOY_LOKI_SETUP.md § Filtering  | (create at P2 start) |
| Structured metadata extraction (Loki 2.9+, high-cardinality fields) | Not Started | 1   | ALLOY_LOKI_SETUP.md § Metadata   | (create at P2 start) |
| OTLP trace collection via Alloy (ports 4317/4318) → Tempo           | Not Started | 2   | ALLOY_LOKI_SETUP.md § Traces     | (create at P2 start) |
| Grafana dashboard provisioning in docker-compose                    | Not Started | 2   | ALLOY_LOKI_SETUP.md § Dashboards | (create at P2 start) |
| Loki ruler alert configuration (error rate, payment failures)       | Not Started | 1   | ALLOY_LOKI_SETUP.md § Alerts     | (create at P2 start) |

**Filtering detail:** Drop LogQL patterns: `{service="app"} |= "GET /livez"`, `{service="app"} |= "GET /readyz"`, `{service="app"} |= "GET /metrics"`.

**Metadata detail:** Extract high-cardinality fields as structured metadata (Loki 2.9+), queryable without indexing overhead.

**Traces detail:** Add OTLP receiver in Alloy (ports 4317/4318), forward to Tempo or other trace backend, correlate logs with traces via traceId.

**Dashboards detail:** Grafana provisioning in docker-compose, pre-built dashboards for app logs, panels for error rate, P95 latency, etc.

**Alerts detail:** Loki ruler configuration, alert on error rate spike, alert on critical events (payment failures, etc.).

### Error Envelope Standardization Track (Public vs Private)

> Principle: Every error has two audiences — **public** (API consumers get sanitized errorCode) and **private** (operator logs get root cause). Both must always be present.

**Problem:** Error context is lost at multiple boundaries. Adapters strip response bodies. `normalizeErrorToExecutionCode()` collapses `provider_4xx`/`provider_5xx`/`unknown` → `"internal"`. Route layer string-matches error messages. Operators see `{"errorCode":"internal"}` with zero debugging value.

#### P0: Adapter-Level Private Root Cause Logging

**Goal:** Every adapter error path logs private diagnostics (redacted, bounded) without changing public error codes.

| Deliverable                                                                | Status | Est | Work Item |
| -------------------------------------------------------------------------- | ------ | --- | --------- |
| LiteLLM adapter: log response body excerpt + network error cause           | Done   | 1   | bug.0059  |
| Rename `langfuse-scrubbing.ts` → `content-scrubbing.ts` (shared redaction) | Done   | 0   | bug.0059  |

#### P1: Error Envelope Type + Boundary Propagation

**Goal:** Define `ErrorEnvelope` type, carry private details through graph execution boundary, structured route responses.

| Deliverable                                                                                                             | Status      | Est | Work Item |
| ----------------------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Define `ErrorEnvelope` type (`{ public: { errorCode, message }, private: { rootCause, statusCode, responseExcerpt } }`) | Not Started | 1   | —         |
| `GraphResult.errorDetail` carries private context to provider boundary                                                  | Not Started | 1   | —         |
| Route-layer structured error responses: `{ errorCode, message, suggestion }` instead of generic 503                     | Not Started | 2   | —         |
| Map `provider_4xx` → `not_found` / `invalid_request` in `normalizeErrorToExecutionCode()`                               | Not Started | 1   | —         |

#### P2: CI Enforcement

**Goal:** Prevent regression via compile-time and CI guards.

| Deliverable                                                                    | Status      | Est | Work Item |
| ------------------------------------------------------------------------------ | ----------- | --- | --------- |
| CI guard: fail on `console.*` usage at system boundaries                       | Not Started | 1   | —         |
| CI guard: fail on unstructured error logging (no `errorCode` field)            | Not Started | 1   | —         |
| Tests: public errors never include private fields; excerpts <=2KB and redacted | Not Started | 1   | —         |

---

### LLM Error Handling Track

> Source: `docs/ERROR_HANDLING_IMPROVEMENT_DESIGN.md` — Spec: [error-handling.md](../../docs/spec/error-handling.md) (as-built architecture)

**Problem:** All LiteLLM errors collapse to generic 503 "AI service temporarily unavailable." Users can't distinguish model removal (404) from rate limits (429) from auth failures (401). Logs lack structured fields for model, provider, and error type. No fallback strategy.

#### P0: Structured Error Types + Logging

**Goal:** Typed error classes in adapter layer, structured logging in route layer, correct HTTP status codes to clients.

| Deliverable                                                                                   | Status      | Est | Work Item |
| --------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Create `LlmAdapterError` class with `LlmErrorType` enum in `src/adapters/server/ai/errors.ts` | Not Started | 1   | —         |
| Implement `classifyLiteLlmError()` mapping status codes → typed errors                        | Not Started | 1   | —         |
| Update `litellm.adapter.ts` to throw `LlmAdapterError` instead of generic `Error`             | Not Started | 1   | —         |
| Update route error handler to catch `LlmAdapterError` with structured JSON response           | Not Started | 1   | —         |
| Implement `mapLlmErrorToResponse()` with per-type user messages and `fallbackAction`          | Not Started | 1   | —         |
| Add structured log fields: `errorType`, `model`, `provider`, `statusCode`                     | Not Started | 1   | —         |
| Unit tests for error classification                                                           | Not Started | 1   | —         |

**Error Type Enum:**

| Type                  | HTTP | Meaning                               | User Action            |
| --------------------- | ---- | ------------------------------------- | ---------------------- |
| `MODEL_NOT_FOUND`     | 404  | Model removed from provider           | Select different model |
| `MODEL_UNAVAILABLE`   | 503  | Provider down / model offline         | Retry later            |
| `RATE_LIMIT_EXCEEDED` | 429  | Quota exhausted                       | Wait or switch model   |
| `AUTH_ERROR`          | 500  | Invalid provider key (hide from user) | Contact support        |
| `TIMEOUT`             | 408  | Provider took too long                | Retry                  |
| `INVALID_REQUEST`     | 400  | Malformed request                     | Fix request            |
| `PROVIDER_ERROR`      | 5xx  | Upstream issue                        | Retry                  |

#### P1: Client UX + Monitoring

**Goal:** Actionable error messages in chat UI; Grafana dashboards for error type distribution.

| Deliverable                                                                | Status      | Est | Work Item |
| -------------------------------------------------------------------------- | ----------- | --- | --------- |
| Update `ChatRuntimeProvider` to parse structured error responses           | Not Started | 1   | —         |
| Add error banner component with actionable suggestion per `fallbackAction` | Not Started | 2   | —         |
| Grafana dashboard panel for `errorType` distribution                       | Not Started | 1   | —         |
| Alert on high `MODEL_NOT_FOUND` rate (model sunset detection)              | Not Started | 1   | —         |

#### P2: Automatic Fallback (Future)

**Goal:** Auto-recovery from model failures. Do NOT build preemptively.

| Deliverable                                               | Status      | Est | Work Item |
| --------------------------------------------------------- | ----------- | --- | --------- |
| Auto-retry with default model on `MODEL_NOT_FOUND`        | Not Started | 2   | —         |
| Model health dashboard (real-time success rate per model) | Not Started | 2   | —         |
| Proactive model sunset detection via Slack alerts         | Not Started | 1   | —         |

### Public Analytics Frontend Track

> Source: `docs/METRICS_OBSERVABILITY.md` — Spec: [public-analytics.md](../../docs/spec/public-analytics.md) (draft, backend as-built)

**Context:** Backend is fully implemented (Phases 1-3 done): Mimir adapter, k-anonymity service, API contract, route. Frontend, security hardening, and deployment remain.

#### P0: Frontend Implementation

**Goal:** Public `/analytics` page with summary cards, time series charts, and model distribution.

| Deliverable                                                                       | Status      | Est | Work Item |
| --------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Create `WindowSelector` component — adapts `TimeRangeSelector` for 7d/30d/90d     | Not Started | 1   | —         |
| Create `AnalyticsSummaryCards` — 4 stat cards (Requests, Tokens, Error Rate, p95) | Not Started | 1   | —         |
| Create `ModelDistributionChart` — recharts BarChart wrapper                       | Not Started | 1   | —         |
| Create `PrivacyFooter` — disclaimer text                                          | Not Started | 1   | —         |
| Create client view `src/app/(public)/analytics/view.tsx` — composes all charts    | Not Started | 1   | —         |
| Create server page `src/app/(public)/analytics/page.tsx` — RSC fetches facade     | Not Started | 1   | —         |
| Implement null-handling for k-anonymity suppression (display "—" or filter nulls) | Not Started | 1   | —         |
| Add to navigation (optional)                                                      | Not Started | 1   | —         |

**Invariant:** Reuse `ActivityChart` from `/activity` for time series; reuse shadcn primitives (Card, Select, Chart); recharts already installed.

**UI labels are dynamic based on window:** 7d → "per hour", 30d → "per 6 hours", 90d → "per day".

**MVP Metrics:**

- Summary Cards: Total Requests, Total Tokens, Error Rate %, Latency p95
- Time Series: Request Rate, Token Rate, Error Rate (3 separate AreaCharts)
- Distribution: Model Class by tokens (horizontal BarChart)

**Excluded from MVP:** Latency p50 (only p95 in summary card), model distribution side-by-side with error rate (stacked layout instead).

**UI Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Platform Analytics                        [7d] [30d] [90d]     │
│  Public metrics • Updated every 60s                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐       │
│  │ Requests  │ │  Tokens   │ │Error Rate │ │ Latency   │       │
│  │   1.2M    │ │   25.4B   │ │   0.03%   │ │ p95: 1.2s │       │
│  │    (—)    │ │    (—)    │ │    (—)    │ │    (—)    │       │ ← null displays as "—"
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘       │
├─────────────────────────────────────────────────────────────────┤
│  Requests Over Time (per {bucket})                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ▂▃▄▅▆▇█▇▆▅▄▃▂▃▄▅▆▇█▇▆▅▄▃▂▃▄▅▆▇█▇▆▅                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Tokens Over Time (per {bucket})                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ▂▃▄▅▆▇█▇▆▅▄▃▂▃▄▅▆▇█▇▆▅▄▃▂▃▄▅▆▇█▇▆▅                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Error Rate Over Time (per {bucket})                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ▂▃▂▃▂▃▂▃▂▃▂▃                                             │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Model Usage Distribution (by tokens)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Free       █████████████                                │   │
│  │  Standard   ████████████████████                         │   │
│  │  Premium    ██████                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Data is aggregated and anonymized. Individual user data is     │
│  never exposed. Low-activity periods are suppressed.            │
└─────────────────────────────────────────────────────────────────┘
```

**Component structure:**

```
src/app/(public)/analytics/
├── page.tsx                       # Server component (RSC, fetches facade)
└── view.tsx                       # Client component (composes all charts)

src/features/analytics/components/
├── WindowSelector.tsx             # 7d/30d/90d selector (adapts TimeRangeSelector)
├── AnalyticsSummaryCards.tsx      # 4 stat cards grid (shadcn/card)
├── ModelDistributionChart.tsx     # recharts BarChart wrapper
└── PrivacyFooter.tsx              # Disclaimer text

Reused:
- src/components/kit/data-display/ActivityChart.tsx (time series)
- src/components/vendor/shadcn/* (Card, Select, Chart primitives)
```

#### P1: Security Hardening + Deployment

**Goal:** Rate limiting, PII verification, production deploy.

| Deliverable                                         | Status      | Est | Work Item |
| --------------------------------------------------- | ----------- | --- | --------- |
| Add Caddy rate limit rule for `/api/v1/analytics/*` | Not Started | 1   | —         |
| Verify k-anonymity suppression in unit tests        | Not Started | 1   | —         |
| Integration test: confirm no PII in responses       | Not Started | 1   | —         |
| Add env vars to preview/prod configs                | Not Started | 1   | —         |
| Deploy and verify metrics display correctly         | Not Started | 1   | —         |

### Required Observability Track (Silent Death Detection)

> Source: OBSERVABILITY_REQUIRED_SPEC.md — Spec: [observability-requirements.md](../../docs/spec/observability-requirements.md)

**Context:** 2026-02-04 preview app died silently (SIGKILL/OOM). No alert fired. scheduler-worker detected it 30 min later via `HeadersTimeoutError`. Application logs cannot attribute SIGKILL — infrastructure-layer signals are required.

#### P0: Silent Death Detection

**Goal:** Heartbeat liveness, process metrics for pre-crash visibility, container restart/exit detection, resource limits, deploy-to-healthy gate.

| Deliverable                                                                 | Status      | Est | Work Item |
| --------------------------------------------------------------------------- | ----------- | --- | --------- |
| `collectDefaultMetrics()` in Prometheus registry (RSS, heap, GC, evloop)    | Not Started | 1   | —         |
| `app_heartbeat_timestamp_seconds` gauge (30s interval)                      | Not Started | 1   | —         |
| `mem_limit`/`cpus` on app service in both compose files                     | Not Started | 1   | —         |
| Container restart/exit-code detection (Alloy `discovery.docker` or sidecar) | Not Started | 1   | —         |
| Fix Dockerfile HEALTHCHECK timeout: 2s → 5s                                 | Not Started | 1   | —         |
| Alloy health check in both compose files                                    | Not Started | 1   | —         |
| DB connectivity check (`SELECT 1`, 2s timeout) in `/readyz`                 | Not Started | 1   | —         |
| Grafana alert: heartbeat absent >90s → P1 critical                          | Not Started | 1   | —         |
| Grafana alert: log-silence 5m → P2 warning                                  | Not Started | 1   | —         |
| Grafana alert: deploy-incomplete (started without complete/failed in 5m)    | Not Started | 1   | —         |
| Update OBSERVABILITY.md with new metrics, limits, alerts                    | Not Started | 1   | —         |

#### P1: Container-Layer Metrics + Dashboard

**Goal:** cAdvisor or cgroup-exporter for OOM attribution and cgroup memory tracking; post-deploy canary probe.

| Deliverable                                                          | Status      | Est | Work Item |
| -------------------------------------------------------------------- | ----------- | --- | --------- |
| Validate cAdvisor feasibility on Akash/Spheron runtime               | Not Started | 1   | —         |
| cAdvisor or cgroup-exporter sidecar (memory, OOM kills, CPU)         | Not Started | 2   | —         |
| Alloy `prometheus.scrape` target for cAdvisor (10s interval)         | Not Started | 1   | —         |
| Grafana dashboard: app memory, request rate, error rate, latency p95 | Not Started | 2   | —         |
| Post-rollout canary probe in `deploy.sh` (poll `/readyz` 3 min)      | Not Started | 1   | —         |
| Grafana alert: cgroup memory >85% of limit → P2 warning              | Not Started | 1   | —         |

#### P2: Full Trace Pipeline

**Goal:** OTel OTLP → Tempo, distributed tracing, client-side log shipping. Do NOT build preemptively.

| Deliverable                                            | Status      | Est | Work Item |
| ------------------------------------------------------ | ----------- | --- | --------- |
| OTel OTLP exporter → Grafana Tempo                     | Not Started | 2   | —         |
| Distributed tracing: app → scheduler-worker → DB spans | Not Started | 2   | —         |
| Client-side log shipping (browser errors to Loki)      | Not Started | 1   | —         |

### PostHog Product Analytics Coverage Track

> Source: PR #565 (PostHog wiring) gap analysis — only 5 of 11 registered events are emitted anywhere in the codebase.

**Context:** PostHog is now required infrastructure (env vars mandatory, `initAnalytics()` always called). However, the core product loop (interactive chat) has zero instrumentation, `sessionId` values are meaningless random UUIDs, and 6 registered events have no call sites.

#### P0: Core Loop Instrumentation

**Goal:** The interactive chat route — the primary user-facing feature — emits agent execution events.

| Deliverable                                                                                      | Status      | Est | Work Item |
| ------------------------------------------------------------------------------------------------ | ----------- | --- | --------- |
| Wire `capture()` in `/api/v1/ai/chat/` for `AGENT_RUN_REQUESTED` on request start                | Not Started | 1   | —         |
| Wire `capture()` in `/api/v1/ai/chat/` for `AGENT_RUN_COMPLETED` on successful stream completion | Not Started | 1   | —         |
| Wire `capture()` in `/api/v1/ai/chat/` for `AGENT_RUN_FAILED` on error paths                     | Not Started | 1   | —         |

#### P0: Session Correlation Fix

**Goal:** `sessionId` in analytics events correlates to real user sessions instead of random UUIDs.

| Deliverable                                                                                         | Status      | Est | Work Item |
| --------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Derive `sessionId` from JWT session hash (or Next-Auth session ID) instead of `crypto.randomUUID()` | Not Started | 1   | —         |

#### P1: Dead Event Audit

**Goal:** Every event in the registry either has a call site or is removed. No dead constants.

| Deliverable                                                                                   | Status      | Est | Work Item |
| --------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Wire or remove `TOOL_CONNECTION_CREATED` — needs call site in tool OAuth flow                 | Not Started | 1   | —         |
| Wire or remove `ARTIFACT_CREATED` — needs call site in PR/work-item creation paths            | Not Started | 1   | —         |
| Wire or remove `BILLING_CREDITS_SPENT` — needs call site in billing deduction logic           | Not Started | 1   | —         |
| Wire or remove `RATE_LIMIT_HIT` — needs call site in LLM adapter rate-limit handling          | Not Started | 1   | —         |
| Wire or remove `SCHEDULE_CREATED` — needs call site in scheduler creation flow                | Not Started | 1   | —         |
| Wire or remove `BILLING_CREDITS_PURCHASED` — verify call site exists in credits confirm route | Not Started | 1   | —         |

---

## Constraints

- LiteLLM is canonical for usage telemetry — no shadow metering, no local token storage
- If LiteLLM is down, fail loudly (503) — no fallback to partial data
- `FakeUsageAdapter` must implement `ActivityUsagePort` faithfully for test reliability

## Dependencies

- [ ] LiteLLM aggregation API for sub-day bucketing (verify `group_by=hour` works)
- [ ] Stack test infrastructure (docker-compose test mode)

## As-Built Specs

- [activity-metrics.md](../../docs/spec/activity-metrics.md) — activity dashboard design, LiteLLM dependency, gating model
- [observability.md](../../docs/spec/observability.md) — structured logging, tracing
- [observability-requirements.md](../../docs/spec/observability-requirements.md) — silent death detection invariants, alert strategy, health check layering

## Design Notes

Content extracted from original `docs/spec/activity-metrics.md` TODO section during docs migration. The `METRICS_OBSERVABILITY.md` and `OBSERVABILITY_REQUIRED_SPEC.md` docs will contribute additional content when migrated.

P2+ log filtering, structured metadata, traces, dashboards, and alerts content extracted from `docs/guides/alloy-loki-setup.md` during guide migration.

### LLM Error Handling Design (from ERROR_HANDLING_IMPROVEMENT_DESIGN.md)

> Source: `docs/ERROR_HANDLING_IMPROVEMENT_DESIGN.md` (2025-12-04, triggered by grok-4.1-fast removal from OpenRouter)

**Current error flow (information loss):**

```
LiteLLM 404 → Adapter → Route → Client
"No endpoints found for x-ai/grok-4.1-fast:free"
         ↓
   "LiteLLM API error: 404 Not Found"
         ↓
   "AI service temporarily unavailable"
         ↓
   "API error: 503"
```

Lost context: which model failed, why (404 vs 503 vs 429), what fallbacks exist.

**Target: `LlmAdapterError` class** (`src/adapters/server/ai/errors.ts`):

```typescript
export class LlmAdapterError extends Error {
  constructor(
    public readonly type: LlmErrorType,
    public readonly model: string,
    public readonly provider: string,
    public readonly statusCode: number,
    public readonly providerMessage: string,
    message?: string
  ) {
    super(message ?? providerMessage);
    this.name = "LlmAdapterError";
  }
}
```

**Classification logic** (`classifyLiteLlmError()`): Maps HTTP status codes to `LlmErrorType`. Key rules:

- 404 + "No endpoints found" → `MODEL_NOT_FOUND`
- 429 → `RATE_LIMIT_EXCEEDED`
- 401/403 → `AUTH_ERROR`
- 502/503 → `MODEL_UNAVAILABLE`
- 504 → `TIMEOUT`

**Response mapping** (`mapLlmErrorToResponse()`): Each error type maps to a specific HTTP status, user message, suggestion text, and `fallbackAction` enum (`SELECT_DIFFERENT_MODEL`, `RETRY_LATER`, `WAIT_OR_SWITCH_MODEL`, `CONTACT_SUPPORT`, `RETRY`).

**Structured logging target:**

```json
{
  "level": 40,
  "errorType": "MODEL_NOT_FOUND",
  "model": "openrouter/x-ai/grok-4.1-fast:free",
  "provider": "OpenRouter",
  "statusCode": 404,
  "providerMessage": "No endpoints found for x-ai/grok-4.1-fast:free.",
  "msg": "LLM error: MODEL_NOT_FOUND"
}
```

**Greppable queries enabled:**

- `jq 'select(.errorType == "MODEL_NOT_FOUND")' logs.json` — precise error type filtering
- `jq -r 'select(.errorType != null) | .model' logs.json | sort | uniq -c` — failing model inventory
- `jq -r 'select(.errorType == "MODEL_NOT_FOUND") | .provider' logs.json | sort | uniq -c` — provider vs app attribution

**File pointers (P0):**

| File                                                            | Change                                           |
| --------------------------------------------------------------- | ------------------------------------------------ |
| `src/adapters/server/ai/errors.ts`                              | New: `LlmAdapterError`, `classifyLiteLlmError()` |
| `src/adapters/server/ai/litellm.adapter.ts`                     | Throw structured errors instead of generic Error |
| `src/app/api/v1/ai/chat/route.ts`                               | Catch `LlmAdapterError`, structured response     |
| `src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx` | Parse structured error JSON                      |

**Acceptance criteria:**

- Each LLM error log has `errorType`, `model`, `provider`, `statusCode` fields
- Users see specific error reason with actionable suggestion
- Error messages never expose internal details (auth keys, stack traces)
- New error types easy to add (extend enum)
