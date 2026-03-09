---
id: task.0136
type: task
title: "Composable DataSource registration: unified poll + webhook ingestion"
status: needs_merge
priority: 1
rank: 10
estimate: 3
summary: "Replace monolithic SourceAdapter with a composable DataSourceRegistration that binds optional PollAdapter and WebhookNormalizer capabilities. Both paths produce ActivityEvent[] and converge at existing AttributionStore.insertIngestionReceipts(). GitHub webhook verification via @octokit/webhooks-methods (OSS, already in Octokit ecosystem)."
outcome: "A data source can declare poll-only, webhook-only, or both. Both paths produce ActivityEvent[] and converge at idempotent receipt insertion via AttributionStore. GitHub adapter gains a webhook fast-path without losing poll reconciliation."
spec_refs:
  [attribution-ledger-spec, data-ingestion-pipelines-spec, graph-execution-spec]
assignees: []
credit:
project: proj.transparent-credit-payouts
branch: claude/review-github-ingestion-Kwjtl
pr: https://github.com/Cogni-DAO/node-template/pull/519
reviewer:
revision: 5
blocked_by:
deploy_verified: false
created: 2026-03-05
updated: 2026-03-07
labels: [architecture, attribution, ingestion]
external_refs:
---

# Composable DataSource registration: unified poll + webhook ingestion

## Design

### Outcome

Data sources can support poll, webhook, or both ingestion modes through composable capability interfaces — eliminating the monolithic `SourceAdapter` port that conflates two fundamentally different runtimes (Temporal activity vs HTTP request handler).

### Approach

**Solution**: Capability-based composition, modeled on `GraphExecutorPort`'s aggregation pattern.

- **One unified output type**: `ActivityEvent[]` (already exists, unchanged)
- **Multiple ingestion modes**: `PollAdapter` (Temporal activity) and `WebhookNormalizer` (HTTP route → feature service)
- **One convergence point**: `AttributionStore.insertIngestionReceipts()` (already exists — no new port)
- **One registration record**: `DataSourceRegistration` binds capabilities per source

```
                  ┌─────────────────────────────────┐
                  │      DataSourceRegistration      │
                  │  source: "github"                │
                  │  version: "0.3.0"                │
                  │  poll?: PollAdapter              │  ← Temporal activity calls this
                  │  webhook?: WebhookNormalizer     │  ← Feature service calls this
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
                  ┌────────────────────────────────┐
                  │  AttributionStore              │  ← Existing port (no extraction)
                  │  .insertIngestionReceipts()    │
                  │  ON CONFLICT DO NOTHING        │
                  └────────────────────────────────┘
```

**Reuses**:

- `ActivityEvent`, `StreamDefinition`, `StreamCursor`, `CollectParams`, `CollectResult` — unchanged from `@cogni/ingestion-core`
- Deterministic event IDs (`github:pr:owner/repo:42`) — natural dedup across both paths
- `RECEIPT_IDEMPOTENT` + `ON CONFLICT DO NOTHING` — already guarantees safe dual-ingest
- Existing `GitHubSourceAdapter.collect()` logic — becomes the `PollAdapter` capability
- Existing `AttributionStore.insertIngestionReceipts()` — shared convergence point (no new port needed)
- `@octokit/webhooks-methods` — MIT, Octokit ecosystem, HMAC-SHA256 verification for GitHub

**Rejected**:

1. **Two separate, unrelated ports** (from the research review) — Rejected because it fragments the source concept. Operators configure "github" as a source; the system should present one registration, not two disconnected interfaces that must be independently wired.
2. **Single interface with optional methods** (current `handleWebhook?()`) — Rejected because poll and webhook run in fundamentally different runtimes (Temporal vs HTTP) with different auth, error handling, and lifecycle. Optional methods on one interface creates a God Object.
3. **Mode parameter on `collect()`** — Rejected because poll and webhook have completely different input shapes (cursor+window vs headers+body). A union parameter would be type-unsafe.
4. **Standalone `ReceiptWriter` port** — Rejected as premature extraction. `AttributionStore.insertIngestionReceipts()` already exists and is the single insertion path. Both the Temporal activity and the webhook feature service can use it directly.
5. **Generic webhook framework (hook-engine, standardwebhooks)** — Rejected. GitHub uses `X-Hub-Signature-256` (HMAC-SHA256), not the Standard Webhooks spec headers (`Webhook-Signature`). Discord uses Ed25519. Each platform has its own signature scheme. A generic framework adds indirection without reducing code — each adapter must still implement platform-specific normalization. The `WebhookNormalizer` port defines the shape; platform-specific OSS libraries (`@octokit/webhooks-methods`, `discord-interactions`) handle verification inside each adapter.

### Is a WebhookNormalizer port useful?

**Yes.** Even though each platform has its own signature scheme, the port provides value as a **contract** that the feature service and route depend on:

1. **Route doesn't know the platform** — The webhook route at `/api/v1/internal/webhooks/:source` dispatches to `DataSourceRegistration[source].webhook` without platform-specific code.
2. **Feature service is source-agnostic** — `WebhookReceiverService.receive(source, headers, body)` calls `verify()` then `normalize()` regardless of whether it's GitHub, Discord, or Stripe.
3. **Test boundary** — Mock `WebhookNormalizer` in feature service tests without HTTP or platform SDK dependencies.
4. **Consistent lifecycle** — All webhook sources follow the same `verify → normalize → insert` pattern. The port makes this contractual, not accidental.

**Implementation is platform-specific, but the contract is generic.** This mirrors how `PollAdapter.collect()` has one interface but GitHub uses GraphQL while Discord uses REST — the port defines what, adapters define how.

### Port Definitions

```typescript
// packages/ingestion-core/src/port.ts — replaces current SourceAdapter

/**
 * Registration record binding a source's ingestion capabilities.
 * A source may support poll, webhook, or both.
 * At least one capability must be present (validated at bootstrap).
 * Not a port itself — a capability manifest containing ports.
 */
interface DataSourceRegistration {
  readonly source: string; // "github", "discord"
  readonly version: string; // bump on schema changes
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
 * Webhook capability — runs inside feature services via HTTP request handlers.
 * Normalizes platform webhook payloads to ActivityEvent[].
 * Verification uses platform-specific OSS: @octokit/webhooks-methods (GitHub),
 * discord-interactions (Discord), etc.
 */
interface WebhookNormalizer {
  /** Platform event types this normalizer handles (e.g., ["pull_request", "issues"]) */
  readonly supportedEvents: readonly string[];

  /** Verify webhook signature. Must be called before normalize().
   *  Implementation uses platform OSS — not bespoke crypto. */
  verify(
    headers: Record<string, string>,
    body: Buffer,
    secret: string
  ): Promise<boolean>;

  /** Parse and normalize webhook payload to ActivityEvent[].
   *  Returns empty array for events we don't care about (e.g., PR opened but not merged).
   *  Should not perform network I/O — all data comes from the payload. */
  normalize(headers: Record<string, string>, body: unknown): ActivityEvent[];
}
```

Note: `verify()` is `async` because `@octokit/webhooks-methods` `verify()` returns `Promise<boolean>` (uses Web Crypto API internally).

### Runtime Topology

**Poll path** (unchanged — Temporal worker):

```
Temporal Schedule → CollectEpochWorkflow
  → resolveStreams(registration.poll!.streams())
  → loadCursor()
  → collectFromSource(registration.poll!.collect(...))
  → attributionStore.insertIngestionReceipts(events)   ← existing method
  → saveCursor()
```

**Webhook path** (new — feature service called from route):

```
GitHub POST /api/v1/internal/webhooks/:source
  → route validates internal bearer token (SCHEDULER_API_TOKEN)
  → extracts headers + raw body
  → calls WebhookReceiverService.receive(source, headers, body)
    → looks up DataSourceRegistration for source
    → registration.webhook!.verify(headers, body, secret)  ← @octokit/webhooks-methods
    → registration.webhook!.normalize(headers, body) → ActivityEvent[]
    → attributionStore.insertIngestionReceipts(events)     ← same existing method
  → return 200
```

**Key design decisions**:

- The webhook route delegates to a **feature service** (`WebhookReceiverService`), respecting the app layer boundary (`app → features`, never `app → ports`).
- Receipt insertion uses the **existing** `AttributionStore.insertIngestionReceipts()` — no new port.
- The route is parameterized by `:source` — one route handles GitHub, Discord, future sources. The feature service dispatches to the correct `DataSourceRegistration`.
- The next `CollectEpochWorkflow` picks up webhook-inserted receipts during `materializeSelection` (per `RECEIPT_SCOPE_AGNOSTIC`).

### WRITES_VIA_TEMPORAL Exemption for Receipt Appends

The attribution-ledger spec invariant `WRITES_VIA_TEMPORAL` states all write operations go through Temporal. The webhook path writes receipts directly from a feature service. This requires a **spec amendment** because receipt appends are provably safe outside Temporal:

1. `RECEIPT_IDEMPOTENT` — Same event ID = PK conflict = no-op. Re-insertion is inherently safe.
2. `RECEIPT_APPEND_ONLY` — DB trigger rejects UPDATE/DELETE. Receipts can only be appended.
3. No ordering dependency — Receipts are independent facts. No workflow state to coordinate.
4. Temporal adds no value — Retry semantics are unnecessary for idempotent appends. The poll path provides reconciliation for any missed webhooks.

Spec update: amend `WRITES_VIA_TEMPORAL` to _"All write operations (collect, finalize) execute in Temporal workflows, **except** `ingestion_receipts` appends which are exempt due to RECEIPT_IDEMPOTENT + RECEIPT_APPEND_ONLY guarantees. Webhook receivers may insert receipts directly via feature services."_

### Auth Topology

| Path           | Auth Mechanism                                       | Where Configured                  |
| -------------- | ---------------------------------------------------- | --------------------------------- |
| Poll           | GitHub App installation token via `VcsTokenProvider` | Container bootstrap (env vars)    |
| Webhook route  | Internal bearer token (`SCHEDULER_API_TOKEN`)        | Same as `/api/internal/*` pattern |
| Webhook verify | Platform-specific signature (`X-Hub-Signature-256`)  | `GH_WEBHOOK_SECRET` env var (V0)  |

### OSS Dependencies

| Purpose                               | Library                     | License | Why                                                                                                                                                               |
| ------------------------------------- | --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub webhook signature verification | `@octokit/webhooks-methods` | MIT     | Already in Octokit ecosystem (codebase uses `@octokit/graphql`, `@octokit/auth-app`). Provides `verify(secret, payload, signature)` using Web Crypto HMAC-SHA256. |
| GitHub webhook event types            | `@octokit/webhooks-types`   | MIT     | Typed webhook payloads (`PullRequestEvent`, `IssuesEvent`, etc.) for the normalizer implementation.                                                               |
| Discord webhook verification (future) | `discord-interactions`      | MIT     | Official Discord library, Ed25519 verification via `verifyKey()`. Added when Discord adapter gains webhook support.                                               |

No bespoke crypto. Each adapter uses its platform's official OSS library for signature verification.

### Migration Path

1. **Backward compatible**: `SourceAdapter` stays as a type alias for `DataSourceRegistration & { poll: PollAdapter }` during migration
2. **GitHubSourceAdapter**: Current class implements `PollAdapter`. Extracted as capability. New `GitHubWebhookNormalizer` added using `@octokit/webhooks-methods`.
3. **Container bootstrap**: `createAttributionContainer()` builds `Map<string, DataSourceRegistration>` instead of `Map<string, SourceAdapter>`
4. **CollectEpochWorkflow**: Access `registration.poll!` instead of `adapter` directly
5. **Singer taps**: Future Singer mapper implements `PollAdapter` — same convergence point

### Invariants

All new invariants below will be added to `attribution-ledger.md` spec as part of this PR. Listed here as code review criteria:

- [ ] CAPABILITY_REQUIRED: At least one of `poll` or `webhook` present. Validated at bootstrap. (spec: attribution-ledger-spec)
- [ ] WEBHOOK_VERIFY_BEFORE_NORMALIZE: Feature service MUST call `verify()` before `normalize()`. Unverified payloads rejected with 401. (spec: attribution-ledger-spec)
- [ ] WEBHOOK_RECEIPT_APPEND_EXEMPT: Webhook receipt insertion exempt from WRITES_VIA_TEMPORAL per RECEIPT_IDEMPOTENT + RECEIPT_APPEND_ONLY. (spec: attribution-ledger-spec, amends existing invariant)
- [ ] POLL_RECONCILES_WEBHOOKS: Poll adapter is reconciliation safety net. Webhook misses caught on next poll cycle. (spec: attribution-ledger-spec)
- [ ] WEBHOOK_SECRET_NOT_IN_CODE: Secrets from env or connections table, never hardcoded. (spec: attribution-ledger-spec)
- [ ] WEBHOOK_VERIFY_VIA_OSS: Signature verification uses platform OSS libraries, not bespoke crypto. (spec: attribution-ledger-spec)
- [ ] RECEIPT_IDEMPOTENT: Both paths produce deterministic event IDs. Dedup via PK conflict. (spec: attribution-ledger-spec, existing)
- [ ] ARCHITECTURE_ALIGNMENT: Route → feature service → port. No direct port imports from app layer. (spec: architecture)

### Files

- Modify: `packages/ingestion-core/src/port.ts` — Replace `SourceAdapter` with `DataSourceRegistration`, `PollAdapter`, `WebhookNormalizer`
- Modify: `packages/ingestion-core/src/index.ts` — Re-export new types
- Modify: `src/ports/source-adapter.port.ts` — Re-export updated types
- Modify: `services/scheduler-worker/src/adapters/ingestion/github.ts` — Refactor to implement `PollAdapter`
- Create: `services/scheduler-worker/src/adapters/ingestion/github-webhook.ts` — `GitHubWebhookNormalizer` using `@octokit/webhooks-methods` + `@octokit/webhooks-types`
- Modify: `services/scheduler-worker/src/bootstrap/container.ts` — Build `DataSourceRegistration` map with both capabilities
- Modify: `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — Use `registration.poll!` instead of `adapter`
- Modify: `services/scheduler-worker/src/activities/ledger.ts` — Update type references
- Create: `src/features/ingestion/services/webhook-receiver.ts` — `WebhookReceiverService` (feature service, uses `AttributionStore` port)
- Create: `src/app/api/internal/webhooks/[source]/route.ts` — Parameterized webhook route (delegates to feature service)
- Create: `src/adapters/server/ingestion/github-webhook.ts` — GitHubWebhookNormalizer (app adapter for route access)
- Modify: `docs/spec/attribution-ledger.md` — Amend WRITES_VIA_TEMPORAL, add new invariants, update source adapter section
- Test: `services/scheduler-worker/tests/github-webhook-normalizer.test.ts` — Unit tests for normalize + verify
- Test: `tests/stack/webhooks/github-webhook.stack.test.ts` — End-to-end webhook → receipt

## Requirements

- `DataSourceRegistration` replaces `SourceAdapter` as the primary registration type for data sources
- A source can declare poll capability, webhook capability, or both
- Both capabilities produce `ActivityEvent[]` with deterministic IDs
- Both paths converge at `AttributionStore.insertIngestionReceipts()` (existing method, no extraction)
- GitHub adapter implements both poll and webhook capabilities
- Webhook verification uses `@octokit/webhooks-methods` (OSS, no bespoke crypto)
- Webhook route delegates to feature service (`WebhookReceiverService`), not importing ports directly
- Webhook route is parameterized by `:source` for multi-source extensibility
- Feature service verifies webhook signature before normalizing
- Webhook path returns fast (no Temporal workflow)
- Poll adapter remains the reconciliation safety net for missed webhooks
- Existing `CollectEpochWorkflow` continues to work via `registration.poll`
- `WRITES_VIA_TEMPORAL` amended in attribution-ledger spec before merge
- New invariants added to `attribution-ledger.md`

## Allowed Changes

- `packages/ingestion-core/` — port interfaces (types only)
- `services/scheduler-worker/src/adapters/ingestion/` — refactor existing adapter + new webhook normalizer
- `services/scheduler-worker/src/bootstrap/` — container wiring
- `services/scheduler-worker/src/workflows/` — workflow references to registration
- `services/scheduler-worker/src/activities/` — type reference updates
- `src/ports/` — re-exports
- `src/features/ingestion/` — new feature service
- `src/app/api/v1/internal/webhooks/` — new webhook route
- `docs/spec/attribution-ledger.md` — spec amendments
- Tests in `services/scheduler-worker/tests/`, `tests/stack/`

## Plan

- [ ] **Checkpoint 1: Port types**
  - Milestone: New port interfaces compile. All existing code still works via backward-compat type alias.
  - Invariants: ADAPTERS_NOT_IN_CORE
  - Todos:
    - [ ] Define `DataSourceRegistration`, `PollAdapter`, `WebhookNormalizer` in `packages/ingestion-core/src/port.ts`
    - [ ] Keep `SourceAdapter` as a backward-compat type alias
    - [ ] Update `packages/ingestion-core/src/index.ts` re-exports
    - [ ] Update `src/ports/source-adapter.port.ts` re-exports
    - [ ] Update `src/ports/index.ts` re-exports
    - [ ] Update `services/scheduler-worker/src/ports/index.ts` re-exports
  - Validation: `pnpm check` passes with zero type errors

- [ ] **Checkpoint 2: Refactor existing code to DataSourceRegistration**
  - Milestone: GitHub adapter + container + workflow + activities use DataSourceRegistration instead of SourceAdapter. Existing behavior unchanged.
  - Invariants: RECEIPT_IDEMPOTENT, CURSOR_STATE_PERSISTED, ADAPTERS_NOT_IN_CORE
  - Todos:
    - [ ] Refactor `GitHubSourceAdapter` to implement `PollAdapter` (remove `handleWebhook?`)
    - [ ] Update container to build `Map<string, DataSourceRegistration>` with poll capability
    - [ ] Update `AttributionContainer.sourceAdapters` type to `DataSourceRegistration` map
    - [ ] Update `AttributionActivityDeps` in ledger.ts to use `DataSourceRegistration`
    - [ ] Update `collectFromSource` to use `registration.poll!.collect()`
    - [ ] Update `resolveStreams` to use `registration.poll!.streams()`
    - [ ] Update workflow references if needed
  - Validation: `pnpm check` passes. Existing tests pass.

- [ ] **Checkpoint 3: Webhook path — normalizer + feature service + route**
  - Milestone: GitHub webhook normalizer implemented. Feature service wires verify→normalize→insert. Route delegates to service.
  - Invariants: WEBHOOK_VERIFY_BEFORE_NORMALIZE, RECEIPT_IDEMPOTENT, ARCHITECTURE_ALIGNMENT, WEBHOOK_VERIFY_VIA_OSS
  - Todos:
    - [ ] Install `@octokit/webhooks-methods` (dev dep in scheduler-worker)
    - [ ] Create `GitHubWebhookNormalizer` in `services/scheduler-worker/src/adapters/ingestion/github-webhook.ts`
    - [ ] Create `WebhookReceiverService` in `src/features/ingestion/services/webhook-receiver.ts`
    - [ ] Create webhook route at `src/app/api/v1/internal/webhooks/[source]/route.ts`
    - [ ] Wire webhook normalizer into GitHub registration in container
    - [ ] Add `GH_WEBHOOK_SECRET` to env schema
    - [ ] Add unit tests for `GitHubWebhookNormalizer`
  - Validation: `pnpm check` passes. Webhook normalizer tests pass.

- [ ] **Checkpoint 4: Spec update + finalize**
  - Milestone: Attribution-ledger spec updated. Work item status set to needs_closeout.
  - Invariants: All listed invariants documented in spec
  - Todos:
    - [ ] Amend WRITES_VIA_TEMPORAL in `docs/spec/attribution-ledger.md`
    - [ ] Add new invariants to spec
    - [ ] Update Source Adapter Interface section in spec
    - [ ] Update work item status to needs_closeout
    - [ ] Final `pnpm check` pass
  - Validation: `pnpm check` passes. `pnpm check:docs` passes.

## Validation

**Command:**

```bash
pnpm check && pnpm test
```

**Expected:** All tests pass. `DataSourceRegistration` replaces `SourceAdapter` usage. Webhook normalizer has full coverage. Attribution-ledger spec updated.

## Review Checklist

- [ ] **Work Item:** `task.0136` linked in PR body
- [ ] **Spec:** RECEIPT_IDEMPOTENT, PROVENANCE_REQUIRED, ADAPTERS_NOT_IN_CORE upheld
- [ ] **Spec:** WRITES_VIA_TEMPORAL amended before merge
- [ ] **Spec:** New invariants added to attribution-ledger.md, not only in work item
- [ ] **Architecture:** Webhook route → feature service → port (no direct port imports from app)
- [ ] **OSS:** Webhook verification uses @octokit/webhooks-methods, no bespoke crypto
- [ ] **Tests:** webhook normalizer unit tests, stack test for webhook → receipt
- [ ] **Reviewer:** assigned and approved

## Review Feedback

### Revision 3 — Blocking Issues

1. **Code Duplication (P0)**: `GitHubWebhookNormalizer` duplicated identically in `services/scheduler-worker/src/adapters/ingestion/github-webhook.ts` and `src/adapters/server/ingestion/github-webhook.ts`. Delete the scheduler-worker copy. Update the test to import from the `src/adapters/server/` barrel or relocate the test to `tests/unit/adapters/`.

2. **Unguarded JSON parse (P1)**: `src/features/ingestion/services/webhook-receiver.ts:68` — `JSON.parse(body.toString("utf-8"))` throws untyped Error on malformed payloads, producing 500 instead of 400. Wrap in try/catch and throw a typed error (e.g., `WebhookPayloadParseError`) so the route returns 400.

3. **Body read before size check (P1)**: `src/app/api/internal/webhooks/[source]/route.ts:77-80` — Full body read into memory via `request.arrayBuffer()` before checking `MAX_BODY_SIZE`. Add `Content-Length` header check before reading the body as a fast-path reject for oversized payloads.

### Revision 3 — Non-blocking Suggestions

- Add structured logging to webhook route (source, event type, outcome)
- Extract version `"0.3.0"` to a shared constant (hardcoded in both containers)
- Add `WEBHOOK_SECRET_NOT_IN_CODE` invariant to the spec (listed in work item but missing from attribution-ledger.md)
- Add runtime `CAPABILITY_REQUIRED` validation at bootstrap (stated as "validated at bootstrap" in spec but no code)

### Revision 5 — Blocking Issues (LOOP_LIMIT — escalate to human)

1. **`pnpm check` fails (P0)**: 3 failures introduced by this change:
   - **lint**: 10 Biome errors in `tests/external/ingestion/webhook-poll-dedup.external.test.ts` (trailing commas in template literals)
   - **format**: 5 errors in same file
   - **check:docs**: 4 header validation errors — `_github-fixture-helper.ts` missing `invariants`/`sideEffects`/`links` labels; all 4 new external test files missing negative-clause in `scope`
   - **Fix**: Run `pnpm format:write`, fix remaining lint, add missing header fields

2. **`insertReceipts` missing `producerVersion` (P0)**: `tests/external/ingestion/ledger-collection.external.test.ts:201,228` — `insertReceipts({ events })` omits required `producerVersion` field. Will fail at runtime with NOT NULL constraint violation on `producer_version` column. Add `producerVersion: githubAdapter.version`.

3. **Version constant duplication (P1)**: `"0.3.0"` hardcoded independently in `services/scheduler-worker/src/adapters/ingestion/github.ts:201` (`GitHubSourceAdapter.version`) and `src/adapters/server/ingestion/github-webhook.ts:23` (`GITHUB_ADAPTER_VERSION`). If these drift, webhook and poll receipts get different `producer_version` values — breaks audit trail. Extract to one shared location.

4. **Phantom `scopeId` in test input (P2)**: `tests/external/ingestion/ledger-collection.external.test.ts:118,131,148` — passes `scopeId` to `ensureEpochForWindow()` but `EnsureEpochInput` has no such field. Silently ignored. Remove.

### Revision 5 — Non-blocking Suggestions

- Add `GH_WEBHOOK_SECRET` to `.github/workflows/ci.yaml` env blocks (won't break CI since `.optional()` but completes propagation)
- Fix fixture filename collision in `_github-fixture-helper.ts:51` — use unique names per run (e.g., `.ext-test-${suffix}.txt`)
- Previous rev 3 suggestion to extract version constant to shared location remains open and is now promoted to blocking

### Revision 3 — Status

All 3 blocking items from rev 3 were addressed:

1. Duplicate normalizer deleted from scheduler-worker ✅
2. JSON parse wrapped in try/catch with `WebhookPayloadParseError` ✅
3. Content-Length check added before body read ✅

Rev 3 non-blocking suggestions addressed:

- Structured logging in route ✅
- `WEBHOOK_SECRET_NOT_IN_CODE` added to spec ✅
- `CAPABILITY_REQUIRED` validation at bootstrap ✅
- Version constant extraction — **NOT addressed**, now blocking (rev 5 item 3)

## PR / Links

- Handoff: [handoff](../handoffs/task.0136.handoff.md)

## Attribution

-
