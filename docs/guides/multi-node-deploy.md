---
id: guide.multi-node-deploy
type: guide
title: Multi-Node Deployment — k3s + Argo CD
status: draft
trust: draft
summary: Provision a VM, set up GitHub environment secrets, and deploy operator + poly + resy via CI
read_when: Setting up a new deployment environment (canary, staging, production), debugging CI/CD pipeline
owner: derekg1729
created: 2026-04-03
verified: null
tags: [deployment, k3s, argo-cd, ci-cd, infrastructure]
---

# Multi-Node Deployment — k3s + Argo CD

## Architecture

```
push to branch → build-multi-node.yml (build 5 images, push GHCR)
    → promote-k8s-staging.yml (update overlay digests, commit)
        → Argo CD auto-syncs → verify-deployment.yml (health + smoke)
```

Compose runs infra (Postgres, Temporal, LiteLLM, Redis, Caddy). k3s + Argo CD runs apps (operator, poly, resy, scheduler-worker). See [cd-pipeline-e2e.md](../spec/cd-pipeline-e2e.md).

## 1. Provision VM (~5 min)

```bash
CHERRY_AUTH_TOKEN=<token> CHERRY_PROJECT_ID=<id> bash scripts/setup/provision-test-vm.sh
```

Outputs VM IP + SSH key to `.local/`. Bootstraps Docker + k3s + Argo CD + Compose infra. See [provision-test-vm.sh](../../scripts/setup/provision-test-vm.sh).

## 2. Set DNS (3 A records)

All point to the VM IP. URL pattern: `{DOMAIN}`, `poly-{DOMAIN}`, `resy-{DOMAIN}`.

```
test.cognidao.org      → 84.32.109.222
poly-test.cognidao.org → 84.32.109.222
resy-test.cognidao.org → 84.32.109.222
```

Use `/dns-ops` skill or Cloudflare dashboard.

## 3. Create GitHub Environment + Secrets (~1 min)

```bash
# Create environment
gh api repos/Cogni-DAO/node-template/environments/canary -X PUT --silent

# Set secrets (2) + variable (1)
echo "<VM_IP>" | gh secret set VM_HOST --repo Cogni-DAO/node-template --env canary
gh secret set SSH_DEPLOY_KEY --repo Cogni-DAO/node-template --env canary < .local/test-vm-key
gh variable set DOMAIN --repo Cogni-DAO/node-template --env canary --body "test.cognidao.org"
```

`ACTIONS_AUTOMATION_BOT_PAT` is repo-level (already set). `GITHUB_TOKEN` handles GHCR push automatically. App secrets live as k8s Secrets on the cluster (created by provision script), not in GitHub.

## 4. Push to trigger CI

```bash
git push origin integration/multi-node   # or canary branch
```

Workflows fire: `build-multi-node` → `promote-k8s-staging` → `verify-deployment`. Watch in GitHub Actions tab.

## 5. Verify

```bash
# Check from your machine
curl -sk https://test.cognidao.org/livez
curl -sk https://poly-test.cognidao.org/livez
curl -sk https://resy-test.cognidao.org/livez

# Check Argo status on VM
ssh -i .local/test-vm-key root@<VM_IP> "kubectl -n argocd get applications"
ssh -i .local/test-vm-key root@<VM_IP> "kubectl -n cogni-staging get pods"
```

## 6. Destroy

```bash
cd infra/provision/cherry/base
tofu workspace select test
tofu destroy -var-file=terraform.test.tfvars
```

## Related

- [INFRASTRUCTURE_SETUP.md](../runbooks/INFRASTRUCTURE_SETUP.md) — full secret catalog + SSH key generation
- [cd-pipeline-e2e.md](../spec/cd-pipeline-e2e.md) — pipeline architecture + networking
- [multi-node-dev.md](./multi-node-dev.md) — local development guide
- `pnpm setup:secrets` — interactive secret provisioning (preview, canary, production)
