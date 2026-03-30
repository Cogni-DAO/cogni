---
id: spec.mcp-control-plane
type: spec
title: MCP Control Plane Architecture
status: draft
spec_state: draft
trust: draft
summary: MCP server lifecycle management — from static Docker Compose services (current) through deployment registry and multi-tenant credential brokering to ToolHive-managed fleet (target).
read_when: Adding MCP servers, changing MCP connection handling, implementing multi-tenant tool access, or planning ToolHive migration.
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

MCP servers provide external tool capabilities to agents — browser automation, observability queries, code search, etc. This spec covers the full lifecycle: how MCP servers are deployed, how agents bind to them, how credentials are resolved, and how the system evolves from static config to managed fleet.

## Goal

Define a control plane where MCP servers are managed resources with stable identities, agents bind to them via slugs (not raw URLs), and credentials are resolved at invocation time via `ConnectionBrokerPort`.

## Non-Goals

- Custom MCP gateway implementation (use ToolHive vMCP when on k8s)
- MCP auth server implementation (use external IdP via PRM)
- General-purpose container hosting (scope: approved MCP server templates only)

---

## Design

### Current State (Phase 0)

Shipped in `task.0228`. Dev-only, single-tenant.

### How it works

```
config/mcp.servers.json (or MCP_SERVERS env var)
    ↓ parseMcpConfigFromEnv()
    ↓ loadMcpTools() via @langchain/mcp-adapters
    ↓
McpConnectionCache (reconnect-on-error + 5min TTL backstop)
    ↓ getSource() → ErrorDetectingMcpToolSource
    ↓
InProcProvider.runGraph() resolves tools per catalog mcpServerIds
    ↓
toolRunner.exec() — standard policy/billing/redaction pipeline
```

### Config delivery

| Environment        | Method                                                                 | Notes                                                                         |
| ------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Dev (pnpm dev)     | `MCP_CONFIG_PATH` → config file + `MCP_*_URL` env vars in `.env.local` | Config file at repo root, CWD workaround via relative path                    |
| Dev (docker:stack) | `MCP_SERVERS` env var or `MCP_*_URL` defaults in compose               | Docker-internal DNS (`playwright-mcp:3003`)                                   |
| Staging/Prod       | `MCP_SERVERS` env var in compose                                       | Priority 1 path — bypasses config file entirely, no Dockerfile changes needed |

### Services

| Service        | Image                              | Port | Profile        | Transport              |
| -------------- | ---------------------------------- | ---- | -------------- | ---------------------- |
| playwright-mcp | `mcr.microsoft.com/playwright/mcp` | 3003 | mcp-playwright | Streamable HTTP `/mcp` |
| grafana-mcp    | `mcp/grafana`                      | 8000 | mcp-playwright | Streamable HTTP `/mcp` |

### Limitations

- Static config — add/remove MCP servers requires compose change + redeploy
- No auth on MCP endpoints (Docker-internal `cogni-edge` network only)
- Shared browser context across all users (single-tenant)
- `mcpServerIds` hardcoded in catalog (code change to rebind)
- `closeMcpConnections()` not wired to shutdown handlers (pre-existing gap)

---

### Target State

#### Deployment Registry

MCP servers are registered as **deployments** with stable slug identifiers. Agents reference slugs, never raw URLs. Slugs are durable across redeployments.

```
mcp_deployments
├── slug (PK)          — e.g., "playwright-dev", "grafana-prod"
├── display_name       — human label
├── endpoint           — resolved URL (e.g., "http://playwright-mcp:3003/mcp")
├── transport          — "streamable-http" | "sse" | "stdio"
├── auth_mode          — "none" | "static_token" | "connection" | "toolhive"
├── auth_ref           — reference to credentials (env var name, connection ID, or null)
├── status             — "healthy" | "unhealthy" | "provisioning" | "decommissioned"
├── capabilities_hash  — SHA256 of last tools/list response (detect drift)
├── config             — JSONB: timeout, retry policy, tool filters
├── created_at
├── updated_at
└── billing_account_id — NULL for shared, set for tenant-scoped
```

#### Agent Bindings

Replaces static `mcpServerIds` in the LangGraph catalog.

```
agent_mcp_bindings
├── agent_id           — graph ID or future agent entity ID
├── deployment_slug    — FK → mcp_deployments.slug
├── allowed_tools      — text[] or NULL (NULL = all tools from server)
├── required           — boolean (fail run if unavailable)
├── created_at
└── UNIQUE(agent_id, deployment_slug)
```

#### Credential Resolution

MCP server credentials follow the existing `ConnectionBrokerPort` pattern:

| Credential Type        | auth_mode      | auth_ref                                | Resolution                                      |
| ---------------------- | -------------- | --------------------------------------- | ----------------------------------------------- |
| None (Docker-internal) | `none`         | `null`                                  | No auth headers                                 |
| Static token           | `static_token` | env var name (e.g., `GRAFANA_SA_TOKEN`) | Read from env at connect time                   |
| Tenant OAuth           | `connection`   | `connection:{uuid}`                     | Resolve via ConnectionBrokerPort (encrypted DB) |
| ToolHive managed       | `toolhive`     | ToolHive server name                    | ToolHive handles auth internally                |

**connectionId and MCP:** Treat an MCP deployment like any other remote connection target. `connectionId` points to tenant-scoped credentials. The deployment row stores `auth_mode` + `auth_ref` (what kind of auth, where to find it); actual secret resolution happens at invocation time, never baked into deployment rows or agent specs.

- **Unauthenticated MCP (shared):** `deployment_slug` only, no `connectionId`
- **Tenant-authenticated MCP:** `deployment_slug` + `connectionId` (resolved per-invocation)
- **Delegated auth (MCP→backend):** Two layers — broker owns client→MCP auth, server-side token exchange owns MCP→backend auth

#### RBAC

MCP tool access fits the existing RBAC model from `proj.rbac-hardening`:

- **Tool-level:** `ToolPolicy.allowedTools` gates which MCP tools an agent can invoke (already enforced)
- **Deployment-level:** `agent_mcp_bindings.allowed_tools` filters which tools from a server are visible to an agent
- **Tenant-level:** `mcp_deployments.billing_account_id` scopes deployments to tenants (NULL = shared)
- **Actor-level (P1+):** `AUTHZ_CHECK_BEFORE_TOOL_EXEC` (future invariant from tool-use.md F1) — AuthorizationPort validates actor has `tool.execute` permission before MCP tool invocation

No new RBAC primitives needed. MCP tools use the same policy/grant/connection pipeline as native tools.

### Transport

**Default: Streamable HTTP** (`/mcp` endpoint). Current MCP spec HTTP transport.

- Stateless request/response for simple tool calls
- SSE upgrade for long-running operations
- Session management via `Mcp-Session-Id` header
- Session expiry (404 with session ID) → re-initialize, not permanent failure

**Security:** Non-localhost HTTP servers MUST use auth. Docker-internal networking is acceptable for same-host deployments. Cross-host or external MCP requires Bearer token or mTLS.

### Dynamic Deployment

Admin action creates `mcp_deployments` record + applies a container template:

```
deployMcpServer(serverType, secrets, policy) → slug
```

On Docker Compose infra: generates a compose service definition and restarts the stack.
On k8s infra: applies a ToolHive MCPServer CRD or Helm release.

**Scope guard:** Approved MCP server templates only. Not a general container platform.

---

## Roadmap

### Phase 0.5: Prod Infra (hours, no code changes)

Add MCP services to `docker-compose.yml` (prod). Set `MCP_SERVERS` JSON env var in CI. MCP works in staging + prod with the same code path as dev.

| Deliverable                                         | Status      | Work Item |
| --------------------------------------------------- | ----------- | --------- |
| Add playwright-mcp + grafana-mcp to prod compose    | Not Started | —         |
| Set `MCP_SERVERS` env var in deploy.sh / CI secrets | Not Started | —         |
| Verify MCP tools load in staging                    | Not Started | —         |

### Phase 1: Config Extraction + Auth (days)

Move MCP bindings from hardcoded catalog to config-driven. Add auth header support for external MCP servers.

| Deliverable                                                          | Status      | Work Item |
| -------------------------------------------------------------------- | ----------- | --------- |
| `mcp_deployments` table (Drizzle migration)                          | Not Started | —         |
| `agent_mcp_bindings` table (Drizzle migration)                       | Not Started | —         |
| Seed migration: populate from current config/catalog                 | Not Started | —         |
| `McpConnectionCache.getSource()` reads from DB instead of env/config | Not Started | —         |
| InProcProvider resolves bindings from DB instead of `mcpServerIds`   | Not Started | —         |
| Auth headers via `ConnectionBrokerPort` at connect time              | Not Started | —         |
| Admin API: CRUD for deployments + bindings (internal)                | Not Started | —         |

### Phase 2: Multi-Tenant Isolation (weeks)

Per-tenant MCP server instances. Tenant A's Grafana credentials don't leak to Tenant B.

| Deliverable                                                     | Status      | Work Item |
| --------------------------------------------------------------- | ----------- | --------- |
| Per-tenant `mcp_deployments` rows (`billing_account_id` scoped) | Not Started | —         |
| Tenant-scoped connection resolution (connectionId per binding)  | Not Started | —         |
| RLS on `mcp_deployments` + `agent_mcp_bindings` tables          | Not Started | —         |
| Per-tenant MCP sessions (no shared browser state)               | Not Started | —         |

### Phase 3: ToolHive + Managed Fleet (when on k8s)

Requires infrastructure migration to Kubernetes (Akash/Spheron k8s or self-managed k3s).

| Deliverable                                           | Status      | Work Item |
| ----------------------------------------------------- | ----------- | --------- |
| ToolHive operator deployment                          | Not Started | —         |
| MCPServer CRDs for managed MCP servers                | Not Started | —         |
| Registry Server for discovery across namespaces       | Not Started | —         |
| Sync job: ToolHive Registry → `mcp_deployments` table | Not Started | —         |
| vMCP gateway for aggregation + circuit breaking       | Not Started | —         |
| OIDC auth via vMCP incoming auth                      | Not Started | —         |
| Namespace-per-tenant isolation                        | Not Started | —         |

**Phase 3 depends on k8s migration.** Current infra is Docker Compose on bare VMs. ToolHive is a k8s operator — it cannot run without k8s. This phase is deferred until infra migration is planned.

---

## Invariants

1. **BINDING_SLUG_NOT_URL**: Agents reference MCP servers by deployment slug, never by raw URL. URLs live in the deployment registry only.
2. **STREAMABLE_HTTP_DEFAULT**: New deployments use Streamable HTTP transport unless explicitly overridden.
3. **TOOL_MANIFEST_SNAPSHOT**: Each run freezes its tool manifest at start. Mid-run tool changes are ignored.
4. **NO_SECRETS_IN_CONTEXT**: MCP credentials never appear in ToolInvocationContext, RunnableConfig, or ALS context. Resolved via ConnectionBrokerPort at invocation time.
5. **REQUIRED_BINDING_FAIL_FAST**: If a `required: true` binding's server is unreachable, the run fails before graph execution.
6. **SESSION_REINIT_ON_EXPIRY**: Streamable HTTP session expiry (404 with Mcp-Session-Id) triggers re-initialization, not permanent failure.
7. **MCP_SAME_POLICY_PATH**: MCP tools use the same toolRunner.exec() pipeline as native tools — same policy, billing, redaction. No bypass paths.
8. **RBAC_VIA_EXISTING_MODEL**: MCP access control uses existing ToolPolicy + ConnectionBrokerPort + AuthorizationPort. No MCP-specific RBAC primitives.

## Migration from Current State

The MVP's `McpConnectionCache.getSource()` is the seam. Each phase replaces what's behind it:

```
Phase 0:   parseMcpConfigFromEnv() → loadMcpTools() → McpToolSource
Phase 0.5: MCP_SERVERS env var → same code path, different config delivery
Phase 1:   queryDeployments(agentId) → resolveAuth(bindings) → loadMcpTools() → McpToolSource
Phase 2:   same as Phase 1, scoped by billing_account_id
Phase 3:   ToolHive Registry → mcp_deployments sync → same resolution path
```

`ToolSourcePort` interface stays the same throughout. InProcProvider calls `getMcpToolSource()` and gets tools regardless of which phase is active.

## Related

- [Tool Use Specification](./tool-use.md) — Canonical tool pipeline, policy enforcement, MCP invariants
- [MCP Production Deployment Patterns](../research/mcp-production-deployment-patterns.md) — Auth spec, ToolHive, k8s patterns
- [Tenant Connections](./tenant-connections.md) — ConnectionBrokerPort, encrypted credential storage
- [Graph Execution](./graph-execution.md) — GraphExecutorPort, billing, execution pipeline
- [Project: Agentic Interop](../../work/projects/proj.agentic-interop.md) — Roadmap for MCP phases
