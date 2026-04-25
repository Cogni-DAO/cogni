---
id: task.0373
type: task
title: "candidate-flight self-heals deploy/candidate-a digests around PR rsync"
status: needs_implement
priority: 1
rank: 1
estimate: 2
branch: chore/task.0373-handoff
summary: "Snapshot-restore deploy/candidate-a overlay digests around the PR-branch rsync inside candidate-flight.yml. Kills the rsync-clobber regression class (stale PR overlay rolls unrelated nodes to bad images) without introducing a new main-write path. Replaces the v1 'mirror task.0349 main-seed' design rejected by /review-design."
outcome: "After every candidate-flight, deploy/candidate-a overlay digests for non-promoted apps equal their pre-flight values (no rsync regression); promoted apps carry the freshly-built pr-{N}-{HEAD_SHA} digest. Zero writes to main, zero new workflows, zero new PATs. Rebase-before-flight bandage retired."
spec_refs:
  - ci-cd
assignees: []
project:
created: 2026-04-25
updated: 2026-04-25
labels: [ci-cd, infra, task.0349-followup]
external_refs:
  - work/items/task.0349.ci-owned-preview-digest-promotion.md
  - docs/spec/ci-cd.md
---

# task.0373 — candidate-flight self-heals deploy/candidate-a digests around PR rsync

## Problem

`candidate-flight.yml`'s `Sync base and catalog to deploy branch` step rsyncs `infra/k8s/overlays/candidate-a/**` from the PR branch onto `deploy/candidate-a`. When the PR branch's overlay digests are stale (PR opened before a recent main change, or rebase missed), the rsync writes a regressing digest, Argo rolls the affected node, and the new pod fails — observed twice on PR #1040 (operator rolled to a pre-task.0370 image lacking `migrate.mjs`).

Operational bandage: rebase every PR onto current main before flight. Brittle; agent committers will not consistently honor it.

## Authority model

`deploy/candidate-a` is the source of truth for "what's on candidate-a right now". `candidate-flight.yml` self-heals it: snapshot before the PR-branch rsync, restore non-promoted apps after promote-build-payload writes promoted apps' digests. `main:infra/k8s/overlays/candidate-a/**` is **advisory and may lag** — it has no consumer (candidate-flight rsyncs from PR branch, not main, unlike preview's `promote-and-deploy`).

Contrast with task.0349 (preview): preview's `promote-and-deploy` rsyncs **from main**, so main is load-bearing and required a CI-owned seed. Candidate-a does not have that property → no main-seed needed.

## Out of scope

- `main:infra/k8s/overlays/candidate-a/**` writes. Explicitly **not** mirrored from task.0349 (see design v2 below).
- Changing `candidate-flight.yml`'s rsync model. The rsync stays; snapshot/restore make its overlay clobber idempotent on non-promoted apps.
- Preview seed pieces — task.0349 stays untouched except for an internal lib refactor that produces byte-identical behaviour.
- Production / canary digest seed. Different env, different task if needed.

## Validation

### exercise

1. Land this task. Take a stale PR (one whose branch predates the most recent candidate-a digest bumps; do **not** rebase). Confirm `git diff origin/main -- infra/k8s/overlays/candidate-a/<non-promoted-node>/kustomization.yaml` shows a different digest than `git show deploy/candidate-a:infra/k8s/overlays/candidate-a/<non-promoted-node>/kustomization.yaml` — i.e., the PR branch carries a stale digest that would clobber.
2. Dispatch candidate-flight on that PR.
3. After flight job ends: `git show deploy/candidate-a:infra/k8s/overlays/candidate-a/<non-promoted-node>/kustomization.yaml` digest must match its pre-flight value (snapshot/restore worked).
4. Promoted node digest on `deploy/candidate-a` must match the freshly-built `pr-{N}-{HEAD_SHA}{suffix}` in GHCR.
5. `verify-candidate` job stays green; `/version.buildSha` matches `head_sha` for promoted apps.

### observability

- GHA flight job logs: explicit "Snapshot pre-rsync overlay digests" and "Restore non-promoted overlay digests" steps with per-target output (snapshotted / restored / promoted-skipped / no-overlay-skipped).
- `kubectl rollout status deployment/<node>-node-app -n cogni-candidate-a` succeeds for all 3 nodes within `verify-candidate` timeout, including for affected-only flights.

## Success criteria

- Zero rsync-clobber incidents (operator/resy rolling to stale digests because of a stale PR overlay) on candidate-flights post-merge.
- Rebase-before-flight bandage retired from operational guidance / agent rules.
- No new files under `.github/workflows/`; no new push paths to `main`; no new PATs.

## Design (v2 — deploy-branch-local snapshot/restore)

> **v1 (CI-owned main seed) rejected by /review-design 2026-04-25.** Preview's
> main-seed pattern exists because `promote-and-deploy` rsyncs **from main** as
> the source of truth (Axiom `INFRA_K8S_MAIN_DERIVED`). `candidate-flight`
> rsyncs from the **PR branch**, so `main:infra/k8s/overlays/candidate-a/**`
> digests have no consumer — seeding them is theatre. Self-heal on
> `deploy/candidate-a` instead. Strictly simpler, no new privileged push to
> main, no new workflow file, no skip-prefix tax, scales to N envs without
> per-env workflows.

### Outcome

After every candidate-flight, `deploy/candidate-a:infra/k8s/overlays/candidate-a/<app>/kustomization.yaml`
holds the freshly-built digest for each promoted app **and** the prior
deploy-branch digest for each non-promoted app — never the stale digest the
PR branch carried. The rsync's overlay clobber becomes harmless: anything it
clobbers gets restored from a pre-rsync snapshot before commit.

### Approach

**Solution — three new steps inside the existing `flight` job in
[`candidate-flight.yml`](../../.github/workflows/candidate-flight.yml):**

1. **Snapshot (pre-rsync):** before the existing `Sync base and catalog to
deploy branch` step (line 138), read each existing
   `deploy-branch/infra/k8s/overlays/candidate-a/<target>/kustomization.yaml`
   digest pin into a TSV at `$RUNNER_TEMP/candidate-a-overlay-snapshot.tsv`
   (one line per `target` in `ALL_TARGETS` whose overlay file exists, format
   `<target>\t<image-ref>` where `image-ref` is `repo@sha256:…` or `repo:tag`).
2. **(unchanged)** Existing rsync clobbers overlays. Existing
   `promote-build-payload.sh` writes correct digests for `PROMOTED_APPS`.
3. **Restore (post-promote, pre-commit):** for each `target` in
   `ALL_TARGETS \ PROMOTED_APPS` whose snapshot row exists, call
   `promote-k8s-image.sh --no-commit --env candidate-a --app <target> --digest <snapshot-ref>`.
   Existing `Commit and push deploy/candidate-a` step then commits the
   merged-correct overlay state to `deploy/candidate-a`.

**Bootstrap (cold-start) behaviour:** the very first flight against a
newly-created `deploy/candidate-a` (or one cloned fresh from `head_sha`) has
no prior good state — snapshot reads the PR-branch overlay, restore is a
no-op. This is acceptable: there is no "good prior" to preserve.

**No `main` writes. No new workflow file. No new PAT. No skip-prefix
maintenance. No verify-gate (irrelevant — promote-build-payload's writes
were already happening before verify; this just stops the rsync from undoing
them on non-promoted overlays).**

**Lib extraction (per /review-design ask):** lift the python overlay-image
extractor out of `promote-preview-seed-main.sh` into
[`scripts/ci/lib/overlay-digest.sh`](../../scripts/ci/lib/overlay-digest.sh)
exposing `extract_overlay_image_ref ENV APP` (writes `repo@sha256:…` or
`repo:tag` to stdout). Refactor `promote-preview-seed-main.sh` to source it
(behaviour unchanged). The new snapshot step + future seed paths share one
parser.

### Reuses

- [`scripts/ci/lib/image-tags.sh`](../../scripts/ci/lib/image-tags.sh)
  (`ALL_TARGETS`) — canonical target catalog.
- [`scripts/ci/promote-k8s-image.sh`](../../scripts/ci/promote-k8s-image.sh)
  `--no-commit` — per-app digest writer.
- Existing flight-job structure: same checkout, same rsync, same
  `promote-build-payload.sh`, same commit/push.

### Rejected

- **v1: New `seed-main` job + `promote-candidate-seed-main.sh` writing to
  main.** Solves a non-problem: main's candidate-a digest pins have no
  downstream consumer (rsync is from PR branch, not main). Adds new
  privileged push path, new PAT exposure, new `chore(candidate-a):` skip
  prefix in `flight-preview.yml`, near-duplicate seed script. Per-env tax.
- **Drop the overlay rsync entirely.** Would prevent PR-side structural
  overlay edits (replicas, env tweaks, new kustomize files) from reaching
  the deploy branch. Real regression for legitimate overlay changes.
- **Smarter rsync that excludes digest fields.** `rsync` has no awareness
  of YAML semantics; would require a yq/python pre/post pass that's
  effectively the same as snapshot/restore but inside the rsync step.
  Snapshot/restore is more legible.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] DEPLOY_BRANCH_SELF_HEAL: `deploy/candidate-a` overlay digests for non-promoted apps must equal their pre-flight value (idempotent on re-flight, no rsync regression). (spec: ci-cd)
- [ ] PROMOTED_DIGESTS_WIN: For apps in `PROMOTED_APPS`, the post-flight digest must be the freshly-built `pr-{N}-{HEAD_SHA}` digest (restore must run BEFORE the existing `Commit and push deploy/candidate-a` step but MUST NOT touch promoted apps). (spec: ci-cd)
- [ ] BOOTSTRAP_SAFE: First flight against a fresh `deploy/candidate-a` must succeed even though snapshot reads the PR-branch state (cold-start = no prior good state). (spec: ci-cd)
- [ ] NO_MAIN_WRITES: No new write to `main`. No new PAT. No new workflow. (spec: ci-cd)
- [ ] CANONICAL_TARGET_CATALOG: All target enumeration goes through `ALL_TARGETS` from `scripts/ci/lib/image-tags.sh`. No hardcoded app names. (spec: ci-cd)
- [ ] LIB_DEDUPED: `promote-preview-seed-main.sh` and the new snapshot path share `extract_overlay_image_ref` via `scripts/ci/lib/overlay-digest.sh`. No duplicated python overlay parser. (spec: ci-cd)
- [ ] PREVIEW_SEED_BEHAVIOUR_UNCHANGED: After the lib refactor, `promote-preview-seed-main.sh` produces byte-identical output for the same inputs. (spec: ci-cd)
- [ ] SIMPLE_SOLUTION: Zero new workflows, zero new privileged pushes, ~3 new steps in `candidate-flight.yml`, one small lib + one small snapshot script. (spec: architecture)

### Files

<!-- High-level scope -->

- Create: `scripts/ci/lib/overlay-digest.sh` — sourceable; exposes `extract_overlay_image_ref ENV APP`.
- Create: `scripts/ci/snapshot-overlay-digests.sh` — given `OVERLAY_ENV` + cwd at deploy-branch root, prints `<target>\t<image-ref>` lines for `ALL_TARGETS` overlays that exist. Used by the snapshot step.
- Modify: `scripts/ci/promote-preview-seed-main.sh` — drop the inlined python parser, source `lib/overlay-digest.sh`. Behaviour unchanged.
- Modify: `.github/workflows/candidate-flight.yml` — add Snapshot step before `Sync base and catalog to deploy branch`; add Restore step between `Promote resolved digests into candidate-a overlay` and `Commit and push deploy/candidate-a`.
- Modify: `docs/spec/ci-cd.md` — replace "single-writer-on-main for candidate-a" expectation with the deploy-branch self-heal axiom; explicitly note that for envs whose `promote-and-deploy` rsync does **not** read main (candidate-a today), main's overlay digests are advisory and may lag.
- Test: `scripts/ci/tests/snapshot-overlay-digests.test.sh` — fixture-driven; covers (a) all overlays present with mixed `digest:`/`newTag:`, (b) missing overlay file → omitted from output, (c) snapshot+restore round-trip via temp tree.

## PR / Links

- Handoff: [handoff](../handoffs/task.0373.handoff.md)
- Reference design: [task.0349](task.0349.ci-owned-preview-digest-promotion.md)
- Reference impl: PR #989 (merged 2026-04-22)
