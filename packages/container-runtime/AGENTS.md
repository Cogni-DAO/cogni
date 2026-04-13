# container-runtime · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Shared container runtime port — deploys images into isolated groups without knowing what's inside them. The universal deployment interface for Docker, k8s, and Akash adapters.

## Pointers

- [Akash Deploy Service Spec](../../docs/spec/akash-deploy-service.md): Layer 2 architecture
- [New Packages Guide](../../docs/guides/new-packages.md): Package checklist

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

## Public Surface

- **Exports:** `ContainerRuntimePort` (port interface), `GroupSpec`, `WorkloadSpec`, `GroupInfo`, `WorkloadInfo` (domain types), Zod schemas for validation
- **Subpath `./adapters/mock`:** `MockContainerRuntime` (in-memory, for testing)
- **Env/Config keys:** none (pure library)

## Responsibilities

- This directory **does**: Define the container deployment interface, domain types, Zod schemas, and a mock adapter
- This directory **does not**: Read env vars, start processes, make network calls, distinguish MCP from agents

## Notes

- Group = isolation boundary (k8s namespace, Akash SDL deployment, Docker network)
- Workloads in a group share internal networking and reach each other by name
- Cross-group access is denied by default
- `ClusterProvider` from node-launch wraps this port for namespace-level provisioning
