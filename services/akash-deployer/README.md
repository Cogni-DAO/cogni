# Akash Deployer Service

> Deploy containerized workloads via `ContainerRuntimePort`.
> v0: mock runtime. P1: Docker, ToolHive (MCP), Akash.

## Start

```bash
pnpm --filter @cogni/akash-deployer-service dev   # :9100
```

## Health

```bash
curl localhost:9100/livez    # {"status":"ok"}
curl localhost:9100/readyz   # {"status":"ok","checks":{"deployer":"mock"}}
```

## Deploy Workloads

```bash
curl -X POST localhost:9100/api/v1/deploy \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "research-crew",
    "workloads": [
      {
        "name": "mcp-github",
        "image": "ghcr.io/modelcontextprotocol/server-github:latest",
        "ports": [{"container": 3101}],
        "env": {"GITHUB_TOKEN": "ghp_xxx"}
      },
      {
        "name": "agent-research",
        "image": "ghcr.io/cogni-dao/openclaw:latest",
        "ports": [{"container": 8080, "expose": true}],
        "connectsTo": ["mcp-github"]
      }
    ]
  }'
```

Response:

```json
{
  "deploymentId": "deploy-1",
  "name": "research-crew",
  "status": "active",
  "workloads": [
    {
      "id": "mock-1",
      "name": "mcp-github",
      "status": "running",
      "endpoints": {}
    },
    {
      "id": "mock-2",
      "name": "agent-research",
      "status": "running",
      "endpoints": { "agent-research:8080": "http://localhost:10002" }
    }
  ]
}
```

## Query / Stop / List

```bash
curl localhost:9100/api/v1/deployments/deploy-1          # GET status
curl -X DELETE localhost:9100/api/v1/deployments/deploy-1 # stop all
curl localhost:9100/api/v1/workloads                      # list all
```

## WorkloadSpec

| Field        | Type                            | Default         | Required |
| ------------ | ------------------------------- | --------------- | -------- |
| `name`       | string                          | —               | yes      |
| `image`      | string                          | —               | yes      |
| `env`        | `Record<string,string>`         | `{}`            | no       |
| `ports`      | `[{container, host?, expose?}]` | `[]`            | no       |
| `resources`  | `{cpu, memory, storage}`        | `0.5/512Mi/1Gi` | no       |
| `connectsTo` | `string[]`                      | `[]`            | no       |

## Auth

Set `INTERNAL_OPS_TOKEN` env var. All `/api/*` routes require `Authorization: Bearer <token>`. Health endpoints are always public.

## Architecture

```
ContainerRuntimePort (the port — deploys images, doesn't care what's inside)
  ├── MockContainerRuntime   (v0 — in-memory)
  ├── DockerAdapter          (P1 — Docker Engine API)
  ├── ToolHive integration   (P1 — MCP servers via thv serve API)
  └── AkashAdapter           (P1 — @akashnetwork/akashjs SDK)

ClusterProvider (from node-launch spec — wraps runtime for namespace-level ops)
  └── applyManifests() calls runtime.deploy() for each container
```

## Tests

```bash
pnpm --filter @cogni/akash-deployer-service test   # 9 smoke tests
```
