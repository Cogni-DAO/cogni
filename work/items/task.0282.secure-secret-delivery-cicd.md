---
id: task.0282
type: task
title: "Secure secret delivery for CI/CD deploys — replace SSH command-line passing"
status: needs_design
priority: 1
rank: 2
estimate: 3
summary: "deploy.sh and deploy-infra.sh pass ~60 secrets as SSH command-line env vars, visible in ps and vulnerable to quote-injection. Replace with a safe transport mechanism. Also establish a pattern for k8s secret provisioning and rotation."
outcome: "Secrets reach VMs and k8s clusters without appearing in process lists or command lines. New environments can be provisioned with secrets. Existing deployments can have secrets updated with rolling restarts."
spec_refs:
assignees: []
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-04
updated: 2026-04-04
labels: [security, ci-cd, secrets, deployment]
external_refs:
---

# Secure Secret Delivery for CI/CD Deploys

## Context

bug.0002 fixed secrets leaking into GitHub Actions artifacts by moving to SSH env var passing. This solved artifact exposure but introduced two new issues:

1. **`ps` visibility**: `ssh root@host "SECRET=value ... bash script.sh"` exposes all ~60 secrets in the process list on both CI runner and VM for the duration of the SSH session.
2. **Quote injection**: If any secret value contains a single quote, it breaks out of the shell quoting and enables arbitrary command execution on the VM.

Both `deploy.sh` and `deploy-infra.sh` share this pattern. The k8s path (`kubectl create secret`) is manual — no CI automation for creating or updating secrets in k8s namespaces.

## Requirements

- Secrets never appear in process listings (`ps aux`) on CI runners or VMs
- Secret values with special characters (`'`, `"`, `$`, backticks, newlines) are transported safely
- New environment provisioning: a single command creates all required secrets on a fresh VM and k8s cluster
- Secret updates: changing a secret in GitHub Environment triggers re-delivery + rolling restart of affected services
- Compose services: `.env` file on VM is updated atomically (write-then-rename)
- k8s services: `kubectl create secret --dry-run=client -o yaml | kubectl apply -f -` pattern (idempotent)
- `setup-secrets.ts` remains the interactive provisioning tool for GitHub Environment secrets

## Allowed Changes

- `scripts/ci/deploy.sh` — secret passing mechanism
- `scripts/ci/deploy-infra.sh` — secret passing mechanism
- `scripts/ci/deliver-secrets.sh` (new) — shared secret delivery helper
- `.github/workflows/build-multi-node.yml` — workflow secret handling
- `.github/workflows/staging-preview.yml` — workflow secret handling (if still used)
- `scripts/setup-secrets.ts` — add k8s secret provisioning commands
- `docs/runbooks/SECRET_ROTATION.md` — update rotation procedures

## Plan

- [ ] Design: Choose transport mechanism (stdin pipe vs scp temp file vs base64 env). Prototype the simplest approach that satisfies all requirements.
- [ ] Implement `deliver-secrets.sh` — helper that accepts secrets via stdin (JSON or env format), writes to VM `.env` atomically, and optionally creates k8s secrets.
- [ ] Refactor `deploy-infra.sh` — replace SSH command-line vars with `deliver-secrets.sh` piping secrets via stdin.
- [ ] Refactor `deploy.sh` — same pattern.
- [ ] Add k8s secret creation to the delivery helper — `kubectl create secret generic <name> --from-env-file=- --dry-run=client -o yaml | kubectl apply -f -`
- [ ] Update `setup-secrets.ts` — add `--provision-k8s` flag that generates `kubectl create secret` commands for a target namespace.
- [ ] Update SECRET_ROTATION.md with new procedures.
- [ ] Test: Verify secrets with special characters (`'`, `"`, `$`, newline) survive the transport roundtrip.

## Validation

**Command:**

```bash
# Verify no secrets in SSH command line
grep -c "LITELLM_MASTER_KEY=.*bash" scripts/ci/deploy-infra.sh  # expect: 0
grep -c "LITELLM_MASTER_KEY=.*bash" scripts/ci/deploy.sh         # expect: 0

# Verify stdin-based delivery
echo 'TEST_SECRET=value-with-'\''quotes'\''' | scripts/ci/deliver-secrets.sh --dry-run
```

**Expected:** All secrets delivered via stdin pipe, never on command line.

## Review Checklist

- [ ] **Work Item:** task.0282 linked in PR body
- [ ] **Spec:** no spec invariants (infra-only change)
- [ ] **Tests:** roundtrip test with special characters
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Prior art: bug.0002 (artifact exposure fix)
- Affected scripts: `deploy.sh`, `deploy-infra.sh`, `build-multi-node.yml`

## Attribution

- Review finding from PR #723 implementation review
