---
id: task.0192
type: task
title: "v1: Per-tenant BYO-AI — ConnectionBrokerPort + BYO completion backend"
status: needs_implement
priority: 2
rank: 15
estimate: 5
summary: "Profile page 'Connect ChatGPT' OAuth stores credentials in connections table. ConnectionBrokerPort resolves credentials. BYOExecutorDecorator intercepts graph execution when modelConnectionId is present, routing LLM completions through user's ChatGPT subscription instead of LiteLLM."
outcome: "Any Cogni graph can run on the user's ChatGPT subscription instead of platform LiteLLM/OpenRouter. Graph identity orthogonal to LLM backend. ConnectionBrokerPort is the unified credential resolution path for BYO provider auth and future tool auth."
spec_refs: [spec.tenant-connections]
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: feat/byo-ai-per-tenant
pr:
reviewer:
created: 2026-03-23
updated: 2026-03-24
labels: [ai, oauth, byo-ai, codex, multi-tenant]
external_refs:
  - docs/research/openai-oauth-byo-ai.md
revision: 5
blocked_by: [task.0191]
deploy_verified: false
---

## Design

### Outcome

Any Cogni graph can run on either the platform LLM backend (LiteLLM/OpenRouter) or the user's own ChatGPT subscription. The user links their ChatGPT account on the profile page; when they chat, LLM completions route through their subscription at $0 platform cost.

### Important Distinction: LLM Provider vs External Agent Runtime

**"Codex" means two different things:**

| Concept                            | What it is                                                                                   | BYO-AI scope?         |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | --------------------- |
| **Codex as LLM OAuth provider**    | ChatGPT subscription tokens powering LLM completions (GPT-5.x models via Responses API)      | Yes — this task       |
| **Codex as external coding agent** | Full Codex agent runtime (sandbox, CLI, file changes, approvals, MCP) spawned as a container | No — separate problem |

BYO-AI is about the first one: using ChatGPT subscription tokens as an alternative LLM completion backend for Cogni's own graphs. The graph logic (nodes, tools, state) still runs in our LangGraph runtime — only the LLM calls route differently.

Spawning external Codex agent containers is a separate capability (like `sandbox:` graphs with OpenClaw). Not in scope here.

### Solution: Typed Connection References + BYO Decorator

```
User selects graph "poet"
  |
  +-- modelConnectionId in request? ──YES──> BYOExecutorDecorator
  |                                           |
  |                                           v
  |                                    broker.resolve(modelConnectionId)
  |                                           |
  |                                           v
  |                                    ChatGPT completion backend
  |                                    (Codex Responses API, user's sub)
  |                                    $0 platform cost
  |
  +-- no modelConnectionId ──────────> Standard executor
                                        |
                                        v
                                       LiteLLM -> OpenRouter
                                       Platform credits consumed
```

### Typed Connection References (not plural connectionIds)

Per external review: `connectionIds: string[]` is under-specified. A run may need a **model connection** (which LLM backend) AND **tool connections** (GitHub token for code search). These are different types with different resolution semantics.

```ts
interface GraphRunRequest {
  // ...existing fields...
  readonly modelConnectionId?: string; // BYO LLM backend
  readonly toolConnectionIds?: readonly string[]; // tool credentials (future, for grant intersection)
}
```

- `BYOExecutorDecorator` reads `modelConnectionId` for backend selection
- `toolRunner` reads `toolConnectionIds` for grant intersection (future)
- No ambiguity between "which LLM" and "which tool credentials"

### Credit Check: No Bypass Needed

The decorator stack order eliminates the need for special BYO bypass logic:

```
ObservabilityDecorator
  -> BillingDecorator
    -> PreflightCreditCheckDecorator
      -> BYOExecutorDecorator              <-- if BYO, handles here
        -> inner executor (LangGraph)      <-- only reached for platform runs
```

If the BYOExecutorDecorator handles the run, it never reaches the inner platform executor. No platform `usage_report` events are emitted, so no credits are consumed. The credit check still validates the user has an account (good), but billing only charges when the inner executor actually runs. No bypass flag, no prefix check — just stack ordering.

### Execution Backend: `codex exec` Subprocess (Proven)

v0 proved `codex exec` subprocess works end-to-end. The app-server `chatgptAuthTokens` mode is unvalidated, marked `[UNSTABLE]`, and adds sidecar lifecycle complexity. Skip it for v1.

**Per-request `codex exec` subprocess**: The `BYOExecutorDecorator` resolves credentials via broker, writes a temp `auth.json` in a temp dir (adapter-internal detail behind the broker port), sets `CODEX_HOME` env var, spawns `codex exec`, streams events, cleans up. Naturally isolated per-request — no shared state, no multiplexing concerns.

**~2s cold start** per execution. Acceptable for v1. If it becomes a bottleneck, the adapter can be swapped to app-server or a pool — same broker, same decorator, same port. Adapter-internal change only.

### Approach

**Solution**: (1) `connections` table + AEAD cipher (spec.tenant-connections). (2) `ConnectionBrokerPort` with typed `ResolvedConnection`. (3) `BYOExecutorDecorator` intercepts when `modelConnectionId` present, routes through `codex exec` subprocess with user's credentials. (4) Remove `codex:` namespace. (5) Profile page OAuth linking.

**Reuses**:

- `connections` table from spec.tenant-connections
- Profile page `SettingRow` + `ConnectedBadge` (same UX as GitHub/Discord/Google)
- `@mariozechner/pi-ai/oauth` — `refreshOpenAICodexToken()`
- Existing decorator pattern (billing, observability, credit check)
- v0-proven `codex exec` subprocess path (`@openai/codex-sdk`)

**Rejected**:

- **Codex-specific graphs (`codex:poet`)**: Graph identity orthogonal to LLM backend. Killed.
- **Untyped `connectionIds: string[]`**: Ambiguous. Use `modelConnectionId` + `toolConnectionIds` (typed, separate concerns).
- **Credit bypass flag/prefix**: Stack ordering handles it. No special logic.
- **App-server sidecar (`chatgptAuthTokens`)**: Unvalidated, marked `[UNSTABLE]`, adds sidecar lifecycle. `codex exec` subprocess is proven and naturally isolated. App-server is a future performance optimization, not v1.
- **Adapter-inlined credential resolution**: Broker's job, not the executor adapter's.

### ConnectionBrokerPort

```ts
// src/ports/connection-broker.port.ts
interface ConnectionBrokerPort {
  resolve(
    connectionId: string,
    billingAccountId: string
  ): Promise<ResolvedConnection>;
}

interface ResolvedConnection {
  readonly connectionId: string;
  readonly provider: string; // "openai-chatgpt", future: "anthropic", "google"
  readonly credentialType: string; // "oauth2", "api_key", "app_password"
  readonly credentials: {
    readonly accessToken: string;
    readonly refreshToken?: string;
    readonly accountId?: string;
  };
  readonly expiresAt: Date | null;
  readonly scopes: readonly string[];
}
```

Used by:

- `BYOExecutorDecorator` (this task) — model backend selection
- `toolRunner.exec()` (future) — tool auth with grant intersection
- Multi-provider BYO (future) — same port, different providers

Adapter (`DrizzleConnectionBrokerAdapter`): SELECT -> tenant verify -> AEAD decrypt -> expiry check -> refresh if needed -> return. Provider-specific refresh logic (openai-chatgpt uses `refreshOpenAICodexToken`, future providers use their own refresh).

### Pre-Implementation Gate

1. **Redirect URI**: Test public OAuth client ID with `redirect_uri=https://<our-domain>/api/v1/auth/openai-codex/callback`. If rejected, switch to Device Code flow. 30-minute spike — write a script, test, report.

### Cleanup: Remove codex: Namespace

- Remove `codex:poet` and `codex:spark` from graph catalog/picker
- Remove `codex` namespace from `NamespaceGraphRouter`
- Remove model validation skip for `codex:` in chat route
- Remove `codex:` prefix check from `PreflightCreditCheckDecorator` (stack ordering replaces it)

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] GRAPH_BACKEND_ORTHOGONAL: No codex-specific graphs. Any Cogni graph runs on any LLM backend. Backend = connection, not graph name.
- [ ] LLM_PROVIDER_NOT_AGENT_RUNTIME: BYO-AI = ChatGPT subscription powering LLM completions. NOT spawning external Codex agent containers (that's a separate capability).
- [ ] TYPED_CONNECTION_REFS: `modelConnectionId` for LLM backend, `toolConnectionIds` for tool auth. Not an untyped `connectionIds[]`.
- [ ] BROKER_RESOLVES_ALL: ConnectionBrokerPort is the single credential resolution path. Adapters never do direct DB reads + decrypt.
- [ ] CONNECTIONS_TABLE: Use `connections` table from spec.tenant-connections. (spec: spec.tenant-connections)
- [ ] ENCRYPTED_AT_REST: AEAD encrypted JSON blob with AAD binding. (spec: spec.tenant-connections, invariant 4)
- [ ] NO_CREDIT_BYPASS: Stack ordering handles BYO billing — no bypass flag or prefix check needed.
- [ ] SUBPROCESS_PER_REQUEST: v1 uses `codex exec` subprocess (proven). Naturally isolated. App-server is a future optimization.
- [ ] TOKENS_NEVER_LOGGED: Token values never in logs, error messages, or API responses.
- [ ] TENANT_SCOPED: Connection rows belong to `billing_account_id`. (spec: spec.tenant-connections, invariant 3)
- [ ] CONTRACT_FIRST: New API endpoints have Zod contracts. (spec: architecture)
- [ ] DECORATOR_PATTERN: BYO backend selection is a decorator, not namespace routing.

### Files

#### connections table + AEAD cipher

- Create: `packages/db-schema/src/connections.ts` — `connections` table per spec.tenant-connections schema. RLS enabled.
- Modify: `packages/db-schema/src/index.ts` — export `connections`
- Create: `scripts/migrations/XXXX_add_connections.sql` — DDL + RLS policies
- Create: `apps/web/src/shared/crypto/aead.ts` — AEAD encrypt/decrypt (AES-256-GCM, nonce prepended, AAD binding)

#### ConnectionBrokerPort + Adapter

- Create: `apps/web/src/ports/connection-broker.port.ts` — `ConnectionBrokerPort`, `ResolvedConnection`
- Modify: `apps/web/src/ports/index.ts` — export
- Create: `apps/web/src/adapters/server/connections/drizzle-broker.adapter.ts` — SELECT, tenant verify, AEAD decrypt, expiry check, provider-specific refresh, persist
- Modify: `apps/web/src/adapters/server/index.ts` — export

#### BYOExecutorDecorator

- Create: `apps/web/src/adapters/server/ai/byo-executor.decorator.ts` — If `req.modelConnectionId` present: resolve via broker, route to ChatGPT completion backend. Otherwise: delegate to inner executor.
- Modify: `apps/web/src/bootstrap/graph-executor.factory.ts` — Insert in decorator stack (inside credit check). Wire broker from container.

#### ChatGPT Completion Backend (adapter-internal)

- Modify: `apps/web/src/adapters/server/ai/codex/codex-graph.provider.ts` — Refactor to `ChatGPTCompletionBackend`. Accepts resolved credentials. Writes temp `auth.json` in temp dir, sets `CODEX_HOME`, spawns `codex exec` via SDK, streams events as AiEvents, cleans up temp dir in `finally`. No DB reads, no decrypt — broker handles that.

#### Remove codex: namespace

- Modify: `apps/web/src/bootstrap/graph-executor.factory.ts` — Remove `codex` from namespace router
- Modify: `apps/web/src/features/ai/components/ChatComposerExtras.tsx` — Remove `codex:poet`, `codex:spark` from picker
- Modify: `apps/web/src/adapters/server/ai/preflight-credit-check.decorator.ts` — Remove `codex:` prefix check entirely
- Modify: `apps/web/src/app/api/v1/ai/chat/route.ts` — Remove model validation skip for `codex:`

#### GraphRunRequest extension

- Modify: `packages/graph-execution-core/src/graph-executor.port.ts` — Add `modelConnectionId?: string` and `toolConnectionIds?: readonly string[]`

#### Chat Route -> Temporal pipeline

- Modify: `apps/web/src/contracts/ai-chat.v1.contract.ts` — Add optional `modelConnectionId?: string`
- Modify: `apps/web/src/features/ai/services/completion.server.ts` — Pass modelConnectionId to Temporal
- Modify: `services/scheduler-worker/src/workflows/graph-run.workflow.ts` — Add to workflow input, map to GraphRunRequest

#### OAuth Routes

- Create: `apps/web/src/app/api/v1/auth/openai-codex/authorize/route.ts` — PKCE flow initiation
- Create: `apps/web/src/app/api/v1/auth/openai-codex/callback/route.ts` — Token exchange, AEAD encrypt, INSERT connection
- Create: `apps/web/src/app/api/v1/auth/openai-codex/disconnect/route.ts` — Soft-delete

#### Profile Page

- Modify: `apps/web/src/app/(app)/profile/view.tsx` — "AI Providers" section with ChatGPT SettingRow
- Create: `apps/web/src/components/kit/data-display/OpenAIIcon.tsx` — OpenAI logomark SVG
- Modify: `apps/web/src/components/index.ts` — export

#### API: Connection Status

- Create: `apps/web/src/contracts/ai-providers.v1.contract.ts` — Zod schemas
- Create: `apps/web/src/app/api/v1/users/me/ai-providers/route.ts` — GET (connectionId, provider, expiresAt — no tokens)

#### Tests

- Test: `tests/unit/shared/aead.test.ts` — encrypt/decrypt roundtrip, wrong key/AAD, tampered ciphertext
- Test: `tests/unit/adapters/drizzle-broker.test.ts` — resolve, tenant mismatch, revoked, refresh
- Test: `tests/unit/adapters/byo-executor-decorator.test.ts` — routes to BYO when modelConnectionId present, passthrough when absent
- Test: `tests/contract/connections.test.ts` — DB schema contract
- Test: `tests/stack/byo-ai-profile-link.stack.test.ts` — full flow

## Validation

- [ ] Any Cogni graph executes on user's ChatGPT subscription when modelConnectionId present
- [ ] Same graph executes on platform LiteLLM/OpenRouter when no modelConnectionId
- [ ] No `codex:` prefixed graphs in catalog or UI
- [ ] ConnectionBrokerPort resolves credentials — adapters never decrypt directly
- [ ] Credentials stored as AEAD encrypted blob with AAD binding
- [ ] Token refresh works: pre-execution expiry check via broker
- [ ] Multiple concurrent users work (subprocess per request, naturally isolated)
- [ ] No special credit bypass — stack ordering handles billing naturally
- [ ] No tokens in logs or API responses
- [ ] Disconnecting soft-deletes connection
