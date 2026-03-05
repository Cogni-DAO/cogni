---
id: research.github-ingestion-review
type: research
title: "Critical Review: GitHub Ingestion Pipeline & Temporal Schedule"
status: active
trust: draft
summary: "Root cause analysis for zero activity in preview, architectural evaluation of poll-only vs webhook-based ingestion, and port/adapter standardization recommendations."
read_when: Debugging empty ledger activity, planning webhook integration, or extending source adapters.
owner: claude
created: 2026-03-05
verified:
tags: [ingestion, github, temporal, architecture]
---

# Critical Review: GitHub Ingestion Pipeline & Temporal Schedule

## Problem Statement

In preview, the ledger shows **zero activity** — no GitHub events are being collected despite the `LEDGER_INGEST` schedule being declared in `repo-spec.yaml`.

---

## What the System Does Today

### Schedule Declaration → Temporal → Workflow → Adapter

1. **`repo-spec.yaml`** declares `LEDGER_INGEST` at `0 6 * * *` (daily 6am UTC)
2. **`syncGovernanceSchedules()`** (runs at deploy time) creates a Temporal Schedule `governance:ledger_ingest` targeting `CollectEpochWorkflow` on the `ledger-tasks` queue
3. **`CollectEpochWorkflow`** computes a 7-day epoch window, then for each source/stream: loads cursor → calls `adapter.collect()` → inserts receipts → advances cursor
4. **`GitHubSourceAdapter`** queries GitHub GraphQL (`repository.pullRequests`, `reviews`, `issues`) with client-side time-window filtering and `updatedAt DESC` early-stop

There is **no webhook handler**. The `SourceAdapter` port declares `handleWebhook?()` as optional/P1. No webhook route exists anywhere in the codebase.

---

## Root Cause Analysis: Why Preview Shows Nothing

Four probable root causes, any combination producing zero activity:

### 1. Missing env vars → GitHub adapter silently skipped (MOST LIKELY)

`createAttributionContainer()` (`services/scheduler-worker/src/bootstrap/container.ts:170`) checks:

```typescript
if (config.GH_REVIEW_APP_ID && config.GH_REVIEW_APP_PRIVATE_KEY_BASE64)
```

If either is unset, the adapter map stays empty. When `collectFromSource()` looks up `sourceAdapters.get("github")`, it gets `undefined`, logs a warning, and **returns zero events without error**. The workflow succeeds silently.

**Diagnosis:** Check Temporal workflow execution history for `ledger-collect-*` runs. Look for `"No adapter found for source, skipping"` log line.

### 2. Temporal Schedule never synced

`syncGovernanceSchedules()` runs at deploy time, not as part of the worker itself. If preview doesn't run the sync (or the API that triggers it isn't called), the schedule `governance:ledger_ingest` never gets created. The worker sits idle.

**Diagnosis:** Check Temporal UI → Schedules tab → look for `governance:ledger_ingest`. If absent, the schedule was never synced.

### 3. `GH_REPOS` env empty or mismatched

Even with valid app credentials, `GH_REPOS` must be set (comma-separated). If empty, the adapter construction is skipped (`container.ts:191-194`).

### 4. GitHub App not installed on the target repo

`GitHubAppTokenProvider` resolves the installation ID dynamically. If the GitHub App isn't installed on `Cogni-DAO/node-template`, it throws — which Temporal retries and eventually fails.

---

## Architectural Evaluation: Poll vs Webhook vs Both

### Poll-only (current state) — correct for V0 but limited

| Issue | Impact |
|-------|--------|
| 24h latency | PR merged at 7am waits ~23h to appear |
| Window gaps | Client-side `updatedAt` early-stop can miss events with GitHub index lag |
| Rate limit pressure | Full re-scan of PR/issue connection ordered by `updatedAt DESC` each day |
| No real-time signal | Contributors don't see their activity until next day |

### Webhooks alone — dangerous

| Issue | Impact |
|-------|--------|
| Delivery not guaranteed | GitHub webhooks are best-effort with limited retries |
| Ordering not guaranteed | Events arrive out of order |
| No backfill | Missed webhook = permanently lost event without poll fallback |

### Recommended: Dual-ingest with idempotent dedup

```
Webhooks (fast-path)                    Poll (reconciliation)
────────────────────                    ─────────────────────
GitHub App webhook                      Temporal Schedule (every 4-6h)
  → POST /api/v1/internal/webhooks/gh     → CollectEpochWorkflow
  → parse event payload                   → adapter.collect(cursor, window)
  → normalize to ActivityEvent            → normalize to ActivityEvent
  → insertReceipts (ON CONFLICT DO NOTHING) → insertReceipts (ON CONFLICT DO NOTHING)
```

**Idempotency is already guaranteed.** Deterministic event IDs (`github:pr:owner/repo:42`) + `ON CONFLICT DO NOTHING` on `ingestion_receipts` PK means both paths naturally deduplicate.

---

## Port/Adapter Standardization Recommendations

### 1. Separate poll adapter from webhook handler

The current `SourceAdapter` conflates two responsibilities. They should be separable ports:

```typescript
// Existing — poll-based collection (runs in Temporal activity)
interface SourceAdapter {
  readonly source: string;
  readonly version: string;
  streams(): StreamDefinition[];
  collect(params: CollectParams): Promise<CollectResult>;
}

// New — webhook normalization (runs in Next.js API route)
interface WebhookHandler {
  readonly source: string;
  readonly supportedEvents: string[];
  parseAndNormalize(headers: Headers, body: unknown): ActivityEvent[];
  verifySignature(headers: Headers, body: Buffer, secret: string): boolean;
}
```

Why separate:
- **Different runtime**: webhook runs in Next.js request/response, not Temporal
- **Different auth**: webhook secret verification vs GitHub App installation token
- **Different error handling**: return 200 to GitHub quickly, process async

### 2. Extract receipt insertion into shared port

Currently `insertReceipts()` is a Temporal activity. Webhooks can't call Temporal activities. Extract:

```typescript
// Shared port — both Temporal activity and webhook route use this
interface IngestionReceiptWriter {
  insertReceipts(events: ActivityEvent[], producerVersion: string): Promise<void>;
}
```

### 3. Increase poll frequency

Change `LEDGER_INGEST` cron from `0 6 * * *` to `0 */4 * * *` (every 4h). The adapter already does cursor-based incremental sync, so frequent polls are cheap. Reduces worst-case latency from 24h to 4h.

### 4. Add watermark reconciliation

After webhook processing, periodically verify completeness: compare event count in `ingestion_receipts` for a time window against what the poll returns. Log `webhook_miss_count` metric as a safety net.

### 5. Per-stream cursor isolation

The workflow currently loads one cursor before iterating all streams for a sourceRef. If PR collection succeeds but review collection fails, the cursor still advances past the PR events. The `saveCursor` activity already accepts a stream parameter — ensure each stream loads/saves its own cursor independently (the workflow loop already does this per-stream, so this is mostly correct, but verify edge cases around error handling).

---

## Prioritized Issue Summary

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | Silent adapter skip when env vars missing | **P0** | Fail loud if `activity_sources.github` is in repo-spec but adapter can't be created |
| 2 | No verification that Temporal Schedule exists | **P0** | Add health check verifying `governance:ledger_ingest` exists |
| 3 | Daily-only collection (24h latency) | P1 | Increase to every 4h |
| 4 | No webhook fast-path | P1 | Add `WebhookHandler` port + GitHub webhook route |
| 5 | `collectFromSource` returns empty on missing adapter without error | P1 | Throw (or emit metric) when configured source has no adapter |
| 6 | No webhook signature verification port | P2 | Required before enabling webhooks |
| 7 | Shared cursor across error boundaries | P2 | Verify per-stream cursor isolation on partial failure |

---

## Related

- [Attribution Pipeline Overview](../spec/attribution-pipeline-overview.md)
- [Data Ingestion Pipelines](../spec/data-ingestion-pipelines.md)
- [Tenant Connections](../spec/tenant-connections.md) — credential brokering for source adapter auth
- [task.0109 — GitHub Adapter Expand Event Types](../../work/items/task.0109.github-adapter-expand-event-types.md)
