---
id: bug.0344
type: bug
title: Hand-curated overlay digests drift on every unrelated flight — adopt a digest-update controller
status: needs_design
priority: 0
rank: 1
estimate: 5
summary: "Main's `infra/k8s/overlays/*/<service>/kustomization.yaml` digest fields are hand-maintained seeds. Every flight runs `rsync -a --delete` of main's overlay onto the deploy branch, then `promote-k8s-image.sh` bumps digests only for apps in the affected-targets set (`scripts/ci/detect-affected.sh`). Services not touched by the flight's PR inherit main's seed — if the seed is stale, the deploy branch silently reverts to a pre-feature image on every unrelated flight. Produced #970 (poly-doltgres migrator with missing script → ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND), #971 (scheduler-worker pre-multi-queue → 30–40s silent chat hang on preview + candidate-a), #972 (operator + resy pre-BUILD_SHA → /readyz.version=0 → verify-buildsha fails every flight). Manual per-service bumps are sunk cost on a dying pattern and don't scale past v0."
outcome: "Git is eventually-consistent with GHCR. A dedicated controller watches the registry for new images matching a per-service policy (e.g. newest digest for `preview-<main-sha>-<service>`) and commits the digest update back to `main`. Unrelated flights never regress a service's digest. `scripts/ci/promote-k8s-image.sh` + hand-bumps disappear from the routine flow. Zero new bespoke GitHub Actions workflows."
spec_refs:
  - ci-cd
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
deploy_verified: false
reviewer:
revision: 0
blocked_by:
created: 2026-04-21
updated: 2026-04-21
labels: [cicd, infra, gitops, drift, argo]
external_refs:
  - scripts/ci/promote-k8s-image.sh
  - scripts/ci/detect-affected.sh
  - .github/workflows/candidate-flight.yml
  - .github/workflows/flight-preview.yml
  - docs/spec/ci-cd.md
---

# Adopt a digest-update controller — retire manual overlay-digest maintenance

## Problem

Two sources of truth drift:

1. **The image in GHCR** — produced by `pr-build.yml` on every commit matching `scripts/ci/detect-affected.sh` rules.
2. **The digest reference in `infra/k8s/overlays/*/<service>/kustomization.yaml` on `main`** — hand-curated.

Flights preserve (1) but overwrite deploy branches from (2). Services whose source hasn't changed in a PR inherit main's stale digest. The failure mode is silent: `/readyz.version=0` (pre-BUILD_SHA images), chat hangs (pre-multi-queue scheduler-worker), migrator crashes (missing script). Every "one-line digest bump" PR (#970, #971, #972) is the same anti-pattern.

## Design

Top-tier GitOps shops don't have this class of bug because they don't let git and registry drift in the first place. Either a controller watches the registry and writes digest updates back to git (pull-side), or the publishing system owns the digest commit as part of releasing the image (push-side, but as one mechanism — not per-service ad-hoc).

Candidate controllers — pick one:

| Option                                             | Pros                                                                           | Cons                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **A. Argo CD Image Updater** (recommended default) | Argo-native; built for exactly this; per-image policy; supports digest pinning | Uneven maintenance cycles over the years — evaluate activity + open-issue posture before committing |
| B. Flux `ImageUpdateAutomation`                    | Actively maintained; strong policy language; well-documented                   | Flux stack, not Argo — would run alongside Argo CD                                                  |
| C. Renovate (digest-pinning mode)                  | Battle-tested; already likely used for npm; low learning curve                 | Opens a PR per bump — noisier than a direct write; PR review adds latency                           |
| D. Custom GitHub Action                            | —                                                                              | Reinvents a dedicated controller in YAML; owned by nobody; repeats the `promote-k8s-image.sh` shape |

**Do not build option D.** It is the shape of this bug.

## Invariants

| Rule                          | Constraint                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NO_BESPOKE_DIGEST_WORKFLOW    | The solution is an adoption of an existing controller, not a new `.github/workflows/*.yml` that commits digests.                                                                                                                                                                                            |
| DIGEST_IMMUTABILITY_PRESERVED | Controller MUST pin by `@sha256:` digest, never mutable tags. `IMAGE_IMMUTABILITY` axiom (see `docs/spec/ci-cd.md`) is untouched.                                                                                                                                                                           |
| COMMIT_PROVENANCE_VISIBLE     | Every digest-update commit on `main` is signed/attributed to the controller identity and references the source image tag it corresponds to — so `git blame` on the overlay makes drift incidents traceable.                                                                                                 |
| SCOPE_IS_MAIN_ONLY            | Controller updates `main`'s overlay digests only. Deploy branch digest promotion (`promote-k8s-image.sh` during candidate/preview/production flights) stays as-is — that lever is what pins the flight to the build-lane image. The controller closes the gap where main's seed goes stale between flights. |

## File pointers (expected, scope-dependent)

| File                                                                      | Change                                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `infra/k8s/argocd/image-updater/` _(new, if option A)_                    | `deployment.yaml`, `kustomization.yaml`, `argocd-image-updater-config.yaml` with per-image policy annotations                       |
| `infra/k8s/overlays/*/<service>/kustomization.yaml` × N                   | Add Image Updater annotations on the `Kustomization` target OR keep digests as today; controller handles the commit-back regardless |
| `scripts/ci/promote-k8s-image.sh`                                         | Unchanged (deploy-branch promote stays the lever for flight-pinning)                                                                |
| `docs/spec/ci-cd.md` § Deploy Branch Rules                                | Replace the "known anti-pattern" callout with a reference to the controller's rollout                                               |
| `work/projects/proj.cicd-services-gitops.md` rows 21/22 (Active Blockers) | Flip to ✅ when controller is in steady-state across 3 envs (candidate-a, preview, production)                                      |

## Validation

- [ ] A service with no source changes in the last 30 days shows fresh digest on `main`'s overlay within 1h of a new image being published to GHCR (catches the exact scenario that broke scheduler-worker + operator + resy).
- [ ] Commit-back authorship is identifiable (`git log --author="<controller-identity>" -- infra/k8s/overlays/**/kustomization.yaml`).
- [ ] `promote-k8s-image.sh` still wins on deploy branches — a flight for a PR touching service X pins the deploy-branch digest to X's build image, regardless of what the controller wrote to `main` seconds earlier.
- [ ] No new `.github/workflows/*.yml` exists whose purpose is "commit digest updates to main".

## Blocked by / prerequisites

- Evaluation of controller candidate (A vs B vs C). Option A is the default recommendation — Argo-native — but open-source maintenance posture should be sanity-checked before commitment.
- GHCR credentials for the controller to read package metadata.
- Git write credentials for the controller to commit to `main` (bot identity, not human).

## Related

- Predecessor bandaids (all manual overlay-digest bumps — the anti-pattern this bug retires):
  - #970 / bug.0343 — poly-doltgres migrator
  - #971 — scheduler-worker multi-queue
  - #972 — operator + resy BUILD_SHA injection
- Sibling bug not retired by this work: rollout-status health check (Argo reporting Healthy before old ReplicaSet drains) — tracked in `proj.cicd-services-gitops.md` row 22.
- Anti-pattern description: `docs/spec/ci-cd.md` § Deploy Branch Rules.
