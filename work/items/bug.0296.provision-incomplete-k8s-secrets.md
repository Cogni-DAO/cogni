---
id: bug.0296
type: bug
title: "provision-test-vm.sh Phase 6 creates incomplete k8s secrets — missing OAuth, Privy, and connection secrets"
status: needs_triage
priority: 0
rank: 1
estimate: 2
summary: "Phase 6 of provision-test-vm.sh creates k8s node-app-secrets with only 14 vars. Missing all OAuth (GitHub, Discord, Google), Privy, CONNECTIONS_ENCRYPTION_KEY, GH_WEBHOOK_SECRET, GH_REVIEW_APP_*, GH_REPOS. Production sign-in falls back to wallet-only auth."
outcome: "provision-test-vm.sh creates k8s secrets with ALL env vars the app needs, sourced from .env.<environment>. deploy-infra.sh also reconciles k8s secrets on each run so drift is caught."
spec_refs: [ci-cd-spec]
assignees: []
credit: []
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-06
updated: 2026-04-06
labels: [deploy, infra, security]
external_refs:
---

# provision-test-vm.sh Phase 6 creates incomplete k8s secrets

## Requirements

### Observed

`scripts/setup/provision-test-vm.sh` Phase 6 (lines 555-600) creates `{node}-node-app-secrets` with only 14 env vars. The app expects ~30+ vars at runtime. Missing secrets:

```
GH_OAUTH_CLIENT_ID          — GitHub OAuth sign-in
GH_OAUTH_CLIENT_SECRET      — GitHub OAuth sign-in
DISCORD_OAUTH_CLIENT_ID     — Discord OAuth sign-in
DISCORD_OAUTH_CLIENT_SECRET — Discord OAuth sign-in
GOOGLE_OAUTH_CLIENT_ID      — Google OAuth sign-in
GOOGLE_OAUTH_CLIENT_SECRET  — Google OAuth sign-in
PRIVY_APP_ID                — Privy auth
PRIVY_APP_SECRET            — Privy auth
PRIVY_SIGNING_KEY           — Privy auth
CONNECTIONS_ENCRYPTION_KEY  — connection credential encryption
GH_WEBHOOK_SECRET           — GitHub webhook verification
GH_REVIEW_APP_ID            — GitHub review app
GH_REVIEW_APP_PRIVATE_KEY_BASE64 — GitHub review app
GH_REPOS                    — repo list for webhooks
```

Additionally, line 582 hardcodes `OPENCLAW_GITHUB_RW_TOKEN='placeholder-not-needed-for-test'` and the sandbox-openclaw secret uses `DISCORD_BOT_TOKEN='placeholder'`. These are never replaced by deploy-infra — k8s secrets are only created by provision, never updated.

### Expected

1. Phase 6 should source ALL app env vars from `.env.<environment>` — not a hardcoded subset
2. `deploy-infra.sh` should reconcile k8s secrets on each run (patch with latest values from GitHub environment secrets)
3. No hardcoded placeholders — if a value isn't set, omit it or use empty string

### Reproduction

```bash
# Provision any environment
bash scripts/setup/provision-test-vm.sh production --yes

# Check created secret
ssh -i .local/production-vm-key root@<IP> \
  "kubectl -n cogni-production get secret operator-node-app-secrets -o json | python3 -c 'import json,sys; [print(k) for k in sorted(json.load(sys.stdin)[\"data\"].keys())]'"

# Result: only 14 keys. No OAuth, Privy, or connection secrets.
# App falls back to wallet-only auth.
```

### Impact

- **Production sign-in broken** — only ETH wallet auth works. GitHub/Discord/Google OAuth missing.
- **Every new provision requires manual secret patching** — not reproducible from scratch
- **deploy-infra can't fix it** — it only writes Compose `.env`, never touches k8s secrets
- Violates REPRODUCIBILITY principle: "Every environment must be rebuildable from scratch via scripts and manifests"

## Allowed Changes

- `scripts/setup/provision-test-vm.sh` — Phase 6 secret creation (lines 555-600)
- `scripts/ci/deploy-infra.sh` — add k8s secret reconciliation step
- `infra/k8s/base/node-app/deployment.yaml` — if envFrom structure changes

## Plan

- [ ] Phase 6: read ALL keys from `.env.<environment>` dynamically instead of hardcoded `--from-literal` list
- [ ] deploy-infra.sh: add step to `kubectl patch secret` with values from GitHub environment secrets (same vars passed to the remote script)
- [ ] Remove all `placeholder` values — use `${VAR:-}` pattern
- [ ] Test: provision a fresh canary, verify all OAuth providers appear on sign-in page

## Validation

**Command:**

```bash
# After fix: provision fresh env, verify full secret set
bash scripts/setup/provision-test-vm.sh canary --yes
ssh -i .local/canary-vm-key root@<IP> \
  "kubectl -n cogni-canary get secret operator-node-app-secrets -o json | python3 -c 'import json,sys; d=json.load(sys.stdin)[\"data\"]; print(f\"{len(d)} keys\"); [print(k) for k in sorted(d.keys()) if \"OAUTH\" in k or \"PRIVY\" in k]'"
```

**Expected:** 25+ keys including all OAuth and Privy vars.

## Review Checklist

- [ ] **Work Item:** `bug.0296` linked in PR body
- [ ] **Spec:** REPRODUCIBILITY invariant restored — provision creates full environment
- [ ] **Tests:** manual verification on canary after provision
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Production manually patched 2026-04-06 ~05:30 UTC (temporary fix)

## Attribution

- Discovered during production deploy session 2026-04-06
