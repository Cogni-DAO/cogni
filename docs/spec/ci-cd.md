---
id: ci-cd-spec
type: spec
title: CI/CD Pipeline Flow
status: active
trust: draft
summary: Trunk-based CI/CD where PRs prove safety in fixed candidate slots before merge and accepted code promotes forward from `main` by digest without rebuilds
read_when: Understanding deployment pipelines, release workflow, or CI configuration
owner: derekg1729
created: 2026-02-05
verified: 2026-04-20
tags: []
---

# CI/CD Pipeline Flow

## Overview

This spec defines the target CI/CD model for the repo:

- `main` is the only long-lived code branch
- pull requests prove safety before merge in fixed `candidate-*` slots
- accepted code promotes forward from `main` without rebuilds
- deploy branches hold environment state only and are reconciled by Argo CD

This document supersedes the old canary-first branch model. The branch model, deploy-state model, and axioms below are the live contract — workflows, scripts, and agent skills that diverge from it are bugs, not allowed drift.

## Core Axioms

1. **`main` is code truth**. It holds safe, accepted code.
2. **Code merges when safe, not merely when ready**. Incomplete work should be hidden behind flags or stay in PRs.
3. **Pre-merge safety happens in candidate or flight slots**. Do not call those lanes `canary`.
4. **Build once, promote by digest**. Downstream environments never rebuild artifacts.
5. **Deploy branches are environment state only**. `deploy/*` branches contain rendered deployment state, not product code.
6. **Argo owns reconciliation**. CI writes desired state to git; Argo syncs from git.
7. **Affected-only CI is the default**. Required checks should scope to the changed surface where practical.
8. **Release branches are exceptional only**. They are not the default path for accepted code.
9. **Direct edits to `deploy/*` are incident-only**. Repair the live environment first when necessary, then mirror the fix back into the normal source-of-truth path.
10. **Agent guidance is part of the control plane**. Prompts, skills, AGENTS files, and workflow docs must not tell agents to PR into or diff against legacy branches.
11. **Verification is a job-level gate, never a step-level skip** (bug.0321). GitHub treats a skipped step inside a running job as green. Every verification that is allowed to no-op (e.g. empty `promoted_apps`) must be gated at the _job_ level with `needs:` and `if:` so the job surfaces as **skipped (grey)** in the checks list, not as a silent-green success.
12. **Gate ordering is enforced structurally, not by convention** (bug.0321 Fix 4). When step A must precede step B in the same job, A writes a marker to `$GITHUB_ENV` (e.g. `ARGOCD_SYNC_VERIFIED=true`) and B refuses to run without it. Comments rot at the next refactor; runtime checks don't.
13. **Artifact provenance travels with the artifact** (bug.0321 Fix 4). `.promote-state/source-sha-by-app.json` on each deploy branch records per-app `source_sha` at promotion time. Production promotions copy it forward from preview; verifiers read it to assert per-app contract (`/version.buildSha == map[app]`), which is the only cross-PR-safe check when affected-only CI produces a mixed-SHA overlay. (task.0345 / PR #978 moved the probe from `/readyz.version` to the dedicated unauthenticated `/version` endpoint so that infra-degraded `/readyz` 503s cannot false-fail an artifact-identity check.)
14. **Skipped verification is not success** (bug.0328). When a downstream job (`release-slot`, `lock-preview-on-success`) consumes the result of a verification job that was gated `if: promoted_apps != ''` per Axiom 11, a `skipped` result is only a valid green signal when `promoted_apps == ''`. A skipped verification combined with a non-empty `promoted_apps` is a **contradiction** (the promote job pushed real digests but verification never ran, e.g. because `promote-build-payload.sh` aborted mid-run and left `$GITHUB_OUTPUT` empty), and must hard-fail the workflow. The job-level skip gate from Axiom 11 prevents _silent step-skip_ success; this axiom prevents _silent job-skip_ success at the consumer. Defense: emit `promoted_apps` incrementally + via `trap EXIT` so the signal survives abort, AND have consumers treat skip-with-promotions as failure.
15. **Argo "Healthy" is necessary but not sufficient** (bug.0326). `status.health.status == Healthy` fires as soon as enough pods are Ready — including pods from the **old** ReplicaSet during a rolling update. `/version` served from those pods returns the prior `BUILD_SHA`, so downstream `verify-buildsha.sh` fails on a green-up-stream flight. `wait-for-argocd.sh` therefore requires the promoted app's own `Deployment` resource inside the Argo `Application` to report `status=Synced`, then runs `kubectl rollout status deployment/<name>`; that combination proves Argo actually applied the new spec and the new ReplicaSet finished replacing the old one.
16. **Image target catalog is single-sourced** (bug.0328 architectural follow-up). `scripts/ci/lib/image-tags.sh` defines `ALL_TARGETS`, `NODE_TARGETS`, and `tag_suffix_for_target()` once. Every producer (`build-and-push-images.sh`), discoverer (`resolve-pr-build-images.sh`), dispatcher (`detect-affected.sh`), re-tagger (`flight-preview.yml` retag step), and promoter (`promote-and-deploy.yml` resolve + promote steps) sources that lib instead of maintaining its own copy. Adding a new node `mynode` is a single-file edit — workflows pick it up on the next run. Duplicate target lists across workflows are a code-smell of this axiom.
17. **`INFRA_K8S_MAIN_DERIVED`** (bug.0334). Every file under `infra/k8s/` on a deploy branch is byte-identical to `main` at the promoted SHA, OR is the per-overlay `env-state.yaml` (the VM-truth file written by provision). The promote workflow does a two-pass rsync: (1) `--ignore-existing` seed pass for `env-state.yaml` (bootstraps new overlays without clobbering VM-written IPs); (2) `--delete --exclude='env-state.yaml'` authoritative sync for everything else. Image digests are mutated by `promote-k8s-image.sh` after rsync — the only other deploy-branch-local write. Kustomize `replacements:` reads `env-state.yaml.data.VM_IP` and injects it into every EndpointSlice `/endpoints/0/addresses/0`, so VM IPs never live inline in `kustomization.yaml`. Violation: any non-digest, non-env-state diff between `main` and `deploy/<env>` after a promote.

## Branch And Deploy-State Model

```text
feature/* → PR → main                               (app code)
deploy/candidate-a, deploy/candidate-b, ...        (pre-merge env state)
deploy/preview, deploy/production                  (post-merge env state)
```

- **Feature branches** are short-lived and PR into `main`.
- **`main`** is the only long-lived shared code branch.
- **`deploy/candidate-*`** branches hold desired state for pre-merge safety lanes.
- **`deploy/preview`** and **`deploy/production`** hold desired state for post-merge promotion lanes.
- CI writes deployment state directly to deploy branches; Argo watches those branches and syncs the cluster.

**Key invariant**: CI never pushes application code to protected app branches.

**Key invariant**: Promotion means changing desired state in a deploy branch, not rebuilding an image.

## Delivery Lanes

```mermaid
flowchart LR
featurePR[FeaturePR] --> prLane[PullRequestLane]
prLane --> candidateSlot[CandidateSlot]
candidateSlot --> safeToMerge[SafeToMerge]
safeToMerge --> mainBranch[Main]
mainBranch --> previewEnv[PreviewEnv]
previewEnv --> productionEnv[ProductionEnv]
```

### PR Lane

The PR lane is authoritative for merge safety in v0.

1. `pull_request` runs affected-only CI where available.
2. CI builds an immutable image for the exact PR head SHA.
3. The PR-head artifact is the authoritative v0 artifact.
4. Passing PRs become ready for manual candidate flight.
5. A human explicitly chooses which PR to flight next.
6. That chosen PR is deployed to `candidate-a` through `deploy/candidate-a`.
7. Candidate validation runs against the stable slot URL.
8. `candidate-flight` is authoritative for PRs explicitly sent to flight, but standard CI and build remain the universal merge gate in v0.

### Main Lane

The main lane is authoritative for promotion, not for pre-merge acceptance.

1. Merge to `main` records the accepted PR SHA.
2. The same proven digest promotes forward without rebuild.
3. `preview` is the first required post-merge promotion lane in v0.
4. Production promotion happens from the same digest by policy:
   - `release.yml` (manual dispatch) cuts a `release/*` PR from the preview
     current-sha into `main`; merging it is the code-truth gate.
   - A human directly dispatches `promote-and-deploy.yml` with
     `environment=production`, `source_sha=<preview current-sha>`, and
     `build_sha=<PR branch head SHA>`. `skip_infra=true` unless
     `infra/compose/**` changed. No intermediate PR: the dispatch IS the
     human gate, same entry point as preview uses. Same workflow, same
     verify-deploy contract, same e2e — just a different env input.
   - `promote-and-deploy.yml` promotes overlay digests on
     `deploy/production` and Argo CD reconciles production pods.

If a post-merge soak lane is retained later, it must be modeled as an explicitly named environment with a distinct purpose. The term `canary` must not be reused for pre-merge acceptance.

Merge queue is deferred in v0. If the repo later adopts merge queue, the workflow graph must add `merge_group` support and revisit artifact authority explicitly instead of assuming the PR-head artifact still maps cleanly to the accepted merge candidate.

## Minimum Authoritative Validation For V0

Do not block the rewrite on perfect black-box E2E maturity. For PRs explicitly sent to candidate flight in the current prototype, the required flight gate is:

- affected-only static checks plus unit tests
- successful image build for the exact PR SHA
- **Argo CD reconciled to the deploy-branch tip SHA, the promoted Deployment resource is `Synced`, and app health is acceptable** for every app in `PROMOTED_APPS` (`scripts/ci/wait-for-argocd.sh`)
- **`kubectl rollout status` clean** for every in-cluster Deployment (`scripts/ci/wait-for-in-cluster-services.sh`)
- a prototype smoke pack passes:
  - `/readyz` returns `200` on operator, poly, and resy
  - `/livez` returns structured JSON on operator, poly, and resy
- **contract probe passes**: `/version.buildSha` on each promoted node-app matches the SHA that built its overlay digest (`scripts/ci/verify-buildsha.sh` in `SOURCE_SHA_MAP` mode, reading `.promote-state/source-sha-by-app.json` from the deploy branch)
- any human or AI validation needed to call the change safe

These gates run inside a **`verify-candidate` job** (for pre-merge candidate flight) or **`verify-deploy` job** (for post-merge preview + production promotion), both gated `if: promoted_apps != ''` at the job level per Axiom 11.

Optional but non-authoritative in v0:

- auth or session sanity paths
- chat or completion probes
- scheduler or worker sanity probes
- one or two node-critical API probes
- richer black-box E2E suites
- AI probe jobs against the changed surface
- broader post-merge soak analysis

## Environment Model

### Candidate Environments

Candidate environments are fixed, pre-running slots reused across PRs. They exist to validate selected unknown code before merge without creating a new VM per PR.

| Environment | Deploy Branch        | Purpose                      |
| ----------- | -------------------- | ---------------------------- |
| candidate-a | `deploy/candidate-a` | manual pre-merge safety slot |

Start with `candidate-a` only. Add `candidate-b` later only after the one-slot prototype is proven stable.

### Promotion Environments

Promotion environments run accepted code only.

| Environment | Deploy Branch       | Purpose               |
| ----------- | ------------------- | --------------------- |
| preview     | `deploy/preview`    | post-merge validation |
| production  | `deploy/production` | production            |

This spec does not require a `canary` environment. If one is retained during migration, it must be described explicitly as a post-merge soak lane and not as a branch or as a pre-merge safety lane.

### Preview Review Lock

`deploy/preview` holds a small state directory, `.promote-state/`, that drives merge-to-main flighting. Three files:

- **`candidate-sha`** — the most recent successfully built merge-to-main SHA. High-water mark. Written unconditionally on every flight attempt (`unlocked`, `dispatching`, or `reviewing`). Policy is **latest-wins, not FIFO**: if a hotfix is queued behind a later merge, only the latest is retained.
- **`current-sha`** — the SHA actually deployed to preview and under human review. Written only after a preview deploy reaches the E2E success step. `create-release.sh` reads this to cut release branches.
- **`review-state`** — `unlocked | dispatching | reviewing`. This is a pre-dispatch lease, not a boolean.

Transitions:

| From → To                 | Written by                                                  | Trigger                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unlocked → dispatching`  | `scripts/ci/flight-preview.sh`                              | merge to main (or manual flight dispatch); atomic with `candidate-sha` update                                                                                                                                                                                                                                                 |
| `dispatching → reviewing` | `lock-preview-on-success` job in `promote-and-deploy.yml`   | preview deploy reaches E2E success; writes `current-sha`                                                                                                                                                                                                                                                                      |
| `dispatching → unlocked`  | `unlock-preview-on-failure` job in `promote-and-deploy.yml` | any of `promote-k8s`, `deploy-infra`, `verify`, `verify-deploy`, `e2e` does not reach success (failure, cancelled, or skipped). Empty-promotion runs legitimately skip `verify-deploy` and therefore `e2e`, which fires unlock — preview stays unlocked instead of silently advancing its lease against an unchanged overlay. |
| `reviewing → unlocked`    | `auto-merge-release-prs.yml`                                | release PR merges                                                                                                                                                                                                                                                                                                             |

On release-merge unlock, if `candidate-sha != current-sha` the workflow dispatches a fresh flight with `sha=candidate-sha` to drain the queue. A flight concurrency group (`flight-preview`) serializes entry to the `unlocked → dispatching` transition; the three-value lease is the correctness guarantee even if concurrency is bypassed.

**Direct pushes to main are not a supported flight trigger.** The flight workflow re-tags `pr-{N}-{sha}` → `preview-{sha}` in GHCR and requires an associated PR number; direct pushes exit 0 with a message. Maintenance commits on `main` that carry no merged PR would trip the same PR-resolution guardrail, so `flight-preview.yml` skips its `flight` job when `github.event.head_commit.message` starts with either prefix: `chore(deps): argocd-image-updater` (bug.0344 Image Updater write-back) or `chore(preview):` (task.0349 digest-seed on `main`). Keying is **message-prefix**, not author identity (`github-actions[bot]` is shared).

## Workflow Design Targets

When implementation begins, workflow changes should follow these rules:

1. **Two lanes only**. One PR safety lane and one main promotion lane.
2. **No branch-name inference for environment routing**. Environment selection must be explicit input, artifact metadata, or deployment-state driven.
3. **No default `release/* -> main` conveyor**. If production still needs explicit approval, make it an environment or promotion control rather than a separate accepted-code branch.
4. **No duplicate orchestration**. E2E, promote, and deploy ownership should be clear rather than split across overlapping workflow graphs.
5. **No legacy branch guidance in prompts or docs**. Agents should not be told to diff against or PR into `staging` or a long-lived `canary` branch.

### App and infra levers are independent (task.0314)

Candidate-a deploy has two orthogonal levers; either can be dispatched independently:

| Workflow                     | Role        | Touches Argo (k8s pods) | Touches VM compose |
| ---------------------------- | ----------- | ----------------------- | ------------------ |
| `candidate-flight.yml`       | App lever   | Yes                     | No                 |
| `candidate-flight-infra.yml` | Infra lever | No                      | Yes                |

- **App lever** writes image digests to `deploy/candidate-a`; Argo CD reconciles pods. No VM SSH for compose. This upholds the `Argo owns reconciliation` axiom.
- **Infra lever** rsyncs `infra/compose/**` from a named git ref (default `main`) to the candidate-a VM and runs `compose up`. It never writes to a `deploy/*` branch.
- `scripts/ci/deploy-infra.sh` accepts `--ref <git-ref>` (default `main`) and `--dry-run`. The rsync source is a detached `git worktree add` of the ref, NOT the caller workflow's checkout — app PRs branched before an infra change can be flown without rebasing.

For `promote-and-deploy.yml` (preview/prod merge path), the job graph is:

```text
promote-k8s ─► deploy-infra ─┬─► verify-deploy ─┐
                             └─► verify         ┴─► e2e ─┬─► lock-preview-on-success
                                                         └─► unlock-preview-on-failure
```

- `verify-deploy` is job-level gated `if: promote-k8s.outputs.promoted_apps != ''` (Axiom 11). Runs `wait-for-argocd` → `wait-for-in-cluster-services` → `verify-buildsha` (`SOURCE_SHA_MAP` mode). Depends on `deploy-infra` so secrets-restart completes before the contract probes run.
- `verify` and `verify-deploy` run in parallel from the `deploy-infra` fan-out; `verify` is the always-on DOMAIN probe, `verify-deploy` is the gated contract probe.
- Empty-promotion runs (infra-only, docs-only, queue-only) → `verify-deploy` skipped → `e2e` skipped → `lock-preview-on-success` skipped → `unlock-preview-on-failure` fires (Axiom 11 + Axiom 12).
- The `candidate-flight.yml` workflow mirrors this with a `flight → verify-candidate → release-slot` graph (plus `report-no-acquire-failure` for pre-acquire failures). `verify-candidate` uses the same `wait-for-argocd → readiness → verify-buildsha` chain and the same `if: promoted_apps != ''` job-level gate. `release-slot.Decide lease state` enforces Axiom 14 — `verify-candidate.result == skipped` is only accepted as success when `flight.outputs.promoted_apps == ''`; a skip against a non-empty promoted_apps fails the job with an explicit `::error::`. `wait-for-argocd.sh` enforces Axiom 15 — once Argo reports the deploy-branch revision, acceptable app health, and a `Synced` Deployment resource for each promoted app, it runs `kubectl rollout status` to guarantee the new ReplicaSet fully replaced the old one before `verify-buildsha` curls **`/version`** and asserts **`.buildSha`** (task.0345 / #978; not `/readyz`).

### Source-SHA Map Provenance

Every deploy branch carries `.promote-state/source-sha-by-app.json` — a merge-semantics JSON map from app name to the PR head SHA that built that app's current overlay digest.

```json
{
  "operator": "abc123...",
  "poly": "def456...",
  "resy": "abc123...",
  "scheduler-worker": "abc123..."
}
```

**Writers** (bug.0321 Fix 4):

- `scripts/ci/update-source-sha-map.sh` — shared primitive that merges a single `app → sha` entry into the file. Untouched apps retain their prior entry (merge, not overwrite).
- `scripts/ci/promote-build-payload.sh` — calls the primitive after each promoted app (candidate-flight path).
- `.github/workflows/promote-and-deploy.yml` promote-k8s loop — calls the primitive after each promoted app (preview + production path).
- Production promotion: a human dispatches `promote-and-deploy.yml` with `environment=production`, `source_sha=<preview current-sha>`, `build_sha=<PR branch head SHA>`. The `promote-k8s` job reads preview's overlay digests through the shared `preview-{sha}` tag convention, copies them onto `deploy/production`, and carries `.promote-state/source-sha-by-app.json` forward so `verify-buildsha.sh` can assert cross-PR mixed-SHA contract.

**Reader**: `scripts/ci/verify-buildsha.sh` in `SOURCE_SHA_MAP` mode. When `NODES` is set (candidate-flight / promote-and-deploy pass `promoted_apps`), verifies only those apps' map entries — not every key in the file — so affected-only runs do not false-fail untouched apps (task.0349). When `NODES` is unset, every Ingress-probeable key in the map is checked. Each probe curls `/version` and asserts `.buildSha == map[app]`. (The probe is the dedicated `/version` endpoint, not `/readyz` — task.0345 / PR #978.)

**Why the map instead of a single `EXPECTED_BUILDSHA`**: production promotions copy preview's overlays, which can mix digests from different PR head SHAs (affected-only CI rebuilds a subset). A single SHA check is only valid when every promoted app comes from the same build; the map is the only cross-PR-safe contract.

## Deploy Branch Rules

- Deploy branches are long-lived, machine-written environment-state refs.
- `infra/k8s/` tracks `main` under invariant `INFRA_K8S_MAIN_DERIVED` (Axiom 17). Only image digests (mutated by `promote-k8s-image.sh`) and `env-state.yaml` files (written by provision) are allowed to differ from main. All other overlay content — ConfigMap patches, Service patches, resource lists, `replacements:` blocks — is rsynced from main every promote.
- **Preview digest seed on `main` (INFRA_K8S_MAIN_DERIVED)** — `promote-and-deploy.yml` rsyncs `infra/k8s/` from **main** at the promoted SHA into `deploy/preview` before mutating digest lines. Therefore `main:infra/k8s/overlays/preview/<app>/kustomization.yaml` digest pins are the **rsync seed** for every later preview promote; they must stay pullable and aligned with GHCR.
- **task.0349 — CI-owned seed (preferred path)** — Only when Flight Preview **dispatched** `promote-and-deploy` (preview lease was `unlocked`, not queue-only), [`promote-preview-digest-seed.yml`](../../.github/workflows/promote-preview-digest-seed.yml) runs [`scripts/ci/promote-preview-seed-main.sh`](../../scripts/ci/promote-preview-seed-main.sh) (**Option B**: direct `promote-k8s-image.sh --no-commit` calls; does **not** reuse `promote-build-payload.sh`, which is coupled to deploy-branch `.promote-state/` provenance). **Tri-state per image:** resolve `preview-{mergeSha}{suffix}` when the merge produced/retagged that image; else **retain** the existing pin from the overlay if it still resolves in GHCR; else **fail**. Emits at most **one** `chore(preview): …` commit to `main` per such merge when overlay lines change. **Queue-only** Flight Preview runs (lease `reviewing` / `dispatching`) upload outcome `queued` and **do not** trigger digest seed — no bot commits for those merges. The workflow uses a read-only job plus verified checkout (`head_sha` must be an ancestor of `origin/main`) before `contents:write` push. **`preview-dispatched-marker`** in `flight-preview.yml` is skipped (grey) when the flight was queue-only, so branch protection can require it as the "preview actually dispatched" signal.
- **bug.0344 / task.0349 — Image Updater vs preview seed** — `preview-applicationset.yaml` carries **no** `argocd-image-updater.argoproj.io/*` annotations (task.0349): preview digest pins on `main` are CI-owned (`flight-preview` / `promote-and-deploy` / [`promote-preview-digest-seed.yml`](../../.github/workflows/promote-preview-digest-seed.yml)). The Image Updater controller may still be installed in-cluster from earlier bootstrap; it is no longer wired via this AppSet. **Scope guard:** [`scripts/ci/check-image-updater-scope.sh`](../../scripts/ci/check-image-updater-scope.sh) requires **zero** annotations on every `*-applicationset.yaml` (empty allowlist until a future work item re-introduces updater-backed envs). Bootstrap history: [docs/runbooks/image-updater-bootstrap.md](../runbooks/image-updater-bootstrap.md).
- **Prettier + machine YAML** — `infra/k8s/overlays/**/kustomization.yaml` stays prettier-ignored because `promote-k8s-image.sh` and related CI writers emit YAML that does not match Prettier's style.
- They are never merged back into app branches.
- PRs are not required for routine automated deploy-state updates; git history is the audit trail.
- Push access on `deploy/*` should be restricted to the CI app or bot, with incident-only human bypass if needed.
- Rollback is by reverting deployment-state commits.

## Known Unknowns

Track these explicitly during the spec rewrite, following the CI/CD scorecard style of keeping unresolved questions visible:

- [ ] **Candidate selection and slot control**
      Define the manual flight trigger, lease, timeout, cleanup, and status ownership without building a queueing system into v0.
- [ ] **E2E validation workflows**
      Decide what stays in the authoritative v0 gate versus what remains advisory, and define how smoke tests, richer black-box E2E, and post-merge validation divide across the PR lane and main lane.
- [ ] **Git-manager agent as a first-class control-plane actor**
      Define whether a git-manager style agent owns PR build tracking, candidate slot coordination, deploy-branch promotion, and status reporting, or whether those responsibilities stay in plain workflows with agent assistance around them.
- [ ] **Candidate-a + production seed freshness**
      Preview overlay seeds on `main` are CI-owned (task.0349); candidate-flight overwrites `deploy/candidate-a` digests on slot acquisition; production overlays on `main` stay human-gated via direct `promote-and-deploy.yml` dispatch (env=production). Still open: a detection signal for candidate-a + production seed staleness (Loki/Grafana query on overlay-digest age), and a design for write-rate-minimized candidate-a auto-updates if that path is ever revisited (e.g. only write when the seed is ≥N days stale).
- [ ] **Rollout-status health check to replace task.0341 polling (bug.0345)**
      Argo reporting Healthy before the old ReplicaSet drains is a health-check-semantics bug, not a polling-interval bug. Bumping the poll window doesn't fix it. Fix: `kubectl rollout status deployment/X --timeout=5m` (observes `observedGeneration`, `updatedReplicas == replicas`, `Progressing=NewReplicaSetAvailable`) OR a proper Argo Deployment health check with correctly-wired probes. task.0341 solved at the wrong layer; replacement is bug.0345.
- [ ] **OpenFeature flags**
      Decide how feature flags reduce PR scope, shrink risky surface area, and let code merge when safe without requiring every incomplete capability to be fully user-exposed.
- [ ] **Merge queue integration later**
      If concurrency pressure eventually justifies merge queue, add `merge_group` workflows and revisit authoritative artifact selection at that time rather than mixing both models in v0.

## Legacy Surfaces To Retire

The following patterns are now legacy and should be removed during implementation:

- long-lived `staging` or `canary` code-branch semantics
- branch-based environment inference in workflow logic
- prompts, skills, AGENTS files, or workflow docs that steer agents toward `origin/staging` or PRs into non-`main` branches
- release branch enforcement as the normal path for accepted code
- namespace, overlay, or deploy-state naming that still encodes `staging` for the preview lane

## Non-Goals For V0

This spec does not require:

- fully dynamic per-PR ephemeral environments
- perfect end-to-end coverage before adopting the model
- a production release branch for every accepted change
- a decision today on every future soak, canary, or experimentation lane

## Related Documentation

- [CD Pipeline E2E](cd-pipeline-e2e.md) — trunk-alignment guide mapping legacy multi-node GitOps design to the target workflow and code-task changes
- [Candidate Slot Controller](candidate-slot-controller.md) — v0 design for lease, TTL, superseding-push handling, and aggregate candidate-flight status
- [CD Pipeline E2E Legacy Canary](cd-pipeline-e2e-legacy-canary.md) — historical canary/staging-era multi-node GitOps detail retained for reference during migration
- [Node CI/CD Contract](node-ci-cd-contract.md) — CI/CD sovereignty invariants, file ownership
- [Application Architecture](architecture.md) — Hexagonal design and code organization
- [Deployment Architecture](../runbooks/DEPLOYMENT_ARCHITECTURE.md) — Infrastructure details
- [CI/CD Conflict Recovery](../runbooks/CICD_CONFLICT_RECOVERY.md) — historical release conflict recovery guidance
