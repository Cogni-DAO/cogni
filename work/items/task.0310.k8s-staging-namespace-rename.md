---
id: task.0310
type: task
title: "Rename k8s staging namespace and overlays to preview"
status: needs_design
priority: 2
rank: 5
estimate: 2
assignees: [derekg1729]
created: 2026-04-12
updated: 2026-04-12
project: proj.cicd-services-gitops
summary: "Rename cogni-staging k8s namespace, staging-applicationset.yaml, infra/k8s/overlays/staging/, deploy/staging branch, and check-gitops scripts to use preview consistently."
outcome: "No more staging terminology in infra layer — namespace, overlays, ApplicationSet, and deploy branch all say preview."
---

# Rename k8s staging namespace and overlays to preview

## Context

The `staging` code branch was purged (PR #859). The k8s infrastructure layer
still uses `staging` as a name for the preview environment. This rename
completes the purge at the infra layer.

## Scope

| Resource             | Current                                        | Target                                     |
| -------------------- | ---------------------------------------------- | ------------------------------------------ |
| k8s namespace        | `cogni-staging`                                | `cogni-preview`                            |
| ApplicationSet       | `infra/k8s/argocd/staging-applicationset.yaml` | `preview-applicationset.yaml`              |
| Argo CD app names    | `staging-operator`, `staging-poly`, etc.       | `preview-operator`, `preview-poly`, etc.   |
| Overlay dir          | `infra/k8s/overlays/staging/`                  | `infra/k8s/overlays/preview/`              |
| Deploy branch        | `deploy/staging`                               | `deploy/preview` (already exists — verify) |
| check-gitops scripts | `for env in staging production`                | `for env in preview production`            |
| Secrets dir          | `infra/k8s/secrets/staging/`                   | `infra/k8s/secrets/preview/`               |

## Constraints

- Requires coordinated VM + Argo CD + deploy branch change — not a pure git rename
- The live VM (`84.32.110.74` preview) must have the namespace recreated or migrated
- Argo CD ApplicationSet must be patched in-cluster AND in git atomically
- `deploy/preview` already exists as the promotion target — verify it doesn't conflict with `deploy/staging`

## Validation

- `exercise:` `kubectl get ns cogni-preview` returns the namespace
- `observability:` `kubectl -n argocd get applicationsets cogni-preview` shows healthy

## Acceptance

- `kubectl get ns` shows `cogni-preview`, not `cogni-staging`
- `kubectl -n argocd get applicationsets` shows `cogni-preview`
- `pnpm check:docs` passes
- `scripts/ci/check-gitops-service-coverage.sh` checks `preview` + `production`
- No remaining `staging` refs in `infra/k8s/`, `scripts/ci/check-gitops-*.sh`
