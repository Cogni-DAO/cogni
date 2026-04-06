---
id: task.0283
type: task
status: needs_design
priority: 1
rank: 2
estimate: 3
title: "Provision VM as GitHub Action — eliminate local .env.{env} dependency"
summary: Run provision-test-vm.sh as a GitHub Actions workflow with `environment:` context so it reads secrets directly from GitHub env secrets. Eliminates split-brain between local .env files and GitHub secrets.
outcome: "One-command VM provisioning via `gh workflow run provision-vm --ref canary`. No local .env.{env} files needed. Same secrets source for provision and deploy-infra."
initiative: proj.cicd-services-gitops
assignees: []
labels: [ci-cd, infra, secrets, provisioning]
created: 2026-04-04
updated: 2026-04-04
---

# task.0283 — Provision VM as GitHub Action

## Problem

Provisioning a VM currently requires:

1. Run `pnpm setup:secrets --env canary --all` locally to generate `.env.canary`
2. Run `bash scripts/setup/provision-test-vm.sh canary --yes` locally, which reads `.env.canary`

This creates a split-brain: GitHub env secrets (for CI deploy-infra) and `.env.canary` on a developer's laptop (for provisioning). They can drift. If the laptop is lost, `.env.canary` can't be reconstructed (GitHub secrets are write-only).

## Solution

Create a `provision-vm.yml` GitHub Actions workflow:

```yaml
name: Provision VM
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [canary, preview, production]
      destroy_first:
        type: boolean
        default: false

jobs:
  provision:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    env:
      # All secrets injected by GitHub environment context
      DEPLOY_ENV: ${{ inputs.environment }}
      VM_HOST: ${{ secrets.VM_HOST }}
      # ... all secrets
    steps:
      - uses: actions/checkout@v4
      - name: Install OpenTofu
        run: ...
      - name: Provision
        run: scripts/setup/provision-test-vm.sh ${{ inputs.environment }} --yes
```

The provision script already reads from environment variables when `.env.{env}` is absent — it just needs a fallback path that reads from env vars directly instead of requiring the file.

## Requirements

- [ ] `provision-test-vm.sh` accepts secrets from env vars OR `.env.{env}` file (env vars take precedence)
- [ ] `provision-vm.yml` workflow with `workflow_dispatch` + environment selection
- [ ] OpenTofu state backend accessible from CI (currently local — may need remote backend)
- [ ] Cherry Servers API key available as GitHub secret
- [ ] SSH key generated in-workflow and uploaded to GitHub env secret (or reuse existing)
- [ ] Cloudflare API token available for DNS records

## Blockers

- OpenTofu state is local (`.local/` directory). Moving to remote backend (S3, GCS, or Terraform Cloud) is required for CI provisioning. This is the biggest piece of work.

## Design constraints

- Do not remove local provisioning capability — developers still need it for debugging
- Provision workflow must be `workflow_dispatch` only (never auto-triggered)
- Production provisioning requires manual approval gate

## Validation

Provisioning via `gh workflow run provision-vm --ref canary` produces a healthy VM with all pods running and health checks passing.
