---
id: task.0014
type: task
title: "VM watchdog: autoheal + HEALTHCHECK on /livez with resource limits"
status: done
priority: 0
estimate: 2
summary: Switch Docker HEALTHCHECK from /readyz to /livez, add hardened autoheal sidecar to auto-restart unhealthy containers, add mem_limit/memswap_limit to app
outcome: App container auto-recovers from hangs within 60-90s; restart events visible in Loki; memory growth bounded
spec_refs: vm-watchdog, spec.observability-requirements
assignees: derekg1729
credit:
project: proj.reliability
branch: feat/vm-watchdog-task0014
pr:
reviewer:
created: 2026-02-10
updated: 2026-02-10
labels: [infra, reliability, P0]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 11
---

# VM watchdog: autoheal + HEALTHCHECK on /livez with resource limits

## Context

Feb 7-8, 2026: Two multi-hour outages with zero auto-recovery. The app was "healthy but hung" — OTel `spawnSync` blocked the event loop. Docker `restart: always` only fires on process exit, not on event-loop hangs. See [postmortem](../../docs/postmortems/2026-02-07-production-vm-loss.md).

See [vm-watchdog spec](../../docs/spec/vm-watchdog.md) for full design, invariants, and rationale.

## Requirements

- Switch Dockerfile HEALTHCHECK from `/readyz` to `/livez` (WATCHDOG_LIVEZ_NOT_READYZ)
  - `/livez` is dependency-free — won't false-positive during deploys/migrations
  - Tuning: interval=10s, timeout=5s, start_period=30s, retries=3
- Add HEALTHCHECK override in docker-compose.yml `app` service (same params as Dockerfile)
- Add `autoheal` service to docker-compose.yml (WATCHDOG_AUTOHEAL_HARDENED):
  - Image: `willfarrell/autoheal` pinned by digest
  - `network_mode: "none"`, `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`
  - Label `autoheal: "false"` on itself (WATCHDOG_AUTOHEAL_NO_SELF)
  - Polls every 5s, start_period 60s
  - Docker socket mounted read-only
- Add `autoheal: "true"` label to `app` service (WATCHDOG_LABEL_GATE)
- Add `mem_limit: 512m` and `memswap_limit: 768m` to `app` service (WATCHDOG_MEM_BOUNDED)
- Autoheal logs flow to Loki via Alloy automatically (WATCHDOG_LOGS_TO_LOKI — no config change needed, Alloy scrapes all Docker logs)
- Recovery within ~60-90s of livez failure (WATCHDOG_RECOVERY_BOUND)

## Allowed Changes

- `Dockerfile` — change HEALTHCHECK from `/readyz` to `/livez`, adjust timeout/start_period
- `platform/infra/services/runtime/docker-compose.yml` — add autoheal service, add app labels + mem_limit + HEALTHCHECK override
- `platform/infra/services/runtime/docker-compose.dev.yml` — add matching HEALTHCHECK override + autoheal for dev parity (if applicable)

## Plan

- [x] Resolve `willfarrell/autoheal` digest pin
  - `sha256:babbdf5d586b8e2708db827893a228e542b7cbd3b61ee698ba172a67b725c7dd`
- [x] Update `Dockerfile` HEALTHCHECK
  - Change `/readyz` to `/livez`
  - Adjust: `--timeout=5s --start-period=30s`
- [x] Update `docker-compose.yml` — app service
  - Add HEALTHCHECK override (same as Dockerfile, ensures compose-level consistency)
  - Add label `autoheal: "true"`
  - Add `mem_limit: 512m`
  - Add `memswap_limit: 768m`
- [x] Update `docker-compose.yml` — add autoheal service
  - Digest-pinned image
  - `restart: always`
  - `network_mode: "none"`, `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`
  - Environment: `AUTOHEAL_CONTAINER_LABEL=autoheal`, `AUTOHEAL_INTERVAL=5`, `AUTOHEAL_START_PERIOD=60`, `AUTOHEAL_DEFAULT_STOP_TIMEOUT=10`
  - Volume: `/var/run/docker.sock:/var/run/docker.sock:ro`
  - Label: `autoheal: "false"`
- [x] Verify dev compose parity — HEALTHCHECK + autoheal added to `docker-compose.dev.yml` (no mem_limit for dev)

## Validation

**Automated (CI):**

```bash
# Dockerfile HEALTHCHECK uses livez
grep '/livez' Dockerfile

# Autoheal service in compose
grep 'autoheal' platform/infra/services/runtime/docker-compose.yml

# App has mem_limit
grep 'mem_limit' platform/infra/services/runtime/docker-compose.yml

# App has autoheal label
grep 'autoheal.*true' platform/infra/services/runtime/docker-compose.yml

# CI gate
pnpm check
```

**Manual (on VM after deploy):**

```bash
# Autoheal is running
docker ps --filter name=autoheal --format '{{.Status}}'

# App health is passing
docker inspect --format='{{.State.Health.Status}}' cogni-runtime-app-1

# Simulate hang: pause app, wait ~60-90s, check restart
docker pause cogni-runtime-app-1
docker events --filter event=health_status --filter event=restart --since 2m
# Verify in Loki: {service="autoheal"} |= "Restarting"

# Memory limit enforced
docker stats --no-stream cogni-runtime-app-1 --format '{{.MemUsage}}'
```

## Review Checklist

- [ ] **Work Item:** `task.0014` linked in PR body
- [ ] **Spec:** all vm-watchdog invariants upheld (WATCHDOG_LIVEZ_NOT_READYZ, WATCHDOG_RECOVERY_BOUND, WATCHDOG_LABEL_GATE, WATCHDOG_AUTOHEAL_HARDENED, WATCHDOG_AUTOHEAL_NO_SELF, WATCHDOG_MEM_BOUNDED, WATCHDOG_LOGS_TO_LOKI)
- [ ] **Tests:** HEALTHCHECK endpoint verified; manual autoheal restart test on VM
- [ ] **Reviewer:** assigned and approved

## PR / Links

- [vm-watchdog spec](../../docs/spec/vm-watchdog.md)
- [Postmortem: Feb 7-8 outages](../../docs/postmortems/2026-02-07-production-vm-loss.md)
- [proj.reliability](../projects/proj.reliability.md)
- [spec.observability-requirements](../../docs/spec/observability-requirements.md)

## Attribution

-
