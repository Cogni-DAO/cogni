---
id: akash-deploy-service-spec
type: spec
title: Akash Deploy Service — Workload Deployment to Decentralized Cloud
status: draft
spec_state: draft
trust: draft
summary: On-demand deployment of containerized workloads (MCP servers + AI agents) to Akash Network. Implements ClusterProvider from node-launch spec. ToolHive for MCP lifecycle on k8s. SDL generator as service-internal utility.
read_when: Working on Akash deployments, MCP hosting, workload orchestration, or ClusterProvider adapters.
implements: proj.akash-crew-deploy
owner: derekg1729
created: 2026-03-26
verified:
tags: [infra, akash, mcp, agents, deployment]
---

# Akash Deploy Service — Workload Deployment to Decentralized Cloud

## Context

The node-launch spec defines `ClusterProvider` — a 4-method interface abstracting where workloads deploy. Today only `CherryK3sProvider` exists. This spec adds `AkashSdlProvider` as a second adapter, enabling the same provisioning workflow to deploy to Akash's decentralized cloud.

For MCP server management specifically, ToolHive (Apache 2.0, by Stacklok) provides a Kubernetes operator with a built-in registry, CRD-based definitions, and automatic RBAC/service discovery. We use ToolHive on k8s and translate its patterns to SDL for Akash.

## Goal

Implement `ClusterProvider` for Akash Network. A user describes workloads (MCP servers + agents), the system generates Akash SDL, and deploys via the standard provisioning workflow.

## Non-Goals

| Item                         | Reason                                                |
| ---------------------------- | ----------------------------------------------------- |
| Bespoke MCP registry         | ToolHive has a built-in registry of vetted servers    |
| New port abstractions        | `ClusterProvider` from node-launch is the only port   |
| Cosmos wallet in v0          | Defer to P1 when live Akash network is needed         |
| Custom container builds      | Golden images or ToolHive registry only               |
| New domain entities ("crew") | Workloads are just container specs — no new semantics |

## Core Invariants

1. **ONE_PORT**: `ClusterProvider` is the only deployment port. No `AkashDeployPort`, no `CrewPort`. Akash is an adapter, not a capability.

2. **TOOLHIVE_FOR_MCP**: MCP server discovery, lifecycle, and security use ToolHive on k8s. For Akash, we translate the same container specs to SDL.

3. **SDL_IS_INTERNAL**: SDL generation is an adapter-internal utility function. Not a package, not a port, not a public API.

4. **PACKAGES_ARE_PURE**: No packages needed for v0. `ClusterProvider` interface is defined in the node-launch spec. SDL generation lives in the service adapter.

5. **GRAPH_VIA_DI**: The orchestrator graph receives all capabilities via dependency injection. No hard imports of deployment infrastructure.

## Design

### Component Map (v0 crawl)

```
services/akash-deployer/
  ├── src/
  │   ├── provider/           ClusterProvider interface + MockProvider
  │   ├── sdl/                SDL generator (internal utility)
  │   ├── routes/             HTTP handlers
  │   ├── config/             Env loading
  │   └── main.ts             Server lifecycle
  ├── Dockerfile
  └── tests/

packages/langgraph-graphs/
  └── src/graphs/crew-orchestrator/   NL → workload specs → ClusterProvider (via DI)

infra/cd/base/akash-deployer/        Kustomize manifests
```

No standalone packages. The service owns all Akash-specific code.

### ClusterProvider Interface (from node-launch spec)

```typescript
interface ClusterProvider {
  ensureCluster(env: string): Promise<ClusterConnection>;
  createNamespace(conn: ClusterConnection, name: string): Promise<void>;
  applyManifests(conn: ClusterConnection, path: string): Promise<void>;
  createSecret(
    conn: ClusterConnection,
    ns: string,
    data: Record<string, string>
  ): Promise<void>;
}
```

Adapters:

- `CherryK3sProvider` — kubectl + kustomize + ToolHive operator (existing)
- `AkashSdlProvider` — @akashnetwork/akashjs + SDL (this spec, P1)
- `MockClusterProvider` — in-memory, for v0 testing

### SDL Generation (adapter-internal)

Pure function: container specs → Akash SDL YAML. Lives inside `services/akash-deployer/src/sdl/`. Not exported. Not a package.

```typescript
function generateSdl(services: ServiceSpec[]): string;
```

### ToolHive Integration (P1 — k8s path)

On k8s, MCP servers are `MCPServer` CRDs managed by ToolHive operator:

```yaml
apiVersion: toolhive.stacklok.dev/v1alpha1
kind: MCPServer
metadata:
  name: mcp-github
spec:
  image: ghcr.io/modelcontextprotocol/server-github
  transport: stdio
  secrets:
    - name: github-token
      key: token
      targetEnvName: GITHUB_TOKEN
```

ToolHive handles: registry lookup, container lifecycle, RBAC, service discovery, secrets injection. We don't rebuild any of this.

For Akash (no k8s operator), the same container specs are translated to SDL by the adapter.

### Orchestrator Graph

React agent with tools that call `ClusterProvider` methods via DI. Accepts natural language workload descriptions, resolves to container specs, deploys.

Tools receive all capabilities through `CrewOrchestratorToolDeps` — the graph package has zero deployment-infrastructure imports.

## Acceptance Checks

1. `services/akash-deployer` starts and serves health, deploy, preview endpoints
2. SDL generator produces valid YAML from container specs (unit tested)
3. Mock provider handles full create → query → close lifecycle
4. Orchestrator graph tools accept deps via DI (no hard imports)
5. `pnpm check` passes — all 13 checks green
6. Service responds correctly to curl (e2e proof)

## Open Questions

1. **ToolHive on Akash**: ToolHive is k8s-native. On Akash there's no operator. How much of ToolHive's registry data can we reuse for SDL generation?
2. **Akash JS SDK maturity**: Is `@akashnetwork/akashjs` production-ready or do we need CLI fallback?
3. **MCP transport on Akash**: ToolHive proxies stdio→HTTP. On Akash, should MCP servers run SSE/HTTP natively?

## Dependencies

- node-launch spec (`ClusterProvider` interface)
- task.0149 (k3s + ArgoCD foundation)
- ToolHive operator (for k8s MCP management at P1)
- @akashnetwork/akashjs (for live Akash at P1)

## Related

- [Node Launch Spec](./node-launch.md) — `ClusterProvider` interface
- [ToolHive Docs](https://docs.stacklok.com/toolhive/) — MCP server management
- [Akash Crew Deploy Project](../../work/projects/proj.akash-crew-deploy.md) — Roadmap
