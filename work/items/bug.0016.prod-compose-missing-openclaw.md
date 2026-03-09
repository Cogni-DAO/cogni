---
id: bug.0016
type: bug
title: Production compose missing OpenClaw services — --profile sandbox-openclaw is silent no-op
status: done
priority: 0
estimate: 2
summary: OpenClaw services (llm-proxy-openclaw, openclaw-gateway) and sandbox-internal network only exist in docker-compose.dev.yml. deploy.sh --profile sandbox-openclaw flags silently do nothing.
outcome: OpenClaw services run in preview and production via --profile sandbox-openclaw in the CD compose
spec_refs: openclaw-sandbox-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch: docs/postmortem-skill-and-disk-exhaustion
pr:
reviewer:
created: 2026-02-10
updated: 2026-02-10
labels: [openclaw, deploy, infra]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Production compose missing OpenClaw services — --profile sandbox-openclaw is silent no-op

## Requirements

### Observed

- `platform/infra/services/runtime/docker-compose.yml` has no OpenClaw services or `sandbox-internal` network
- `platform/infra/services/runtime/docker-compose.dev.yml` lines 438-543 have `llm-proxy-openclaw`, `openclaw-gateway`, and `sandbox-internal` network
- `deploy.sh` lines 684, 696, 726 pass `--profile sandbox-openclaw` but compose silently ignores profiles for services that don't exist in the active file
- `litellm` service in production compose is only on `internal` network — needs `sandbox-internal` too for the OpenClaw proxy to reach it

### Expected

- `docker-compose.yml` should contain the same OpenClaw services (adapted for VM paths)
- `litellm` should be on both `internal` and `sandbox-internal` networks
- `sandbox-internal` network should be defined in production compose
- deploy.sh should rsync OpenClaw config files to VM

### Reproduction

SSH to preview/production VM, run `docker compose --profile sandbox-openclaw ps` — no OpenClaw containers running despite deploy.sh passing the profile flag.

### Impact

OpenClaw gateway never started in any deployed environment. Sandbox agent capability unavailable to users. Deployment reported success despite a required service being completely absent — no health/readyz verification for OpenClaw in the deploy pipeline.

## Allowed Changes

- `platform/infra/services/runtime/docker-compose.yml` — add OpenClaw services, sandbox-internal network, litellm network membership
- `platform/ci/scripts/deploy.sh` — add rsync for sandbox-proxy and openclaw config files, add post-deploy health check for OpenClaw
- `docs/guides/create-service.md` — add "critical service" checklist step for deploy health verification

## Plan

- [ ] Add `sandbox-internal` network (internal: true) to docker-compose.yml networks section
- [ ] Add `sandbox-internal` to litellm service networks
- [ ] Add `llm-proxy-openclaw` service (nginx:alpine, profile sandbox-openclaw) — adapted from dev compose with VM-relative volume paths (`./sandbox-proxy/...`)
- [ ] Add `openclaw-gateway` service (openclaw-outbound-headers:latest, profile sandbox-openclaw) — adapted with VM-relative paths (`./openclaw/...`)
- [ ] Add rsync in deploy.sh to upload `platform/infra/services/sandbox-proxy/` to VM
- [ ] Add scp in deploy.sh to upload `services/sandbox-openclaw/openclaw-gateway.json` to VM
- [ ] Add post-deploy health check for openclaw-gateway in deploy.sh (curl readyz/healthcheck, fail deployment if critical service doesn't come healthy)
- [ ] Update `docs/guides/create-service.md` new-service checklist: add step to decide if the service is deployment-critical, and if so, add a required health/readyz verification to deploy.sh that fails the deploy when the service is unhealthy

## Validation

**Command:**

```bash
# Verify services exist in compose
grep -c "llm-proxy-openclaw\|openclaw-gateway\|sandbox-internal" platform/infra/services/runtime/docker-compose.yml
```

**Expected:** At least 3 matches (both services + network defined).

## Review Checklist

- [ ] **Work Item:** `bug.0016` linked in PR body
- [ ] **Spec:** openclaw-sandbox-spec invariants upheld
- [ ] **Tests:** deploy to preview starts OpenClaw containers
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Postmortem: `docs/postmortems/pm.preview-disk-exhaustion.2026-02-10.md`

## Attribution

-
