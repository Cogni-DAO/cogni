---
work_item_id: task.0279, task.0282
status: in_progress
branch: canary (direct), fix/env-specific-ssh-keys (PR #734)
last_commit: 9381cef13
---

# Handoff: Canary Deploy + Secrets Infrastructure

## Goal

Get canary fully green: all 3 nodes healthy, CI deploy-infra succeeding, Grafana Cloud receiving k8s pod logs. Then staging-ready.

## Current State

**What works:**

- All 3 nodes (operator, poly, resy) pass `/readyz` on `test.cognidao.org`, `poly-test.cognidao.org`, `resy-test.cognidao.org`
- Sign-in works on all nodes. AI chat works on all nodes.
- CI builds + promotes images successfully
- 37 GitHub secrets set in canary environment
- `setup-secrets.ts` has `--env canary --auto` for targeted provisioning

**What's broken:**

- CI `deploy-infra` job fails: `rsync: change_dir "infra/compose/sandbox-proxy" failed: No such file or directory`
- Without deploy-infra, Grafana creds don't reach the VM's Compose Alloy — no pod log shipping
- Treasury widget returns 500 (repo-spec missing `payments_in` config — cosmetic, not blocking)

## Immediate Next Steps

### 1. Merge PR #734 (env-specific SSH keys)

Fixes `.local/test-vm-key` → `.local/${env}-vm-key`. Prevents cross-env key confusion.

### 2. Fix sandbox-proxy rsync error in deploy-infra.sh

`scripts/ci/deploy-infra.sh` rsyncs `infra/compose/sandbox-proxy/` which doesn't exist on canary.
Find the rsync line, gate it with `if [ -d ... ]` or remove the stale reference.

### 3. Run setup-secrets to fill remaining gaps

```bash
git checkout canary && git pull
pnpm setup:secrets --env canary --auto
```

Auto-generates COGNI_NODE_DBS and COGNI_NODE_ENDPOINTS (derived from `nodes/*/.cogni/repo-spec.yaml`).
Reuses existing SSH key from `.local/canary-vm-key`. Merges into `.env.canary`.

### 4. Trigger CI or push to canary

Deploy-infra runs → writes Grafana creds to VM → Alloy ships pod logs → verify in Grafana Cloud with `{namespace="cogni-canary"}`.

### 5. Verify green

- All 3 `/readyz` → 200
- Grafana Cloud shows k8s pod logs
- CI build → promote → deploy-infra → verify all pass

## Key Files

| File                                                       | Purpose                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `scripts/setup-secrets.ts`                                 | Single source of truth for secrets. `--env canary --auto`    |
| `scripts/setup/provision-test-vm.sh`                       | VM provisioning. Reads from `.env.{env}`                     |
| `scripts/ci/deploy-infra.sh`                               | CI job: pushes Compose config + secrets to VM via SSH        |
| `.github/workflows/build-multi-node.yml`                   | CI pipeline: build → promote → deploy-infra → verify         |
| `.env.canary`                                              | Local secrets file (gitignored). Written by setup-secrets.ts |
| `.local/canary-vm-key`                                     | SSH key for canary VM (gitignored)                           |
| `infra/k8s/overlays/canary/`                               | k8s overlays for canary environment                          |
| `infra/compose/runtime/configs/alloy-config.metrics.alloy` | Alloy log + metric shipping config                           |

## Completed Work (this session)

| Item                                             | PR          | Status |
| ------------------------------------------------ | ----------- | ------ |
| task.0250: Extract @cogni/graph-execution-host   | #698        | Merged |
| task.0279: Node-aware execution routing (nodeId) | #713        | Merged |
| fix: Scheduler-worker node port mismatch         | #722        | Merged |
| fix: Per-node repo-spec in Docker images         | Direct push | Merged |
| fix: Readyz skip EVM when payment rails inactive | Direct push | Merged |
| fix: CI promote script migrator digest (awk)     | Direct push | Merged |
| fix: Provision script parameterize env           | Direct push | Merged |
| fix: setup-secrets.ts env-aware + auto + merge   | #733        | Merged |
| fix: Env-specific SSH keys                       | #734        | Open   |

## Architecture Decisions

- **setup-secrets.ts owns all secrets.** Generates + uploads to GitHub + saves to `.env.{env}`. Provision script and CI both consume.
- **Per-env local files.** `.local/canary-vm-key`, `.local/preview-vm-key`, etc. Never share keys across environments.
- **Node secrets derived from repo.** `COGNI_NODE_DBS` and `COGNI_NODE_ENDPOINTS` are auto-derived from `nodes/*/.cogni/repo-spec.yaml`. No hardcoding UUIDs.
- **task.0282** (other dev) tracks securing the secret transport (stdin pipe vs SSH command-line). P2 — not blocking canary green.

## Gotchas

- The provision script generates SSH + SOPS keys per-VM but reads app secrets from `.env.{env}`. If `.env.canary` doesn't exist, it fails with a clear error.
- `deploy-infra.sh` passes ~60 secrets as SSH env vars (visible in `ps`). task.0282 tracks fixing this.
- Argo CD ApplicationSets must be applied separately from the full Argo install (kustomize conflicts with bootstrap). The provision script applies individual YAML files, not `kubectl kustomize`.
- Cherry Servers reuses IPs — always `ssh-keygen -R` before SSHing to a new VM at an old IP.
