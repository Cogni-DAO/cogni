---
id: bug.0334
type: bug
title: Overlay EndpointSlice IPs + workflow rsync — establish INFRA_K8S_MAIN_DERIVED invariant
status: needs_design
priority: 1
rank: 5
estimate: 4
summary: "Follow-up to bug.0333. After that bug's base audit, the last remaining deploy-branch-local overlay content is EndpointSlice IP patches (`/endpoints/0/addresses`) written by provision scripts. The promote workflow still skips `infra/k8s/overlays/**` from its rsync, so any future non-IP overlay change on main could still fail to propagate. Closing this requires (1) a single per-env truth source for VM IPs, (2) wiring those IPs into EndpointSlices via kustomize `replacements`, (3) switching the workflow rsync to cover the full `infra/k8s/` tree with `--exclude='<truth-source>'`. Scope was cut from bug.0333 when implementation surfaced that production uses two distinct IPs per env (`127.0.0.1` for scheduler-worker, `10.0.0.1` for node-apps), which breaks the initial single-IP-per-env schema. Needs topology investigation before design."
outcome: "`INFRA_K8S_MAIN_DERIVED` holds after every promote — every file under `infra/k8s/` on a deploy branch either matches `main` at the promoted SHA or is the single per-env VM-truth file. No overlay YAML is hand-edited on deploy branches. Non-digest drift is structurally impossible."
spec_refs:
  - cd-pipeline
  - ci-cd
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer: claude-code
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-19
updated: 2026-04-19
labels: [cicd, deploy-branch, gitops, config-drift, follow-up]
external_refs:
  - predecessor: bug.0333
  - trigger-incident: task.0280 preview validation, 2026-04-19
---

## Open questions (resolve before design)

- **Production topology**: why do production's EndpointSlice patches use `127.0.0.1` for scheduler-worker and `10.0.0.1` for operator/poly/resy? Is `10.0.0.1` a placeholder, a k3s podCIDR route, or an actual interface? Confirm from the running production VM (or its provision script) whether one IP could serve both, or whether the env-state schema needs multiple fields.
- **Canary vs preview IPs**: canary and preview currently both use `84.32.109.222`. Intentional (same VM)? Expected to differ once canary is on a separate VM? This shapes whether env-state is "per env" or "per VM."
- **Truth source format**: is `ConfigMap/env-state` (yaml) with `config.kubernetes.io/local-config: "true"` the right shape for kustomize `replacements`, or is a plain values file pulled via a `configMapGenerator` cleaner?

## Sketch (pre-design)

Carry forward from bug.0333 rev-1's design:

- `infra/k8s/overlays/<env>/env-state.yaml` — the only deploy-branch-local file.
- Each overlay uses kustomize `replacements:` to inject `env-state` values into EndpointSlice addresses.
- Workflow: `rsync -a --delete --exclude='env-state.yaml' app-src/infra/k8s/ deploy-branch/infra/k8s/`.
- Provision scripts write only `env-state.yaml`.
- Migration path: idempotent provision step writes `env-state.yaml` on first promote after merge; no manual deploy-branch commits.
- CI guard: post-promote `git diff <promoted-sha> HEAD -- infra/k8s/ ':!**/env-state.yaml'` must be empty modulo digest lines.

Docs/specs list from bug.0333 rev-1 carries forward here: `docs/spec/ci-cd.md`, `docs/spec/cd-pipeline-e2e.md`, `docs/spec/cd-pipeline-e2e-legacy-canary.md`, `docs/spec/deploy.config-reconciliation.md`, `docs/spec/preview-deployments.md`, `docs/guides/multi-node-deploy.md`, `docs/guides/node-formation-guide.md`, plus workflow + provision script headers.

## Validation

- `kustomize build` rendered EndpointSlice addresses match pre-change baseline per env.
- `git diff <promoted-sha> origin/deploy/<env> -- infra/k8s/ ':!**/env-state.yaml'` empty (modulo digest) on every promoted env.
- Deliberate ConfigMap change on main (e.g. touch `LOG_LEVEL` in a genuinely-env-varying overlay patch) reaches `deploy/candidate-a` in 1 promote cycle.
- Reprovision a preview VM with a different IP → single commit to `deploy/preview/env-state.yaml`, no other files touched.
