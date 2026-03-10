---
id: pm.preview-disk-exhaustion.2026-02-10
type: postmortem
title: "Preview VM Disk Exhaustion — Deploy Blocked at 100%"
status: active
trust: draft
severity: SEV2
duration: "~1 hour manual recovery"
services_affected: [preview deploy pipeline, all preview services]
summary: Preview VM hit 100% disk (39G/39G), blocking deploys. Cleanup logic ran after the pull that exhausted disk, and keep-last tag preserved images through prune. OpenClaw services were never wired into production compose, making --profile sandbox-openclaw a silent no-op.
read_when: Investigating deploy failures, disk space issues, or missing services in CD pipeline.
owner: derekg1729
created: 2026-02-10
verified: 2026-02-10
tags: [incident, deploy, disk, openclaw, cd]
---

# Postmortem: Preview VM Disk Exhaustion — Deploy Blocked at 100%

**Date**: 2026-02-10
**Severity**: SEV2
**Status**: Resolved — bug.0015 (disk cleanup ordering) and bug.0016 (production compose) both fixed
**Duration**: ~1 hour manual recovery

---

## Summary

The preview VM ran out of disk space (39G/39G, 100% full), blocking all deploys. The deploy script's disk cleanup (Step 5) runs _after_ the OpenClaw image pull (Step 3.5), so by the time cleanup triggers, the pull that would benefit from it has already failed. Additionally, the `keep-last` rollback tag preserves old app images through `docker system prune -af`, reducing prune effectiveness. Manual cleanup recovered 24GB (39G → 15G used). A second issue was discovered: OpenClaw compose services only exist in `docker-compose.dev.yml`, meaning the `--profile sandbox-openclaw` flags in `deploy.sh` are silent no-ops — OpenClaw was never running in preview or production.

---

## Timeline

| Time (approx, UTC)  | Event                                                                  | Source                 |
| ------------------- | ---------------------------------------------------------------------- | ---------------------- |
| 2026-02-10 ~morning | PR #358 merged (OpenClaw concurrent gateway mode)                      | GitHub                 |
| 2026-02-10 ~morning | Deploy to preview triggered                                            | GitHub Actions         |
| 2026-02-10          | `docker pull` at Step 3.5 fails — `ENOSPC` (no space left on device)   | deploy.sh stderr       |
| 2026-02-10          | Disk check: `df -h /` shows 39G/39G, 0 bytes available, 100% used      | Manual SSH             |
| 2026-02-10          | `docker system df` shows 23 images (33.1GB), 12.3GB reclaimable        | Manual SSH             |
| 2026-02-10          | `cogni-runtime:keep-last` tag found preserving old image through prune | Manual investigation   |
| 2026-02-10          | Manual cleanup: remove keep-last tag + orphan images + full prune      | Manual SSH             |
| 2026-02-10          | Disk recovered: 39G → 15G used (24GB reclaimed, 25GB free)             | `df -h /` post-cleanup |
| 2026-02-10          | SSH connection reset during cleanup (VM recovered)                     | Terminal output        |

---

## Root Cause

### What Happened

Two independent bugs combined to exhaust the 40GB preview VM disk:

**Bug 1: Disk cleanup ordering** (`deploy.sh:576-616`)

The deploy script pulls the OpenClaw gateway image at Step 3.5 (line 580-583), _before_ the disk space check at Step 5 (line 599-616). When the VM is near capacity, the OpenClaw pull pushes it to 100%, and the subsequent cleanup can't help because the pull already failed.

```
Step 3:   GHCR auth
Step 3.5: docker pull openclaw (FAILS — disk full)  ← pull happens HERE
Step 4:   Tag keep-last (preserves old image)
Step 5:   Check disk, prune if needed                ← cleanup happens HERE (too late)
Step 7:   docker compose pull                        ← never reached
```

**Bug 2: keep-last tag defeats prune** (`deploy.sh:585-596`)

Step 4 tags the running app image as `cogni-runtime:keep-last`. This gives the old image a local tag, which means `docker system prune -af` will NOT remove it (prune only removes untagged/dangling images). On a 40GB VM running ~10 service images, preserving even one extra ~1.5GB app image is significant.

**Bug 3: Production compose missing OpenClaw services** (`docker-compose.yml:333-352`)

The OpenClaw services (`llm-proxy-openclaw`, `openclaw-gateway`) and `sandbox-internal` network only exist in `docker-compose.dev.yml`. The production compose (`docker-compose.yml`) has no knowledge of these services. The `--profile sandbox-openclaw` flags in deploy.sh (lines 684, 696, 726) are silently ignored because compose profiles for non-existent services are no-ops. OpenClaw was never actually starting in any deployed environment.

### Contributing Factors

1. **Proximate cause**: 23 Docker images accumulating to 33.1GB on a 40GB disk
2. **Contributing factor**: Cleanup ordering — prune runs after the pull that needs the space
3. **Contributing factor**: `keep-last` tag pins ~1.5GB through prune cycles
4. **Systemic factor**: No disk space monitoring/alerting on VMs; deploy assumes cleanup will always free enough space

---

## Detection & Response

### What Worked

- Deploy script has a disk gate (Step 5) that fails fast when space is insufficient after cleanup
- `docker system df` clearly showed the problem — 33.1GB in images, 12.3GB reclaimable
- Manual cleanup was straightforward and recovered 24GB

### What Didn't Work

- No proactive alerting for disk approaching capacity
- Cleanup logic is reactive (runs when already failing) instead of preventive
- The keep-last preservation mechanism silently retained images that should have been pruned
- `--profile sandbox-openclaw` being a silent no-op was never detected — no validation that profile services actually exist in the compose file

---

## Impact

### Customer Impact

- Preview environment unavailable for deploys until manual cleanup
- OpenClaw gateway never running in preview or production (since PR #358 merged services into the wrong compose file) — no sandbox agent capability in deployed environments

### Technical Impact

- Deploy pipeline blocked — all preview deploys fail at image pull
- SSH connection reset during aggressive cleanup (VM briefly unresponsive under I/O pressure)
- Accumulated 12 stale image tags consuming 12.3GB unnecessarily

---

## Lessons Learned

### What Went Well

1. Docker system diagnostics (`df`, `system df`, `system prune`) were effective for manual recovery
2. The deploy script's disk gate prevented a partial deploy (fail-fast worked, just too late)

### What Went Wrong

1. Deploy script orders operations wrong — pull before cleanup
2. `keep-last` rollback mechanism conflicts with disk cleanup strategy
3. OpenClaw services added to dev compose only; production compose changes missed in PR #358
4. No CI validation that compose profiles reference actual services
5. Deploy reports success even when a required service (OpenClaw) is completely absent — no post-deploy health verification for critical services

### Where We Got Lucky

1. The issue hit preview first, not production
2. Manual SSH access was available for emergency cleanup
3. No data loss — only image cache needed clearing

---

## Action Items

| Pri | Action                                                                                                                                                                                                           | Owner      | Work Item |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| P0  | Fix deploy.sh: move disk cleanup before all pulls, remove keep-last tag                                                                                                                                          | derekg1729 | bug.0015  |
| P0  | Wire OpenClaw services + sandbox-internal network into production compose; add deploy health check for critical services; update create-service guide with "is this service deployment-critical?" checklist step | derekg1729 | bug.0016  |

---

## Related

- [Postmortem: Production VM Loss (2026-02-07)](./2026-02-07-production-vm-loss.md) — same VM, prior disk/infra incident
- [proj.openclaw-capabilities](../../work/projects/proj.openclaw-capabilities.md) — OpenClaw project
- [proj.reliability](../../work/projects/proj.reliability.md) — Reliability project
- [deploy.sh](../../scripts/ci/deploy.sh) — Deploy script
- [docker-compose.yml](../../infra/compose/runtime/docker-compose.yml) — Production compose
