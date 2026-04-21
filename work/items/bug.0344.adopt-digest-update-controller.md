---
id: bug.0344
type: bug
title: Hand-curated overlay digests drift on every unrelated flight — adopt a digest-update controller
status: needs_review
priority: 0
rank: 1
estimate: 5
summary: "Main's `infra/k8s/overlays/*/<service>/kustomization.yaml` digest fields are hand-maintained seeds. Every flight runs `rsync -a --delete` of main's overlay onto the deploy branch, then `promote-k8s-image.sh` bumps digests only for apps in the affected-targets set (`scripts/ci/detect-affected.sh`). Services not touched by the flight's PR inherit main's seed — if the seed is stale, the deploy branch silently reverts to a pre-feature image on every unrelated flight. Produced #970 (poly-doltgres migrator with missing script → ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND), #971 (scheduler-worker pre-multi-queue → 30–40s silent chat hang on preview + candidate-a), #972 (operator + resy pre-BUILD_SHA → /readyz.version=0 → verify-buildsha fails every flight). Manual per-service bumps are sunk cost on a dying pattern and don't scale past v0."
outcome: "Git is eventually-consistent with GHCR. Argo CD Image Updater (pinned v0.15.2 — last version tested against Argo CD v2.13.x) watches the `deploy/preview` Applications for new `preview-*` image tags and commits fresh digests back to `main`'s `preview/` overlays under the existing `Cogni-1729` PAT identity used by every other automated commit in this repo. Scope is deliberately narrow for MVP; candidate-a and production overlays on main plus migrator images are follow-up work (see _MVP scope boundaries_ below). `scripts/ci/promote-k8s-image.sh` stays in place as the deploy-branch digest pinner — only the bit that previously required humans to copy digests back to main is automated here. Zero new bespoke GitHub Actions workflows, zero new GitHub App registrations, zero new branch-protection carve-outs."
spec_refs:
  - ci-cd
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: design/bug-0344-digest-updater
pr:
deploy_verified: false
reviewer:
revision: 1
blocked_by:
created: 2026-04-20
updated: 2026-04-20
labels: [cicd, infra, gitops, drift, argo]
external_refs:
  - scripts/ci/promote-k8s-image.sh
  - scripts/ci/detect-affected.sh
  - .github/workflows/candidate-flight.yml
  - .github/workflows/flight-preview.yml
  - infra/k8s/argocd/preview-applicationset.yaml
  - docs/spec/ci-cd.md
---

# Adopt a digest-update controller — retire manual overlay-digest maintenance

## Problem

Two sources of truth drift:

1. **The image in GHCR** — produced by `pr-build.yml` on every commit matching `scripts/ci/detect-affected.sh` rules, re-tagged `preview-{mainSHA}` by `flight-preview.yml` on merge.
2. **The digest reference in `infra/k8s/overlays/*/<service>/kustomization.yaml` on `main`** — hand-curated.

Flights preserve (1) but overwrite deploy branches from (2). Services whose source hasn't changed in a PR inherit main's stale digest. The failure mode is silent: `/readyz.version=0` (pre-BUILD_SHA images), chat hangs (pre-multi-queue scheduler-worker), migrator crashes (missing script). Every "one-line digest bump" PR (#970, #971, #972) is the same anti-pattern.

## Design

### Outcome

A dedicated controller makes `main`'s overlay digest seed **eventually-consistent with GHCR's `preview-*` tags** — the only tag class that represents merged, accepted code. Any flight that rsyncs main→deploy-branch now pulls a current seed; unrelated services never silently regress.

### Approach

**Solution**: Install **Argo CD Image Updater v0.15.2** (argoproj-labs, Apache-2.0) into the existing `argocd` namespace. Annotate each preview Application (generated from `preview-applicationset.yaml`) with an image-list + `write-back-method: git` + `git-branch: main`. The controller polls GHCR, finds new `preview-{sha}` digests, and commits digest updates back to `main`'s overlay kustomization files, authenticated as the existing **`Cogni-1729`** bot account via the already-provisioned `ACTIONS_AUTOMATION_BOT_PAT`. Provenance is established via stable commit-message prefix (`chore(deps): argocd-image-updater ...`) — the same mechanism `promote-k8s-image.sh`, `flight-preview.yml`, and `promote-to-production.yml` commits already rely on.

**Reuses**:

- **Argo CD Image Updater v0.15.2** — last upstream release explicitly tested against Argo CD v2.13.4 (`chore(deps): bump argo-cd from 2.13.2 to 2.13.4`, release 0.15.1 PR#925). We stay on this pin until the Argo CD server itself is upgraded to v2.14+ / v3.x, at which point an Image Updater upgrade can be earned (tracked as a follow-up, not a prerequisite).
- **`ACTIONS_AUTOMATION_BOT_PAT` + `Cogni-1729` identity** — already authoring every automated commit on `main` and `deploy/*` today (`release.yml`, `promote-to-production.yml`, `promote-and-deploy.yml`, `flight-preview.yml`). Image Updater's git write-back is the same trust envelope as those workflows. No new GitHub App, no new branch-protection carve-out.
- **Existing `preview-applicationset.yaml`** — annotated in place; no new AppSet.
- **Existing `infra/k8s/argocd/kustomization.yaml`** — the Image Updater install manifest slots in alongside `install.yaml` and `ksops-cmp.yaml`.
- **Existing per-service `kustomization.yaml` `images:` blocks** — controller writes the `digest:` field using the same syntax `promote-k8s-image.sh` already edits; no schema change.
- **Existing ksops CMP (`ksops-cmp.yaml`)** — the git-credentials secret and GHCR registry secret are delivered through the established SOPS/age encrypted-at-rest pattern. Same secret-management story as every other in-cluster secret today.

### Why watch `deploy/preview`, not `deploy/candidate-a`

`candidate-a` flies arbitrary PR builds (including unmerged / failed ones) via `candidate-flight.yml` — bumping `main`'s seed off a candidate-a build would propagate unaccepted code to every other service's seed. `deploy/preview` only receives digests from `flight-preview.yml`, which re-tags `pr-{N}-{sha} → preview-{mainSHA}` exclusively on merge. Every `preview-*` tag therefore represents accepted code — the correct signal to promote into `main`'s seed.

### Why write to `main`, not to the Application's source branch

Image Updater's default is to write to the Application's source branch (`deploy/preview` in our case). That's wrong for us — `deploy/preview` is machine-managed state that gets rsynced from `main` on every promotion. Writing there creates a fight with `promote-k8s-image.sh` and would be clobbered on the next flight. The `argocd-image-updater.argoproj.io/git-branch: main` annotation (per-Application) redirects the write-back to `main`, where the seed actually lives. `promote-k8s-image.sh` stays the authoritative pinner for flight-specific digests on `deploy/*`; Image Updater stays the authoritative seed-keeper on `main`. No fight.

### Why it doesn't fight with the flight workflow

| Writer                              | Target                                     | Trigger                            | Owns                                            |
| ----------------------------------- | ------------------------------------------ | ---------------------------------- | ----------------------------------------------- |
| `promote-k8s-image.sh` (candidate)  | `deploy/candidate-a` overlay               | PR flight                          | Pins the chosen PR's digest on the flight slot  |
| `promote-k8s-image.sh` (preview)    | `deploy/preview` overlay                   | merge-to-main flight               | Pins merged code's digest on the preview slot   |
| `promote-k8s-image.sh` (production) | `deploy/production` overlay                | manual `promote-to-production.yml` | Pins preview's validated digest on production   |
| **Argo CD Image Updater (new)**     | **`main` overlay (preview env only, MVP)** | continuous poll of GHCR            | Keeps `main`'s preview seed fresh for every app |

Rsync (`INFRA_K8S_MAIN_DERIVED`, Axiom 17) still wins on deploy branches: `main → deploy/<env>` then `promote-k8s-image.sh` overrides affected apps. The controller's commits to `main` arrive asynchronously — if a flight rsyncs before Image Updater catches up, the next flight will catch it. That's the "eventually-consistent" in the outcome statement.

### Rejected alternatives

- **Flux `ImageUpdateAutomation`** — strong policy language, actively maintained. Rejected: running the full Flux controller stack alongside Argo CD doubles the CRD surface and operational burden for a single capability we can get from an Argo-native sibling project.
- **Renovate (digest-pinning mode)** — battle-tested, already common in npm workflows. Rejected: opens a PR per digest bump. With 7 targets (`operator`, `operator-migrator`, `poly`, `poly-migrator`, `resy`, `resy-migrator`, `scheduler-worker`) and one merge producing 7 PRs, the review noise exceeds the drift savings. Image Updater's direct-commit mode is strictly simpler for this workload.
- **Custom GitHub Actions workflow that commits digests to `main`** — explicitly forbidden by invariant `NO_BESPOKE_DIGEST_WORKFLOW`. This is the shape of the bug, not the fix.
- **Extend `promote-k8s-image.sh` to also commit to `main`** — same failure mode: a one-shot script owned by nobody, still driven by the flight workflow's affected-only logic (the exact source of drift).

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **NO_BESPOKE_DIGEST_WORKFLOW** — solution is adoption of the existing Image Updater project, not a new `.github/workflows/*.yml` that commits digests. Fail if the PR adds a workflow whose purpose is "commit digest updates to main".
- [ ] **DIGEST_IMMUTABILITY_PRESERVED** — Image Updater is configured with `update-strategy: latest` (v0.15.2 semantics: pick newest tag by image-manifest creation timestamp), paired with a tight `allow-tags` regex that only admits the post-merge SHA-bearing tag class. Tag-class immutability comes from the regex, not the strategy name: every tag admitted by `^preview-[0-9a-f]{40}(-<suffix>)?$` is content-addressed by the merge SHA, so `IMAGE_IMMUTABILITY` axiom (`docs/spec/ci-cd.md`) is untouched. The `digest` strategy is the wrong primitive here (it tracks a single mutable tag). Verify: `allow-tags` admits only preview-SHA-tag-class, never `latest` / `stable` / floating tags.
- [ ] **COMMIT_PROVENANCE_VIA_MESSAGE_PREFIX** — every digest-update commit on `main` uses commit-message prefix `chore(deps): argocd-image-updater` (configured via Image Updater's `--commit-message-template` flag / `git.commit-message-template` ConfigMap key) so `git log --grep='argocd-image-updater' -- infra/k8s/overlays/` is the audit filter. The commit author is `Cogni-1729` — same as every other automated commit — intentionally consistent with the existing PAT-based automation pattern (`release.yml`, `promote-to-production.yml`, `promote-and-deploy.yml`, `flight-preview.yml`).
- [ ] **SCOPE_IS_MAIN_ONLY** — Image Updater writes to `main` only. Deploy branch digest promotion (`promote-k8s-image.sh` during candidate/preview/production flights) stays as-is. Verify: no Image Updater annotation points `git-branch` at a `deploy/*` branch.
- [ ] **PRODUCTION_NOT_AUTO_UPDATED** — production flights require explicit human dispatch via `promote-to-production.yml`. The controller watches only `deploy/preview`'s Applications; annotations on `production-applicationset.yaml` are **not** added. Verify: `infra/k8s/argocd/production-applicationset.yaml` has zero `argocd-image-updater.argoproj.io/*` annotations.
- [ ] **NO_NEW_GITHUB_APP** — reuses the existing `Cogni-1729` PAT (`ACTIONS_AUTOMATION_BOT_PAT`). No GitHub App registration, no branch-protection bypass carve-out, no new trust envelope. Verify: PR adds zero references to new App IDs / private keys / installation IDs.
- [ ] **SIMPLE_SOLUTION** — leverages the upstream install manifest as a remote Kustomize resource (same pattern as `install.yaml: https://raw.githubusercontent.com/argoproj/argo-cd/v2.13.4/manifests/install.yaml`). No forking, no vendoring, no Helm.
- [ ] **ARCHITECTURE_ALIGNMENT** — installs into the existing `argocd` namespace via the existing `infra/k8s/argocd/kustomization.yaml`. Credentials delivered via existing ksops CMP pattern. No new namespace, no new secret-management pattern.

### Wiring (concrete)

```text
pr-build.yml (per PR)
  └─ builds pr-{N}-{sha} in GHCR

flight-preview.yml (on merge to main)
  ├─ re-tags pr-{N}-{sha} → preview-{mainSHA} in GHCR   ← ✅ stable tag published
  └─ writes deploy/preview overlay digest via promote-k8s-image.sh

Argo CD Image Updater (continuous, every 2m default poll)
  ├─ watches: Applications generated from preview-applicationset.yaml (candidate-a and production intentionally excluded)
  ├─ registry: ghcr.io/cogni-dao/cogni-template with per-Application allow-tags regex
  │   (^preview-[0-9a-f]{40}{{image_tag_suffix}}$), update-strategy: latest
  └─ on new digest:
        write-back-method: git
        git-branch: main                                 ← ✅ writes to main, not deploy/preview
        write-back-target: kustomization    (Application source.path: infra/k8s/overlays/preview/{{name}})
        commit author: Cogni-1729 (reuses ACTIONS_AUTOMATION_BOT_PAT)  ← ✅ no new App
        commit message prefix: chore(deps): argocd-image-updater ...  ← ✅ provenance via grep
        → updates digest: "sha256:..." in main's preview/{{name}}/kustomization.yaml (MVP scope)

next preview flight
  └─ rsync main → deploy/preview  (Axiom 17)            ← ✅ main's preview overlay is fresh
     └─ promote-k8s-image.sh bumps affected apps only   ← ✅ non-affected apps now have CURRENT seed
```

### Files

**Create:**

- `infra/k8s/argocd/image-updater/kustomization.yaml` — references upstream install manifest pinned at `https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v0.15.2/manifests/install.yaml` plus local patches.
- `infra/k8s/argocd/image-updater/config-patch.yaml` — patches the `argocd-image-updater-config` ConfigMap: sets the `registries:` entry for `ghcr.io` (credentials reference the `argocd-image-updater-ghcr` Secret in the `argocd` namespace), sets `git.user` / `git.email` for Cogni-1729 commit authorship, and sets `git.commit-message-template` to prefix commits with `chore(deps): argocd-image-updater`.
- `docs/runbooks/image-updater-bootstrap.md` — one-page runbook: imperatively creating the two Kubernetes Secrets (`kubectl create secret generic --from-literal=... --dry-run=client -o yaml | kubectl apply -f -`, matching the pattern in `scripts/ci/deploy-infra.sh`), validating the first auto-commit on `main`, rolling back (removing AppSet annotations + scaling controller to 0) if the controller misbehaves, PAT rotation procedure (re-apply the Secret + `kubectl rollout restart deployment/argocd-image-updater -n argocd`). Note: ksops was retired from this repo's Argo CD bootstrap (`infra/provision/cherry/base/bootstrap.yaml`, task.0284 ESO migration) — secrets are **not** committed to git.

**Modify:**

- `infra/k8s/argocd/kustomization.yaml` — add `image-updater/` to `resources:` so the controller is installed alongside the existing `install.yaml`.
- `infra/k8s/argocd/preview-applicationset.yaml` — add the `argocd-image-updater.argoproj.io/*` annotations on the `template.metadata.annotations` block, parameterized via the catalog generator: `image-list: app=ghcr.io/cogni-dao/cogni-template`, `app.update-strategy: latest`, `app.allow-tags: regexp:^preview-[0-9a-f]{40}{{image_tag_suffix}}$`, `write-back-method: git:secret:argocd/argocd-image-updater-git-creds`, `git-branch: main`, `write-back-target: kustomization`. GHCR credentials are resolved at the registry level (via `registries.conf`) — no per-Application `pull-secret` annotation is needed.
- `infra/catalog/{operator,poly,resy,scheduler-worker}.yaml` — add `image_tag_suffix` field (`""` for operator, `"-poly"`, `"-resy"`, `"-scheduler-worker"` respectively), exposing the per-target tag suffix already canonical in `scripts/ci/lib/image-tags.sh` to the ApplicationSet template.
- `docs/spec/ci-cd.md` § Deploy Branch Rules — replace the current "⚠️ Known anti-pattern: main's overlay digests are hand-curated seeds." callout with a description of the controller's role (seed-keeper on `main`'s preview overlay) and a pointer to this bug's PR, the bootstrap runbook, and the remaining follow-up surfaces (candidate-a / production overlays + migrators).
- `work/projects/proj.cicd-services-gitops.md` row 21 (Active Blockers) — leave open after this PR lands; only flip once the MVP is extended to cover candidate-a/production overlays and migrators (tracked as separate follow-ups).

**MVP scope boundaries (what this PR intentionally does NOT cover):**

- **Candidate-a & production overlays on `main`** stay manually maintained. Rationale: Image Updater's `write-back-target: kustomization` writes to the Application's single `source.path`. The preview AppSet's source.path is `infra/k8s/overlays/preview/{{name}}` — so only that path is updated. Fan-out to sibling envs needs either (a) annotating the candidate-a AppSet the same way (legal — its Applications also live on `deploy/candidate-a`, so writes redirect to `main` via `git-branch: main`) or (b) a small post-commit script that mirrors the digest across env overlays. Pick one in a follow-up once this MVP is proven in steady state.
- **Per-node migrator images** (`cogni-template` tags `-poly-migrate`, `-resy-migrate`, `-operator-migrate`) stay maintained by `promote-k8s-image.sh --migrator-digest` on deploy branches. Rationale: the kustomize `images:` block uses two entries (app + migrator) sharing one `newName` but different source `name`s; Image Updater's one-alias-per-image-list model is awkward for this shape. Follow-up: add a second alias (`migrate=ghcr.io/cogni-dao/cogni-template`) per Application with its own `kustomize.image-name: ghcr.io/cogni-dao/cogni-template-migrate` write-back match.
- **Scheduler-worker + operator coverage in MVP**: both are included (same annotation shape, different `image_tag_suffix`). No node-app migrator dance there — operator has no Kubernetes migrator Job today and scheduler-worker has no migrator image at all.

**Test / Validation:**

- `docs/runbooks/image-updater-bootstrap.md` includes the explicit test: push a trivial change to `nodes/resy/app/...`, merge, observe `flight-preview.yml` re-tag to `preview-<merge-sha>-resy` in GHCR, observe within 5 minutes a `Cogni-1729`-authored commit on `main` updating `infra/k8s/overlays/preview/resy/kustomization.yaml` to the new `sha256:...`.

## Validation

**exercise:**

1. On `main`, capture current digest for resy in `infra/k8s/overlays/preview/resy/kustomization.yaml`: `D0`.
2. Merge a no-op change that touches `nodes/resy/**` (triggers `pr-build` → `flight-preview` → new `preview-{mergeSHA}-resy` tag). Capture new GHCR digest: `D1`.
3. Wait ≤ 5 minutes.
4. Expect: a new commit on `main` authored by `Cogni-1729` with message prefix `chore(deps): argocd-image-updater`, touching `infra/k8s/overlays/preview/resy/kustomization.yaml` and setting the primary app image's `digest:` field to `D1`. (Migrator entry + candidate-a/production overlays on main are explicitly out of MVP scope — they still get bumped the old way during flights.)
5. Trigger a `flight-preview` run for an **unrelated** PR (e.g. one touching only `nodes/poly/**`). After the flight rsyncs `main → deploy/preview`, inspect `deploy/preview:infra/k8s/overlays/preview/resy/kustomization.yaml`: resy's primary app digest must equal `D1` (fresh seed inherited from main), not `D0` (the stale pre-Image-Updater value).

**observability:**

- `{namespace="argocd",pod=~"argocd-image-updater-.*"}` in Loki shows `level=info msg="Successfully updated image"` for each processed Application, with the target digest in the payload.
- `git log --grep='chore(deps): argocd-image-updater' --since="1 hour ago" -- infra/k8s/overlays/preview/` returns at least one commit covering the resy update.
- `argocd app get preview-resy -o json | jq '.status.summary.images'` at rest matches the latest `main` preview seed for resy.

## Blocked by / prerequisites

- **Ksops secret authoring access** — the implementer needs SOPS/age private-key material to encrypt `ghcr-secret.enc.yaml` and `git-creds-secret.enc.yaml` locally before commit. Same requirement every other encrypted cluster secret has today; no new process.
- **GHCR scan via `GHCR_DEPLOY_TOKEN`** — the existing org-level PAT already has `read:packages` scope and is what every deploy pipeline uses to pull images. Reused verbatim for Image Updater's registry metadata scanning; no new credential.

_Intentionally not prerequisites_ (reconciled during `/review-design`):

- ~~New GitHub App registration~~ — reuses `ACTIONS_AUTOMATION_BOT_PAT` + `Cogni-1729`, the existing PAT-based automation identity. See `proj.vcs-integration.md` L70 — that "separate apps per blast radius" constraint governs GitHub **Apps**; PAT reuse is consistent with every other automated commit path in this repo.
- ~~Branch-protection carve-out on `main`~~ — the PAT already has push access to `main` (used by `release.yml`, `promote-and-deploy.yml`, `flight-preview.yml`). Same trust envelope, no new bypass rule.
- ~~Argo CD v2.14+ compatibility smoke test~~ — we pin v0.15.2, which was tested against Argo CD v2.13.4 upstream. Upgrading Image Updater to v0.18.x or v1.x is a follow-up tied to the Argo CD server upgrade, not a precondition for this MVP.

## Implementation review (revision 1)

Self-review against upstream v0.15.2 docs and the live bootstrap script surfaced four blockers plus one non-blocking cleanup. Each item has a specific fix and is cross-referenced to a source of truth — an upstream doc URL or a live file path in this repo. All must be green before `/closeout`.

- [x] **B1 — `.enc.yaml` ksops workflow is dead.** `infra/provision/cherry/base/bootstrap.yaml:176-179` explicitly retired ksops (`# ksops CMP plugin + repo-server sidecar patch removed. SOPS/ksops will be replaced by ESO (task.0284)`). Applying `infra/k8s/argocd/image-updater/kustomization.yaml` as shipped would submit SOPS ciphertext as raw Secret contents. Fix: drop `ghcr-secret.enc.yaml` + `git-creds-secret.enc.yaml` resources + the two `.enc.yaml.example` files; rewrite `docs/runbooks/image-updater-bootstrap.md` §1 and the PAT-rotation section to use imperative `kubectl create secret generic --from-literal=... --dry-run=client -o yaml | kubectl apply -f -`, matching the live pattern at `scripts/ci/deploy-infra.sh:966`.
- [x] **B2 — `update-strategy: newest-build` is not a v0.15.2 strategy.** [v0.15.2 docs](https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v0.15.2/docs/configuration/images.md#update-strategies) list only `semver | latest | name | digest`. Invalid values silently fall back to the `semver` default, which matches zero of our `preview-<40hex>{-suffix}` tags. Fix: change the annotation value in `infra/k8s/argocd/preview-applicationset.yaml` to `latest`; update the `DIGEST_IMMUTABILITY_PRESERVED` invariant narrative above to say `latest` and note that tag-class immutability comes from the `allow-tags` regex, not the strategy name.
- [x] **B3 — `app.pull-secret: pullsecret:...` is the wrong Secret type.** Per the same v0.15.2 doc (§Specifying pull secrets), `pullsecret:<ns>/<name>` requires a `kubernetes.io/dockerconfigjson` Secret with a `.dockerconfigjson` key. The authored Secret is `type: Opaque` with a `token` key. The annotation is also redundant — `config-patch.yaml`'s `registries.conf` entry (`credentials: secret:argocd/argocd-image-updater-ghcr#token`) already handles GHCR auth at the registry level. Fix: delete the `app.pull-secret` annotation line from `preview-applicationset.yaml`.
- [x] **B4 — commit author will be `argocd-image-updater <noreply@argoproj.io>`, not `Cogni-1729`.** Per [v0.15.2 update-methods docs](https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/v0.15.2/docs/basics/update-methods.md#specifying-the-user-and-email-address-for-commits), the HTTPS creds secret only controls _authentication_; _authorship_ comes from `git.user` + `git.email` in the `argocd-image-updater-config` ConfigMap (or CLI flags). The `COMMIT_PROVENANCE_VIA_MESSAGE_PREFIX` invariant above explicitly claims "The commit author is `Cogni-1729`" — that claim currently fails. Fix: add `git.user: Cogni-1729` and `git.email: <Cogni-1729 GitHub noreply>` to `infra/k8s/argocd/image-updater/config-patch.yaml`.
- [x] **C1 (non-blocking) — drop undefined template vars.** `git.commit-message-template` in `config-patch.yaml` references `{{ .NewDigest }}` and `{{ .OldDigest }}`; v0.15.2's template schema only exposes `.AppName` + `.AppChanges[].Image` / `.OldTag` / `.NewTag`. `text/template` renders missing fields as `<no value>`. Fix: remove the `@{{ .NewDigest }}` and `@{{ .OldDigest }}` fragments.

Drive-by notes (not this PR):

- `infra/k8s/argocd/kustomization.yaml:4` header comment + `ksops-cmp.yaml` resource + `repo-server-patch.yaml` sidecar patch are all ksops-era dead code. Track under task.0284 (ESO migration).
- `image_tag_suffix` in `infra/catalog/*.yaml` duplicates `scripts/ci/lib/image-tags.sh:tag_suffix_for_target`. Either side could become the generator for the other. Follow-up after this MVP proves out.

## Related

- **Predecessor bandaids** (all manual overlay-digest bumps — the anti-pattern this bug retires):
  - #970 / bug.0343 — poly-doltgres migrator
  - #971 — scheduler-worker multi-queue
  - #972 — operator + resy BUILD_SHA injection
- **Sibling bug not retired by this work:** rollout-status health check (Argo reporting Healthy before old ReplicaSet drains) — tracked as bug.0345 / `proj.cicd-services-gitops.md` row 22.
- **Anti-pattern description:** `docs/spec/ci-cd.md` § Deploy Branch Rules (to be updated by this PR).
- **Upstream project:** https://github.com/argoproj-labs/argocd-image-updater (2K ★, Apache-2.0, active 2026).
