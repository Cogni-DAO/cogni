---
id: handoff.deploy-scorecard
title: "Deploy scorecard — operator boots to /livez, 2 blockers remain"
branch: deploy/multi-node
vm_ip: 84.32.109.222
ssh: "ssh -i .claude/worktrees/deploy-scorecard/.local/test-vm-key root@84.32.109.222"
created: 2026-04-03
updated: 2026-04-03
---

# Deploy Scorecard

## Wins (resolved this session)

| What                       | Detail                                                                            |
| -------------------------- | --------------------------------------------------------------------------------- |
| Compose infra 7/7 healthy  | postgres, temporal, litellm, redis, caddy, temporal-postgres, autoheal            |
| k3s + Argo CD              | Single node Ready, 5 Applications generated, watching `deploy/multi-node`         |
| Scheduler-worker           | **1/1 Running, Healthy** — first green k8s workload                               |
| DB migrations (3 nodes)    | All Completed — cogni_operator, cogni_poly, cogni_resy                            |
| DNS live                   | test.cognidao.org, poly-test.cognidao.org, resy-test.cognidao.org → 84.32.109.222 |
| EndpointSlice loopback fix | 127.0.0.1 → VM IP in all overlays + compose ports on 0.0.0.0                      |
| GHCR auth working          | k3s registries.yaml has real PAT                                                  |
| k8s secrets created        | 5/5 with correct VM IP in DATABASE_URLs                                           |
| secretRef namePrefix       | Overlay patches fix kustomize limitation                                          |
| APP_ENV validation         | preview → test                                                                    |
| Operator /livez            | Returns 200 `{"status":"alive"}`                                                  |
| Provision script unified   | One command: provision + compose + secrets + scorecard                            |

## Blockers (RED — 2 remaining)

### 1. GHCR repo name mismatch (poly/resy images)

**Error:** `ghcr.io/cogni-dao/node-template:staging-placeholder-poly: not found`

**Root cause:** User built and pushed to `ghcr.io/cogni-dao/cogni-template:staging-placeholder-poly` (old repo name). But k8s overlays reference `ghcr.io/cogni-dao/node-template` (new repo name after GitHub rename). The GitHub redirect works for `git clone` and `docker pull` from CLI, but k3s containerd doesn't follow the redirect.

**Fix:** Rebuild and push to the correct repo name:

```bash
docker buildx build --platform linux/amd64 -f nodes/poly/app/Dockerfile --target runner \
  -t ghcr.io/cogni-dao/node-template:staging-placeholder-poly --push .

docker buildx build --platform linux/amd64 -f nodes/resy/app/Dockerfile --target runner \
  -t ghcr.io/cogni-dao/node-template:staging-placeholder-resy --push .
```

### 2. git-sync sidecar missing from k8s Deployment

**Error:** `COGNI_REPO_ROOT missing package.json and .git: /tmp`

**Root cause:** The Compose stack has a `git-sync` service + `repo_data` volume that clones the repo to `/repo/current`. The k8s Deployment base doesn't have this — no initContainer, no sidecar, no volume. The app's env validation requires `COGNI_REPO_PATH` to point to a real git repo with `package.json` and `.git/`.

**Fix options:**

- **A) Add git-sync initContainer to k8s base** — same pattern as compose, needs `GIT_READ_TOKEN` secret. ~30 min.
- **B) Make COGNI_REPO_PATH optional in app** — code change to server-env.ts validation. Would need rebuild of all images.
- **C) Add emptyDir + initContainer that does `git clone --depth=1`** — lighter than git-sync, one-shot.

**Decision needed:** Which approach? Option A is the proper port of compose behavior. Option B is cleaner long-term but requires app code change + image rebuild.

## Stable Green

| Component             | Status                                  |
| --------------------- | --------------------------------------- |
| Compose infra (7 svc) | ALL HEALTHY                             |
| k3s node              | Ready                                   |
| scheduler-worker      | 1/1 Running                             |
| DNS (3 records)       | Resolving                               |
| DB migrations (3)     | Completed                               |
| k8s secrets (5)       | Created with VM IP                      |
| Caddy routing         | Configured (502 until app pods healthy) |
| Operator /livez       | 200 OK                                  |

## Connection Info

```bash
ssh -i .claude/worktrees/deploy-scorecard/.local/test-vm-key root@84.32.109.222
# Secrets: .claude/worktrees/deploy-scorecard/.local/test-vm-secrets.env
# Creds: .env.operator
```

## Cost

VM running at ~€0.07/hr since 2026-04-03T04:15Z. **Destroy when done.**
