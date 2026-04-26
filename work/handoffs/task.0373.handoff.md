---
id: task.0373.handoff
type: handoff
work_item_id: task.0373
status: active
created: 2026-04-25
updated: 2026-04-25
branch: ""
last_commit: ""
---

# Handoff: CI-owned candidate-a digest seed (mirror task.0349)

## Context

- task.0349 shipped via PR #989 (merged 2026-04-22) — preview digest seed on main is live; `chore(preview): refresh digest seed …` commits land after every Flight Preview success. Image Updater is demoted (no AppSet annotations).
- The same **rsync-clobber regression class** keeps biting `candidate-a`: `candidate-flight.yml`'s `Sync base and catalog to deploy branch` step rsyncs the PR branch's `infra/k8s/overlays/candidate-a/**` onto `deploy/candidate-a`, overwriting good digest pins with whatever the PR branch was last rebased to. Caused two CrashLoopBackOff incidents on PR #1040 (operator rolled to pre-task.0370 image lacking `migrate.mjs`).
- Operational bandage today: rebase every PR onto current main before flighting. Brittle; agent committers will not consistently honor it.
- Seed PR #1045 manually bumped `main:infra/k8s/overlays/candidate-a/**` digests to post-task.0371 values once. The need is for that seed to be **automatic and continuous**, the same way preview's seed is.
- task.0349 shipped for **preview only**. This is a **new task** (task.0373) applying the same pattern to candidate-a — not an extension of task.0349.

## Current State

- **Preview seed: shipped + working.** Don't re-touch. Reference, don't re-derive.
- **Candidate-a seed: not built.** PR-branch rsync remains the de-facto digest writer for `deploy/candidate-a`.
- `verify-buildsha.sh` map mode (∩ NODES) is already correct from task.0349 v3.
- `scripts/ci/lib/image-tags.sh` `ALL_TARGETS` is the canonical target catalog — reuse, never hardcode.

## Decisions Made

- **Authority model**: same as preview — single writer to `main:infra/k8s/overlays/candidate-a/<app>/kustomization.yaml` digest fields. Deploy branch (`deploy/candidate-a`) stays machine state. See [task.0349 §Authority model](../items/task.0349.ci-owned-preview-digest-promotion.md#authority-model-load-bearing).
- **Tri-state digest resolution**: resolve via `imagetools inspect` → else retain current main pin if still valid → else fail. See [task.0349 §Affected-only digest resolution](../items/task.0349.ci-owned-preview-digest-promotion.md#affected-only-digest-resolution-tri-state).
- **Trigger choice (open)**: `workflow_run` on Candidate Flight success vs. an explicit step inside `candidate-flight.yml` after promote. Argue in design.
- **Skip-self prefix**: extend the existing maintenance-prefix table in `flight-preview.yml` and add same to `candidate-flight.yml` job-level `if:`. Use `chore(candidate-a):` or unify under `chore(seed):` (argue).

## Next Actions

- [ ] Read this handoff + [task.0349.md](../items/task.0349.ci-owned-preview-digest-promotion.md) end-to-end. Preview impl is the template.
- [ ] Read [`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md) candidate-a + promote-and-deploy rsync axiom (`INFRA_K8S_MAIN_DERIVED`).
- [ ] Diff [`scripts/ci/promote-preview-seed-main.sh`](../../scripts/ci/promote-preview-seed-main.sh) and [`.github/workflows/promote-preview-digest-seed.yml`](../../.github/workflows/promote-preview-digest-seed.yml) — mirror these for candidate-a.
- [ ] Read `candidate-flight.yml` `Sync base and catalog to deploy branch` step + promote step. Pick trigger (`workflow_run` vs. inline) and argue in PR.
- [ ] Cut a fresh branch from `origin/main`. Update [task.0373](../items/task.0373.ci-owned-candidate-a-digest-seed.md) status to `in_progress`.
- [ ] Implement `scripts/ci/promote-candidate-seed-main.sh` (or extend the preview script with an env arg — argue the simpler shape).
- [ ] Implement `.github/workflows/promote-candidate-digest-seed.yml`. CodeQL: verified `head_sha` checkout pattern as in preview seed workflow.
- [ ] Add commit-message-prefix skip to `candidate-flight.yml` (mirror `flight-preview.yml`).
- [ ] Update [`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md) authority section to cover candidate-a.
- [ ] Validation: dispatch a candidate-flight; observe one `chore(candidate-a):` seed commit on main; re-flight any open PR predating the seed and confirm operator/resy do not roll to a bad digest.

## Risks / Gotchas

- **Trigger ordering**: candidate-flight already retags / promotes synchronously inside the flight. Unlike preview's `flight-preview.yml` retag → seed dance, the candidate-flight trigger must fire _after_ the flight job's promote step writes to GHCR. Read `candidate-flight.yml` carefully before picking the trigger event.
- **Affected-only flights**: candidate-flight may promote only a subset (e.g. poly-only PR). Tri-state must retain non-promoted overlay rows from main, not blank them.
- **Zero-noop commits**: seed must produce **no commit** when no digest changed. Preview already gets this right; mirror exactly.
- **Don't unify prefixes prematurely.** `chore(preview):` is filtered in multiple places. Adding `chore(candidate-a):` alongside is the safer default.
- **Don't touch the shipped preview pieces.** They work. This task is purely additive.

## Pointers

| File / Resource                                                                                                        | Why it matters                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`work/items/task.0373.ci-owned-candidate-a-digest-seed.md`](../items/task.0373.ci-owned-candidate-a-digest-seed.md)   | This task                                                               |
| [`work/items/task.0349.ci-owned-preview-digest-promotion.md`](../items/task.0349.ci-owned-preview-digest-promotion.md) | Reference design (preview) — full v3 spec                               |
| [`scripts/ci/promote-preview-seed-main.sh`](../../scripts/ci/promote-preview-seed-main.sh)                             | Reference script (preview)                                              |
| [`.github/workflows/promote-preview-digest-seed.yml`](../../.github/workflows/promote-preview-digest-seed.yml)         | Reference workflow (preview)                                            |
| [`.github/workflows/candidate-flight.yml`](../../.github/workflows/candidate-flight.yml)                               | Source of the rsync-clobber bug this task kills                         |
| [`scripts/ci/lib/image-tags.sh`](../../scripts/ci/lib/image-tags.sh)                                                   | Canonical target catalog — reuse, never hardcode                        |
| [`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md)                                                                       | Spec authority + `INFRA_K8S_MAIN_DERIVED` axiom — update alongside code |
| Seed PR #1045 (commit `48e280952`)                                                                                     | Manual one-shot bump that proves the desired end state                  |
| PR #989 (merged 2026-04-22)                                                                                            | task.0349 ship PR — the template you're mirroring                       |
| PRs #1039, #1040 incidents                                                                                             | Concrete failure cases this work prevents                               |
