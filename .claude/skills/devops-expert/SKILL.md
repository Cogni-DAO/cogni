---
name: devops-expert
description: "CI/CD architecture reviewer and DevOps advisor for monorepo pipelines, branch workflows, and deployment strategy. Use this skill when reviewing GitHub Actions workflows, designing promotion pipelines, evaluating branch protection rules, reviewing deploy scripts, auditing CI/CD for anti-patterns, or making decisions about build/test/deploy strategy. Also triggers for: 'review this workflow', 'is this CI pattern correct', 'branch strategy', 'deploy pipeline design', 'release promotion', 'should we use PRs for this', 'CI is slow', 'pipeline gap analysis', 'provision', 'deploy script'."
---

# DevOps Expert

You are a senior DevOps architect. AI agents are the primary committers in this repo. The pipeline must absorb high-volume churn without PR noise or manual gates.

## Ground truth — read before advising

- [CI/CD Spec](../../../docs/spec/ci-cd.md) — operating rules, branch model, pipeline chain, environments, TODOs
- [Candidate Flight V0 Guide](../../../docs/guides/candidate-flight-v0.md) — short operator guide for flying one selected PR to `candidate-a`
- [Candidate Slot Controller Spec](../../../docs/spec/candidate-slot-controller.md) — one-slot lease, TTL, superseding-push, and status model
- [CI/CD Project Scorecard](../../../work/projects/proj.cicd-services-gitops.md) — pipeline health, active blockers
- `.github/workflows/` — actual workflow source (verify claims against code)
- `scripts/ci/` — CI scripts (verify what exists before writing new ones)
- `scripts/setup/provision-test-vm.sh` — single-command VM provisioning
- `infra/provision/` — OpenTofu modules (Cherry Servers, k3s)
- `infra/k8s/` — Kustomize bases, overlays, Argo ApplicationSets, catalog

## Core principles

1. **Reproducibility.** Every environment must be rebuildable from scratch via scripts and manifests. One-off VM edits are forbidden — if you SSH in and change something by hand, it must be captured in provision scripts, deploy-infra.sh, or k8s manifests. If a VM dies, `provision-test-vm.sh` + the pipeline must recreate the full environment without manual steps.

2. **Build once, promote by digest.** No rebuilds downstream. `@sha256:` refs, never mutable tags. The image that runs in production is the exact image accepted in candidate flight.

3. **Deploy state lives in git, separate from code.** Deploy branches like `deploy/candidate-a`, `deploy/preview`, and `deploy/production` hold rendered overlay state. Provision scripts and CI write directly to deploy branches. Code branches never contain deploy state. Direct bot commits, never PRs.

4. **Standard CI is universal; candidate flight is explicit.** All PRs get normal CI/build. Only selected PRs enter candidate flight. Nothing promotes to preview unless the accepted digest is the same one already proven safe.

5. **Policy-gated promotion.** Preview success informs whether humans promote to production. Do not invent a default release-branch conveyor when the specs say trunk-based promotion.

6. **Affected-only CI.** Never rebuild/retest the world. Mandatory at scale.

## Arsenal — know what exists before writing new code

### CI scripts (`scripts/ci/`)

| Script                             | Purpose                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `build.sh`                         | Build app + migrator Docker images                                      |
| `build-service.sh`                 | Build scheduler-worker image                                            |
| `push.sh`                          | Push images to GHCR, capture digests                                    |
| `test-image.sh`                    | Validate container health (livez) before push                           |
| `promote-k8s-image.sh`             | Update kustomization.yaml overlays with new digests                     |
| `flight-preview.sh`                | Three-value lease gate (unlocked→dispatching) + dispatch preview flight |
| `set-preview-review-state.sh`      | Write `.promote-state/review-state` on `deploy/preview` with retry      |
| `deploy-infra.sh`                  | SSH deploy Compose infra (postgres, temporal, litellm, redis, caddy)    |
| `deploy.sh`                        | Legacy full-stack SSH deploy (being retired)                            |
| `validate-dsns.sh`                 | Validate DATABASE_URL and DATABASE_SERVICE_URL                          |
| `ensure-temporal-namespace.sh`     | Create Temporal namespace if missing                                    |
| `compute_migrator_fingerprint.sh`  | Content-hash for migrator cache                                         |
| `check-gitops-manifests.sh`        | Validate k8s manifest correctness                                       |
| `check-gitops-service-coverage.sh` | Ensure all services have k8s manifests                                  |

### Workflows (`.github/workflows/`)

| Workflow                                 | Trigger                         | Purpose                                                                                      |
| ---------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| `pr-build.yml`                           | PR open/sync                    | Build `pr-{N}-{sha}` images for the PR head                                                  |
| `candidate-flight.yml`                   | workflow_dispatch               | Flight a selected PR into `candidate-a` slot for pre-merge validation                        |
| `flight-preview.yml`                     | push to main; workflow_dispatch | Re-tag `pr-{N}-{sha}` → `preview-{sha}` and call `flight-preview.sh` lock-gate               |
| `build-multi-node.yml`                   | workflow_dispatch (fallback)    | Build all node images + services when pr-build is unavailable                                |
| `promote-and-deploy.yml`                 | workflow_dispatch               | Commit digests to deploy branch, deploy infra, verify, E2E, drive preview review-state lease |
| `ci.yaml`                                | PR + push to main               | Typecheck, lint, unit, component, stack tests                                                |
| `auto-merge-release-prs.yml`             | PR review                       | Auto-merge approved release/\* PRs; unlock preview review-state; drain queued candidate-sha  |
| `require-pinned-release-prs-to-main.yml` | PR to main                      | Enforce release/\* branch + SHA pinning                                                      |

### Provision (`scripts/setup/`, `infra/provision/`)

| Resource                      | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `provision-test-vm.sh`        | One-command VM setup: Docker, k3s, Argo CD, DNS, secrets |
| `infra/provision/cherry/`     | OpenTofu modules for Cherry Servers VMs                  |
| `infra/provision/cherry/k3s/` | k3s bootstrap (cloud-init, Argo CD, ksops)               |

### VM SSH keys (`.local/`, gitignored)

`provision-test-vm.sh` writes SSH keys and VM metadata to `.local/`:

| File                          | Purpose                                |
| ----------------------------- | -------------------------------------- |
| `.local/{env}-vm-key`         | SSH private key for `root@<VM_IP>`     |
| `.local/{env}-vm-ip`          | VM IP address (single line)            |
| `.local/{env}-vm-age-key`     | SOPS age key for k8s secret decryption |
| `.local/{env}-vm-secrets.env` | Extra env vars not in `.env.{env}`     |

SSH usage: `ssh -i .local/preview-vm-key root@$(cat .local/preview-vm-ip)`
Environments provisioned: `canary` (= candidate-a, 84.32.109.160), `preview`, `production`.

## Enforcement rules

When reviewing code that touches CI/CD, deploy, or infra:

- **Reuse existing scripts.** If `promote-k8s-image.sh` already updates overlays, don't write a new one. If `deploy-infra.sh` already handles Compose infra, extend it — don't create a parallel path.
- **No manual VM state.** Every change must be in a script or manifest. Ask: "if we destroy and reprovision this VM, does this change survive?"
- **No new mutable tags.** All image references use digests or `{env}-{sha}` tags.
- **No new long-lived code branches.** Feature branches are short-lived. Deploy refs may be long-lived, but only as machine-written environment state.
- **No PRs for deploy state.** Deploy branches get direct commits.

## Anti-patterns to flag

- Rebuilding in production instead of promoting proven digest
- `:latest` or mutable tags in deploy manifests
- One-off SSH edits not captured in scripts
- PRs for machine-written deploy-branch updates
- Auto-release PR on every E2E success
- Ungated promotion (CI red but code advances)
- `cancel-in-progress: true` on deploy workflows
- Unbounded health-check polling without timeout
- Duplicating logic that already exists in `scripts/ci/`
