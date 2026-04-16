---
id: ai-pipeline-e2e-spec
type: spec
title: "AI Pipeline E2E: Auth, Execution, Billing & Security"
status: active
spec_state: active
trust: reviewed
summary: "End-to-end reference for the AI execution pipeline — auth surfaces, graph execution, billing data flow, security posture scorecard, and priority actions. Covers all LLM providers: platform (LiteLLM), BYO (Codex, OpenAI-compatible), and sandbox."
read_when: Understanding the full AI pipeline (auth → execution → billing → dashboard), debugging missing billing records, adding a new LLM provider, evaluating security posture, or onboarding new engineers.
implements: proj.byo-ai
owner: derekg1729
created: 2026-03-27
verified: 2026-03-29
tags: [billing, auth, security, observability, byo-ai, architecture]
---

# AI Pipeline E2E: Auth, Execution, Billing & Security

> One diagram, one narrative. How a user request becomes a `charge_receipt` row becomes a dashboard chart — and the security model that protects every layer.

## Goal

Provide a single reference showing the complete path from user request to dashboard chart — auth, execution, billing, and security posture — across all LLM providers (platform, BYO, sandbox).

## Non-Goals

- Defining the charge_receipts schema (see [billing-evolution](./billing-evolution.md))
- Defining the callback protocol (see [billing-ingest](./billing-ingest.md))
- Defining provider selection or ModelRef (see [multi-provider-llm](./multi-provider-llm.md))
- Defining RLS policy details (see [database-rls](./database-rls.md))
- Defining auth surface details (see [security-auth](./security-auth.md))

## Design

### Key References

|          |                                                             |                                      |
| -------- | ----------------------------------------------------------- | ------------------------------------ |
| **Spec** | [billing-ingest](./billing-ingest.md)                       | Callback-driven receipt writing      |
| **Spec** | [billing-evolution](./billing-evolution.md)                 | charge_receipts schema, credit units |
| **Spec** | [multi-provider-llm](./multi-provider-llm.md)               | Provider registry, ModelRef          |
| **Spec** | [graph-execution](./graph-execution.md)                     | Decorator stack, execution pipeline  |
| **Spec** | [activity-metrics](./activity-metrics.md)                   | Dashboard query logic                |
| **Spec** | [external-executor-billing](./external-executor-billing.md) | Reconciliation design                |
| **Spec** | [security-auth](./security-auth.md)                         | Auth surfaces, route protection      |
| **Spec** | [database-rls](./database-rls.md)                           | RLS tenant isolation                 |
| **Spec** | [graph-execution](./graph-execution.md)                     | Execution context, invariants        |

## End-to-End Flow

```
USER REQUEST
  Chat UI / Schedule / API
  modelRef: { providerKey, modelId, connectionId? }
       │
       ▼
FACADE  (completion.server.ts)
  sessionUser → billingAccountId
  Starts Temporal workflow → Redis RunStream
       │
       ▼
INTERNAL ROUTE  (graphs/[graphId]/runs/route.ts)
  Resolves accountService, preflightCheckFn, commitByoUsage
  Calls createScopedGraphExecutor()
       │
       ▼
DECORATOR STACK  (graph-executor.factory.ts)
  ┌─ 5. ObservabilityDecorator         Langfuse trace
  │  ┌─ 4. PreflightCreditCheck        Gate: enough credits?
  │  │  ┌─ 3. UsageCommitDecorator     Validate + commit BYO
  │  │  │  ┌─ 2. BillingEnrichment     Add billingAccountId
  │  │  │  │  ┌─ 1. NamespaceRouter    Route by graphId prefix
  │  │  │  │  │     ├── "langgraph:*" → InProc
  │  │  │  │  │     └── "sandbox:*"  → Sandbox
  └──┴──┴──┴──┘
       │
       ▼
EXECUTION SCOPE (AsyncLocalStorage)
  scope.llmService   = resolved from provider.createLlmService()
  scope.usageSource  = provider.usageSource ("litellm"|"codex"|"ollama")
  scope.billing      = { billingAccountId, virtualKeyId }
       │
       ├────────────────────────┬─────────────────────────┐
       ▼                        ▼                         ▼
  PLATFORM (InProc)       BYO (InProc)              SANDBOX
  LiteLlmAdapter          CodexLlmAdapter           Ephemeral / Gateway
  HTTP → LiteLLM proxy    subprocess / HTTP         Docker container
       │                        │                         │
       ▼                        ▼                         ▼
INPROC ADAPTER emits usage_report  (inproc-completion-unit.adapter.ts)
  UsageFact {
    runId, attempt: 0, graphId,
    source:      scope.usageSource,
    executorType: "inproc",
    usageUnitId: litellmCallId ?? "${runId}/${attempt}/byo",
    inputTokens, outputTokens,
    model,
    costUsd:     result.providerCostUsd ?? 0,
  }
       │
       ▼
DECORATOR 2: BillingEnrichment  (billing-enrichment.decorator.ts)
  ADDS: fact.billingAccountId, fact.virtualKeyId
       │
       ▼
DECORATOR 3: UsageCommitDecorator  (usage-commit.decorator.ts)
  1. Validate via Zod (strict for inproc/sandbox, hints for external)
  2. Dispatch:
     ┌──────────────────────────┬──────────────────────────┐
     │ source === "litellm"     │ source !== "litellm"     │
     │ CONSUME event            │ commitUsageFact() → DB   │
     │ Defer to LiteLLM CB ─┐  │ Then CONSUME event       │
     └──────────────────────┼──┴──────────────────────────┘
                            │
       ┌────────────────────┘  (async, seconds later)
       ▼
LITELLM CALLBACK  (billing/ingest/route.ts)
  POST /api/internal/billing/ingest
  StandardLoggingPayload[] → buildUsageFact() → commitUsageFact()
  Cost authority: entry.response_cost
       │
       ▼
commitUsageFact()  (billing.ts)
  ONE_LEDGER_WRITER: sole caller of recordChargeReceipt()
  Idempotency: sourceReference = "${runId}/${attempt}/${usageUnitId}"
       │
       ▼
DATABASE
  charge_receipts  +  llm_charge_details  (1:1 FK)
  UNIQUE(source_system, source_reference) prevents duplicates
       │
       ▼
ACTIVITY FACADE  (activity.server.ts)
  GET /api/v1/activity
  1. listChargeReceipts({ billingAccountId, from, to })
  2. listLlmChargeDetails({ chargeReceiptIds })
  3. Aggregate → time buckets, groupBy, totals
       │
       ▼
DASHBOARD UI  (/app/activity, /app/dashboard)
  Charts: spend, tokens, requests over time
  Table: provider, model, tokensIn, tokensOut, cost
```

## Data Shapes at Each Stage

### Stage 1: UsageFact (emitted by executor)

```ts
// inproc-completion-unit.adapter.ts:294-316
UsageFact {
  runId: string;               // Canonical execution identity
  attempt: number;             // Always 0 (P0_ATTEMPT_FREEZE)
  source: SourceSystem;        // "litellm" | "codex" | "ollama"
  executorType: "inproc";      // Or "sandbox" for sandbox path
  graphId: GraphId;            // e.g., "langgraph:poet"
  usageUnitId: string;         // litellmCallId OR "${runId}/${attempt}/byo"
  inputTokens?: number;        // From adapter response
  outputTokens?: number;       // From adapter response
  model?: string;              // Resolved model name
  costUsd: number;             // providerCostUsd ?? 0
  // NOT YET: billingAccountId, virtualKeyId
}
```

### Stage 2: UsageFact (after enrichment)

```ts
// billing-enrichment.decorator.ts:57-64
UsageFact {
  // ... all fields from Stage 1 ...
  billingAccountId: string;    // ADDED by enrichment decorator
  virtualKeyId: string;        // ADDED by enrichment decorator
}
```

### Stage 3: charge_receipts (database row)

```sql
-- packages/db-schema/src/billing.ts:125-193
charge_receipts (
  id                  UUID PRIMARY KEY,
  billing_account_id  TEXT NOT NULL,
  virtual_key_id      UUID NOT NULL,
  run_id              TEXT NOT NULL,
  attempt             INTEGER NOT NULL,
  ingress_request_id  TEXT,              -- HTTP correlation
  litellm_call_id     TEXT,              -- Forensic correlation
  charged_credits     BIGINT NOT NULL,   -- 0 for BYO
  response_cost_usd   NUMERIC,           -- 0 for BYO
  provenance          TEXT NOT NULL,      -- "stream"
  charge_reason       TEXT NOT NULL,      -- "llm_usage"
  source_system       TEXT NOT NULL,      -- "litellm"|"codex"|"ollama"
  source_reference    TEXT NOT NULL,      -- "${runId}/${attempt}/${usageUnitId}"
  receipt_kind        TEXT NOT NULL,      -- "llm"
  created_at          TIMESTAMP DEFAULT NOW()

  UNIQUE(source_system, source_reference)  -- Idempotency
)
```

### Stage 4: llm_charge_details (1:1 with charge_receipts)

```sql
-- packages/db-schema/src/billing.ts:200-231
llm_charge_details (
  charge_receipt_id   UUID PRIMARY KEY REFERENCES charge_receipts(id),
  provider_call_id    TEXT,              -- x-litellm-call-id or null
  model               TEXT NOT NULL,     -- User-facing model name
  provider            TEXT,              -- "openai"|"anthropic"|null
  tokens_in           INTEGER,           -- Prompt tokens
  tokens_out          INTEGER,           -- Completion tokens
  latency_ms          INTEGER,           -- null (not available in UsageFact)
  graph_id            TEXT NOT NULL      -- e.g., "langgraph:poet"
)
```

### Stage 5: Activity API response

```ts
// contracts/ai.activity.v1.contract.ts
GET /api/v1/activity?range=1w&groupBy=model

{
  effectiveStep: "1h",
  chartSeries: [
    { bucketStart: "2026-03-27T00:00:00Z", spend: "0.005000", tokens: 150, requests: 1 },
    ...
  ],
  groupedSeries: [
    { group: "gpt-4o", buckets: [...] },
    { group: "llama3:8b", buckets: [...] },  // BYO model visible here
  ],
  totals: {
    spend:    { total: "0.050000", avgDay: "0.007143", pastRange: "0" },
    tokens:   { total: 1500, avgDay: 214, pastRange: 0 },
    requests: { total: 10, avgDay: 1, pastRange: 0 },
  },
  rows: [
    {
      id: "uuid", timestamp: "...",
      provider: "openai",        // From llm_charge_details.provider
      model: "gpt-4o",           // From llm_charge_details.model
      graphId: "langgraph:poet",
      tokensIn: 100, tokensOut: 50,
      cost: "0.005000",
      speed: 25.0,
    },
    {
      id: "uuid", timestamp: "...",
      provider: "ollama",         // BYO: falls back to sourceSystem
      model: "llama3:8b",         // BYO: from adapter response
      graphId: "langgraph:poet",
      tokensIn: 200, tokensOut: 80,
      cost: "0.000000",           // BYO: zero platform cost
      speed: 40.0,
    },
  ],
  nextCursor: null,
}
```

## Per-Provider Comparison

| Field               | Platform (LiteLLM)         | Codex (ChatGPT BYO)     | OpenAI-compatible (BYO) | Sandbox (ephemeral)     | Sandbox (gateway)      |
| ------------------- | -------------------------- | ----------------------- | ----------------------- | ----------------------- | ---------------------- |
| `source_system`     | `litellm`                  | `codex`                 | `ollama`                | `litellm`               | `litellm`              |
| `usageUnitId`       | `x-litellm-call-id`        | `${runId}/0/byo`        | `${runId}/0/byo`        | `x-litellm-call-id`     | `x-litellm-call-id`    |
| `charged_credits`   | calculated from cost       | `0`                     | `0`                     | calculated from cost    | calculated from cost   |
| `response_cost_usd` | from LiteLLM callback      | `0`                     | `0`                     | from proxy audit log    | from LiteLLM callback  |
| `tokens_in/out`     | from LiteLLM response      | from Codex SDK          | from `/v1/completions`  | from proxy              | from LiteLLM callback  |
| `model`             | from LiteLLM `model_group` | from adapter            | from adapter            | from proxy              | from LiteLLM callback  |
| **Receipt writer**  | LiteLLM callback route     | UsageCommitDecorator    | UsageCommitDecorator    | UsageCommitDecorator    | LiteLLM callback route |
| **Write timing**    | async (seconds after call) | synchronous (in stream) | synchronous (in stream) | synchronous (in stream) | async (seconds after)  |

## Receipt Writer Paths

There are exactly **two paths** to `commitUsageFact()`:

```
PATH A: Platform + Sandbox-Gateway (async via LiteLLM callback)
  LiteLLM fires generic_api callback
  → POST /api/internal/billing/ingest (Bearer auth)
  → buildUsageFact() from StandardLoggingPayload
  → commitUsageFact()
  → recordChargeReceipt()

PATH B: BYO + Sandbox-Ephemeral (sync via UsageCommitDecorator)
  Inproc/Sandbox emits usage_report event
  → BillingEnrichmentDecorator adds billing identity
  → UsageCommitDecorator validates + calls commitByoUsage()
  → commitUsageFact()
  → recordChargeReceipt()
```

Both paths converge on `commitUsageFact()` which is the **ONE_LEDGER_WRITER**: the sole function that calls `accountService.recordChargeReceipt()`.

## Idempotency

All receipts are protected by a database unique constraint:

```
UNIQUE(source_system, source_reference)
```

Where `source_reference = ${runId}/${attempt}/${usageUnitId}`.

| Provider          | source_system | source_reference example                |
| ----------------- | ------------- | --------------------------------------- |
| Platform          | `litellm`     | `run-abc/0/litellm-call-id-xyz`         |
| Codex (BYO)       | `codex`       | `run-abc/0/run-abc/0/byo`               |
| Ollama (BYO)      | `ollama`      | `run-abc/0/run-abc/0/byo`               |
| Sandbox-ephemeral | `litellm`     | `sandbox-run/0/litellm-call-from-proxy` |
| Sandbox-gateway   | `litellm`     | `gateway-run/0/litellm-call-from-cb`    |

Duplicate callbacks or retries produce the same key and are silently dropped (no-op).

## Invariants

| Rule                              | Enforced by                     | Meaning                                                                                                       |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ONE_LEDGER_WRITER                 | `commitUsageFact()`             | Sole function calling `recordChargeReceipt()`. Two callers of commitUsageFact (callback + decorator) is fine. |
| CALLBACK_WRITES_PLATFORM_RECEIPTS | UsageCommitDecorator            | Platform receipts deferred to LiteLLM callback. BYO receipts committed directly by decorator.                 |
| BILLING_NEVER_THROWS              | `commitUsageFact()`             | Post-call billing catches all errors. Never blocks user response.                                             |
| COST_ORACLE_IS_LITELLM            | Callback route                  | Platform cost from `response_cost`. BYO cost = 0 (or adapter-reported).                                       |
| PROVIDER_AWARE_USAGE              | InProc adapter + ExecutionScope | `source` field reflects actual provider via `scope.usageSource`.                                              |
| DETERMINISTIC_BYO_USAGE_ID        | InProc adapter                  | BYO `usageUnitId` = `${runId}/${attempt}/byo`. Never `crypto.randomUUID()`.                                   |
| PLATFORM_CALLID_STILL_REQUIRED    | InProc adapter                  | Missing `litellmCallId` on platform runs = CRITICAL error, run fails.                                         |
| ADAPTERS_NEVER_BILL               | Architecture boundary           | Adapters emit `usage_report` events. Never call `commitUsageFact()` directly.                                 |
| CHARGE_RECEIPTS_IDEMPOTENT        | DB unique constraint            | `UNIQUE(source_system, source_reference)` prevents duplicate receipts.                                        |

## File Index

| File                                                                     | Role                                     |
| ------------------------------------------------------------------------ | ---------------------------------------- |
| `apps/operator/src/adapters/server/ai/execution-scope.ts`                | AsyncLocalStorage scope (usageSource)    |
| `apps/operator/src/adapters/server/ai/inproc-completion-unit.adapter.ts` | Emits `usage_report` for all providers   |
| `apps/operator/src/adapters/server/ai/billing-enrichment.decorator.ts`   | Adds billing identity to facts           |
| `apps/operator/src/adapters/server/ai/usage-commit.decorator.ts`         | Validates + commits BYO receipts         |
| `apps/operator/src/bootstrap/graph-executor.factory.ts`                  | Decorator stack composition              |
| `apps/operator/src/app/api/internal/billing/ingest/route.ts`             | LiteLLM callback handler                 |
| `apps/operator/src/features/ai/services/billing.ts`                      | `commitUsageFact()` — sole ledger writer |
| `packages/db-schema/src/billing.ts`                                      | charge_receipts + llm_charge_details     |
| `packages/ai-core/src/usage/usage.ts`                                    | UsageFact type + Zod schemas             |
| `packages/ai-core/src/billing/source-system.ts`                          | SourceSystem enum                        |
| `apps/operator/src/app/_facades/ai/activity.server.ts`                   | Activity dashboard query logic           |
| `apps/operator/src/contracts/ai.activity.v1.contract.ts`                 | Activity API response contract           |

## Security Architecture

### Defense-in-Depth Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Transport Auth                                     │
│  NextAuth JWT (browser) │ Bearer token (machine-to-machine) │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Authorization                                      │
│  ExecutionGrant (scoped, expirable, revocable)              │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Billing Gate                                       │
│  PreflightCreditCheck → BillingEnrichment → UsageCommit     │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Data Isolation                                     │
│  PostgreSQL RLS (SET LOCAL per-transaction, fail-deny)      │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: Audit / Metering                                   │
│  Idempotent charge_receipts, credit_ledger, Langfuse traces │
└─────────────────────────────────────────────────────────────┘
```

### Security Posture Scorecard

> Assessed 2026-03-29. Compared against practices at Stripe, AWS, Google Cloud, OpenAI, Cloudflare.

| Dimension                       | Our Implementation                                                                                                   | Top 0.1% Benchmark                                                         | Gap       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- |
| **Transport auth**              | Timing-safe bearer tokens (`timingSafeEqual`, length guards)                                                         | mTLS / short-lived signed JWTs with automatic rotation                     | Medium    |
| **Session management**          | NextAuth JWT + HttpOnly cookies, 30-day maxAge, SIWE verification                                                    | Same                                                                       | **None**  |
| **Tenant isolation**            | PostgreSQL RLS + `SET LOCAL` per-transaction, fail-deny on missing context                                           | Same (this IS the gold standard)                                           | **None**  |
| **Role separation**             | Dual DB roles (`app_user` / `app_service`) + boot-time enforcement + dep-cruiser import boundary                     | Same + HSM key separation                                                  | Small     |
| **Authorization**               | Scoped grants (`graph:execute:{id}`), expirable, revocable, validated twice                                          | Same + formal RBAC/ABAC policies                                           | Small     |
| **Billing attribution**         | Callback-based, `end_user` field, `BILLING_INGEST_TOKEN` shared secret                                               | Per-key attribution, HMAC-signed callbacks                                 | Medium    |
| **Billing safety**              | Preflight balance check only (single gate at start; negative balances possible by design via `BILLING_NEVER_THROWS`) | Spend caps + per-commit circuit breakers + billing alerts                  | **Large** |
| **Rate limiting**               | Per-IP token bucket (10 req/min), per-instance, public routes only                                                   | Multi-dimensional (per-IP, per-account, per-model), shared state via Redis | **Large** |
| **Audit trail**                 | Structured Pino logs, Langfuse traces, analytics events                                                              | Immutable append-only audit table + SIEM integration                       | **Large** |
| **Secret rotation**             | Static bearer tokens, manual rotation, no expiry                                                                     | Automatic rotation, short-lived tokens, JWKS endpoints                     | Medium    |
| **Input validation**            | Zod schemas on all endpoints + size limits + format checks                                                           | Same                                                                       | **None**  |
| **Idempotency**                 | Triple-layer: DB unique constraint + credit ledger partial indexes + application check                               | Same                                                                       | **None**  |
| **Webhook verification**        | Platform-specific HMAC signature verification (GitHub, Alchemy)                                                      | Same + timestamp-based replay protection                                   | Small     |
| **Execution context isolation** | `NO_BILLING_LEAKAGE` / `NO_TRACING_LEAKAGE` invariants, AsyncLocalStorage scoping                                    | Same                                                                       | **None**  |
| **Credential handling**         | `NO_BROWSER_SECRETS`, `HASH_ONLY_STORAGE`, `NO_PLAINTEXT_LITELLM_KEYS`, encrypted BYO via ConnectionBroker           | Same + HSM-backed credential broker sidecar                                | Small     |

### Priority Actions

| Priority | Action                                                                               | Risk Addressed                                                                                              |
| -------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **P0**   | Add `spend_limit_credits` to `billing_accounts` + enforcement in `commitUsageFact()` | Compromised grant with loaded account can drain entire balance — preflight runs once at start, not per-call |
| **P1**   | Per-`billingAccountId` rate limiting via Redis                                       | No throttle between preflight pass and unbounded execution                                                  |
| **P1**   | Immutable `security_audit_log` table (append-only, no UPDATE/DELETE grants)          | Cannot answer "who did what" without grepping ephemeral logs                                                |
| **P1**   | HMAC-sign billing ingest callbacks (per-request nonce in outbound LiteLLM metadata)  | `BILLING_INGEST_TOKEN` compromise = arbitrary billing attribution to any account                            |
| **P2**   | Replace static bearer tokens with short-lived signed JWTs (JWKS endpoint)            | Single point of compromise with no automatic expiry or revocation                                           |
| **P2**   | Webhook timestamp replay protection                                                  | Idempotency key alone doesn't prevent delayed replay attacks                                                |
| **P3**   | Credential broker sidecar for BYO keys (app never sees decrypted key)                | App process holds decrypted user credentials in memory during execution                                     |

### Security File Index

| File                                                                | Role                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts` | Bearer token auth (timing-safe), grant validation      |
| `apps/operator/src/auth.ts`                                         | NextAuth config, SIWE verification, OAuth linking      |
| `apps/operator/src/shared/env/invariants.ts`                        | Boot-time role separation enforcement                  |
| `apps/operator/src/shared/env/server-env.ts`                        | Zod schema for all secrets (min 32 chars)              |
| `packages/db-client/src/tenant-scope.ts`                            | `withTenantScope()` — SET LOCAL per-transaction        |
| `packages/db-client/src/adapters/drizzle-grant.adapter.ts`          | Grant validation (scope, expiry, revocation)           |
| `apps/operator/src/bootstrap/http/wrapRouteHandlerWithLogging.ts`   | Route auth guard (required/optional/none)              |
| `apps/operator/src/bootstrap/http/rateLimiter.ts`                   | Token bucket rate limiter                              |
| `apps/operator/src/app/api/internal/billing/ingest/route.ts`        | Billing callback auth + suspicious-zero-cost detection |
| `docs/spec/database-rls.md`                                         | RLS policy design + dual-role architecture             |
