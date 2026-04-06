---
id: data-source-integration-guide
type: guide
title: Data Source Integration Guide
status: draft
trust: draft
summary: How to integrate an external data source through the canonical ingestion pipeline and optionally publish summaries for dashboard/AI visibility.
read_when: Adding a new external data source, writing a PollAdapter, wiring Redis stream publishing, or adding a dashboard summary.
owner: derekg1729
created: 2026-04-05
---

# Data Source Integration Guide

> How to integrate an external data source end-to-end: adapter → Temporal → Postgres → Redis live plane → (optional) SSE summary.

## The Rule

**External data source integration is done only when raw events are published to `streams:{domain}:{source}`.** Publishing a summary to `node:{nodeId}:events` is optional/derived for dashboard UX — it is NOT the primary integration step.

```
Source API → PollAdapter → Temporal Activity
  ├──▶ ingestion_receipts (Postgres)       ← durable archive
  ├──▶ streams:{domain}:{source} (Redis)   ← live plane (MANDATORY per STREAM_THEN_EVALUATE)
  └──▶ node:{nodeId}:events (Redis)        ← summary for SSE/UI/AI (OPTIONAL, derived)
```

## What Is a Summary Publisher?

A summary publisher is the **last optional step** of an ingestion activity that writes a derived event to `node:{nodeId}:events` so the SSE endpoint can deliver it to dashboards and AI agents.

**A summary publisher is NOT:**

- The primary integration point (that's `streams:{domain}:{source}`)
- A standalone polling loop in bootstrap (that's the old anti-pattern)
- A replacement for ingestion-core + Temporal (that's the canonical path)
- The primary storage for source data (that's `ingestion_receipts` in Postgres)

## The Two Publisher Patterns

### Pattern 1: Temporal Activity Publisher (external sources)

For any data that comes from outside the process — GitHub, Polymarket, Grafana, cross-node health probes.

```
Source API → PollAdapter.collect() → Temporal Activity
  ├──▶ insertReceipts()           ← durable archive (Postgres)
  ├──▶ XADD streams:{domain}:{source}  ← raw live plane (Redis, MANDATORY)
  └──▶ XADD node:{nodeId}:events ← summary for SSE/UI/AI (Redis)
```

The activity already exists in `services/scheduler-worker/src/activities/ledger.ts`. To add the stream publish step:

```typescript
// In the Temporal activity, after insertReceipts():
await nodeStreamPort.publish(`node:${nodeId}:events`, {
  type: "ingestion_summary",
  timestamp: new Date().toISOString(),
  source: registration.source, // "github", "polymarket", etc.
  eventCount: result.events.length,
  domain: "prediction-market", // or "vcs", "on-chain", etc.
  lastEventTime: result.events.at(-1)?.eventTime ?? null,
} satisfies IngestionSummaryEvent);
```

### Pattern 2: Bootstrap Publisher (node-local only)

For data that lives inside the process and has zero external dependencies — `process.memoryUsage()`, event loop delay, uptime.

```
process.memoryUsage() → setInterval(60s) → XADD node:{nodeId}:events
```

This pattern is LIMITED to `ProcessHealthEvent`. Do not extend it to external sources.

## Adding a New External Data Source (Checklist)

### 1. Define the adapter

Create a `PollAdapter` in `services/scheduler-worker/src/adapters/ingestion/`:

```typescript
export class MySourceAdapter implements PollAdapter {
  readonly version = "0.1.0";

  streams(): StreamDefinition[] {
    return [{ name: "events", description: "My source events" }];
  }

  async collect(params: CollectParams): Promise<CollectResult> {
    // Fetch from external API using params.cursor for incremental sync
    // Return deterministic event IDs: "mysource:{entity}:{id}"
    // Include payloadHash (SHA-256) per PROVENANCE_REQUIRED
  }
}
```

### 2. Register in scheduler-worker bootstrap

In `services/scheduler-worker/src/bootstrap/container.ts`:

```typescript
if (env.MY_SOURCE_API_KEY) {
  registrations.set("mysource", {
    source: "mysource",
    version: adapter.version,
    poll: new MySourceAdapter({ apiKey: env.MY_SOURCE_API_KEY }),
  });
}
```

### 3. Configure in repo-spec

In `.cogni/repo-spec.yaml`:

```yaml
activity_sources:
  mysource:
    attribution_pipeline: cogni-v0.0
    source_refs: ["my-account-id"]
```

### 4. Add the stream publish step

In the Temporal activity (after `insertReceipts`), publish a summary to the node stream. This makes the data visible on the SSE endpoint.

### 5. Create the frontend event content component

In `features/node-stream/components/MySourceEventContent.tsx`:

```typescript
export function MySourceEventContent({ event }: { event: MySourceData }): ReactElement {
  return (
    <div className="flex items-center gap-3 text-sm">
      <Badge intent="default" size="sm">{event.source}</Badge>
      <span className="text-muted-foreground">{event.eventCount} events</span>
    </div>
  );
}
```

### 6. Add to `useNodeStream` knownTypes

In `features/node-stream/hooks/useNodeStream.ts`, add your event type string to the `knownTypes` array.

## Event Type Contract

Every event must extend `NodeEventBase`:

```typescript
interface NodeEventBase {
  type: string; // discriminator — unique per event kind
  timestamp: string; // ISO 8601
  source: string; // provenance for drill-back
}
```

**Naming convention:** `type` uses snake_case: `process_health`, `ci_status`, `ingestion_summary`, `market_snapshot`.

**Source convention:** matches the adapter source key: `"github"`, `"polymarket"`, `"process-metrics"`.

## Reference

| Spec                                                        | What it covers                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| [data-streams.md](../spec/data-streams.md)                  | Canonical 3-tier architecture, stream key families, SSE transport layer |
| [architecture.md](../spec/architecture.md)                  | Hexagonal layering, port/adapter boundaries                             |
| [ingestion-core](../../packages/ingestion-core/src/port.ts) | PollAdapter, WebhookNormalizer, DataSourceRegistration interfaces       |
