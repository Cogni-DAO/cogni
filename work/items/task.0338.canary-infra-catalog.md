---
id: task.0338
type: task
title: "Canary — infra catalog + CI wiring + k8s base + overlays"
status: needs_design
priority: 1
estimate: 5
rank: 2
summary: "Everything that turns `nodes/canary/` from a directory into a flightable target: catalog entry, detect-affected registration, build recipes, k8s base, overlays, wait-for-argocd, Caddy routing, and DNS."
outcome: "A PR opened off `feat/cogni-canary-scaffold` passes `pr-build.yml` with a `canary` target, and `candidate-flight.yml` can promote a canary image to `candidate-a` with Argo reaching Healthy."
spec_refs:
  - canary
  - cicd-services-gitops
assignees: derekg1729
project: proj.cogni-canary
created: 2026-04-20
updated: 2026-04-20
labels: [canary, ci, k8s, argo]
external_refs:
  - infra/catalog/
  - scripts/ci/detect-affected.sh
  - scripts/ci/build-and-push-images.sh
  - scripts/ci/resolve-pr-build-images.sh
  - scripts/ci/wait-for-argocd.sh
  - infra/k8s/base/
  - infra/k8s/overlays/
  - infra/compose/edge/configs/Caddyfile.tmpl
---

# Canary infra catalog + CI wiring

## Context

task.0337 lands the source tree. Without the CI + GitOps plumbing below, the service won't build in PR CI, won't be discovered by Argo ApplicationSets, and won't have a routable public URL. Every step is required — missing any one silently green-lights CI and never deploys (see enforcement rules in `.claude/skills/devops-expert/SKILL.md`).

## Deliverables

### CI

- [ ] `infra/catalog/canary.yaml` — `{ name: canary, type: node, port: 3400, node_id: "89612f02-114d-460d-87a5-c2ab212ccf6f", dockerfile: nodes/canary/app/Dockerfile }`
- [ ] `scripts/ci/detect-affected.sh` — append to `ALL_TARGETS`, add `nodes/canary/*` → `add_target canary` case
- [ ] `scripts/ci/build-and-push-images.sh` — `resolve_tag` + `build_target` cases for `canary`
- [ ] `scripts/ci/resolve-pr-build-images.sh` — matching `resolve_tag` case
- [ ] `scripts/ci/wait-for-argocd.sh` — add `canary` to `APPS=(...)` (classify as critical; flight fails if not Healthy)
- [ ] `.github/workflows/build-multi-node.yml` — add `canary` to `build-nodes` matrix (manual fallback)

### k8s

- [ ] `infra/k8s/base/canary/` — if canary needs node-specific base resources; otherwise reuse `base/node-app` via overlay `namePrefix: canary-` (mirror operator pattern; poly has its own Doltgres base)
- [ ] `infra/k8s/overlays/candidate-a/canary/kustomization.yaml` — NodePort **30400**, secret ref `canary-node-app-secrets`, ConfigMap patches for `NODE_NAME=canary`, `NEXTAUTH_URL=https://canary-candidate-a.cognidao.org`
- [ ] `infra/k8s/overlays/preview/canary/kustomization.yaml` — NodePort 30400 in preview namespace
- [ ] `infra/k8s/overlays/production/canary/kustomization.yaml` — only after CP5 revenue proof (gated)

### Compose (dev + VM edge)

- [ ] `infra/compose/runtime/docker-compose.yml` — add `canary` service
- [ ] `infra/compose/runtime/docker-compose.dev.yml` — add `canary` service
- [ ] `infra/compose/edge/configs/Caddyfile.tmpl` — add `{$CANARY_DOMAIN}` → `host.docker.internal:30400` block
- [ ] `scripts/setup/provision-test-vm.sh` — add `CANARY_DOMAIN` to the env plumbing and DNS_RECORDS array

### DNS

- [ ] Cloudflare A record: `canary-candidate-a.cognidao.org` → VM IP (provision script handles this once `CANARY_DOMAIN` is in the env loop)

### Secrets

- [ ] `setup-secrets.ts` — extend for canary DB credentials (`cogni_canary` in `COGNI_NODE_DBS`)
- [ ] `provision-test-vm.sh` Phase 6 — add `canary-node-app-secrets` k8s secret creation

### AppSet

- [ ] `infra/k8s/argocd/candidate-a-applicationset.yaml` + `preview-applicationset.yaml` — confirm the generator picks up `infra/catalog/canary.yaml` without template edits; add branches in the template only if necessary

## Validation

- `exercise:` — push a trivial commit to `nodes/canary/app/src/` on a candidate branch; `pr-build.yml` runs a matrix leg for `canary` and publishes `ghcr.io/cogni-dao/cogni-template:pr-{N}-{sha}-canary`; `candidate-flight.yml --pr {N}` promotes it and reaches `Argo Healthy`.
- `observability:` — Loki query `{app="canary", namespace="cogni-candidate-a"} |= "singularity"` returns the stub route's log line at the deployed SHA.

## Non-goals

- Production overlay (gated on CP5)
- Real brain loop (task.0341)
