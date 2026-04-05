---
id: task.0291
type: task
status: needs_implement
priority: 0
rank: 1
estimate: 3
title: "v0 path to green — fix E2E, kill stale staging-preview, clean preview infra"
summary: "Get the existing canary→preview→release pipeline green end-to-end. Fix E2E smoke, disable staging-preview.yml, decommission zombie VM, switch canary deploy-branch to direct commits."
outcome: "One clean automated flow: canary push → build → deploy to preview → E2E pass → release branch created → PR to main. No stale workflows interfering."
project: proj.cicd-services-gitops
assignees: [derekg1729]
branch: fix/v0-pipeline-green
created: 2026-04-05
updated: 2026-04-05
labels: [ci-cd, deployment, blocker]
---

# v0 Path to Green

## Context

The canary pipeline is proven through build → promote → deploy → verify. But the full chain never completes because:

1. **E2E smoke fails** — operator node's home page lacks the landmarks tests expect (skip link, `nav[aria-label="Primary"]`). See [handoff](../handoffs/cicd-deploy-branches.handoff.md).
2. **staging-preview.yml still active** — deploys old single-node to wrong VM on every staging push, creating confusion and wasted CI minutes.
3. **Preview infra drift** — DNS points to new VM (84.32.110.74) but SSH key not authorized for local access. Old VM (84.32.109.160) is a zombie consuming compute.
4. **Canary deploy-branch noise** — auto-PRs for every canary promotion. Need direct commits.

**Prerequisite for:** task.0290 (Release Control Plane). Do not build the Temporal control plane until this pipeline is green.

## Design

### Step 1: Fix E2E smoke tests

The blocker. Two tests fail because operator's public layout doesn't have `AppHeader.tsx` landmarks.

**Approach:** Check what operator's `/` actually renders, then either:

- A: Add skip link + nav to operator's actual public layout
- B: Update tests to match operator's real layout (separate test expectations per node)

**Start with:** `curl -sk https://test.cognidao.org/ | grep '<header\|<nav\|<main'` to see what's there.

**Files:**

- Diagnose: `nodes/operator/app/src/app/(public)/layout.tsx` or equivalent
- Fix: Either operator layout OR `e2e/tests/*.spec.ts`

### Step 2: Disable staging-preview.yml

**Approach:** Add `if: false` to all jobs, or rename to `staging-preview.yml.disabled`. Don't delete yet — keep for reference until the new pipeline is proven.

**Why now:** It deploys old single-node to the wrong VM, wastes CI, and creates false failures that block attention.

**Files:**

- Modify: `.github/workflows/staging-preview.yml` — disable all jobs

### Step 3: Switch canary deploy-branch to direct commits

**Approach:** In `promote-and-deploy.yml`, replace the PR-create-and-merge logic with direct `git push` to `deploy/canary`. Keep PR flow for `deploy/staging` and `deploy/production` (human-reviewed tiers).

**Why now:** Eliminates 100+ noise PRs/day as AI agents ship to canary.

**Files:**

- Modify: `.github/workflows/promote-and-deploy.yml` — canary path: direct push, not PR

### Step 4: Clean preview infra

- **Decommission old VM** (84.32.109.160): Stop containers, remove from any automation
- **Fix new VM** (84.32.110.74): Ensure SSH key is authorized (check provision script output, update `.env.deployments`)
- **Verify Argo ApplicationSet** on preview VM points to `deploy/staging`

**Files:**

- Modify: `.env.deployments` — update preview IP if needed
- SSH: Stop containers on old VM

### Step 5: Prove the full chain

Trigger a canary push and watch the full chain complete:

```
canary push → build-multi-node ✅
  → promote-and-deploy (canary, direct commit) ✅
  → e2e (canary) ✅
  → promote-to-staging (dispatch) ✅
  → promote-and-deploy (preview) ✅
  → e2e (preview) ✅
  → promote-release (creates release/* branch + PR to main) ✅
```

## Validation

- [ ] E2E smoke tests pass on canary
- [ ] staging-preview.yml disabled (no jobs run on staging push)
- [ ] Canary deploy-branch updates are direct commits (no PRs)
- [ ] Old preview VM (84.32.109.160) containers stopped
- [ ] New preview VM (84.32.110.74) SSH works, Argo syncs from deploy/staging
- [ ] Full chain proven: canary push → release PR to main created automatically
