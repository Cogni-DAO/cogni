---
id: mcp-production-deployment-patterns
type: research
status: active
trust: draft
title: "MCP Production Deployment Patterns: Multi-Tenant Auth & K8s Orchestration"
summary: Research on MCP auth spec (Nov 2025), ToolHive k8s operator, vMCP gateway, tenant isolation patterns, and production deployment recommendations
read_when: Designing MCP server deployment, multi-tenant auth, or k8s orchestration for MCP
owner: derekg1729
created: 2026-03-28
verified: 2026-03-28
tags: [mcp, architecture, security, kubernetes]
---

# MCP Production Deployment Patterns: Multi-Tenant Auth & K8s Orchestration

> Research spike for Cogni node-template MCP architecture decisions.
> Date: 2026-03-28

---

## 1. MCP Auth Spec Evolution

### 1.1 Spec Timeline

The MCP authorization spec has gone through three major revisions:

| Version        | Key Change                                                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2025-03-26** | Initial OAuth 2.1 + PKCE. MCP server = auth server + resource server (dual role). Dynamic Client Registration (RFC 7591). Fallback endpoints at `/authorize`, `/token`, `/register`.                                                         |
| **2025-06-18** | **Breaking:** Decoupled auth server from resource server. MCP server is now a pure OAuth 2.1 **resource server** only. Added RFC 9728 Protected Resource Metadata (PRM). Removed fallback default endpoints.                                 |
| **2025-11-25** | Added Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document-00). Added Resource Indicators (RFC 8707) as MUST. Added step-up authorization (scope challenge handling). Added OIDC Discovery support alongside RFC 8414. |

**Current spec (2025-11-25) key requirements:**

- MCP servers MUST implement RFC 9728 (Protected Resource Metadata) to advertise their authorization server(s)
- MCP clients MUST use PRM for auth server discovery (no more fallback endpoints)
- Authorization servers MUST implement OAuth 2.1 with PKCE (S256 method)
- Tokens MUST be audience-bound (RFC 8707 Resource Indicators)
- Token passthrough is explicitly FORBIDDEN (confused deputy prevention)
- STDIO transport SHOULD NOT use OAuth; retrieve credentials from environment instead

### 1.2 The Dual-Role Problem (Now Resolved)

The March 2025 spec required each MCP server to be its own authorization server, which was widely criticized for enterprise use:

- Made MCP servers stateful (token databases, caches)
- Each server needed to implement token issuance correctly
- Multiple MCP servers = multiple auth endpoints = fragmentation

The June 2025 revision fixed this by separating concerns:

- **MCP Server** = stateless resource server (validates tokens, enforces RBAC)
- **Authorization Server** = external, dedicated IdP (Keycloak, Auth0, Entra ID, etc.)
- PRM document tells clients where to get tokens

### 1.3 How Auth Works Now (November 2025 Spec)

```
Client -> MCP Server: request (no token)
MCP Server -> Client: 401 + WWW-Authenticate header with resource_metadata URL
Client -> MCP Server: GET resource_metadata (RFC 9728 PRM)
MCP Server -> Client: PRM document with authorization_servers[] field
Client -> Auth Server: OAuth 2.1 flow (authorization_code or client_credentials)
Auth Server -> Client: access token (audience-bound to MCP server)
Client -> MCP Server: request + Bearer token
```

### 1.4 Implications for Cogni

**Shared/service MCP servers (e.g., Grafana):**

- Use `client_credentials` grant type (no human in the loop)
- Store service account tokens as k8s secrets
- STDIO transport servers just read creds from environment -- no OAuth needed

**Per-tenant MCP servers (BYO credentials):**

- Use `authorization_code` grant with user's IdP
- MCP server advertises tenant's auth server via PRM
- vMCP / gateway handles the auth boundary separation (clients auth once to gateway, gateway manages backend creds)

**References:**

- [MCP Authorization Spec (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Authorization Spec (2025-03-26)](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- [Logto: In-Depth Review of MCP Auth Spec](https://blog.logto.io/mcp-auth-spec-review-2025-03-26)
- [Christian Posta: The MCP Auth Spec Is a Mess](https://blog.christianposta.com/the-updated-mcp-oauth-spec-is-a-mess/)
- [Auth0: MCP Spec Updates June 2025](https://auth0.com/blog/mcp-specs-update-all-about-auth/)
- [Oso: Authorization for MCP](https://www.osohq.com/learn/authorization-for-ai-agents-mcp-oauth-21)
- [Descope: Diving Into MCP Auth Spec](https://www.descope.com/blog/post/mcp-auth-spec)

---

## 2. ToolHive for K8s MCP Management

### 2.1 Architecture Overview

ToolHive (by Stacklok, Apache 2.0) is the most mature open-source platform for running MCP servers in Kubernetes. It provides:

1. **MCPServer CRD** -- declare an MCP server as a k8s resource
2. **Kubernetes Operator** -- watches MCPServer resources, creates StatefulSets + proxy Deployments
3. **vMCP (Virtual MCP Server)** -- aggregation proxy that federates multiple backends behind one endpoint
4. **Registry Server** -- cluster-wide discovery of MCP servers across namespaces
5. **Embedded Auth Server** -- in-proxy OAuth endpoints with OIDC federation

### 2.2 MCPServer CRD

```yaml
apiVersion: toolhive.stacklok.dev/v1alpha1
kind: MCPServer
metadata:
  name: my-server
spec:
  image: ghcr.io/example/my-mcp-server:latest
  transport: streamable-http # or "sse" or "stdio"
  port: 8080
  permissionProfile:
    type: builtin
    name: network # permits outbound connections
  env:
    - name: API_KEY
      valueFrom:
        secretKeyRef:
          name: my-secret
          key: api-key
  # Full PodTemplateSpec available for complex cases
```

**What the operator creates per MCPServer:**

1. **StatefulSet** with the MCP server container
2. **Deployment** with a proxy sidecar (handles transport bridging, auth)
3. **Service** exposing the proxy on port 8080

### 2.3 Secrets & Credential Injection

ToolHive supports three patterns for credential injection:

| Pattern                        | How                                                                         | Best For                                      |
| ------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------- |
| **K8s Secrets (secretKeyRef)** | Standard `env[].valueFrom.secretKeyRef` in MCPServer CRD                    | Simple API keys, service tokens               |
| **HashiCorp Vault**            | Vault Agent Injector sidecar via `podTemplateMetadataOverrides` annotations | Production credential rotation, multi-env     |
| **Bearer Token Auth**          | `tokenSecretRef` field, references k8s Secret                               | Authenticating to remote/upstream MCP servers |

**Vault integration pattern:**

```yaml
spec:
  podTemplateMetadataOverrides:
    annotations:
      vault.hashicorp.com/agent-inject: "true"
      vault.hashicorp.com/role: "toolhive-mcp-workloads"
      vault.hashicorp.com/agent-inject-secret-creds: "secret/data/mcp/github"
      vault.hashicorp.com/agent-inject-template-creds: |
        {{- with secret "secret/data/mcp/github" -}}
        GITHUB_TOKEN={{ .Data.data.token }}
        {{- end -}}
```

### 2.4 vMCP (Virtual MCP Server)

vMCP is ToolHive's gateway/aggregation layer. Key capabilities:

- **Tool aggregation**: Multiple backends behind one endpoint; auto-prefixes conflicting tool names (`github_create_issue`, `jira_create_issue`)
- **Auth boundary separation**: Clients authenticate once to vMCP (OIDC); vMCP manages per-backend credentials independently
- **Circuit breakers**: Detects unhealthy backends, temporarily removes them
- **Composite tools**: Declarative multi-step workflows with parallel execution, conditionals, approval gates
- **Tool filtering/wrapping**: Restrict tools to specific domains, validate inputs, rename tools
- **Session storage**: Redis-backed for horizontal scaling
- **Telemetry**: OpenTelemetry metrics + distributed traces

```yaml
apiVersion: toolhive.stacklok.dev/v1alpha1
kind: VirtualMCPServer
spec:
  groupRef:
    name: my-mcp-group
  incomingAuth:
    type: oidc # or "anonymous"
  outgoingAuth:
    source: discovery
  aggregation:
    conflictResolution: prefix
  sessionStorage:
    type: redis
    redis:
      address: redis:6379
```

### 2.5 Multi-Tenant Readiness

ToolHive's Registry Server v0.6.0+ supports:

- **Cluster-wide namespace scanning** via `THV_REGISTRY_WATCH_NAMESPACE` (monitors MCPServers across namespaces)
- **Built-in RBAC** with ClusterRole/RoleBinding for multi-namespace
- **PostgreSQL persistence** (replaced in-memory store)

For per-tenant isolation, the pattern is: **namespace-per-tenant + MCPServer CRD per tenant + vMCP as shared gateway**.

### 2.6 Production Readiness Assessment

| Aspect           | Status                                                             |
| ---------------- | ------------------------------------------------------------------ |
| CRD maturity     | v1alpha1 -- API may change                                         |
| Auth             | Embedded auth server + OIDC federation (production-grade)          |
| Secrets          | K8s Secrets + Vault integration (production-grade)                 |
| Observability    | OTel metrics + Prometheus + distributed traces (good)              |
| Circuit breakers | vMCP has them (good)                                               |
| Multi-tenant     | Namespace scanning exists; no built-in tenant isolation primitives |
| Community        | Active (Stacklok/Red Hat backing), weekly releases                 |

**References:**

- [ToolHive GitHub](https://github.com/stacklok/toolhive)
- [ToolHive Docs](https://docs.stacklok.com/toolhive/)
- [ToolHive K8s Quickstart](https://docs.stacklok.com/toolhive/tutorials/quickstart-k8s)
- [ToolHive CRD Reference](https://docs.stacklok.com/toolhive/reference/crd-spec)
- [ToolHive Vault Integration](https://docs.stacklok.com/toolhive/tutorials/vault-integration)
- [ToolHive K8s Operator Article](https://dev.to/stacklok/toolhive-an-mcp-kubernetes-operator-321)
- [ToolHive vMCP Introduction](https://stacklok.com/blog/introducing-virtual-mcp-server-unified-gateway-for-multi-mcp-workflows/)
- [ToolHive Enterprise Updates (Feb 2026)](https://docs.stacklok.com/toolhive/updates/2026/02/16/updates)

---

## 3. MCP Connection Reliability

### 3.1 Transport Options

| Transport            | Session Model                         | Best For                                        |
| -------------------- | ------------------------------------- | ----------------------------------------------- |
| **stdio**            | 1:1 process                           | Local dev, sidecar containers. No multiplexing. |
| **SSE (deprecated)** | Long-lived HTTP connection            | Legacy. ~30 req/s at high concurrency.          |
| **Streamable HTTP**  | Stateless HTTP + optional SSE upgrade | Production. ~300 req/s. Supports multiplexing.  |

**Streamable HTTP** is the production choice. It allows:

- Stateless request/response for simple tool calls
- SSE streaming for long-running operations
- HTTP/2 multiplexing (hundreds of concurrent streams per TCP connection)

### 3.2 Health Checking

MCP spec includes a **Ping** utility (JSON-RPC method):

- Either party can send `ping` to verify the counterpart is responsive
- Standard timeout: 2-5 seconds (anything longer = unhealthy)
- Recommended: 3 consecutive failed pings before triggering restart

**Production health check pattern:**

```
- Kubernetes liveness probe: HTTP GET to proxy health endpoint
- MCP-level ping: JSON-RPC ping every 30s (configurable)
- Circuit breaker: vMCP removes unhealthy backends automatically
```

### 3.3 Reconnection Strategy

For Streamable HTTP:

- Stateless by default -- each request is independent, no reconnection needed
- For SSE streams: use `Last-Event-ID` header to resume
- Exponential backoff with jitter for retries
- Track message IDs to prevent duplicate processing

For stdio:

- Process crash = restart the container (k8s handles this)
- No in-protocol reconnection; rely on orchestrator restart

### 3.4 Session Management

The MCP protocol is stateful at the session level (tools/resources are negotiated per session). Options:

- **Stateless proxy**: vMCP with Redis session storage handles horizontal scaling
- **Session affinity**: Gateway routes same `session_id` to same backend (Microsoft MCP Gateway pattern)
- **Session-per-request**: For simple tool calls, treat each request as independent

**References:**

- [MCP Ping Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/ping)
- [MCP Architecture Overview](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP Transports Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [MCP Connection Health Checks Guide](https://mcpcat.io/guides/implementing-connection-health-checks/)
- [MCP State Discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/102)

---

## 4. Tenant Isolation in K8s

### 4.1 Isolation Models for MCP

| Model                            | Isolation Level            | Cost   | Best For                                    |
| -------------------------------- | -------------------------- | ------ | ------------------------------------------- |
| **Shared pool + tenant context** | Logical (tenant_id filter) | Low    | Low-risk tools (read-only, no credentials)  |
| **Namespace-per-tenant**         | Network + RBAC             | Medium | Most production cases                       |
| **Cluster-per-tenant**           | Full compute               | High   | Regulated (PHI, financial), high-risk tools |
| **Sidecar per agent**            | Pod-level                  | Medium | Agent-specific MCP tools                    |

### 4.2 Recommended Pattern: Namespace-per-Tenant + Shared Gateway

```
                    +------------------+
                    |   vMCP Gateway   |  <-- shared, OIDC auth
                    | (VirtualMCPServer)|
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
     +--------+----+ +------+------+ +-----+------+
     | ns: tenant-a | | ns: tenant-b | | ns: shared  |
     | MCPServer:   | | MCPServer:   | | MCPServer:  |
     | github-a     | | github-b     | | grafana     |
     | (user creds) | | (user creds) | | (svc token) |
     +--------------+ +--------------+ +-------------+
```

- **Shared MCP servers** (Grafana, filesystem tools): Single instance in shared namespace, service account token
- **Per-tenant MCP servers** (GitHub, Slack with user creds): One MCPServer CRD per tenant in tenant namespace
- **Gateway (vMCP)**: Routes tool calls to correct backend based on tenant context

### 4.3 Credential Injection Patterns

| Pattern                       | Mechanism                                         | Rotation                  | Complexity  |
| ----------------------------- | ------------------------------------------------- | ------------------------- | ----------- |
| **K8s Secrets**               | `secretKeyRef` in MCPServer CRD                   | Manual or ExternalSecrets | Low         |
| **External Secrets Operator** | Syncs from AWS SM / GCP SM / Vault to k8s Secrets | Automatic                 | Medium      |
| **Vault Agent Injector**      | Sidecar injects secrets as env vars / files       | Automatic (Vault lease)   | Medium-High |
| **Sealed Secrets**            | Encrypted in git, decrypted by controller         | Manual re-encrypt         | Low         |

**Recommendation for Cogni:** Start with K8s Secrets + External Secrets Operator (syncing from whatever secret store is available). Graduate to Vault when tenant count requires it.

### 4.4 Network Policies

```yaml
# Deny all ingress to tenant namespace except from vMCP gateway
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-only-gateway
  namespace: tenant-a
spec:
  podSelector: {}
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              app: vmcp-gateway
      ports:
        - port: 8080
```

### 4.5 Tenant Context Propagation

Every MCP request should carry: `{tenant_id, user_id, agent_id, session_id}`

Options:

- **HTTP headers**: Gateway injects `X-Tenant-ID` before routing to backend
- **Token claims**: Tenant ID embedded in JWT `aud` or custom claim
- **MCP metadata**: Pass via tool call parameters (less secure, tool must enforce)

**References:**

- [Prefactor: MCP Security for Multi-Tenant AI Agents](https://prefactor.tech/blog/mcp-security-multi-tenant-ai-agents-explained)
- [Kubernetes Multi-Tenancy Docs](https://kubernetes.io/docs/concepts/security/multi-tenancy/)
- [Sysdig: Three Multi-Tenant Isolation Boundaries](https://www.sysdig.com/blog/multi-tenant-isolation-boundaries-kubernetes)

---

## 5. MCP Proxy/Gateway Patterns

### 5.1 Available Gateways (2026)

| Gateway                   | Auth Model                     | K8s Native         | Multi-Tenant           | Maturity              |
| ------------------------- | ------------------------------ | ------------------ | ---------------------- | --------------------- |
| **ToolHive vMCP**         | OIDC + per-backend creds       | Yes (CRD)          | Namespace scanning     | Production (Stacklok) |
| **Microsoft MCP Gateway** | Entra ID + role-based          | Yes (StatefulSets) | Session-aware routing  | Preview (Microsoft)   |
| **AgentGateway**          | None built-in                  | Yes (Gateway API)  | Label-based federation | Early                 |
| **Envoy AI Gateway**      | Envoy filter chain             | Yes (Envoy-native) | Envoy RBAC             | Early                 |
| **ContextForge (IBM)**    | Pluggable                      | Yes                | Registry-based         | Early                 |
| **Gravitee MCP Proxy**    | Full API management            | Via Gravitee       | Enterprise             | Commercial            |
| **mcp-auth-proxy**        | OAuth 2.1 (Google/GitHub/OIDC) | No                 | No                     | Community             |

### 5.2 Gateway Architecture Pattern

The recommended pattern puts the gateway between agents and MCP servers:

```
Agent (MCP Client)
    |
    | OAuth 2.1 Bearer token (user identity)
    v
+-------------------+
| MCP Gateway/Proxy |  <-- validates token, resolves tenant, routes
| (vMCP / MS GW)    |
+--------+----------+
         |
    +----+----+
    |         |
  Backend   Backend   <-- MCP servers (stateless resource servers)
  (shared)  (per-tenant)
```

**What the gateway does:**

1. **Auth termination**: Validates incoming OAuth tokens against IdP
2. **Tenant resolution**: Extracts tenant_id from token claims
3. **Tool routing**: Maps tool calls to correct backend based on tool registry
4. **Session affinity**: Ensures stateful sessions hit same backend
5. **Circuit breaking**: Removes unhealthy backends
6. **Audit logging**: Records all tool invocations with tenant context

### 5.3 Microsoft MCP Gateway Details

- Uses **StatefulSets** for stable pod identity and network endpoints
- **Session-aware routing**: All requests with same `session_id` go to same instance
- **Adapter pattern**: Each MCP server registered as an "adapter" at `/adapters/{name}/mcp`
- **Tool gateway router**: A meta-MCP-server that routes by tool name
- **Entra ID integration**: Role-based access (`mcp.engineer`, `mcp.admin`)

### 5.4 Auth Proxy Pattern (for existing MCP servers)

For MCP servers that don't implement OAuth natively, put an auth proxy in front:

```yaml
# mcp-auth-proxy wraps any MCP server with OAuth 2.1
apiVersion: apps/v1
kind: Deployment
spec:
  containers:
    - name: auth-proxy
      image: ghcr.io/sigbit/mcp-auth-proxy:latest
      env:
        - name: OIDC_ISSUER
          value: https://auth.example.com
        - name: MCP_BACKEND
          value: http://localhost:3000/mcp
    - name: mcp-server
      image: my-mcp-server:latest
```

**References:**

- [Microsoft MCP Gateway](https://github.com/microsoft/mcp-gateway)
- [AgentGateway MCP Multiplexing](https://agentgateway.dev/blog/2026-02-20-mcp-multiplexing-tool-access-agentgateway/)
- [Envoy AI Gateway MCP Support](https://aigateway.envoyproxy.io/blog/mcp-implementation/)
- [Gravitee MCP Proxy](https://www.gravitee.io/blog/mcp-proxy-unified-governance-for-agents-tools)
- [mcp-auth-proxy](https://github.com/sigbit/mcp-auth-proxy)
- [ContextForge (IBM)](https://ibm.github.io/mcp-context-forge/)
- [Composio: Best MCP Gateways 2026](https://composio.dev/content/best-mcp-gateway-for-developers)

---

## 6. Scalable MCP Architecture

### 6.1 Connection Multiplexing

**Can multiple agents share one MCP server?**

Yes, with Streamable HTTP transport:

- HTTP/2 multiplexes hundreds of concurrent streams per TCP connection
- Each agent gets its own session (negotiated tools/resources)
- Stateless tool calls can be load-balanced freely
- Stateful sessions need affinity (session_id routing)

**When you need dedicated instances:**

- MCP server has per-user state (filesystem, database connections)
- Security isolation requires it (per-tenant credentials baked into the server)
- Resource-intensive tools that need dedicated CPU/memory

**When shared is fine:**

- Read-only tools (search, fetch, monitoring)
- Stateless tool calls (each call is independent)
- Service-account-based tools (same creds for all tenants)

### 6.2 Platform Comparison

| Platform     | Model                                     | Auth          | Production?          |
| ------------ | ----------------------------------------- | ------------- | -------------------- |
| **Smithery** | Registry/discovery ("Docker Hub for MCP") | None          | No -- discovery only |
| **Composio** | Managed hosting + integrations            | Managed OAuth | Yes (commercial)     |
| **ToolHive** | Self-hosted k8s operator                  | OIDC + Vault  | Yes (open source)    |
| **Mastra**   | Framework (in-process MCP client)         | App-level     | Partial              |

Smithery is a registry (2500+ community tools) but not a runtime. Composio is the hosted commercial option. ToolHive is the self-hosted production option.

### 6.3 Recommended Architecture for Cogni

```
                         +------------------+
                         |  Keycloak / IdP  |
                         +--------+---------+
                                  |
                    OAuth 2.1     |  token validation
                                  |
+----------+      +---------+----+--------+---------+
| Agent A  | ---> |         vMCP Gateway             |
| Agent B  | ---> |  (ToolHive VirtualMCPServer)     |
| Agent C  | ---> |  - OIDC incomingAuth             |
+----------+      |  - per-backend outgoingAuth      |
                  |  - tool aggregation + prefixing  |
                  |  - circuit breakers              |
                  |  - Redis session storage         |
                  |  - OTel telemetry                |
                  +--+----------+----------+---------+
                     |          |          |
              +------+--+ +----+----+ +---+--------+
              | ns:shared| |ns:ten-a | |ns:ten-b    |
              | grafana  | | github  | | github     |
              | postgres | | slack   | | jira       |
              | (svc tok)| | (user)  | | (user)     |
              +----------+ +---------+ +------------+
```

**Key decisions:**

1. **Gateway**: ToolHive vMCP (most mature, CRD-native, OIDC, circuit breakers)
2. **Transport**: Streamable HTTP for all remote servers; stdio only for local dev
3. **Auth**: OIDC via vMCP for incoming; k8s Secrets/Vault for backend creds
4. **Isolation**: Namespace-per-tenant for per-user MCP servers; shared namespace for service-account tools
5. **Session**: Redis-backed session storage in vMCP for horizontal scaling
6. **Health**: k8s liveness probes + MCP ping + vMCP circuit breakers
7. **Secrets**: K8s Secrets + External Secrets Operator (start); Vault (scale)

### 6.4 Migration Path

| Phase             | Scope                                           | Auth Model                                       |
| ----------------- | ----------------------------------------------- | ------------------------------------------------ |
| **Phase 0 (now)** | Single shared MCP servers (Grafana, Playwright) | Static tokens in k8s secrets                     |
| **Phase 1**       | ToolHive operator + MCPServer CRDs              | Service account tokens via secretKeyRef          |
| **Phase 2**       | vMCP gateway + OIDC                             | Per-tenant namespaces, OIDC incoming auth        |
| **Phase 3**       | Full BYO-credential flow                        | User OAuth flow through vMCP, Vault for rotation |

---

## Summary: Key Takeaways

1. **The MCP auth spec is now enterprise-ready** (Nov 2025). MCP servers are pure resource servers; auth is delegated to external IdPs via PRM (RFC 9728). This matches standard API gateway patterns.

2. **ToolHive is the clear leader** for self-hosted k8s MCP management. CRD-based lifecycle, vMCP aggregation, OIDC auth, Vault integration, circuit breakers, OTel observability. The CRD is v1alpha1 but actively developed with Stacklok/Red Hat backing.

3. **Streamable HTTP is the production transport**. 10x throughput vs SSE, supports HTTP/2 multiplexing, works stateless or with session affinity.

4. **Namespace-per-tenant + shared gateway** is the right isolation model for most cases. Network policies restrict cross-tenant traffic. vMCP handles routing and auth boundary separation.

5. **Start simple, scale up**: Static k8s secrets -> External Secrets Operator -> Vault. Shared MCP servers -> per-tenant namespaces -> full BYO-credential OAuth flow.

6. **Do not build a custom gateway**. ToolHive vMCP, Microsoft MCP Gateway, or AgentGateway all exist. The gateway is the hardest part to get right (auth, routing, session affinity, circuit breaking).
