---
id: task.0162
type: task
primary_charter:
title: "Redis 7 infrastructure: docker-compose, ioredis dependency, env config"
state: Active
status: needs_implement
priority: 0
rank: 1
estimate: 1
summary: Add Redis 7 to the runtime docker-compose stack, add ioredis as a dependency, and wire environment config for connection
outcome: Redis 7 available in dev/test/prod stacks; app can connect via ioredis; health check passing
assignees: []
project: proj.unified-graph-launch
created: 2026-03-12
updated: 2026-03-12
labels:
  - ai-graphs
  - infra
branch: claude/unified-graph-launch-mmXvl
---

# Redis 7 Infrastructure

## Design

### Outcome

Redis 7 is available as a service in all runtime stacks (dev, test, prod). The app can connect via `ioredis`. This is the foundational infra task for the Redis Streams streaming plane.

### Approach

**Solution**: Add Redis 7 service to docker-compose, add `ioredis` dependency to `apps/web`, wire `REDIS_URL` env var through compose + app config.

**Reuses**: Existing docker-compose patterns (healthcheck, network, named volumes). Existing env var passthrough pattern.

**Rejected**: Redis Cluster/Sentinel — unnecessary at current scale. Valkey — Redis 7 is more mature and widely documented.

### Invariants

- [ ] REDIS_IS_EPHEMERAL: Redis holds only transient stream data. No durable state in Redis. (spec: unified-graph-launch)
- [ ] ARCHITECTURE_ALIGNMENT: Redis service on `internal` network only (same as postgres, litellm)
- [ ] SIMPLE_SOLUTION: Standalone Redis 7, no cluster/sentinel complexity

### Files

- Modify: `infra/compose/runtime/docker-compose.yml` — add `redis` service with healthcheck
- Modify: `infra/compose/runtime/docker-compose.dev.yml` — add Redis port exposure for local dev
- Modify: `apps/web/package.json` — add `ioredis` dependency
- Modify: `apps/web/src/bootstrap/container.ts` — add Redis client to DI container (lazy)
- Create: `apps/web/src/adapters/server/redis/connection.ts` — Redis connection factory
- Modify: docker-compose env sections — add `REDIS_URL` passthrough
- Modify: `.env.example` — add `REDIS_URL` with default

## Validation

**Command:**

```bash
pnpm check
docker compose -f infra/compose/runtime/docker-compose.yml config --quiet
```

**Expected:** All lint, type, format checks pass. Docker compose config validates without errors. Redis healthcheck passes in `pnpm dev:stack`.

### Notes

- Redis data volume is NOT needed — ephemeral by design. Use `--save ""` to disable RDB persistence.
- Memory limit: 128MB is sufficient for stream data. Set `maxmemory 128mb` + `maxmemory-policy noeviction`.
- The app service should `depends_on: redis: condition: service_healthy`.
