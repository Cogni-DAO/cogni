---
id: task.0281.handoff
type: handoff
work_item_id: task.0281
status: active
created: 2026-04-04
updated: 2026-04-04
branch: feat/task-0281-node-streams-pkg
last_commit: 89af9d888
---

# Handoff: Node Data Stream Standardization (Phase 1)

## Context

- Every node needs standardized, real-time data streams for AI oversight + human dashboards
- Poly has a proven 3-tier pattern (External → Redis → Postgres) but it's poly-specific
- The deployment matrix (PR #714, `feat/deploy-matrix` → canary) uses naive HTTP polling — this task replaces its data layer with Redis Streams + SSE
- This is Phase 1 of 3: package creation + operator wiring. Phase 2 = poly/attribution, Phase 3 = AI tools
- Integration branch `integration/node-data-streams` off canary; sub-branch `feat/task-0281-node-streams-pkg` for this PR

## Current State

- **Done**: Checkpoint 1 — `@cogni/node-streams` package builds and exports:
  - `NodeStreamPort` interface (publish/subscribe/streamLength)
  - `RedisNodeStreamAdapter` (XADD/XRANGE/XREAD with cursor replay + BLOCK)
  - `encodeSSE()` (AsyncIterable → SSE ReadableStream)
  - `NodeEvent` union type (health | ci_status | deploy)
  - Package registered in root tsconfig, `pnpm packages:build` passes
- **Not done**: Checkpoints 2-4 (tests, SSE route, deployment matrix migration)
- **Not done**: `pnpm check` not verified post-checkpoint-1 (only typecheck + build confirmed)
- **Separate**: PR #714 (`feat/deploy-matrix`) has 3 reusable observability adapters (health-probe, loki-query-client, github-actions-client) in `nodes/operator/app/src/adapters/server/observability/` — these become the source adapters for the stream

## Decisions Made

- `NodeStreamPort` is distinct from `RunStreamPort` — different lifecycle (continuous vs terminal). See [design review discussion in task.0281](../items/task.0281.node-data-stream-standardization.md)
- No graceful degradation for Redis — if Redis is down, the node is degraded anyway
- Phase 1 keeps the deployment matrix facade's polling and publishes results to Redis (simpler than moving to Temporal immediately). Temporal migration deferred to Phase 2
- Hardcoded topology (test.cognidao.org, preview.cognidao.org, cognidao.org) — acceptable for v1

## Next Actions

- [ ] Checkpoint 2: Write port contract tests (`packages/node-streams/tests/`) — publish → subscribe → receive using ioredis-mock or real Redis
- [ ] Checkpoint 3: Create SSE route at `nodes/node-template/app/src/app/api/v1/node/stream/route.ts` — follows pattern from `runs/[runId]/stream/route.ts`
- [ ] Checkpoint 4: Wire deployment matrix facade (`nodes/operator/app/src/app/_facades/deployments/matrix.server.ts`) to publish poll results to Redis via `NodeStreamPort`, and update view to consume SSE instead of React Query polling
- [ ] Run `pnpm check` at each checkpoint
- [ ] Create PR to `integration/node-data-streams` when all checkpoints pass
- [ ] E2E validation: `curl -N localhost:3000/api/v1/node/stream` returns `event: health\ndata: {...}\n\n`

## Risks / Gotchas

- PR #714's observability adapters are on `feat/deploy-matrix` branch (targeting canary). They need to be available on this branch too — either cherry-pick or merge PR #714 first
- The SSE route in node-template uses `wrapRouteHandlerWithLogging` and `getContainer()` — new route must follow the same pattern but wire `NodeStreamPort` into the container
- `ioredis` type import in the package uses `import type Redis from "ioredis"` — at runtime the app provides the Redis instance via constructor injection
- Canary k8s environment has Redis available (`REDIS_URL` env var). Local dev requires `pnpm dev:infra` for Redis

## Pointers

| File / Resource | Why it matters |
|---|---|
| `packages/node-streams/src/` | The new package — port, adapter, SSE encoder, event types |
| `packages/graph-execution-core/src/run-stream.port.ts` | Reference pattern (similar but terminal lifecycle) |
| `nodes/node-template/app/src/adapters/server/ai/redis-run-stream.adapter.ts` | Redis adapter reference implementation |
| `nodes/node-template/app/src/app/api/v1/ai/runs/[runId]/stream/route.ts` | SSE endpoint reference (auth, Last-Event-ID, ReadableStream) |
| `nodes/operator/app/src/adapters/server/observability/` | Health probe, Loki client, GitHub Actions client (from PR #714) |
| `nodes/operator/app/src/app/_facades/deployments/matrix.server.ts` | Deployment matrix facade to migrate (from PR #714) |
| `docs/spec/data-streams.md` | 3-tier architecture spec (poly-specific, to be generalized) |
| `work/items/task.0281.node-data-stream-standardization.md` | Work item with full design, invariants, validation criteria |
| `work/items/task.0282.node-streams-poly-attribution.md` | Phase 2 work item |
| `work/items/task.0283.node-streams-ai-oversight.md` | Phase 3 work item |
