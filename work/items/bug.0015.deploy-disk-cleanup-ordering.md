---
id: bug.0015
type: bug
title: Deploy disk cleanup runs after pulls — disk exhaustion on 40GB VMs
status: done
priority: 0
estimate: 2
summary: deploy.sh Step 5 (disk prune) runs after Step 3.5 (OpenClaw pull), so the pull that needs space fails before cleanup runs. keep-last tag also defeats prune.
outcome: Disk cleanup runs before all image pulls; keep-last tag removed; deploy succeeds on 40GB VMs with <15GB free
spec_refs:
assignees: derekg1729
credit:
project: proj.reliability
branch: docs/postmortem-skill-and-disk-exhaustion
pr:
reviewer:
created: 2026-02-10
updated: 2026-02-10
labels: [deploy, disk, infra]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Deploy disk cleanup runs after pulls — disk exhaustion on 40GB VMs

## Requirements

### Observed

- Preview VM hit 100% disk (39G/39G) during deploy — `docker pull` at Step 3.5 fails with ENOSPC
- `deploy.sh:580-583` (Step 3.5) pulls OpenClaw image BEFORE `deploy.sh:599-616` (Step 5) checks/cleans disk
- `deploy.sh:585-596` (Step 4) tags running image as `cogni-runtime:keep-last`, which survives `docker system prune -af` because it has a local tag
- Header comments (lines 7-14) reference outdated invariants ("keep exactly 1 previous", "70% threshold", "20GB disks")

### Expected

- Disk cleanup should run before any image pulls, giving pulls maximum headroom
- No mechanism should pin old images through aggressive prune on space-constrained VMs
- Threshold should be 15GB free (not 10GB) to handle multi-image pull sequences

### Reproduction

Deploy to a 40GB VM with ~25GB+ of Docker images. Step 3.5 pulls OpenClaw image, pushing disk to 100%. Step 5 cleanup runs too late.

### Impact

All preview deploys blocked. Production at risk of same failure.

## Allowed Changes

- `platform/ci/scripts/deploy.sh` — reorder steps, remove keep-last, update threshold and header comments

## Plan

- [ ] Move Step 5 (disk cleanup) before Step 3 (GHCR auth) — insert as Step 2.5, right after edge stack
- [ ] Bump free-space threshold from 10GB to 15GB
- [ ] Delete Step 4 (keep-last tag) — rollback is re-deploying old commit SHA, not running old image
- [ ] Move Step 3.5 (OpenClaw pull+tag) after the new cleanup position
- [ ] Remove `--profile sandbox-openclaw` from pull commands in Steps 6-7 (OpenClaw image is a local tag alias, not registry-pullable)
- [ ] Update header comments to reflect new invariants

## Validation

**Command:**

```bash
# Verify step ordering in deploy.sh: cleanup before any docker pull
grep -n "Step\|docker pull\|docker system prune\|keep-last" platform/ci/scripts/deploy.sh
```

**Expected:** Cleanup step appears before all pull steps; no keep-last references remain.

## Review Checklist

- [ ] **Work Item:** `bug.0015` linked in PR body
- [ ] **Spec:** deploy invariants updated in header comments
- [ ] **Tests:** deploy to preview succeeds on near-full disk
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Postmortem: `docs/postmortems/pm.preview-disk-exhaustion.2026-02-10.md`

## Attribution

-
