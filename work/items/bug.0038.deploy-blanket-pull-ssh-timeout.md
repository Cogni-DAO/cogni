---
id: bug.0038
type: bug
title: Deploy pulls all 15+ images every run — SSH timeout on slow pulls
status: done
priority: 0
estimate: 2
summary: deploy-remote.sh does a blanket `compose pull` of every service (including pinned-digest images that never change), wasting bandwidth and time. Combined with missing SSH keepalive on the deploy connection, slow pulls cause SSH disconnect (Broken pipe) and deploy failure.
outcome: Deploy pulls only images that change; static images use local cache; SSH connection survives long operations
spec_refs: openclaw-sandbox-spec
assignees: derekg1729
credit:
project: proj.reliability
branch: fix/deploy-targeted-pull-ssh-keepalive
pr:
reviewer:
created: 2026-02-12
updated: 2026-02-12
labels: [deploy, infra, ssh]
external_refs: https://github.com/Cogni-DAO/node-template/actions/runs/21936705892/job/63354600251
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Deploy pulls all 15+ images every run — SSH timeout on slow pulls

## Requirements

### Observed

**1. Blanket compose pull re-downloads everything every deploy**

`platform/ci/scripts/deploy.sh:657` (inside heredoc, remote Step 7):

```bash
$RUNTIME_COMPOSE --profile bootstrap --profile sandbox-openclaw pull
```

This pulls **all 15 services** in the runtime compose file, including 10+ images that never change between deploys:

| Image                                      | Pin type             | Changes?      |
| ------------------------------------------ | -------------------- | ------------- |
| `willfarrell/autoheal@sha256:babb...`      | digest               | Never         |
| `ghcr.io/berriai/litellm@sha256:7e78...`   | digest               | Never         |
| `nginx:alpine@sha256:5878...`              | digest               | Never         |
| `postgres:15`                              | tag                  | Rarely        |
| `registry.k8s.io/git-sync/git-sync:v4.4.0` | tag                  | Never         |
| `grafana/alloy:v1.9.2`                     | tag                  | Never         |
| `temporalio/auto-setup:1.29.1`             | tag                  | Never         |
| `temporalio/ui:2.34.0`                     | tag                  | Never         |
| `busybox` (repo-init)                      | **none — `:latest`** | Unpredictable |

Only 3 images actually change per deploy: `APP_IMAGE`, `MIGRATOR_IMAGE`, `SCHEDULER_WORKER_IMAGE`.

Additionally, 2 sandbox images should be pulled (may update): `ghcr.io/cogni-dao/cogni-sandbox-openclaw:latest` and the pnpm-store image.

After a disk prune (Step 2.5, which triggers at >70% or <15GB free), **all cached static images are wiped**, forcing a complete re-download of ~3GB on the next pull. This creates a vicious prune→repull cycle.

**2. SSH deploy connection has no keepalive**

`platform/ci/scripts/deploy.sh:152`:

```bash
SSH_OPTS="-i $SSH_KEY_PATH -o StrictHostKeyChecking=yes"
```

Compare to the SSH _test_ connection at `.github/workflows/deploy-production.yml:77`:

```bash
ssh ... -o ServerAliveInterval=10 -o ServerAliveCountMax=6 root@"$VM_HOST" "echo SSH test successful"
```

The test has keepalive; the actual deploy (`deploy.sh:827`) does not. When pulls take 10+ minutes (especially after a prune), NAT/firewall drops the idle-looking SSH connection → `client_loop: send disconnect: Broken pipe`.

**3. Dry-run "validation" at Step 6 validates nothing**

`platform/ci/scripts/deploy.sh:645`:

```bash
if ! $RUNTIME_COMPOSE --dry-run --profile bootstrap --profile sandbox-openclaw pull; then
```

`docker compose --dry-run pull` checks compose file syntax, not registry existence. This step gives false confidence that images exist in GHCR.

**4. SourceCred image pulled unnecessarily**

`platform/ci/scripts/deploy.sh:617`:

```bash
$SOURCECRED_COMPOSE pull sourcecred
```

The sourcecred image (`ghcr.io/cogni-dao/cogni-sourcecred-runner:sc0.11.2-node18-2025-12-07`) has a very specific pinned tag — it never changes. This pull is wasted I/O.

**5. `busybox` unpinned in compose**

`platform/infra/services/runtime/docker-compose.yml:200`:

```yaml
repo-init:
  image: busybox
```

No tag or digest pin. Pulls `:latest` which can change unpredictably.

### Expected

- Deploy pulls only images that change or may update: `APP_IMAGE`, `MIGRATOR_IMAGE`, `SCHEDULER_WORKER_IMAGE`, `cogni-sandbox-openclaw:latest`, pnpm-store
- Static/pinned images use local Docker cache — no re-pull unless explicitly needed
- SSH connection survives 30+ minute operations without disconnect
- After disk prune, only the 5 needed images are re-pulled (~1.5GB), not all 15 (~3GB+)

### Reproduction

1. Deploy to a VM with >70% disk usage (triggers prune at Step 2.5)
2. Prune wipes all unused image caches
3. Step 7 blanket compose pull re-downloads all ~15 images over SSH
4. SSH connection drops after ~20 minutes with `client_loop: send disconnect: Broken pipe`
5. Deploy fails at exit 255

Evidence: https://github.com/Cogni-DAO/node-template/actions/runs/21936705892/job/63354600251

```
04299c40328a: Pull complete
2f8054c9403a: Pull complete
5541dfe18d41: Download complete
client_loop: send disconnect: Broken pipe
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Error:  deploy failed (exit 255)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
=== VM disk state ===
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda1        39G   30G  8.9G  78% /
```

### Impact

Production and preview deploys fail intermittently on slow connections or post-prune. Each retry re-triggers the same blanket pull. Manual SSH to the VM is required to recover.

## Allowed Changes

- `platform/ci/scripts/deploy.sh` — replace blanket compose pull with targeted pulls, add SSH keepalive, remove dry-run theater
- `platform/infra/services/runtime/docker-compose.yml` — pin `busybox` image
- `platform/ci/scripts/seed-pnpm-store.sh` — changed to expect `$PNPM_STORE_IMAGE` from caller

## Plan

- [x] Add SSH keepalive to `SSH_OPTS` (`deploy.sh:153,166`): `-o ServerAliveInterval=15 -o ServerAliveCountMax=12`
- [x] Replace blanket `$RUNTIME_COMPOSE ... pull` (Step 7) with targeted pulls of only the 5 images that change or may update:
  ```bash
  docker pull "$APP_IMAGE"
  docker pull "$MIGRATOR_IMAGE"
  docker pull "$SCHEDULER_WORKER_IMAGE"
  docker pull "$OPENCLAW_GATEWAY_IMAGE"
  docker pull "$PNPM_STORE_IMAGE" || log_warn "..."
  ```
- [x] Remove Step 6 dry-run validation (checked compose syntax, not registry — false confidence)
- [x] Remove `$SOURCECRED_COMPOSE pull sourcecred` (Step 4) — immutable pinned tag; `compose up -d` handles cache
- [x] Pin `busybox` in `docker-compose.yml:200` to `busybox:1.37`
- [x] Consolidate pnpm-store pull into main pull block; `seed-pnpm-store.sh` now requires `$PNPM_STORE_IMAGE` from caller
- [ ] Add post-deploy image cleanup: `docker image prune -f` after health checks (deferred — low priority)

## Validation

**Command:**

```bash
# 1. Verify no blanket compose pull remains in deploy script
grep -n 'RUNTIME_COMPOSE.*pull' platform/ci/scripts/deploy.sh | grep -v 'docker pull'

# 2. Verify SSH keepalive is set
grep -n 'ServerAliveInterval' platform/ci/scripts/deploy.sh

# 3. Verify busybox is pinned
grep 'busybox' platform/infra/services/runtime/docker-compose.yml | grep -E '@sha256:|:[0-9]'

# 4. Deploy to preview succeeds without SSH timeout
```

**Expected:** No blanket compose pull, SSH keepalive present, busybox pinned, deploy completes.

## Review Checklist

- [ ] **Work Item:** `bug.0038` linked in PR body
- [ ] **Spec:** deploy.sh header invariants updated
- [ ] **Tests:** deploy to preview succeeds on near-full disk without SSH timeout
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Follow-on from bug.0015 (disk cleanup ordering — fixed, but blanket pull remained)
- Failed run: https://github.com/Cogni-DAO/node-template/actions/runs/21936705892/job/63354600251

## Attribution

-
