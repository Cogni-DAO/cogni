---
title: PostHog Product Analytics
status: active
owner: platform
created: 2025-02-28
updated: 2026-03-13
---

# PostHog Product Analytics

PostHog is the product analytics event store for Cogni. Events are captured server-side and queryable via HogQL API by AI agents.

## Architecture Decision: PostHog Cloud

**Decision (2026-03-13):** Use PostHog Cloud (free tier, 1M events/month) for production. Self-hosted stack (`infra/compose/posthog/`) is retained for local dev only.

**Why:**

- AI-first analytics — agents query PostHog's HogQL API (`POST /api/projects/:id/query/`), not a human dashboard
- Self-hosted PostHog is 9 containers (~4GB RAM) — too heavy to add to the single production VM
- PostHog Cloud free tier is generous (1M events/month, no credit card, 1 year retention)
- Same `capture()` code and HogQL API work identically with both Cloud and self-hosted
- When event volume outgrows the free tier, migrate to self-hosted or paid Cloud

**Hosts:**

| Environment  | POSTHOG_HOST               | Source                          |
| ------------ | -------------------------- | ------------------------------- |
| Production   | `https://us.i.posthog.com` | GitHub environment secret       |
| Dev (host)   | `http://localhost:8000`    | `.env.local` (self-hosted)      |
| Dev (docker) | `http://posthog-web:8000`  | docker-compose internal DNS     |
| CI/Test      | `http://localhost:18000`   | Dummy — events silently dropped |

## Production Setup (PostHog Cloud)

1. Sign up at [posthog.com](https://posthog.com) (GitHub SSO, no credit card)
2. Create organization + project
3. Skip the "install snippet" step — server-side `capture()` is already wired
4. Copy **Project API Key** from Project Settings (format: `phc_xxxxxxxxxxxx`)
5. Set GitHub environment secrets (both `preview` and `production` environments):
   - `POSTHOG_API_KEY` = your `phc_...` key
   - `POSTHOG_HOST` = `https://us.i.posthog.com` (US) or `https://eu.i.posthog.com` (EU)

## Local Dev Setup (Self-Hosted, Optional)

Self-hosted PostHog runs as a separate compose stack for local development.

**Resource requirements:** ~4GB RAM minimum.

```bash
# Start PostHog stack
pnpm posthog:up

# Wait for health (~60s startup)
docker compose -f infra/compose/posthog/docker-compose.posthog.yml ps
```

### First-Time Setup (Local)

1. Open `http://localhost:8000` in browser
2. Create an admin account
3. Copy the **Project API Key** from Settings > Project > API Key
4. Set in `.env.local`:

```bash
POSTHOG_API_KEY=phc_your_project_api_key_here
POSTHOG_HOST=http://localhost:8000
```

### Services & Ports (Self-Hosted)

| Service              | Port (host)      | Purpose                       |
| -------------------- | ---------------- | ----------------------------- |
| `posthog-web`        | `127.0.0.1:8000` | PostHog UI + API              |
| `posthog-clickhouse` | `127.0.0.1:8123` | ClickHouse HTTP (SQL queries) |
| `posthog-clickhouse` | `127.0.0.1:9000` | ClickHouse native protocol    |
| `posthog-postgres`   | (internal only)  | PostHog metadata DB           |
| `posthog-redis`      | (internal only)  | Cache + queue                 |
| `posthog-kafka`      | (internal only)  | Event ingestion pipeline      |
| `posthog-zookeeper`  | (internal only)  | Kafka coordination            |

## App Configuration

### Environment Variables

| Variable          | Required | Default | Description               |
| ----------------- | -------- | ------- | ------------------------- |
| `POSTHOG_API_KEY` | **Yes**  | —       | PostHog project API key.  |
| `POSTHOG_HOST`    | **Yes**  | —       | PostHog API endpoint URL. |

Both variables are **required**. The app will fail to start if either is missing. For local dev, use self-hosted PostHog (`pnpm posthog:up`) or PostHog Cloud free tier.

### How Events Are Sent

The app uses `capture()` from `apps/web/src/shared/analytics/capture.ts`:

```typescript
import { capture, AnalyticsEvents } from "@/shared/analytics";

capture({
  event: AnalyticsEvents.AUTH_SIGNED_IN,
  identity: {
    userId: user.id, // canonical users.id UUID
    sessionId: session.id, // session identifier
    tenantId: billingAccountId,
    traceId: ctx.traceId, // OTel trace ID
  },
  properties: {
    provider: "github",
    is_new_user: true,
  },
});
```

Events are batched (50 events or 5s interval) and sent via HTTP POST to PostHog's `/batch/` endpoint.

## Running ClickHouse Queries

### From Host (Self-Hosted)

```bash
# Interactive ClickHouse client
docker exec -it posthog-clickhouse clickhouse-client

# One-off query
docker exec posthog-clickhouse clickhouse-client \
  --query "SELECT count() FROM posthog.events"

# HTTP API (useful for scripts)
curl 'http://localhost:8123/?query=SELECT+count()+FROM+posthog.events'
```

### From Inside the Docker Network

Other services on the `internal` network can reach ClickHouse at:

- HTTP: `http://posthog-clickhouse:8123`
- Native: `posthog-clickhouse:9000`

### Schema Discovery

PostHog stores events in ClickHouse. To explore the schema:

```sql
-- List all databases
SHOW DATABASES;

-- List tables in posthog database
SHOW TABLES FROM posthog;

-- Key tables:
--   posthog.events          — raw events (main query target)
--   posthog.person          — user/person records
--   posthog.person_distinct_id2 — distinct_id → person mapping

-- Describe the events table
DESCRIBE posthog.events;

-- Sample recent events
SELECT event, distinct_id, timestamp, properties
FROM posthog.events
ORDER BY timestamp DESC
LIMIT 10;
```

## Stopping PostHog

```bash
# Stop (preserve data)
docker compose -f infra/compose/posthog/docker-compose.posthog.yml down

# Stop and delete all data
docker compose -f infra/compose/posthog/docker-compose.posthog.yml down -v
```

## Risks & Trade-offs

### PostHog Cloud Dependency

Production analytics depend on PostHog Cloud (external SaaS). If PostHog Cloud has an outage, `capture()` calls fail silently (fire-and-forget HTTP). No app impact, but events are lost. Migration path to self-hosted exists if needed (same API, same `capture()` code).

### Identity

Canonical identity is `users.id` (UUID). For unauthenticated events (pre-sign-in), use a deterministic anonymous ID from the session cookie. PostHog will merge identities when `$identify` is called after sign-in.

### Event Volume

The MVP event set (12 events) is intentionally small. `page_viewed` is excluded to avoid volume spam. Monitor ClickHouse disk usage if self-hosting.

### Trace ID Correlation

`trace_id` is included when events fire inside an OTel span context (route handlers, graph execution). Events outside span context (e.g., auth callbacks) will have `trace_id: null`.

### No Kafka/Redis Sharing

PostHog uses its own Kafka and Redis instances, separate from the app stack. This avoids cross-contamination but increases resource usage.
