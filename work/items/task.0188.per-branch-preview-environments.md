---
id: task.0188
type: task
title: "Preview Controller — imperative preview deployments for AI agent e2e testing"
status: needs_design
priority: 1
rank: 3
estimate: 5
summary: "Preview Controller service (HTTP API) + DockerAdapter (ContainerRuntimePort) + Caddy dynamic routing. Agents POST /deploy → get URL in 90s → run tests → DELETE. Hard-capped at 3 concurrent on preview VM. Shared infra (PG, Temporal, LiteLLM) over network; only thin app workload per-preview."
outcome: "AI agent or CI calls POST /api/v1/previews → gets https://{slug}.preview.cognidao.org URL within 90s → runs stack tests against it → DELETE tears down. Max 3 concurrent previews, 48h TTL, automatic cleanup."
spec_refs:
  - spec.preview-deployments
assignees: []
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 1
blocked_by: task.0247
deploy_verified: false
created: 2026-03-19
updated: 2026-04-03
labels: [deployment, infra, preview, dx, container-runtime]
external_refs:
---

# Preview Controller — Imperative Preview Deployments

## Problem

AI coding agents and CI need to validate code changes against a running stack. Today there's no way to get a live preview URL from a feature branch — only static tests in CI. The previous design (Argo CD ApplicationSet with pullRequest generator) is wrong: Argo polls git at 3-minute intervals, requires git commits for state changes, and has no imperative API for agents.

## Design

See [preview-deployments spec](../../docs/spec/preview-deployments.md) for architecture, data flow, and invariants.

## Deliverables

### Phase 1: DockerAdapter (the easy part)

1. **DockerAdapter** — implements `ContainerRuntimePort` using Docker Engine API (dockerode). Maps groups to Docker networks, workloads to containers, uses labels for durable state.
2. **Unit tests** — test adapter against real Docker socket.

### Phase 2: Preview Controller orchestration (the hard part)

3. **DB lifecycle** — CREATE DATABASE on shared Postgres (via DATABASE_ROOT_URL), run migrator as transient workload (wait for exit 0), DROP on teardown with forced disconnects.
4. **Migration ordering** — Migrator must complete before app starts. Migrator failure = abort preview, don't start app.
5. **Cleanup** — Orphaned containers (controller crash mid-deploy), leaked databases (teardown failed), expired TTLs (cron reaper).
6. **Quotas** — Hard cap 3 concurrent previews. 429 when at capacity. Track in-memory + reconstruct from Docker labels on restart.
7. **Caddy routing** — Admin API calls to add/remove routes. Error recovery: roll back containers + DB if route add fails.
8. **Health polling** — Poll /readyz with timeout. If app never becomes healthy, tear down and report failure.

### Phase 3: Integration

9. **CI step** — Add to staging-preview.yml: call preview controller after image push, run stack tests against preview URL, post URL as PR comment.
10. **Wildcard DNS** — One-time: `*.preview.cognidao.org` A record → preview VM IP.
11. **Caddy TLS** — Add wildcard block with on-demand TLS to Caddyfile.

## Validation

- [ ] POST /api/v1/previews → returns URL within 90 seconds
- [ ] Preview URL accessible and returns healthy /readyz response
- [ ] Stack tests pass when run against preview URL (APP_BASE_URL=$url pnpm test:stack:dev)
- [ ] DELETE /api/v1/previews/:id → containers stopped, network removed, database dropped
- [ ] 4th concurrent preview rejected with 429
- [ ] TTL expiry triggers automatic teardown
- [ ] Controller restart reconstructs state from Docker labels (no orphans)

## Depends On

- task.0247 (merged infra/ reorg + container-runtime package available)

## Does NOT Depend On

- task.0149 (k3s) — previews run on Docker, not k8s
- Akash — DockerAdapter is the first adapter; Akash is a future swap
