# Akash Deployer Service

> Deploy containerized workloads into isolated groups via `ContainerRuntimePort`.
> v0: mock runtime. P1: Docker, ToolHive (MCP), Akash.

## Start

```bash
pnpm --filter @cogni/akash-deployer-service dev   # :9100
```

## Deploy

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
        "ports": [{"container": 8080, "expose": true}]
      }
    ]
  }'
```

Creates an isolated group. Workloads inside it can reach each other by name (`http://mcp-github:3101`). Only workloads with `expose: true` get external endpoints.

## API

| Method | Path                 | Description                      |
| ------ | -------------------- | -------------------------------- |
| GET    | `/livez`             | Liveness probe                   |
| GET    | `/readyz`            | Readiness probe                  |
| POST   | `/api/v1/deploy`     | Create group + deploy workloads  |
| GET    | `/api/v1/groups/:id` | Get group with workload statuses |
| DELETE | `/api/v1/groups/:id` | Destroy group and all workloads  |
| GET    | `/api/v1/groups`     | List all groups                  |

## WorkloadSpec

| Field       | Type                            | Default         | Required |
| ----------- | ------------------------------- | --------------- | -------- |
| `name`      | string                          | —               | yes      |
| `image`     | string                          | —               | yes      |
| `env`       | `Record<string,string>`         | `{}`            | no       |
| `ports`     | `[{container, host?, expose?}]` | `[]`            | no       |
| `resources` | `{cpu, memory, storage}`        | `0.5/512Mi/1Gi` | no       |

## Isolation Model

- **Group** = isolation boundary (k8s namespace / Akash SDL deployment / Docker network)
- Workloads in a group share internal DNS — reach each other by name
- Cross-group access denied by default
- External access only via `expose: true` ports

## Auth

Set `INTERNAL_OPS_TOKEN` env var. All `/api/*` routes require `Authorization: Bearer <token>`.

## Tests

```bash
pnpm --filter @cogni/akash-deployer-service test   # 10 smoke tests
```
