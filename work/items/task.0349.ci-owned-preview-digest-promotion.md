---
id: task.0349
type: task
title: "CI-owned preview digest promotion; demote Image Updater to freshness-only"
status: needs_implement
priority: 1
rank: 1
estimate: 3
summary: "Replace Image Updater as the preview digest seed engine with one CI-authored commit per merge cycle to main (same files IU mutates today). Demote IU (no AppSet annotations; optional dormant install). Fixes N-commits/merge and aligns with promote-and-deploy rsync (main-derived infra/k8s seed)."
outcome: "After each human merge to main (post flight-preview retag), exactly one `chore(preview): …` commit updates `main:infra/k8s/overlays/preview/**` digest pins where GHCR has new `preview-{mergeSha}-*` tags; untouched services keep their prior digest pin when no new tag exists. `promote-and-deploy` rsync then inherits a correct seed. Zero Image Updater write-back commits. `flight-preview.yml` skips maintenance pushes via a second commit-message prefix (same pattern as IU). `docs/spec/ci-cd.md` documents the new authority and revokes the old anti-bespoke axiom."
spec_refs:
  - ci-cd
assignees: []
project:
pr:
created: 2026-04-22
updated: 2026-04-22
labels: [ci-cd, infra, bug.0344-followup]
external_refs:
  - work/items/bug.0344.adopt-digest-update-controller.md
  - docs/spec/ci-cd.md
  - docs/runbooks/image-updater-bootstrap.md
---

# task.0349 — CI-owned preview digest promotion (design v3)

> **Design review 2026-04-22:** REQUEST CHANGES on v1 (Cursor plan `design_review_task.0349`). Resolved in v2/v3: single authority on **main** (rsync seed), `workflow_run` after Flight Preview, affected-only tri-state digest resolution, spec-first amendment to `docs/spec/ci-cd.md`, message-prefix skips (not author email). Second review: **Option B only** (`promote-build-payload.sh` on `main` rejected — deploy-branch + `.promote-state/` coupling); clarify seed commit timing vs in-flight preview deploy.

## Single PR scope (no PR-A/PR-B split)

One merge closes the loop: digest seed on `main`, demote IU on the preview AppSet, **and** fix `verify-buildsha.sh` map mode so `NODES`/`promoted_apps` restricts checks to the promoted subset (affected-only flights were false-failing operator when only poly was promoted).

### Shipped in this branch

- [`scripts/ci/promote-preview-seed-main.sh`](../../scripts/ci/promote-preview-seed-main.sh) — Option B loop + tri-state resolve.
- [`.github/workflows/promote-preview-digest-seed.yml`](../../.github/workflows/promote-preview-digest-seed.yml) — `workflow_run` on **Flight Preview** `completed` + `success` + `push` on `main`; **only if** Flight Preview artifact reports `dispatched` (not `queued`); read-only decide job + verified `head_sha` checkout before push (CodeQL); message-prefix gates + race-safe push.
- [`.github/workflows/flight-preview.yml`](../../.github/workflows/flight-preview.yml) — uploads `preview-flight-outcome` artifact; **`preview-dispatched-marker`** job skipped when queue-only.
- [`flight-preview.yml`](../../.github/workflows/flight-preview.yml) — skip `chore(preview):` and IU maintenance prefixes.
- [`infra/k8s/argocd/preview-applicationset.yaml`](../../infra/k8s/argocd/preview-applicationset.yaml) — **no** Image Updater annotations (CI-owned seed).
- [`scripts/ci/check-image-updater-scope.sh`](../../scripts/ci/check-image-updater-scope.sh) — empty allowlist: **zero** `argocd-image-updater.argoproj.io/*` on any `*-applicationset.yaml`.
- [`scripts/ci/verify-buildsha.sh`](../../scripts/ci/verify-buildsha.sh) + [`scripts/ci/tests/verify-buildsha.test.sh`](../../scripts/ci/tests/verify-buildsha.test.sh) — map mode ∩ `NODES`.
- [`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md), [`docs/guides/create-service.md`](../../docs/guides/create-service.md), [`.prettierignore`](../../.prettierignore) — authority + verify semantics aligned with code.
- [`.github/workflows/candidate-flight.yml`](../../.github/workflows/candidate-flight.yml) — comment fix (`/version.buildSha`, not `/readyz.version`).

## Problem statement

[bug.0344](bug.0344.adopt-digest-update-controller.md) closed seed-rot by letting Argo CD Image Updater write preview digest pins. **Cost:** one git commit per Argo `Application` in the preview AppSet (~4 today, linear in catalog size). **Wrong job:** IU discovers “newest allowed image”; preview needs “pin the exact artifacts promoted for this merge.”

## Authority model (load-bearing)

**Single writer for preview digest seed on `main`:** `infra/k8s/overlays/preview/<app>/kustomization.yaml` image digest fields.

**Why not `deploy/preview` alone:** [`promote-and-deploy.yml`](../../.github/workflows/promote-and-deploy.yml) checks out app source at `head_sha` on **main**, then **rsync** `app-src/infra/k8s/` → `deploy-branch/infra/k8s/` (two-pass, Axiom `INFRA_K8S_MAIN_DERIVED` in [`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md)). Digest mutation on the deploy branch runs **after** that rsync. Seeds for rows the promote loop does not overwrite therefore come from **main**. Image Updater today writes **main** for preview overlays — same surface the CI promoter must own.

**Deploy branch** (`deploy/preview`) remains machine state + `.promote-state/`; unchanged ownership. The new workflow does **not** replace `promote-and-deploy`; it replaces **only** IU’s role of keeping **main’s** preview overlay digest lines honest between merges.

## Ordering (load-bearing)

[`flight-preview.yml`](.github/workflows/flight-preview.yml) re-tags `pr-{N}-{prHeadSha}` → `preview-{mergeSha}` only for **targets that existed in the PR build** (affected-only; lines 174–200). A digest resolver that runs on raw `push` to `main` **before** retag completes can see missing tags.

**Trigger:** `workflow_run`:

- `workflows: [Flight Preview]` (exact workflow name)
- `types: [completed]`
- `if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'`

**SHA:** `github.event.workflow_run.head_sha` (merge commit on `main` after retag job succeeded).

**Guard:** first step fetches that commit’s subject (e.g. `git fetch` + `git log -1 --format=%s "$SHA"`). If message starts with `chore(deps): argocd-image-updater` (IU maintenance push) or `chore(preview):` (self — see below), **exit 0** without mutating. Same rationale as IU skip: those pushes are not human PR merges with retagged images.

## Affected-only digest resolution (tri-state)

Canonical target list: [`scripts/ci/lib/image-tags.sh`](../../scripts/ci/lib/image-tags.sh) `ALL_TARGETS` / `NODE_TARGETS` (do not hardcode four services in YAML).

For each target, compute `full_tag` using existing `image_name_for_target` + `image_tag_for_target` with base tag `preview-{mergeSha}` (same convention as promote-and-deploy / flight-preview).

1. **If** `docker buildx imagetools inspect` (or equivalent) resolves a digest for `full_tag` → use it (this merge produced or retagged that image).
2. **Else** read the **current** digest pin from `main`’s overlay file for that app (parse existing `newTag` / `digest` in kustomize `images:` block). If that pin still resolves in GHCR → **retain** (no file change for that target).
3. **Else** → **fail the job** (would ship a broken or stale-unrecoverable pin).

Then apply digest updates in one atomic commit (see implementation options below).

## `flight-preview.yml` maintenance bypass

CI seed commits to `main` have **no** `(#NNN)` merge suffix. Without a skip rule, the Flight Preview job fails the “no PR resolvable” guard (same failure mode IU had).

**Invariant:** extend the existing job-level `if:` (today: skip IU prefix) with **OR** skip when `startsWith(github.event.head_commit.message, 'chore(preview):')` — exact prefix chosen once and documented in `docs/spec/ci-cd.md` next to the IU prefix (`COMMIT_PROVENANCE_VIA_MESSAGE_PREFIX` may be renamed to a short table of maintenance prefixes).

Commitlint: keep subject ≤100 chars; body carries detail.

## Spec-first (not “workflow only”)

[`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md): anti-bespoke axiom removed; task.0349 authority, `workflow_run` ordering, tri-state semantics, `NODES` ∩ map verify semantics, and maintenance message-prefix skips are documented in the spec body.

Per [docs/spec/docs-work-system.md](../../docs/spec/docs-work-system.md) `LINK_DONT_DUPLICATE`, long SCREAMING_SNAKE invariants live in the spec; this work item links and lists PR checklists only.

## Implementation path (spike outcome)

**Option A rejected:** `promote-build-payload.sh` is documented and defaulted for **deploy-branch** cwd (`../app-src/…`, `.promote-state/` map writes). Reusing it on a `main` checkout risks leaking deploy-branch assumptions; spike did not pursue.

**Option B shipped:** [`scripts/ci/promote-preview-seed-main.sh`](../../scripts/ci/promote-preview-seed-main.sh) — `promote-k8s-image.sh --no-commit` per catalog target; tri-state digest resolution; no `.promote-state/` on `main`.

## Follow-ups (optional, not blocking this task)

- Gate in-cluster Image Updater install (`ENABLE_IMAGE_UPDATER` / deploy-infra) if we want the controller absent entirely — runbook + bug.0344 appendix.
- Trim `flight-preview.yml` IU skip once we are confident no legacy `chore(deps): argocd-image-updater` pushes land on `main` (keeping the skip is harmless).

## Out of scope

- Prod/canary promotion semantics; AppSet topology; multi-repo split.
- Changing `promote-and-deploy` rsync model (would be a different task).
- ~~Candidate-a verify~~ — fixed here: map mode must intersect `SOURCE_SHA_MAP` with `NODES` when the caller passes `promoted_apps`.

## Validation

### exercise

1. Merge a normal PR; wait for Flight Preview **completed** success.
2. Confirm digest-seed workflow ran for that `head_sha`.
3. `git log -1 --format=%s main -- infra/k8s/overlays/preview/` shows `chore(preview):` prefix for the seed commit when digests changed.
4. Run or wait for preview `promote-and-deploy`; confirm preview pods’ `/version.buildSha` matches expected SHAs for promoted apps (per existing verify contract).

### observability

- GHA: digest-seed workflow summary lists per-target resolution outcome (resolved / retained / failed).
- After preview deploy: use existing Loki / curl patterns from [`docs/guides/agent-api-validation.md`](../../docs/guides/agent-api-validation.md) or project runbooks — **do not** assert undocumented label keys until verified in Grafana.

## Rollback

- Revert this PR as a unit; re-annotate preview AppSet if restoring IU write-back; restore prior `verify-buildsha.sh` behavior only if intentionally reverifying full map on every flight.

## Success criteria

- `deploy_verified: true` after observed merge cycle: zero new `argocd-image-updater` **write-back** commits from preview (AppSet demoted), seed commits ≤1 per human merge when digests change, candidate-a verify green on affected-only flights, preview digest pins consistent with `promote-and-deploy` rsync.

## Follow-up (bundled CI cleanup) — harden `loki-ci-telemetry` to be checkout-layout-agnostic

Surfaced by PR #1029 (bare-checkout workaround for the `verify-deploy` job in `promote-and-deploy.yml`). Every `promote-and-deploy` run since the action was introduced silently job-failed on the `CI Telemetry` step in `verify-deploy` (preview + production) because that job checks out only to `app-src/` + `deploy-branch/` sub-paths, leaving `$GITHUB_WORKSPACE` root empty. Two repo-root assumptions inside `.github/actions/loki-ci-telemetry/action.yml`:

1. Line 307: `uses: ./.github/actions/loki-push` — nested `uses: ./...` in a composite action resolves against `$GITHUB_WORKSPACE`, **not** the parent action's directory.
2. Line 136: `scripts/ci/fetch_github_job_logs.sh` — bash `run:` defaults to `cwd=$GITHUB_WORKSPACE`.

PR #1029 worked around both by adding a bare root checkout in `verify-deploy`. The next workflow job that checks out only to sub-paths will hit this again. Make the action self-contained:

- Resolve the script via `${{ github.action_path }}/../../scripts/ci/fetch_github_job_logs.sh`, or copy the script into the action and drop the out-of-tree dependency.
- Inline `loki-push` into `loki-ci-telemetry` (it's one `curl`) so the nested `uses:` disappears.
- Drop the bare root checkout from `verify-deploy` once the action no longer depends on workspace layout.

Regression guard: a lint step that greps `.github/actions/**/action.yml` for workspace-relative paths (`scripts/`, `uses: ./...`) and fails the PR.
