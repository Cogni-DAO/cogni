---
id: akash-deploy-service-spec
type: spec
title: Akash Deploy Service — Container Runtime & Workload Orchestration
status: draft
spec_state: draft
trust: draft
summary: Layered architecture for deploying containerized workloads to any compute target. ContainerRuntimePort deploys containers (Docker, k8s, Akash). ClusterProvider wraps it for namespace-level provisioning. ToolHive manages MCP-specific lifecycle. LangGraph orchestrator converts NL to workload specs.
read_when: Working on container deployment, Akash integration, MCP hosting, ClusterProvider adapters, or workload orchestration.
implements: proj.akash-crew-deploy
owner: derekg1729
created: 2026-03-26
verified:
tags: [infra, akash, mcp, agents, deployment, containers]
---

# Akash Deploy Service — Container Runtime & Workload Orchestration

## Context

The node-launch spec defines `ClusterProvider` for namespace-level provisioning (create namespace, apply manifests, inject secrets). This works for the `provisionNode` workflow but is too high-level to describe what actually happens when containers deploy to Docker, k8s, or Akash.

We need a lower-level primitive — a container runtime port that deploys images without knowing what's inside them. `ClusterProvider` wraps this for namespace-level orchestration. ToolHive sits above both as an MCP-aware lifecycle manager.

## Goal

Define a clean layered architecture where each layer has one job, the port doesn't know MCP vs agent vs anything else, and adapters for Docker/k8s/Akash are interchangeable.

## Non-Goals

| Item                                | Reason                                           |
| ----------------------------------- | ------------------------------------------------ |
| ToolHive Akash runtime contribution | Evaluate at P1; Go contribution to external repo |
| Custom MCP registry                 | ToolHive built-in registry handles this          |
| Cosmos wallet in v0                 | No live Akash deployment yet                     |
| New domain entities                 | Workloads are container specs, nothing more      |

## Core Invariants

1. **CONTAINER_AGNOSTIC**: `ContainerRuntimePort` deploys container images. It does not know if the image is an MCP server, an AI agent, a database, or anything else.

2. **RUNTIME_IS_PLUGGABLE**: Docker, k8s, and Akash are adapters behind the same port. Swapping runtime is a config change, not a redesign.

3. **CLUSTER_WRAPS_RUNTIME**: `ClusterProvider` from node-launch composes `ContainerRuntimePort` calls. `applyManifests` deploys N containers. `createSecret` injects env vars. The provisioning workflow doesn't call the runtime directly.

4. **TOOLHIVE_FOR_MCP**: MCP server discovery, transport proxying, secrets, and health checks use ToolHive. For non-MCP containers, ToolHive is bypassed.

5. **SDL_IS_ADAPTER_INTERNAL**: Akash SDL generation is inside the Akash adapter. Not a port, not a package, not a public API.

## Design

### Layer Architecture

```
┌──────────────────────────────────────────────────────┐
│  LAYER 4: ORCHESTRATION                              │
│  LangGraph crew-orchestrator graph                   │
│  NL → list of WorkloadSpec (image, env, ports)       │
│  Calls Layer 3 for MCP servers, Layer 2 for agents   │
└──────────────────┬───────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────┐
│  LAYER 3: MCP LIFECYCLE (ToolHive)                   │
│  Registry, transport proxy, secrets, health, RBAC    │
│  OSS dependency — not our code                       │
│  Pass-through for non-MCP containers                 │
└──────────────────┬───────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────┐
│  LAYER 2: CONTAINER RUNTIME (our port)               │
│  ContainerRuntimePort                                │
│    deploy(spec) → WorkloadInfo                       │
│    stop(id) → void                                   │
│    list() → WorkloadInfo[]                           │
│    status(id) → WorkloadStatus                       │
│  Adapters: Docker, K8s, Akash                        │
└──────────────────┬───────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────┐
│  LAYER 1: INFRASTRUCTURE                             │
│  Docker daemon, k8s API, Akash provider network      │
│  External systems — not our code                     │
└──────────────────────────────────────────────────────┘
```

### ClusterProvider wraps ContainerRuntimePort

```
provisionNode workflow (from node-launch spec)
  → ClusterProvider.ensureCluster(env)
  → ClusterProvider.createNamespace(conn, name)
  → ClusterProvider.applyManifests(conn, path)
      → ContainerRuntimePort.deploy(container1)
      → ContainerRuntimePort.deploy(container2)
      → ContainerRuntimePort.deploy(containerN)
  → ClusterProvider.createSecret(conn, ns, data)
      → ContainerRuntimePort.deploy() with env injection
```

### ContainerRuntimePort

```typescript
interface ContainerRuntimePort {
  deploy(spec: WorkloadSpec): Promise<WorkloadInfo>;
  stop(id: string): Promise<void>;
  list(): Promise<WorkloadInfo[]>;
  status(id: string): Promise<WorkloadStatus>;
}

interface WorkloadSpec {
  name: string; // DNS-safe identifier
  image: string; // container image ref
  env: Record<string, string>; // environment variables
  ports: PortMapping[]; // container→host mappings
  resources: ResourceLimits; // cpu, memory, storage
  connectsTo: string[]; // service names for internal networking
}

interface PortMapping {
  container: number; // port inside container
  host?: number; // port on host (auto-assigned if omitted)
  expose: boolean; // expose externally
}

interface ResourceLimits {
  cpu: number; // CPU units (e.g., 0.5)
  memory: string; // e.g., "512Mi"
  storage: string; // e.g., "1Gi"
}

interface WorkloadInfo {
  id: string; // runtime-specific ID
  name: string;
  status: WorkloadStatus;
  endpoints: Record<string, string>; // port name → URL
  startedAt: string;
}

type WorkloadStatus = "pending" | "running" | "stopped" | "failed";
```

### Adapters

**DockerAdapter** — Calls Docker Engine API via `dockerode` or HTTP. For local dev. Maps `deploy()` to `docker run`, `stop()` to `docker stop`, etc. Networking via Docker bridge. This is what ToolHive uses under the hood for its Docker runtime.

**K8sAdapter** — Creates k8s Deployment + Service + optional Ingress. For shared cluster (Cherry k3s). When deploying MCP servers, delegates to ToolHive's k8s operator. For non-MCP containers, creates raw k8s resources.

**AkashAdapter** — Translates `WorkloadSpec[]` → Akash SDL, submits via `@akashnetwork/akashjs`. Handles bid selection, lease creation, manifest sending. SDL generation is internal to this adapter.

**MockAdapter** — In-memory Map. For unit tests and API shape validation.

### ToolHive Integration

ToolHive sits at Layer 3. Two integration modes:

**Local dev (v0):** `thv serve` runs alongside our service. Orchestrator calls ToolHive REST API (`POST /api/workloads`) for MCP servers. ToolHive uses Docker underneath. Non-MCP containers deploy via `ContainerRuntimePort` directly with DockerAdapter.

**k8s (P1):** ToolHive operator runs in cluster. Orchestrator creates `MCPServer` CRDs for MCP servers. ToolHive operator handles lifecycle. Non-MCP containers deploy via K8sAdapter.

**Akash (P1+):** Evaluate contributing Akash runtime to ToolHive (`pkg/container/runtime/akash/`). If viable, `thv run --runtime akash` deploys MCP servers to Akash natively. If not, our AkashAdapter handles all containers and we bypass ToolHive for Akash deployments.

### Component Map (v0)

```
services/akash-deployer/
  ├── src/
  │   ├── runtime/
  │   │   ├── container-runtime.port.ts    ContainerRuntimePort interface
  │   │   ├── mock.adapter.ts              In-memory mock
  │   │   └── docker.adapter.ts            Docker Engine API (stretch goal)
  │   ├── sdl/
  │   │   └── sdl-generator.ts             Pure fn for Akash adapter (internal)
  │   ├── routes/
  │   │   ├── deploy.ts                    HTTP handlers
  │   │   └── health.ts                    /livez, /readyz
  │   ├── config/env.ts
  │   └── main.ts
  └── tests/
```

## Acceptance Checks

1. `ContainerRuntimePort` interface defined with deploy/stop/list/status
2. MockAdapter passes full lifecycle test (deploy→status→stop)
3. HTTP API accepts WorkloadSpec[], deploys via runtime port
4. SDL generator produces valid YAML from WorkloadSpec[] (unit tested)
5. Service starts, health endpoints respond, deploy lifecycle works e2e
6. `pnpm check` — all checks green
7. No MCP vs agent distinction in the runtime port

## Open Questions

1. **ToolHive Akash runtime**: Is the Go runtime interface clean enough for a community Akash adapter contribution? Needs source review.
2. **Docker adapter in v0 or P1**: Should v0 ship with real Docker deployment, or is mock sufficient to prove the architecture?
3. **ToolHive API stability**: `thv serve` API is undocumented beyond OpenAPI spec. Is it stable enough to depend on?

## Dependencies

- node-launch spec (ClusterProvider interface)
- task.0149 (k3s + ArgoCD foundation)
- ToolHive (`brew install thv` for local dev)
- @akashnetwork/akashjs (P1, for AkashAdapter)
- dockerode or Docker Engine API (for DockerAdapter)

## Related

- [Node Launch Spec](./node-launch.md) — ClusterProvider interface
- [ToolHive Docs](https://docs.stacklok.com/toolhive/) — MCP lifecycle
- [ToolHive Runtime Interface](https://github.com/stacklok/toolhive/blob/main/pkg/container/runtime/types.go) — Go runtime port
- [Akash Crew Deploy Project](../../work/projects/proj.akash-crew-deploy.md)
