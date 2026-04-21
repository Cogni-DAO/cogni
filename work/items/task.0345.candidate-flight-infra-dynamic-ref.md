---
id: task.0345
type: task
title: "candidate-flight-infra: default to dispatch ref so PR branches can be flown"
status: needs_closeout
priority: 1
rank: 1
estimate: 0
summary: "`.github/workflows/candidate-flight-infra.yml` hardcodes `ref: main` in its scripts-checkout step and defaults `inputs.ref` to `main`. That makes pre-merge validation of `scripts/ci/deploy-infra.sh` changes impossible — the workflow always runs main's scripts against main's infra. Default both to the dispatch ref (`github.ref` / `github.ref_name`) so `gh workflow run --ref=<branch>` DTRT and unchanged dispatches from main behave identically."
outcome: "`gh workflow run candidate-flight-infra.yml --ref=<PR-branch>` runs that branch's `scripts/ci/deploy-infra.sh` and rsyncs that branch's `infra/compose/**`. Default dispatches from `main` remain a no-op change (`github.ref_name == main`). Unblocks pre-merge validation of bug.0344's image updater bootstrap integration in deploy-infra.sh (PR #974), and any future script-layer change to the infra lever."
spec_refs:
  - docs/spec/ci-cd.md
  - .claude/skills/pr-coordinator-v0/SKILL.md
assignees: []
credit:
project: proj.cicd-services-gitops
branch: feat/task-0345-candidate-flight-infra-dynamic-ref
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-20
updated: 2026-04-20
labels: [ci-cd, workflow]
external_refs:
---

# candidate-flight-infra: Default to Dispatch Ref

## Why

`scripts/ci/deploy-infra.sh` is about to grow an idempotent ArgoCD Image Updater bootstrap block (bug.0344, PR #974). The value of that change is "reproducible, autonomous CI/CD" — but we cannot validate it pre-merge because `candidate-flight-infra.yml` hardcodes `ref: main` in its own scripts-checkout step. The version of `deploy-infra.sh` that runs on dispatch is always `main`'s, not the PR branch's. Any script-layer change to the infra lever is therefore unreachable before merge.

Two-line structural fix: default both the `actions/checkout@v4` ref and `inputs.ref` to the workflow's own dispatch ref. `gh workflow run --ref=<branch>` now sources scripts AND rsyncs `infra/compose/**` from that branch. Default dispatches from `main` (or any main-tracking branch) are a no-op.

The app lever (`candidate-flight.yml`) already does this — it checks out `app-src` from `${{ steps.meta.outputs.head_sha }}`. This brings the infra lever up to parity so the two levers behave the same way around "where do my scripts come from."

## Design

### Contract

- `inputs.ref.default` becomes `${{ github.ref_name }}` (previously literal `main`).
- `actions/checkout` `ref:` becomes `${{ github.ref }}` (previously literal `main`).
- `inputs.ref.description` updated to note the dispatch-ref default.
- Header comment updated to document the ref-resolution rule and its task.0345 lineage.
- `deploy-infra.sh --ref "${{ inputs.ref || 'main' }}"` — unchanged; `inputs.ref` now tracks the dispatch ref by default so the rsync source and scripts are pulled from the same ref.

### Invariants

- `CANDIDATE_FLIGHT_INFRA_DISPATCH_REF_IS_DEFAULT`: the workflow's scripts checkout + infra-rsync source default to the dispatch ref. Explicit `-f ref=<other>` still overrides only the rsync source; the checkout still tracks `github.ref`, which is the correct split (scripts come from the CI actor's branch; rsync content can be pinned to any other ref if needed).
- `DEFAULT_FROM_MAIN_IS_NO_OP`: `gh workflow run candidate-flight-infra.yml` (no `--ref`) from a main-tracking branch produces the same checkout and rsync source as before the change.
- `APP_INFRA_LEVER_REF_PARITY`: both `candidate-flight.yml` and `candidate-flight-infra.yml` now source their own scripts from a non-`main` ref by default (PR head SHA for app lever; dispatch ref for infra lever). Neither silently runs `main`'s scripts against an unmerged change.

## Plan

- [x] **Checkpoint 1** — workflow YAML
  - Todos:
    - [x] `candidate-flight-infra.yml`: default `inputs.ref` to `${{ github.ref_name }}`, checkout `ref:` to `${{ github.ref }}`, update `inputs.ref.description` and header comment.
- [x] **Checkpoint 2** — doc reconciliation
  - Todos:
    - [x] `docs/spec/ci-cd.md` §"App and infra levers are independent": add a bullet describing the dispatch-ref default and `--ref=<branch>` pre-merge pattern; also note the app lever's own PR-head-SHA script checkout.
    - [x] `.claude/skills/pr-coordinator-v0/SKILL.md` "Two Independent Levers": update the dispatch block and the v0/v1 callout to reflect the passthrough now exists.

## Validation

- exercise:
  - After merge, pre-merge re-validate PR #974 via `gh workflow run candidate-flight-infra.yml --repo Cogni-DAO/node-template --ref design/bug-0344-digest-updater`. Observe the run's "Checkout (for scripts)" step logs show the SHA of the `design/bug-0344-digest-updater` branch, and the "Deploy Compose infra" step runs that branch's `scripts/ci/deploy-infra.sh` (including the new Step 7b image updater bootstrap block).
- observability:
  - GitHub Actions run log, "Checkout (for scripts)" step: the resolved ref SHA matches the tip of the dispatched branch (not main's).
  - GitHub Actions run log, "Deploy Compose infra to candidate-a VM" step: `bash scripts/ci/deploy-infra.sh --ref <branch>` runs to completion or fails with an error class sourced from that branch's `deploy-infra.sh`, not main's.
- acceptance:
  - Dispatching from `main` (no `--ref`) produces identical run-log output to the pre-change behavior — same rsync source, same script versions.
  - Dispatching with `--ref=<branch>` runs that branch's scripts and rsyncs that branch's `infra/compose/**`, verifiable via the checkout step's SHA.

## Non-Goals

- `candidate-flight.yml` (app lever) — already checks out from the PR's head SHA; no change.
- `promote-and-deploy.yml` (preview/prod merge-triggered path) — push-to-main only; no dispatch ref to parameterize.
- `deploy-infra.sh` Step 7b (Argo CD Image Updater bootstrap integration) — tracked in bug.0344 / PR #974.
- Per-PR fine-grained ref passthrough for non-dispatch triggers — YAGNI; `gh workflow run --ref=<branch>` is the full contract.
