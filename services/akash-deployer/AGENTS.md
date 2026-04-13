# akash-deployer · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

HTTP service for deploying containerized workloads via `ContainerRuntimePort`. The port is container-agnostic — it deploys images without knowing what's inside them. v0 uses a mock adapter. P1 targets Docker, ToolHive (MCP servers), and Akash Network.

## Pointers

- [Akash Deploy Service Spec](../../docs/spec/akash-deploy-service.md): 4-layer architecture
- [README](./README.md): Quick start, API reference, curl examples

## Boundaries

```json
{
  "layer": "services",
  "may_import": ["packages", "services"],
  "must_not_import": ["app", "features", "ports", "core", "adapters", "shared"]
}
```

## Public Surface

- **Exports:** none (standalone service)
- **Routes:** `/livez` [GET], `/readyz` [GET], `/api/v1/deploy` [POST], `/api/v1/deployments/:id` [GET, DELETE], `/api/v1/workloads` [GET]
- **Env/Config keys:** `PORT`, `HOST`, `LOG_LEVEL`, `INTERNAL_OPS_TOKEN`

## Responsibilities

- This directory **does**: Deploy container workloads via `ContainerRuntimePort`, serve health endpoints, manage deployment lifecycle (deploy/status/stop/list)
- This directory **does not**: Distinguish MCP servers from agents, manage wallets, store persistent state

## Notes

- `ContainerRuntimePort` will move to a shared package when `provisionNode` (task.0202) needs it
- Crew orchestrator graph in `packages/langgraph-graphs` is unwired — no endpoint calls it yet
