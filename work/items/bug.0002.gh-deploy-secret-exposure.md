---
id: bug.0002
type: bug
title: "P0 SECURITY: Deploy artifacts expose all secrets"
status: done
priority: 0
estimate: 2
summary: Deploy workflow uploads secrets as GitHub Actions artifact, exposing all production credentials
outcome: Secrets rotated, deploy script fixed to exclude secrets from artifacts
spec_refs:
assignees: derekg1729
credit:
project: proj.docs-system-infrastructure
branch: chore/bug-0002-secret-setup-v2
pr: https://github.com/Cogni-DAO/node-template/pull/629
reviewer:
created: 2026-02-06
updated: 2026-03-25
labels: [security, p0, secrets, ci]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 1
---

## Execution Checklist

- [x] Rotate ALL agent-rotatable secrets for preview and production environments
- [x] Fix `scripts/ci/deploy.sh` — secrets passed via SSH env vars, not written to artifact dir (already fixed in prior PR)
- [x] Delete orphaned secrets (SOURCECRED_GITHUB_TOKEN, COGNI_1729_ACTIONS_AUTOMATION_PAT, NEXT_PUBLIC_DAO_WALLET_ADDRESS, SESSION_SECRET)
- [x] Create `scripts/setup-secrets.ts` — interactive secret provisioning for new nodes
- [x] Create `docs/runbooks/SECRET_ROTATION.md` — complete secret enumeration and rotation procedures
- [ ] Human: rotate remaining external-dashboard secrets (GitHub PATs, OAuth, Grafana, etc.) via `pnpm setup:secrets`

**Root Cause:** `platform/ci/scripts/deploy.sh` (now `scripts/ci/deploy.sh`) previously created `deploy-secrets.env` in `$ARTIFACT_DIR`, which got uploaded as workflow artifact. This has been fixed — secrets now pass via SSH env vars only.

**Remediation (2026-03-24):**

9 agent-rotatable secrets rotated across both environments (preview + production): AUTH_SECRET, LITELLM_MASTER_KEY, SCHEDULER_API_TOKEN, BILLING_INGEST_TOKEN, INTERNAL_OPS_TOKEN, METRICS_TOKEN, OPENCLAW_GATEWAY_TOKEN, GH_WEBHOOK_SECRET, SSH_DEPLOY_KEY.

Remaining human-owned secrets (GitHub PATs, OAuth, Grafana, Privy, etc.) require dashboard visits. Run `pnpm setup:secrets` to walk through them interactively.

## Validation

```bash
# Verify no deploy-secrets in artifact dir
grep -c "deploy-secrets" scripts/ci/deploy.sh  # expect: 0

# Run interactive setup for remaining secrets
pnpm setup:secrets
```
