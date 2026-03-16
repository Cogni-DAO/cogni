---
id: webhook-ingestion-architecture-research
type: research
title: "Research: Webhook Ingestion Architecture — Next.js App vs Scheduler Worker vs Dedicated Service"
status: active
trust: draft
summary: "Industry best practices analysis for webhook ingestion architecture. Evaluates three options: Next.js app route (current), scheduler-worker direct ingestion, and dedicated webhook gateway. Recommends the current dual-ingest architecture with targeted improvements."
read_when: Deciding where webhook ingestion should live, evaluating webhook infrastructure options, or planning ingestion scaling.
owner: claude
created: 2026-03-05
verified: 2026-03-05
tags: [architecture, ingestion, webhooks, research]
---

# Research: Webhook Ingestion Architecture

> research | date: 2026-03-05

## Question

Should the scheduler worker directly ingest webhooks? Should the Next.js app handle them? Should there be a dedicated service? What is the industry standard best practice?

## Context

### What exists today

The codebase already implements a **dual-ingest architecture** for GitHub events:

| Path        | Runtime                                 | Entry Point                                                 | Status                  |
| ----------- | --------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| **Poll**    | Temporal activity in `scheduler-worker` | `CollectEpochWorkflow` → `GitHubSourceAdapter.collect()`    | Implemented             |
| **Webhook** | Next.js API route                       | `POST /api/internal/webhooks/[source]` → `receiveWebhook()` | Implemented (task.0136) |

Both paths produce `ActivityEvent[]` and converge at `AttributionStore.insertIngestionReceipts()` with `ON CONFLICT DO NOTHING` for natural deduplication.

The composable `DataSourceRegistration` type (task.0136) cleanly separates the two capabilities:

- `PollAdapter` — runs inside Temporal activities (cursor-based incremental sync)
- `WebhookNormalizer` — runs inside a feature service called from the Next.js route (verify → normalize → insert)

### What prompted this research

The question of whether the scheduler worker should directly handle webhooks, or whether the current Next.js route + feature service approach is correct, or whether a dedicated microservice would be better.

---

## Findings

### Option A: Scheduler Worker directly ingests webhooks

**What**: The Temporal worker exposes an HTTP endpoint to receive webhooks, processes them inside Temporal activities/workflows.

- **Pros**:
  - Single service owns all ingestion logic (poll + webhook)
  - Temporal provides built-in retry, idempotency (workflow ID = event ID), and durability
  - Temporal signals could feed webhook data into running workflows

- **Cons**:
  - **Temporal workers are not designed to be HTTP servers.** Workers pull tasks from queues — they don't expose HTTP endpoints. Adding an HTTP server to a Temporal worker is an anti-pattern that conflates two runtimes.
  - **Latency.** Starting a Temporal workflow per webhook adds ~50-200ms overhead for task scheduling + worker pickup. GitHub expects a response within 10 seconds, but the added latency is unnecessary friction vs a direct HTTP handler.
  - **Coupling.** Worker deployment/scaling/crashes would affect webhook availability. Workers should be free to restart without dropping webhook HTTP connections.
  - **Complexity.** Requires a separate HTTP server process inside the worker, health checking, port management, and load balancing — all of which the Next.js app already has.
  - **Violates architecture boundaries.** The scheduler-worker is an adapter layer (Temporal activities). Webhook reception is a delivery concern (HTTP entry point → feature service → port). Mixing these breaks the hexagonal layering.

- **OSS tools**: Temporal SDK (already in use). No additional tools needed, but the pattern is not recommended by Temporal's own documentation.

- **Fit with our system**: **Poor.** The codebase's hexagonal architecture (`app → features → ports → core`, `adapters` implement ports) places HTTP entry points in the `app` layer and scheduled tasks in `services/`. Combining them violates layer boundaries. The scheduler-worker's AGENTS.md enforces that activities and workflows import ports only — never HTTP framework code.

### Option B: Next.js App route (current architecture)

**What**: A parameterized Next.js API route at `/api/internal/webhooks/[source]` receives webhooks, delegates to a feature service that verifies → normalizes → inserts receipts.

- **Pros**:
  - **Industry-standard pattern.** The universal best practice is "verify → enqueue/persist → ACK fast." Our implementation does exactly this: verify signature, normalize to `ActivityEvent[]`, insert idempotent receipts, return 200. The entire flow completes in a single DB write — no queue needed because the operation is already idempotent and append-only.
  - **Clean architecture.** Route (app layer) → feature service (features layer) → port (AttributionStore). Dependencies point inward. The route knows nothing about GitHub — it dispatches by `:source` parameter.
  - **Already deployed.** Next.js app is the existing HTTP entry point. No new infrastructure, load balancers, DNS records, or health checks needed.
  - **Shared auth/middleware.** Internal routes (`/api/internal/*`) already have rate limiting, logging, and security headers from the Next.js middleware stack.
  - **Poll reconciliation.** The Temporal-scheduled poll adapter catches any webhooks that were missed (GitHub webhook delivery is best-effort). This dual-ingest pattern is exactly what the industry recommends.

- **Cons**:
  - **Coupled to Next.js process.** If the Next.js app is down for a deploy, webhooks are missed (mitigated by poll reconciliation).
  - **No queue buffer.** Under burst traffic, webhook processing happens inline. For our current scale (single GitHub org, <100 events/day), this is fine. At 10K+ events/minute, a queue would be needed.
  - **Cold start on serverless.** Not applicable — we deploy on a VM, not serverless. But worth noting if deployment model changes.

- **OSS tools**: `@octokit/webhooks-methods` (HMAC-SHA256 verification), `@octokit/webhooks-types` (typed payloads). Both MIT, official GitHub ecosystem.

- **Fit with our system**: **Excellent.** This is exactly how the feature development guide says to build features: contract → feature service → route. The webhook route is just another API endpoint that calls a feature service.

### Option C: Dedicated webhook gateway microservice

**What**: A standalone microservice (e.g., Express/Fastify) that receives all webhooks, persists raw payloads to a durable queue (SQS, Redis Streams, Postgres queue table), and workers process asynchronously.

- **Pros**:
  - **Isolation.** Webhook traffic can't affect the main app's performance.
  - **Queue buffer.** Absorbs traffic spikes. Processing rate is decoupled from ingestion rate.
  - **Replayability.** Raw payloads stored in queue enable reprocessing on schema changes.
  - **Independent scaling.** Webhook receiver and processors scale independently.

- **Cons**:
  - **Massive over-engineering for our scale.** We process <100 GitHub events/day. A dedicated microservice, queue, and worker pool is infrastructure for 10K+ events/minute scale.
  - **New infrastructure.** Requires a separate Docker service, health checks, DNS entry, TLS cert, queue (Redis/SQS/Postgres), dead-letter queue, monitoring dashboards. Each piece needs configuration, secrets, and CI/CD.
  - **Operational burden.** More services = more failure modes. Queue backpressure, DLQ alerting, worker scaling policies, and queue depth monitoring all need implementation.
  - **Duplication.** The Next.js app already provides HTTP handling, middleware, auth, logging, and health checking. A dedicated service rebuilds all of this.
  - **Temporal IS the queue.** For cases where we need durable async processing, Temporal already provides workflow-level durability, retry policies, and dead-letter handling. Adding another queue system is redundant.

- **OSS tools**: Hookdeck (managed webhook gateway), Svix (webhook delivery platform), AWS EventBridge, or custom with Fastify + BullMQ/SQS.

- **Fit with our system**: **Poor for current scale. Valid at 100x growth.** The architecture already has Temporal as a durable execution engine. Adding a second async processing layer (queue + workers) creates infrastructure duplication.

### Option D: Webhook-as-a-Service (WaaS)

**What**: Use a managed service like Hookdeck, Svix, or AWS EventBridge to receive webhooks and forward to our app.

- **Pros**:
  - **Zero infrastructure.** Managed retry, DLQ, replay, and monitoring.
  - **Battle-tested.** These services handle webhook delivery at scale across thousands of customers.
  - **Fast setup.** Minutes instead of days.

- **Cons**:
  - **External dependency for core pipeline.** Attribution ingestion is a core governance function. Depending on a third-party service for it introduces a control and availability risk.
  - **Cost.** Hookdeck charges per event. At low volume the cost is negligible; at scale it adds up.
  - **DAO philosophy mismatch.** The project's mission is "all infra deployable via open tooling." A managed SaaS webhook service contradicts this.
  - **Signature verification still needed.** WaaS forwards the payload but we still need to verify and normalize — the bulk of the work.

- **Fit with our system**: **Poor.** Contradicts the OSS-first, self-hosted infrastructure philosophy.

---

## Industry Best Practices Summary

The industry consensus from sources including [Hookdeck](https://hookdeck.com/blog/webhooks-at-scale), [Shortcut Engineering](https://www.shortcut.com/blog/more-reliable-webhooks-with-queues), [WorkOS](https://workos.com/blog/building-webhooks-into-your-application-guidelines-and-best-practices), [AWS](https://aws.amazon.com/blogs/compute/sending-and-receiving-webhooks-on-aws-innovate-with-event-notifications/), and [Temporal community patterns](https://community.temporal.io/t/how-to-poll-from-external-api-in-response-to-webhook/17454):

1. **Verify → persist → ACK fast.** Return 2xx within seconds. Do heavy processing async.
2. **Idempotent processing.** Webhooks are at-least-once. Design for duplicates.
3. **Queue-first for complex processing.** If processing takes >1s or has side effects, enqueue first.
4. **Poll as reconciliation.** Never rely on webhooks alone. Always have a poll fallback.
5. **Separate ingestion from processing.** The receiver should do minimal work.
6. **Use platform OSS for verification.** Don't roll your own HMAC.
7. **Monitor delivery rate, latency, and dedup hits.**

### How our current architecture maps

| Best Practice                      | Our Implementation                                                                                   | Status     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- |
| Verify → persist → ACK fast        | Route → verify → normalize → `insertIngestionReceipts()` → 200                                       | Done       |
| Idempotent processing              | Deterministic event IDs + `ON CONFLICT DO NOTHING`                                                   | Done       |
| Queue-first for complex processing | N/A — receipt insertion is a single idempotent DB write, not complex processing                      | Not needed |
| Poll as reconciliation             | `CollectEpochWorkflow` via Temporal Schedule (every 4-6h)                                            | Done       |
| Separate ingestion from processing | Webhook inserts raw receipts. Selection/enrichment/allocation happen in separate Temporal workflows. | Done       |
| Platform OSS for verification      | `@octokit/webhooks-methods` for GitHub HMAC-SHA256                                                   | Done       |
| Monitor delivery rate              | Not yet implemented                                                                                  | Gap        |

**Our architecture already follows industry best practices.** The only significant gap is observability (monitoring webhook delivery rate, latency, and dedup rate).

---

## Recommendation

**Keep the current architecture (Option B).** The Next.js app route + feature service + poll reconciliation is the correct design for our scale and architecture.

### Why not the scheduler worker (Option A)?

Temporal workers pull tasks from queues — they don't serve HTTP. Adding an HTTP server to a Temporal worker is an anti-pattern. The webhook and poll paths run in fundamentally different runtimes (HTTP request/response vs Temporal activity) and should live in their respective runtime homes.

### Why not a dedicated service (Option C)?

At <100 events/day from a single GitHub org, a dedicated webhook microservice with queue infrastructure is premature optimization by 2-3 orders of magnitude. The "verify → insert idempotent receipt → return 200" flow completes in ~10ms. There's nothing to queue.

### When to reconsider

Revisit Option C if any of these thresholds are crossed:

- **>10 webhook sources** (each with different verification schemes and payload formats)
- **>10K events/minute** (sustained, not burst)
- **Webhook processing takes >1s** (currently ~10ms for a DB insert)
- **Next.js deploy downtime** becomes unacceptable and poll reconciliation latency is too high

### Targeted improvements for the current architecture

| Improvement                                                 | Priority | Rationale                                                                      |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| Add webhook delivery monitoring (rate, latency, dedup hits) | P1       | Only significant gap vs industry best practices                                |
| Increase poll frequency to every 4h (from daily)            | P1       | Reduces worst-case reconciliation window                                       |
| Add collection completeness verification (task.0108)        | P1       | Compare webhook-inserted vs poll-returned counts per window                    |
| Add structured logging to webhook route                     | P2       | Source, event type, outcome, latency                                           |
| Consider GitHub App webhook vs org webhook                  | P2       | App webhooks auto-configure on installation, org webhooks require manual setup |

---

## Open Questions

1. **Webhook vs App webhook**: Should we use GitHub Organization webhooks (configured manually per org) or GitHub App webhooks (configured automatically per installation)? App webhooks are more portable but require the GitHub App to be installed. Current poll path already uses a GitHub App — aligning webhooks to the same App would simplify credential management.

2. **Observability tooling**: What metrics backend should webhook monitoring use? Prometheus counters via the existing Grafana Cloud integration seem natural. Specific metrics: `webhook_received_total{source,event_type}`, `webhook_latency_seconds`, `webhook_dedup_total`, `webhook_error_total{source,error_type}`.

3. **Zero-downtime deploys**: During a Next.js rolling deploy, is there a brief window where webhooks could be lost? GitHub retries failed deliveries, and poll reconciliation catches misses, but quantifying the window would be valuable.

4. **Rate limiting**: Should the webhook endpoint have its own rate limit separate from the general `/api/internal/*` limits? GitHub can burst-deliver webhooks when many PRs merge simultaneously (e.g., a release branch merge).

---

## Proposed Layout

### Project Impact

No new project needed. Improvements fall under existing **proj.transparent-credit-payouts** (ingestion reliability) and **proj.reliability** (observability).

### Spec Updates

1. **attribution-pipeline-overview.md** — Add a section on the dual-ingest pattern and why webhooks live in the Next.js app.
2. **observability.md** — Add webhook-specific metrics to the observability spec.

### Likely Tasks

| Task                          | Description                                                                                                 | Priority |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| Webhook delivery monitoring   | Add Prometheus counters for webhook receipt rate, latency, dedup hits, and errors. Grafana dashboard panel. | P1       |
| Increase poll frequency       | Change `LEDGER_INGEST` cron from daily to every 4h. Already cursor-based, so frequent polls are cheap.      | P1       |
| task.0108 (existing)          | Collection completeness verification — compare webhook counts vs poll counts per window.                    | P1       |
| Webhook structured logging    | Add source, event type, outcome, and latency fields to webhook route logs.                                  | P2       |
| GitHub App webhook evaluation | Spike: evaluate GitHub App webhooks vs org webhooks for credential alignment with existing App auth.        | P2       |

**Sequence**: Monitoring → poll frequency increase → completeness verification → structured logging → App webhook evaluation

### What NOT to build

- No dedicated webhook microservice (premature at current scale)
- No queue infrastructure (receipt insertion is already idempotent and fast)
- No Temporal workflow for webhook processing (webhook path is intentionally exempt from WRITES_VIA_TEMPORAL)
- No webhook-as-a-service integration (contradicts OSS-first philosophy)
- No scheduler-worker HTTP endpoint (anti-pattern for Temporal workers)

---

## Related

- [GitHub Ingestion Review](./github-ingestion-review.md) — Root cause analysis for zero activity in preview
- [Epoch Event Ingestion Pipeline](./epoch-event-ingestion-pipeline.md) — Original spike.0097 research on adapter design
- [task.0136 — Composable DataSource Registration](../../work/items/task.0136.composable-data-source-port.md) — Implementation of the dual-ingest port architecture
- [task.0108 — Collection Completeness Verification](../../work/items/task.0108.collection-completeness-verification.md) — Planned webhook vs poll reconciliation monitoring
- [Attribution Pipeline Overview](../spec/attribution-pipeline-overview.md) — End-to-end pipeline architecture

## Sources

- [Hookdeck: Webhooks at Scale](https://hookdeck.com/blog/webhooks-at-scale)
- [Shortcut: More Reliable Webhooks with Queues](https://www.shortcut.com/blog/more-reliable-webhooks-with-queues)
- [WorkOS: Building Webhooks Best Practices](https://workos.com/blog/building-webhooks-into-your-application-guidelines-and-best-practices)
- [AWS: Sending and Receiving Webhooks](https://aws.amazon.com/blogs/compute/sending-and-receiving-webhooks-on-aws-innovate-with-event-notifications/)
- [Integrate.io: Webhook Best Practices](https://www.integrate.io/blog/apply-webhook-best-practices/)
- [Temporal: Sending Webhooks with Temporal](https://ihsaanp.com/posts/sending-webhooks-with-temporal/)
- [Temporal Community: Poll from External API in Response to Webhook](https://community.temporal.io/t/how-to-poll-from-external-api-in-response-to-webhook/17454)
- [Svix: Webhook Architecture Diagram](https://www.svix.com/resources/webhook-architecture-diagram/)
- [System Design Handbook: Design a Webhook System](https://www.systemdesignhandbook.com/guides/design-a-webhook-system/)
