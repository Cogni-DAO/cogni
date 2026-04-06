---
id: bug.0287
type: bug
status: needs_merge
priority: 0
rank: 1
estimate: 3
title: "Provision script incompatible with deploy branch model — 3 gaps"
summary: "provision-test-vm.sh doesn't create ApplicationSets, doesn't update EndpointSlice IPs on deploy branches, and git-pushes to app branches (blocked by hooks). Preview reprovision required 3 manual interventions."
outcome: "Running provision-test-vm.sh against a fresh or existing VM produces a fully working environment with zero manual SSH or git intervention."
initiative: proj.cicd-services-gitops
assignees: []
labels: [ci-cd, infra, provisioning, p0]
created: 2026-04-04
updated: 2026-04-05
branch: fix/deploy-state-endpoints
pr: https://github.com/Cogni-DAO/node-template/pull/774
---

# bug.0287 — Provision script incompatible with deploy branch model

## Incident

On 2026-04-04, preview reprovision (84.32.110.74) required 3 manual interventions after `provision-test-vm.sh preview --yes`:

1. **ApplicationSets not applied** — script said "applied" but cluster had zero ApplicationSets. Had to manually `kubectl apply` the preview ApplicationSet from canary branch.
2. **EndpointSlice IPs wrong** — `deploy/staging` overlays had canary VM IP (84.32.109.222) baked in instead of preview IP (84.32.110.74). Had to manually push a commit to `deploy/staging` fixing IPs.
3. **Argo stale sync** — after fixing IPs, Argo reported OutOfSync but wouldn't re-apply EndpointSlices. Had to delete all Applications so the ApplicationSet recreated them fresh.
4. **Git push blocked by pre-push hook** — script commits EndpointSlice patch to app branch and pushes, but husky pre-push hook runs `check:fast` which fails (branch state issues). Script aborts.

## Root Cause

The provision script was written before the deploy branch model (#747). It assumes:

- Overlays live on app branches (canary/staging/main) — **wrong**, they live on deploy/\* branches
- ApplicationSets can be applied via `kubectl kustomize infra/k8s/argocd/` from the runtime dir — **wrong**, runtime dir only has compose files
- Pushing overlay changes to the app branch is safe — **wrong**, hooks block it

## Required Fixes

### Fix 1: Apply ApplicationSets from app branch source

The provision script needs to fetch ApplicationSet YAMLs and apply them. Options:

- Shallow clone app branch to `/tmp`, apply `infra/k8s/argocd/{env}-applicationset.yaml`, clean up
- Or: SCP the ApplicationSet YAML from the developer's machine

Don't use `kubectl kustomize` on the full argocd dir — the ksops/repo-server patches may not apply cleanly on all clusters.

### Fix 2: Update EndpointSlice IPs on deploy branch, not app branch

After provisioning, the script must:

1. Clone `deploy/{env}` to temp dir
2. Replace EndpointSlice IP addresses in overlay kustomization.yaml files
3. Commit + push directly (deploy branches are unprotected) or create PR + auto-merge
4. **Do NOT touch the app branch** — remove the current git commit+push of overlay patches entirely

### Fix 3: Remove app branch git push

The current Phase 4b "Patch EndpointSlice IPs" commits to the current app branch and pushes. This triggers pre-push hooks and can fail. Delete this entirely — Fix 2 replaces it.

## Validation

Running `provision-test-vm.sh preview --yes` against a fresh VM produces:

- All Compose services healthy
- ApplicationSet applied, Argo apps generated
- EndpointSlice IPs correct on deploy branch
- All 3 app pods healthy (/readyz 200)
- Zero manual SSH or git intervention
