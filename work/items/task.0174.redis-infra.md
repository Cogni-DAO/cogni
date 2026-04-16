---
id: task.0174
type: task
primary_charter:
title: "Redis 7 infrastructure: docker-compose, ioredis dependency, env config"
state: Done
status: done
priority: 0
rank: 1
estimate: 1
summary: Add Redis 7 to the runtime docker-compose stack, add ioredis as a dependency, and wire environment config for connection
outcome: Redis 7 available in all runtime stacks; ioredis installed; REDIS_URL wired as optional env var with default
assignees: []
project: proj.unified-graph-launch
created: 2026-03-12
updated: 2026-03-13
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

**Solution**: Add Redis 7 service to docker-compose, add `ioredis` dependency to `apps/operator`, wire `REDIS_URL` env var through compose + app config.

**Reuses**: Existing docker-compose patterns (healthcheck, network, named volumes). Existing env var passthrough pattern.

**Rejected**: Redis Cluster/Sentinel — unnecessary at current scale. Valkey — Redis 7 is more mature and widely documented.

### Invariants

Per spec [unified-graph-launch.md §7](../../docs/spec/unified-graph-launch.md): `REDIS_IS_STREAM_PLANE` — Redis holds only ephemeral stream data. PostgreSQL is durable truth.

### Files

- Modify: `infra/compose/runtime/docker-compose.yml` — add `redis` service with healthcheck, `internal` network, `depends_on` from app
- Modify: `infra/compose/runtime/docker-compose.dev.yml` — add Redis port exposure for local dev (both dev and test stacks use this file)
- Modify: `apps/operator/package.json` — add `ioredis` dependency (ships its own types; no `@types/ioredis`)
- Modify: `apps/operator/src/shared/env/server-env.ts` — add `REDIS_URL` as optional with default `redis://localhost:6379`
- Modify: `.env.local.example` — document `REDIS_URL`
- Modify: docker-compose env sections — add `REDIS_URL` passthrough

**Not in scope** (deferred to task.0175): connection factory, container.ts registration. No consumer exists in this task — wiring happens when `RedisRunStreamAdapter` lands.

## Plan

- [ ] **Checkpoint 1: Docker Compose**
  - Milestone: Redis 7 service defined in both compose files
  - Invariants: REDIS_IS_STREAM_PLANE (ephemeral, no volume)
  - Todos:
    - [ ] Add `redis` service to `docker-compose.yml` (healthcheck, internal network, no volume, `--save ""`)
    - [ ] Add `redis` depends_on to `app` service in `docker-compose.yml`
    - [ ] Add `REDIS_URL` passthrough to `app` environment in `docker-compose.yml`
    - [ ] Add `redis` service to `docker-compose.dev.yml` with port 6379 exposed
    - [ ] Add `redis` depends_on to `app` service in `docker-compose.dev.yml`
    - [ ] Add `REDIS_URL` passthrough to `app` environment in `docker-compose.dev.yml`
  - Validation: `docker compose -f ... config --quiet` passes for both files

- [ ] **Checkpoint 2: ioredis + env config**
  - Milestone: ioredis installed, REDIS_URL in server-env.ts and .env.local.example
  - Todos:
    - [ ] Add `ioredis` to `apps/operator/package.json`
    - [ ] Add `REDIS_URL` optional field to `serverSchema` in `server-env.ts`
    - [ ] Document `REDIS_URL` in `.env.local.example`
  - Validation: `pnpm check` passes

## Validation

**Command:**

```bash
pnpm check
docker compose -f infra/compose/runtime/docker-compose.yml config --quiet
docker compose -f infra/compose/runtime/docker-compose.dev.yml config --quiet
```

**Expected:** All lint, type, format checks pass. Both compose configs validate. Redis healthcheck passes in `pnpm dev:stack`.

### Notes

- Redis data volume is NOT needed — ephemeral by design. Use `--save ""` to disable RDB persistence.
- Memory limit: 128MB is sufficient for stream data. Set `maxmemory 128mb` + `maxmemory-policy noeviction`.
- The app service should `depends_on: redis: condition: service_healthy`.
- `REDIS_URL` is optional so unit tests and `pnpm check` work without Redis running.
