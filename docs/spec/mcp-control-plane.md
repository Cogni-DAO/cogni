---
id: spec.mcp-control-plane
type: spec
title: MCP Control Plane Architecture
status: draft
spec_state: draft
trust: draft
summary: Control plane for MCP server lifecycle, deployment registry, agent bindings, and Temporal preflight — the target architecture beyond the MVP shared-cache approach.
read_when: Adding MCP servers, changing MCP connection handling, implementing multi-tenant tool access, or integrating ToolHive.
implements: []
owner: cogni-dev
created: 2026-03-29
verified: null
tags:
  - ai-graphs
  - tooling
  - mcp
  - infrastructure
---

# MCP Control Plane Architecture

## Context

MCP (Model Context Protocol) servers provide external tool capabilities to agents — browser automation, observability queries, code search, etc. The MVP (`feat/mcp-client-mvp`) uses a config file + shared connection cache with reconnect-on-error. This spec defines the target architecture for production MCP management.

The MVP approach (config file, shared cache, static `mcpServerIds` in catalog) is intentionally minimal. It works for single-tenant dev but does not support:

- Dynamic MCP server provisioning (add/remove without restart)
- Per-tenant MCP server isolation
- Agent-level tool binding (which agent gets which tools)
- Tool manifest snapshots for run reproducibility
- Credential rotation without connection drops

## Goal

Define a control plane where MCP servers are managed resources with stable identities, agents bind to them via slugs (not raw URLs), and Temporal Activities handle connection lifecycle at run start.

## Non-Goals

- Custom MCP gateway implementation (use ToolHive vMCP)
- MCP auth server implementation (use external IdP via PRM)
- Per-tool granular RBAC within MCP servers (Phase 3+)
- MCP server auto-scaling (defer to ToolHive operator)

## Design

### Deployment Registry

MCP servers are registered as **deployments** with stable slug identifiers. Agents reference slugs, never raw URLs.

```
mcp_deployments
├── slug (PK)          — e.g., "playwright-dev", "grafana-prod"
├── display_name       — human label
├── endpoint           — resolved URL (e.g., "http://playwright-mcp:3003/mcp")
├── transport          — "streamable-http" | "sse" | "stdio"
├── auth_ref           — reference to credentials (k8s secret name, connection ID, or null)
├── status             — "healthy" | "unhealthy" | "provisioning" | "decommissioned"
├── capabilities_hash  — SHA256 of last tools/list response (detect drift)
├── config             — JSONB: server-specific config (timeout, retry policy, tool filters)
├── created_at
├── updated_at
└── billing_account_id — NULL for shared, set for tenant-scoped
```

**Shared deployments** (Grafana, filesystem tools): `billing_account_id = NULL`, service account credentials via `auth_ref`.

**Per-tenant deployments** (GitHub with user creds): `billing_account_id` set, user OAuth credentials via `auth_ref → connections.id`.

### Agent Bindings

Agents declare which MCP deployments they can use. This replaces the static `mcpServerIds` field in the LangGraph catalog.

```
agent_mcp_bindings
├── agent_id           — graph ID or future agent entity ID
├── deployment_slug    — FK → mcp_deployments.slug
├── allowed_tools      — text[] or NULL (NULL = all tools from server)
├── required           — boolean (true = fail run if server unavailable)
├── created_at
└── UNIQUE(agent_id, deployment_slug)
```

`required: false` means the agent works without this server (graceful degradation). `required: true` means the run should fail-fast if the server is unreachable.

### Run-Start Preflight (Temporal Activity)

At run start, a Temporal Activity resolves bindings and initializes MCP sessions:

```
initializeMcpBindingsActivity(input: {
  runId: string
  agentId: string
  billingAccountId: string
}) → {
  resolvedTools: ToolManifestSnapshot  // frozen tool specs for this run
  sessionIds: Record<slug, string>     // MCP session IDs (for Streamable HTTP)
}
```

**Steps:**

1. Query `agent_mcp_bindings` for `agentId`
2. For each binding, resolve `mcp_deployments` endpoint + credentials
3. Initialize MCP session (POST to `/mcp` with `initialize` message)
4. Call `tools/list` to discover available tools
5. Filter by `allowed_tools` if specified
6. Snapshot the resolved tool manifest onto the run (reproducibility)
7. If `required: true` and server unreachable → fail the Activity (Temporal retries)

**The tool manifest snapshot is immutable for the run.** Tools don't change mid-conversation. If the MCP server adds tools (via `notifications/tools/list_changed`), the next run picks them up — not the current one.

**For interactive chat runs** (not via Temporal): the same resolution logic runs synchronously in the InProc provider's `runGraph()` path. The Activity is only for scheduled/webhook-triggered runs.

### Credential Resolution

MCP server credentials follow the existing `ConnectionBrokerPort` pattern:

| Credential Type  | auth_ref Format           | Resolution                                      |
| ---------------- | ------------------------- | ----------------------------------------------- |
| None (local dev) | `null`                    | No auth headers                                 |
| Static token     | `secret:grafana-sa-token` | Read from k8s Secret or env var                 |
| User OAuth       | `connection:{uuid}`       | Resolve via ConnectionBrokerPort (encrypted DB) |
| ToolHive managed | `toolhive:{server-name}`  | ToolHive handles auth internally                |

**NO_SECRETS_IN_CONTEXT applies.** The resolved Bearer token is set on the MCP HTTP client, never in `ToolInvocationContext` or `RunnableConfig.configurable`.

### Transport

**Default: Streamable HTTP** (`/mcp` endpoint). This is the current MCP spec's HTTP transport (replaced legacy SSE).

Streamable HTTP supports:

- Stateless request/response for simple tool calls
- SSE upgrade for long-running operations (streaming results)
- HTTP/2 multiplexing for concurrency
- Session management via `Mcp-Session-Id` header

**Session lifecycle:** A 404 response to a request carrying `Mcp-Session-Id` means the session expired — client must re-initialize. The connection cache (MVP) handles this via reconnect-on-error. The preflight Activity (Phase 1) handles this by always initializing fresh sessions per run.

**Security:** Non-localhost HTTP servers MUST use auth (Bearer token or mTLS). The MCP spec warns about Origin validation and DNS rebinding for localhost servers. Docker-internal networking (`cogni-edge`) is acceptable for dev but NOT for prod.

### ToolHive Integration Path

[ToolHive](https://docs.stacklok.com/toolhive/) is the target operator for production MCP management:

| Phase             | Infrastructure                       | Registration                                         |
| ----------------- | ------------------------------------ | ---------------------------------------------------- |
| **Phase 0 (MVP)** | Docker Compose services, config file | Static `mcpServerIds` in catalog                     |
| **Phase 1**       | Docker Compose + DB registry         | `mcp_deployments` + `agent_mcp_bindings` tables      |
| **Phase 2**       | ToolHive operator + MCPServer CRDs   | ToolHive Registry Server → sync to `mcp_deployments` |
| **Phase 3**       | ToolHive vMCP gateway                | One gateway endpoint per trust boundary, OIDC auth   |

**Phase 2 detail:** ToolHive's Registry Server discovers MCPServer CRDs across namespaces. A sync job reads the registry and upserts `mcp_deployments` rows. Agent bindings remain in our DB — ToolHive manages servers, we manage policy.

**Phase 3 detail:** vMCP aggregates multiple backends behind one endpoint with tool prefixing, circuit breaking, and session storage. Agent bindings reference the vMCP slug, not individual server slugs. ToolHive handles per-backend credential injection.

### Admin API

```
POST   /api/internal/mcp/deployments          — register a deployment
GET    /api/internal/mcp/deployments           — list deployments (+ health status)
DELETE /api/internal/mcp/deployments/:slug     — decommission
POST   /api/internal/mcp/deployments/:slug/bind — bind agent to deployment
DELETE /api/internal/mcp/deployments/:slug/bind/:agentId — unbind
```

These are internal APIs (Bearer SCHEDULER_API_TOKEN). No public API for MCP management in Phase 1.

## Invariants

1. **BINDING_SLUG_NOT_URL**: Agents reference MCP servers by deployment slug, never by raw URL. URLs live in the deployment registry only.
2. **STREAMABLE_HTTP_DEFAULT**: New deployments use Streamable HTTP transport unless explicitly overridden.
3. **TOOL_MANIFEST_SNAPSHOT**: Each run freezes its tool manifest at start. Mid-run tool changes are ignored.
4. **NO_SECRETS_IN_CONTEXT**: MCP credentials never appear in ToolInvocationContext, RunnableConfig, or ALS context.
5. **REQUIRED_BINDING_FAIL_FAST**: If a `required: true` binding's server is unreachable, the run fails before graph execution (not mid-conversation).
6. **SESSION_REINIT_ON_EXPIRY**: Streamable HTTP session expiry (404 with Mcp-Session-Id) triggers re-initialization, not permanent failure.

## Migration from MVP

The MVP's `McpConnectionCache.getSource()` method is the seam. Phase 1 replaces:

```
parseMcpConfigFromEnv() → loadMcpTools(config) → McpToolSource
```

with:

```
queryAgentBindings(agentId) → resolveDeployments(bindings) → initMcpSessions(deployments) → ToolManifestSnapshot
```

The `ToolSourcePort` interface stays the same. `InProcProvider` doesn't change — it calls `getMcpToolSource()` and gets tools. The implementation behind that function evolves.

## Related

- [Tool Use Specification](./tool-use.md) — Canonical tool pipeline, policy enforcement
- [MCP Production Deployment Patterns](../research/mcp-production-deployment-patterns.md) — Auth spec, ToolHive, k8s patterns
- [Tenant Connections](./tenant-connections.md) — ConnectionBrokerPort, encrypted credential storage
- [Graph Execution](./graph-execution.md) — GraphExecutorPort, billing, execution pipeline
- [Project: Agentic Interop](../../work/projects/proj.agentic-interop.md) — Roadmap for MCP phases
