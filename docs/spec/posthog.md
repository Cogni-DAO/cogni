---
id: posthog-spec
type: spec
title: PostHog Product Analytics
status: active
trust: draft
summary: Architecture decision, capture contract, identity model, and event registry for PostHog product analytics.
read_when: Adding analytics events, querying PostHog from agents, or changing the analytics infrastructure.
owner: derekg1729
created: 2026-03-13
verified: 2026-03-13
tags: [analytics, observability]
---

# PostHog Product Analytics

## Core Invariants

1. **Cloud for production, self-hosted for dev.** PostHog Cloud free tier (1M events/month) is the production backend. Self-hosted stack (`infra/compose/posthog/`) is local dev only. Decision rationale: 9-container self-hosted stack (~4GB RAM) is too heavy for the single production VM.

2. **AI-first.** The primary consumer of PostHog data is AI agents querying the HogQL API (`POST /api/projects/:id/query/`). The PostHog dashboard UI is a debugging convenience, not the primary interface.

3. **Server-side capture only (MVP).** Events are emitted via `capture()` from `apps/operator/src/shared/analytics/capture.ts`. No frontend JS snippet yet (tracked in `proj.observability-hardening` P0).

4. **Fire-and-forget.** `capture()` batches events (50 events or 5s) and HTTP POSTs to `/batch/`. Failures are silent — no app impact, but events are lost during PostHog outages.

5. **Identity is `users.id`.** The `distinct_id` on every event is the canonical `users.id` UUID. Session correlation uses the auth session ID (not random UUIDs — fix tracked in `proj.observability-hardening` P0).

## Contracts

### Environment Variables

| Variable             | Required | Description                                              |
| -------------------- | -------- | -------------------------------------------------------- |
| `POSTHOG_API_KEY`    | **Yes**  | Project API key (`phc_...`). App fails to start without. |
| `POSTHOG_HOST`       | **Yes**  | PostHog API endpoint URL. App fails to start without.    |
| `POSTHOG_PROJECT_ID` | Optional | Numeric project ID. Required for HogQL agent queries.    |

Validated by `serverEnv()` Zod schema (`z.string().min(1)` and `z.string().url()`).

### Host by Environment

| Environment  | POSTHOG_HOST               | Source                      |
| ------------ | -------------------------- | --------------------------- |
| Production   | `https://us.i.posthog.com` | GitHub environment secret   |
| Dev (host)   | `http://localhost:8000`    | `.env.local`                |
| Dev (docker) | `http://posthog-web:8000`  | docker-compose internal DNS |
| CI/Test      | `http://localhost:18000`   | Dummy — events dropped      |

### Capture API

```typescript
import { capture, AnalyticsEvents } from "@/shared/analytics";

capture({
  event: AnalyticsEvents.AUTH_SIGNED_IN,
  identity: {
    userId: user.id,
    sessionId: session.id,
    tenantId: billingAccountId,
    traceId: ctx.traceId,
  },
  properties: {
    provider: "github",
    is_new_user: true,
  },
});
```

### Event Envelope (Required on Every Event)

| Field                    | Type    | Source               |
| ------------------------ | ------- | -------------------- |
| `event`                  | string  | Namespaced `cogni.*` |
| `distinct_id`            | string  | `users.id` UUID      |
| `properties.session_id`  | string  | Auth session ID      |
| `properties.tenant_id`   | string? | Billing account ID   |
| `properties.environment` | string  | `APP_ENV` config     |
| `properties.app_version` | string  | Git SHA              |
| `properties.trace_id`    | string? | OTel trace ID        |

### Event Registry

Event names defined in `apps/operator/src/shared/analytics/events.ts`. Payload schemas in `docs/analytics/events.v0.md`.

## File Pointers

| File                                               | Purpose                        |
| -------------------------------------------------- | ------------------------------ |
| `apps/operator/src/shared/analytics/capture.ts`    | `capture()`, `initAnalytics()` |
| `apps/operator/src/shared/analytics/events.ts`     | Event name constants           |
| `apps/operator/src/shared/env/server-env.ts`       | Env var validation (Zod)       |
| `apps/operator/src/bootstrap/container.ts`         | `initAnalytics()` call site    |
| `docs/analytics/events.v0.md`                      | Event payload schemas          |
| `infra/compose/posthog/docker-compose.posthog.yml` | Self-hosted stack (dev only)   |

## Migration Path

If event volume exceeds PostHog Cloud free tier:

1. Deploy self-hosted PostHog stack to a dedicated VM
2. Change `POSTHOG_HOST` GitHub secret to the new instance URL
3. No code changes — `capture()` and HogQL queries work identically

## Related

- [PostHog Setup Guide](../guides/posthog-setup.md) — first-time setup steps
- [Event Taxonomy v0](../analytics/events.v0.md) — event payload schemas
- [Observability Hardening Project](../../work/projects/proj.observability-hardening.md) — coverage gaps
