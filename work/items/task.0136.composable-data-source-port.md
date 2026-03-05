---
id: task.0136
type: task
title: "Composable DataSource port: unified poll + webhook ingestion"
status: needs_implement
priority: 1
rank: 10
estimate: 3
summary: "Replace monolithic SourceAdapter with a composable DataSource descriptor that binds optional PollAdapter and WebhookNormalizer capabilities, converging at a shared ReceiptWriter. Modeled on GraphExecutorPort's aggregation pattern."
outcome: "A data source can declare poll-only, webhook-only, or both. Both paths produce ActivityEvent[] and converge at idempotent receipt insertion. GitHub adapter gains a webhook fast-path without losing poll reconciliation."
spec_refs: [attribution-ledger-spec, data-ingestion-pipelines-spec, graph-execution-spec]
assignees: []
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-05
updated: 2026-03-05
labels: [architecture, attribution, ingestion]
external_refs:
---

# Composable DataSource port: unified poll + webhook ingestion

## Design

### Outcome

Data sources can support poll, webhook, or both ingestion modes through composable capability interfaces — eliminating the monolithic `SourceAdapter` port that conflates two fundamentally different runtimes (Temporal activity vs HTTP request handler).

### Approach

**Solution**: Capability-based composition, modeled on `GraphExecutorPort`'s aggregation pattern.

The key insight from `GraphExecutorPort` is: one unified output type (`AiEvent` stream), multiple provider adapters behind an aggregator, cross-cutting concerns handled by decorators (billing, credit check). The analog for data ingestion:

- **One unified output type**: `ActivityEvent[]` (already exists, unchanged)
- **Multiple ingestion modes**: `PollAdapter` (Temporal activity) and `WebhookNormalizer` (HTTP route)
- **One convergence point**: `ReceiptWriter` port (extracted from Temporal activity, usable by both paths)
- **One descriptor**: `DataSourceDescriptor` binds capabilities per source

```
                  ┌─────────────────────────────────┐
                  │      DataSourceDescriptor        │
                  │  source: "github"                │
                  │  version: "0.3.0"                │
                  │  poll?: PollAdapter              │  ← Temporal activity calls this
                  │  webhook?: WebhookNormalizer     │  ← HTTP route calls this
                  └──────────┬──────────┬────────────┘
                             │          │
                    ┌────────▼──┐  ┌────▼──────────┐
                    │ collect() │  │ normalize()    │
                    │ cursor    │  │ verify()       │
                    │ window    │  │ headers+body   │
                    └────┬──────┘  └────┬───────────┘
                         │              │
                         ▼              ▼
                    ActivityEvent[]  ActivityEvent[]
                         │              │
                         └──────┬───────┘
                                ▼
                    ┌───────────────────────┐
                    │    ReceiptWriter      │  ← Shared port (idempotent insert)
                    │  insertReceipts()     │
                    │  ON CONFLICT DO NOTHING│
                    └───────────────────────┘
```

**Reuses**:
- `ActivityEvent`, `StreamDefinition`, `StreamCursor`, `CollectParams`, `CollectResult` — unchanged from `@cogni/ingestion-core`
- Deterministic event IDs (`github:pr:owner/repo:42`) — natural dedup across both paths
- `RECEIPT_IDEMPOTENT` + `ON CONFLICT DO NOTHING` — already guarantees safe dual-ingest
- Existing `GitHubSourceAdapter.collect()` logic — becomes the `PollAdapter` capability
- `insertIngestionReceipts()` from `AttributionStore` — extracted into standalone `ReceiptWriter` port

**Rejected**:
1. **Two separate, unrelated ports** (from the research review) — Rejected because it fragments the source concept. Operators configure "github" as a source; the system should present one descriptor, not two disconnected interfaces that must be independently wired.
2. **Single interface with optional methods** (current `handleWebhook?()`) — Rejected because poll and webhook run in fundamentally different runtimes (Temporal vs HTTP) with different auth, error handling, and lifecycle. Optional methods on one interface creates a God Object.
3. **Mode parameter on `collect()`** — Rejected because poll and webhook have completely different input shapes (cursor+window vs headers+body). A union parameter would be type-unsafe.

### Port Definitions

```typescript
// packages/ingestion-core/src/port.ts — replaces current SourceAdapter

/**
 * Descriptor binding a source's ingestion capabilities.
 * A source may support poll, webhook, or both.
 * At least one capability must be present.
 */
interface DataSourceDescriptor {
  readonly source: string;     // "github", "discord"
  readonly version: string;    // bump on schema changes
  readonly poll?: PollAdapter;
  readonly webhook?: WebhookNormalizer;
}

/**
 * Poll capability — runs inside Temporal activities.
 * Cursor-based incremental sync over a time window.
 */
interface PollAdapter {
  streams(): StreamDefinition[];
  collect(params: CollectParams): Promise<CollectResult>;
}

/**
 * Webhook capability — runs inside HTTP request handlers.
 * Normalizes platform webhook payloads to ActivityEvent[].
 */
interface WebhookNormalizer {
  /** Platform event types this normalizer handles (e.g., ["pull_request", "issues"]) */
  readonly supportedEvents: readonly string[];

  /** Verify webhook signature. Must be called before normalize(). */
  verify(headers: Headers, body: Buffer, secret: string): boolean;

  /** Parse and normalize webhook payload to ActivityEvent[].
   *  Returns empty array for events we don't care about (e.g., PR opened but not merged).
   *  Must be synchronous and pure (no I/O). */
  normalize(headers: Headers, body: unknown): ActivityEvent[];
}

/**
 * Shared receipt insertion — used by both Temporal activities and HTTP routes.
 * Extracted from AttributionStore to enable convergence.
 */
interface ReceiptWriter {
  insertReceipts(
    events: readonly ActivityEvent[],
    producer: string,
    producerVersion: string,
    nodeId: string,
  ): Promise<void>;
}
```

### Why This Mirrors GraphExecutorPort

| Graph Execution | Data Ingestion | Pattern |
|---|---|---|
| `GraphExecutorPort.runGraph()` | `ActivityEvent[]` output | Unified output type |
| `AggregatingGraphExecutor` | `DataSourceDescriptor` | Routes to capability |
| `InProcCompletionUnitAdapter` | `PollAdapter` | One execution mode |
| `ClaudeGraphExecutorAdapter` | `WebhookNormalizer` | Another execution mode |
| `BillingGraphExecutorDecorator` | `ReceiptWriter` | Cross-cutting convergence |
| `graphId` namespace routing | `source` field routing | Provider dispatch |
| Provider declares capabilities | Descriptor declares poll/webhook | Capability declaration |

### Runtime Topology

**Poll path** (unchanged — Temporal worker):
```
Temporal Schedule → CollectEpochWorkflow
  → resolveStreams(descriptor.poll!.streams())
  → loadCursor()
  → collectFromSource(descriptor.poll!.collect(...))
  → receiptWriter.insertReceipts(events)
  → saveCursor()
```

**Webhook path** (new — Next.js API route):
```
GitHub POST /api/v1/internal/webhooks/github
  → lookup DataSourceDescriptor for "github"
  → descriptor.webhook!.verify(headers, body, secret)
  → descriptor.webhook!.normalize(headers, body) → ActivityEvent[]
  → receiptWriter.insertReceipts(events)
  → return 200 (fast, sync)
```

**Key**: The webhook route does NOT start a Temporal workflow. It writes receipts directly. The next scheduled `CollectEpochWorkflow` run picks them up during `materializeSelection` (receipts are scope-agnostic; epoch membership is determined at selection time per `RECEIPT_SCOPE_AGNOSTIC`).

### Auth Topology

| Path | Auth Mechanism | Where Configured |
|---|---|---|
| Poll | GitHub App installation token via `VcsTokenProvider` | Container bootstrap (env vars) |
| Webhook | Webhook secret signature verification (`X-Hub-Signature-256`) | Connection or env var |
| Receipt write | Internal — no user auth | Direct DB access |

Webhook secrets follow the tenant-connections pattern (`CONNECTION_ID_ONLY`): the secret is resolved at verification time, never stored in route config. V0 can use env var; P1 uses `connections` table.

### Migration Path

1. **Backward compatible**: `SourceAdapter` interface stays as a type alias for `DataSourceDescriptor & { poll: PollAdapter }` during migration
2. **GitHubSourceAdapter**: Current class implements `PollAdapter`. Extract `poll` capability, add `webhook` capability
3. **Container bootstrap**: `createAttributionContainer()` builds `Map<string, DataSourceDescriptor>` instead of `Map<string, SourceAdapter>`
4. **CollectEpochWorkflow**: Access `descriptor.poll!` instead of `adapter` directly
5. **Singer taps**: Future Singer mapper implements `PollAdapter` — same convergence point

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CAPABILITY_REQUIRED: `DataSourceDescriptor` must have at least one of `poll` or `webhook`. Validated at container bootstrap.
- [ ] WEBHOOK_VERIFY_BEFORE_NORMALIZE: Route MUST call `verify()` before `normalize()`. Unverified payloads rejected with 401.
- [ ] RECEIPT_IDEMPOTENT: Both paths produce deterministic event IDs. Dedup is natural via PK conflict (spec: attribution-ledger-spec).
- [ ] WEBHOOK_RETURNS_FAST: Webhook route returns 200 within 10s. No Temporal workflow started. Receipt insertion is the only I/O.
- [ ] RECEIPT_WRITER_SHARED: Both paths use the same `ReceiptWriter` port. No separate insertion logic.
- [ ] POLL_RECONCILES_WEBHOOKS: Poll adapter is the reconciliation safety net. Webhook misses are caught on next poll cycle.
- [ ] WEBHOOK_SECRET_NOT_IN_CODE: Webhook secrets resolved from env or connections table, never hardcoded.
- [ ] NORMALIZE_IS_PURE: `WebhookNormalizer.normalize()` does no I/O. All data comes from the payload.
- [ ] SIMPLE_SOLUTION: Leverages existing `ActivityEvent` types, deterministic IDs, and ON CONFLICT DO NOTHING (spec: attribution-ledger-spec)
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal ports & adapters, capability composition pattern from GraphExecutorPort (spec: architecture, graph-execution-spec)

### Files

<!-- High-level scope -->

- Modify: `packages/ingestion-core/src/port.ts` — Replace `SourceAdapter` with `DataSourceDescriptor`, `PollAdapter`, `WebhookNormalizer`
- Create: `packages/ingestion-core/src/receipt-writer.port.ts` — `ReceiptWriter` port interface
- Modify: `packages/ingestion-core/src/index.ts` — Re-export new types
- Modify: `src/ports/source-adapter.port.ts` — Re-export updated types
- Modify: `services/scheduler-worker/src/adapters/ingestion/github.ts` — Refactor to implement `PollAdapter`; add `WebhookNormalizer` implementation
- Create: `services/scheduler-worker/src/adapters/ingestion/github-webhook.ts` — `GitHubWebhookNormalizer` (verify + normalize)
- Modify: `services/scheduler-worker/src/bootstrap/container.ts` — Build `DataSourceDescriptor` with both capabilities
- Modify: `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — Use `descriptor.poll!` instead of `adapter`
- Modify: `services/scheduler-worker/src/activities/ledger.ts` — Extract receipt insertion into `ReceiptWriter`
- Create: `src/app/api/v1/internal/webhooks/github/route.ts` — GitHub webhook receiver route
- Modify: `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — Implement `ReceiptWriter` port
- Test: `services/scheduler-worker/tests/github-webhook-normalizer.test.ts` — Unit tests for normalize + verify
- Test: `tests/contract/receipt-writer.contract.ts` — Port contract test
- Test: `tests/stack/webhooks/github-webhook.stack.test.ts` — End-to-end webhook → receipt

## Requirements

- `DataSourceDescriptor` replaces `SourceAdapter` as the primary port for data sources
- A source can declare poll capability, webhook capability, or both
- Both capabilities produce `ActivityEvent[]` with deterministic IDs
- Both paths converge at `ReceiptWriter.insertReceipts()` (idempotent via PK)
- GitHub adapter implements both poll and webhook capabilities
- Webhook route verifies signature before processing
- Webhook route returns fast (no Temporal workflow)
- Poll adapter remains the reconciliation safety net for missed webhooks
- Existing `CollectEpochWorkflow` continues to work via `descriptor.poll`

## Allowed Changes

- `packages/ingestion-core/` — port interfaces
- `services/scheduler-worker/src/adapters/ingestion/` — adapter implementations
- `services/scheduler-worker/src/bootstrap/` — container wiring
- `services/scheduler-worker/src/workflows/` — workflow references to descriptor
- `services/scheduler-worker/src/activities/` — receipt writer extraction
- `packages/db-client/src/adapters/` — receipt writer implementation
- `src/app/api/v1/internal/webhooks/` — new webhook route
- `src/ports/` — re-exports
- Tests in `services/scheduler-worker/tests/`, `tests/contract/`, `tests/stack/`

## Plan

- [ ] Define `DataSourceDescriptor`, `PollAdapter`, `WebhookNormalizer` in `packages/ingestion-core/src/port.ts`
- [ ] Define `ReceiptWriter` port in `packages/ingestion-core/src/receipt-writer.port.ts`
- [ ] Refactor `GitHubSourceAdapter` to implement `PollAdapter` interface
- [ ] Implement `GitHubWebhookNormalizer` (verify + normalize)
- [ ] Extract receipt insertion from `ledger.ts` activities into `ReceiptWriter` implementation
- [ ] Update container bootstrap to build `DataSourceDescriptor` map
- [ ] Update `CollectEpochWorkflow` to use `descriptor.poll`
- [ ] Add webhook route at `/api/v1/internal/webhooks/github`
- [ ] Add unit tests for webhook normalizer
- [ ] Add contract test for `ReceiptWriter` port
- [ ] Update attribution-ledger spec source adapter section

## Validation

**Command:**

```bash
pnpm check && pnpm test
```

**Expected:** All tests pass. `DataSourceDescriptor` replaces `SourceAdapter` usage. Webhook normalizer has full coverage.

## Review Checklist

- [ ] **Work Item:** `task.0136` linked in PR body
- [ ] **Spec:** RECEIPT_IDEMPOTENT, PROVENANCE_REQUIRED, ADAPTERS_NOT_IN_CORE upheld
- [ ] **Spec:** WEBHOOK_VERIFY_BEFORE_NORMALIZE enforced in route
- [ ] **Tests:** webhook normalizer unit tests, receipt writer contract test
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
