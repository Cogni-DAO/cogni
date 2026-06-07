---
id: rbac-spec
type: spec
title: Authorization (RBAC/ReBAC) Design
status: active
trust: draft
summary: OpenFGA-based authorization with actor/subject model and layered permission checks
read_when: Implementing authorization checks, tool permissions, or on-behalf-of delegation
owner: derekg1729
created: 2026-02-05
verified: 2026-06-07
tags: [authorization]
---

# Authorization (RBAC/ReBAC) Design

> [!CRITICAL]
> Every protected action requires `AuthorizationPort.check(actor, subject?, action, resource, context)`. When `subject` is present (agent acting on behalf of user), BOTH the subject's permission AND the actor's delegation must be verified. OpenFGA is the sole source of truth.

## Core Invariants

1. **CONTEXT_HAS_ACTOR_SUBJECT_TENANT_GRAPH**: Every `ToolInvocationContext` and `GraphRunContext` must include `{ actorId, tenantId, graphId }` and optionally `{ subjectId }` for on-behalf-of runs. No secrets in context — only opaque references.

2. **AUTHZ_CHECK_BEFORE_TOOL_EXEC**: `toolRunner.exec()` must call `AuthorizationPort.check(actor, subject?, 'tool.execute', tool:{toolId}, ctx)` BEFORE tool execution. When subject is present, enforces dual check.

3. **AUTHZ_CHECK_BEFORE_TOKEN_MINT**: `ConnectionBroker.resolveForTool()` must call `AuthorizationPort.check(actor, subject?, 'connection.use', connection:{connectionId}, ctx)` BEFORE token materialization. Credential faucet gate.

4. **DENY_BY_DEFAULT_AUTHZ**: If no explicit relation exists in OpenFGA, the check returns DENY. No fallback to "allow if not denied" patterns.

5. **OBO_SUBJECT_MUST_BE_BOUND**: `subjectId` cannot be supplied by agents, tools, or request parameters. It is set ONLY from server-issued grants, sessions, or execution contexts. Prevents impersonation-by-parameter attacks.

6. **AUTHZ_FAIL_CLOSED_WITH_DISTINCTION**: `AuthorizationPort.check()` returns `deny` on infrastructure failure (timeout, network error, OpenFGA error). Use distinct error codes: `authz_denied` (OpenFGA returned DENY) vs `authz_unavailable` (infrastructure failure). Never return `allow` on failure. Metrics and durable audit events consume these codes in the P1 audit layer.

---

## Layered Authorization Model

Authorization operates across three distinct layers with different purposes:

| Layer                  | Location         | Purpose                                           | Error Code      |
| ---------------------- | ---------------- | ------------------------------------------------- | --------------- |
| **ToolPolicy**         | In-memory config | Capability gating (which tools exist in this env) | `policy_denied` |
| **Grant Intersection** | In-memory set op | Connection scope narrowing (defense-in-depth)     | `policy_denied` |
| **OpenFGA**            | External service | Permission + delegation verification              | `authz_denied`  |

**OpenFGA is the sole source of truth for permission and delegation relationships.** ToolPolicy and Grant Intersection are capability/safety gates that execute before OpenFGA (fail-fast on capability denial). They are NOT authorization in the identity/access sense—they answer "does this capability exist?" not "is this actor permitted?"

## Implementation Coverage

| Surface                                  | Status              | Enforcement                                                                                                       |
| ---------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Shared authorization contract            | Active in task.5010 | `packages/authorization-core` exports `AuthorizationPort`, check params/decisions, helpers, OpenFGA adapter, fake |
| Tool execution                           | Active in task.5010 | `createToolRunner()` calls `AuthorizationPort.check()` after ToolPolicy and before arg validation/execution       |
| Operator in-process graph/chat execution | Active in task.5010 | Operator DI injects `AuthorizationPort`; inproc provider passes `actorId`, `tenantId`, `graphId` to tool runner   |
| API-originated internal graph runs       | Identity-ready      | Route requires `actorUserId`, `billingAccountId`, `virtualKeyId`; tool authz receives `user:{actorUserId}`        |
| Direct `POST /api/v1/vcs/flight` route   | Session/bearer-auth | Route requires `SessionUser` and CI green; it does not call OpenFGA in task.5010                                  |
| `core__vcs_flight_candidate` graph tool  | Tool-authz-covered  | PR-manager graph invokes it through `toolRunner.exec()`, so OpenFGA can deny `tool.execute` for that tool         |
| Connection broker token materialization  | Pending hardening   | Broker receives `{ actorId, tenantId }`; `connection.use` OpenFGA check is not wired in task.5010                 |
| Graph invocation entry                   | Pending hardening   | `graph.invoke` check at `GraphExecutorPort.runGraph()` is not wired in task.5010                                  |
| Authz audit metrics/events               | Pending hardening   | Current adapter returns decision details; durable `authz.check` event/metric emission is P1                       |

---

## Actor Types

| Type    | Format                  | Description                          |
| ------- | ----------------------- | ------------------------------------ |
| User    | `user:{user_id}`        | Human or user-bound machine token    |
| Agent   | `agent:{agentId}`       | Autonomous agent (graph instance)    |
| Service | `service:{serviceName}` | Internal service (scheduler, worker) |

`user_id` is the canonical person identifier. Wallet addresses, OAuth provider
IDs, and bearer token strings are credentials or bindings, never RBAC actors.

**Actor** = who is making the request.
**Subject** = on whose behalf (always a user; only present for delegated execution).

---

## Dual-Check Enforcement

When `subject` is present (agent acting on behalf of user):

```
┌─────────────────────────────────────────────────────────────────────┐
│ DELEGATED EXECUTION CHECK                                           │
│ ─────────────────────────                                           │
│ 1. OpenFGA: ALLOW(subject, action, resource)?                       │
│    └─ Does the USER have permission for this action?                │
│                                                                     │
│ 2. OpenFGA: ALLOW(actor, 'user.act_as', user:{subject})?            │
│    └─ Is the AGENT authorized to act on behalf of this user?        │
│                                                                     │
│ 3. BOTH must return ALLOW. Either DENY → reject.                    │
└─────────────────────────────────────────────────────────────────────┘
```

When `subject` is absent (direct user or service action):

```
┌─────────────────────────────────────────────────────────────────────┐
│ DIRECT EXECUTION CHECK                                              │
│ ─────────────────────────                                           │
│ 1. OpenFGA: ALLOW(actor, action, resource)?                         │
│    └─ Does the actor have permission for this action?               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Schema: OpenFGA Authorization Model

```dsl
type user
  relations
    define delegates: [agent]

type agent

type service

type tenant
  relations
    define admin: [user, service]
    define member: [user] or admin

type graph
  relations
    define owner: [user]
    define tenant: [tenant]
    define can_invoke: [user, agent, service] or owner or member from tenant

type tool
  relations
    define graph: [graph]           # Parent link: which graph owns this tool
    define can_execute: [user, agent, service] or can_invoke from graph

type connection
  relations
    define owner: [user]
    define tenant: [tenant]         # Parent link: which tenant owns this connection
    define can_use: [user, agent, service] or owner or member from tenant
```

**Parent Relations:** `tool.graph` and `connection.tenant` are required for computed permissions (`can_invoke from graph`, `member from tenant`).

### Known Limitation: Global Delegation (P0)

The current `user.delegates` relation is global—not scoped to tenant or graph. An agent with delegation can act on behalf of the user across all resources the user can access.

**P0 Mitigations:**

1. Only first-party agents (graphs defined in this repository) may receive delegation
2. MCP-discovered agents MUST NOT receive delegation (per MCP_UNTRUSTED_BY_DEFAULT)
3. Delegation issuance requires explicit user action in UI

**P1 Scope:** Implement scoped delegation via `delegation` type with `{tenant, graph}` binding.

---

## Action→Relation Mapping

| Action           | Resource Type     | OpenFGA Check                             | Error Code     |
| ---------------- | ----------------- | ----------------------------------------- | -------------- |
| `tool.execute`   | `tool:{id}`       | `check(actor, can_execute, tool:{id})`    | `authz_denied` |
| `connection.use` | `connection:{id}` | `check(actor, can_use, connection:{id})`  | `authz_denied` |
| `graph.invoke`   | `graph:{id}`      | `check(actor, can_invoke, graph:{id})`    | `authz_denied` |
| `user.act_as`    | `user:{user_id}`  | `check(actor, delegates, user:{user_id})` | `authz_denied` |

**Delegation relation:** `user.delegates` grants agents the right to act on behalf of user. Dual-check queries `user.act_as` when `subject` is present.

---

## Trusted Boundaries for subjectId

`subjectId` may ONLY be set at these code locations:

| Boundary             | Location                                         | How subjectId is bound                 |
| -------------------- | ------------------------------------------------ | -------------------------------------- |
| Session middleware   | `src/proxy.ts`                                   | Extracted from session JWT claims      |
| Agent grant issuance | `src/features/agents/services/grant.ts` (future) | Bound when grant is created            |
| Scheduler job        | `src/adapters/server/scheduler/`                 | Hardcoded to job owner at job creation |

**Never from:** Request body, query params, tool args, `RunnableConfig.configurable`.

---

## Resource ID Format

- `tenant:{id}` — billing account / tenant
- `graph:{id}` — graph definition
- `tool:{id}` — tool ID (namespaced: `core__get_current_time`)
- `connection:{id}` — connection UUID

---

## Design Decisions

### 1. Actor vs Subject

| Scenario                | Actor               | Subject          | Checks                                                                          |
| ----------------------- | ------------------- | ---------------- | ------------------------------------------------------------------------------- |
| User executes directly  | `user:{user_id}`    | —                | `ALLOW(user, action, resource)`                                                 |
| Agent on behalf of user | `agent:chat-v1`     | `user:{user_id}` | `ALLOW(user, action, resource)` AND `ALLOW(agent, user.act_as, user:{user_id})` |
| Service (scheduler)     | `service:scheduler` | —                | `ALLOW(service, action, resource)`                                              |

**Why dual-check for OBO?** The user must have the permission, AND the agent must be delegated. This prevents:

- Agents with broad delegation accessing resources the user can't access
- Users delegating to agents they don't control

### 2. Why Subject from Server Only

If `subjectId` came from request parameters, an agent could claim to act on behalf of any user. By binding `subjectId` only at session/grant issuance:

- Server cryptographically attests to the delegation
- Agents cannot escalate by changing parameters
- Audit trail is trustworthy

### 3. Authorization Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ REQUEST INGRESS                                                     │
│ ─────────────────                                                   │
│ 1. Extract JWT from session/bearer                                  │
│ 2. Determine actor type:                                            │
│    - Session JWT → user:{user_id}                                    │
│    - Machine bearer token → user:{user_id}                           │
│    - Agent token → agent:{agentId} + subject from grant             │
│    - Service key → service:{serviceName}                            │
│ 3. Attach { actorId, subjectId?, tenantId } to request context      │
│ 4. Forward to graph executor / tool runner                          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ TOOL EXECUTION (blocking)                                           │
│ ─────────────────────────                                           │
│ 1. toolRunner.exec() receives ctx with actorId + subjectId?         │
│ 2. AuthorizationPort.check(actor, subject?, "tool.execute", tool)   │
│    └─ If subject: dual-check (permission + delegation)              │
│ 3. if DENY → { ok: false, errorCode: "authz_denied" }               │
│ 4. if ALLOW → proceed to execution                                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (if tool requires connection)
┌─────────────────────────────────────────────────────────────────────┐
│ CONNECTION RESOLUTION (blocking)                                    │
│ ───────────────────────────                                         │
│ 1. Broker receives connectionId from ctx                            │
│ 2. AuthorizationPort.check(actor, subject?, "connection.use", conn) │
│    └─ If subject: dual-check (permission + delegation)              │
│ 3. if DENY → { ok: false, errorCode: "authz_denied" }               │
│ 4. if ALLOW → decrypt + return token via AuthCapability             │
└─────────────────────────────────────────────────────────────────────┘
```

### 4. Enforcement Order + Error Codes

Checks are ordered cheapest-first to fail fast:

```
toolRunner.exec(toolId, rawArgs, ctx)
    │
    ├─ 1. ToolPolicy.decide(toolId, effect)        ← In-memory allowlist (cheap)
    │      └─ deny → { errorCode: 'policy_denied' }
    │
    ├─ 2. AuthorizationPort.check(actor, subject?, action, resource)  ← OpenFGA (network)
    │      ├─ deny → { errorCode: 'authz_denied' }
    │      └─ unavailable/missing identity → { errorCode: 'authz_unavailable' }
    │
    ├─ 3. Grant intersection (if connection required)  ← In-memory set intersection
    │      └─ connectionId ∉ effective → { errorCode: 'policy_denied' }
    │
    ├─ 4. ConnectionBroker.resolveForTool()        ← Only after authz passes
    │      └─ (token materialization happens here)
    │
    └─ 5. Tool execution proceeds
```

| Error Code          | Meaning                                                       | Source            |
| ------------------- | ------------------------------------------------------------- | ----------------- |
| `policy_denied`     | Tool not in allowlist OR connection not in grant intersection | ToolPolicy, Grant |
| `authz_denied`      | OpenFGA check returned DENY (permission or delegation)        | AuthorizationPort |
| `authz_unavailable` | OpenFGA timeout/network error (infrastructure failure)        | AuthorizationPort |
| `unavailable`       | Tool not found in catalog                                     | ToolSourcePort    |

**Key:** `policy_denied` is local/cheap checks; `authz_denied` is centralized OpenFGA.

Authz failures occur before validated arguments and before `tool_call_start`.
`toolRunner.exec()` emits a `tool_call_result` error with the stable
`toolCallId` and does not execute the tool. Operator chat UI streams ignore
result-only tool events for display, so denied tools do not produce broken tool
cards; the graph still receives the fail-closed tool result.

### 5. Candidate Flight Use Case

There are two flight paths:

1. **Direct route:** `POST /api/v1/vcs/flight`
   - Authenticates with browser session or HMAC machine bearer token.
   - Resolves `SessionUser.id`, checks CI is green for the target PR head, then dispatches `candidate-flight.yml`.
   - Does not call `AuthorizationPort.check()` in task.5010.

2. **PR-manager graph tool:** `core__vcs_flight_candidate`
   - Exposed to the operator-only `pr-manager` LangGraph catalog entry.
   - Runs through `createToolRunner()`.
   - When OpenFGA is configured, checks:

```typescript
AuthorizationPort.check({
  actorId: "user:{user_id}",
  action: "tool.execute",
  resource: "tool:core__vcs_flight_candidate",
  context: { tenantId, graphId: "langgraph:pr-manager", runId, toolCallId },
});
```

The end-to-end validation for task.5010 is therefore: an authenticated operator
chat/API graph run selects `langgraph:pr-manager`, requests an explicit
candidate-a flight, and observes either an allowed dispatch of
`core__vcs_flight_candidate` or a fail-closed `authz_denied` /
`authz_unavailable` before any GitHub workflow dispatch. Direct route-level
OpenFGA for `/api/v1/vcs/flight` is a follow-up protected-action gate.

Candidate-a deployment proof uses the existing app flight lever: PR Build
produces per-target digests, `candidate-flight.yml` writes the candidate overlay
deploy branch, Argo reconciles the operator pod, and validation checks
`/version.buildSha` on `https://test.cognidao.org` against the PR head SHA. A
`/readyz` 200 alone is not deployment proof.

### 6. Audit Events (P1)

The target durable audit event shape is:

```typescript
{
  type: "authz.check",
  actor: string,
  subject?: string,        // Present for OBO
  action: AuthzAction,
  resource: string,
  decision: "allow" | "deny",
  delegationChecked: boolean,  // True if dual-check performed
  durationMs: number,
  cached: boolean,
  tenantId: string,
  runId?: string,
}
```

**Why log both actor and subject?** Explicit audit trail. When reviewing logs:

- "Who actually did it?" → actor
- "On whose authority?" → subject

The task.5010 adapter returns decision/check details to the caller but does not
emit this durable event itself.

### 7. Caching Strategy (P1)

**Cache key:** `${actor}:${subject ?? 'direct'}:${action}:${resource}`

Subject included in cache key because delegation status can change independently of resource permissions.

**TTL:** 5 seconds.

---

## Anti-Patterns

| Pattern                                | Problem                                            |
| -------------------------------------- | -------------------------------------------------- |
| Subject from request body              | Impersonation-by-parameter                         |
| Single check for OBO                   | Missing delegation verification                    |
| Actor-only audit logging               | Can't trace delegation chain                       |
| Caching without subject in key         | Stale delegation decisions                         |
| Bespoke role tables per service        | Fragmented policy                                  |
| Checking authz after broker.resolve    | Token already materialized                         |
| Allowing by default if check fails     | Fails open; must fail closed                       |
| Treating authz timeout as authz_denied | Masks infrastructure issues; use authz_unavailable |

---

## Related

- [RBAC Hardening Project](../../work/projects/proj.rbac-hardening.md) — Roadmap, implementation checklists, P1/P2 plans
- [Tool Use Spec](tool-use.md) — Tool execution pipeline, DENY_BY_DEFAULT
- [Tenant Connections Spec](tenant-connections.md) — Connection auth, GRANT_INTERSECTION
- [Graph Execution](graph-execution.md) — Graph executor, billing idempotency
- [Security Auth Spec](security-auth.md) — Authentication (SIWE, API keys)
