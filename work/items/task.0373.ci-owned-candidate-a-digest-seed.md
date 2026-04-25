---
id: task.0373
type: task
title: "CI-owned candidate-a digest seed (mirror task.0349 for candidate-a)"
status: needs_implement
priority: 1
rank: 1
estimate: 3
branch: chore/task.0373-handoff
summary: "Apply task.0349's pattern (CI owns preview digest seed on main, rsync stops being authority) to the candidate-a environment. Kills the rsync-clobber regression class where stale PR-branch overlay digests roll unrelated nodes to bad images during candidate-flight."
outcome: "After each successful candidate-flight, exactly one `chore(candidate-a): …` commit updates `main:infra/k8s/overlays/candidate-a/**` digest pins for promoted apps; non-promoted overlays retain prior pin. PR-branch rsync onto deploy/candidate-a stops introducing digest regressions because every PR's branch (post-rebase or freshly opened) inherits a current seed from main. Rebase-before-flight bandage retired."
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

# task.0373 — CI-owned candidate-a digest seed

## Problem

`candidate-flight.yml`'s `Sync base and catalog to deploy branch` step rsyncs `infra/k8s/overlays/candidate-a/**` from the PR branch onto `deploy/candidate-a`. When the PR branch's overlay digests are stale (PR opened before a recent main change, or rebase missed), the rsync writes a regressing digest, Argo rolls the affected node, and the new pod fails — observed twice on PR #1040 (operator rolled to a pre-task.0370 image lacking `migrate.mjs`).

Operational bandage: rebase every PR onto current main before flight. Brittle; agent committers will not consistently honor it.

## Authority model

Single writer for candidate-a digest seed on `main`: `infra/k8s/overlays/candidate-a/<app>/kustomization.yaml` digest fields. Same model as task.0349 v3 (preview).

`deploy/candidate-a` stays machine state + `.promote-state/`. Unchanged ownership.

## Approach (mirror task.0349)

- **Reference implementation**: [`scripts/ci/promote-preview-seed-main.sh`](../../scripts/ci/promote-preview-seed-main.sh) + [`.github/workflows/promote-preview-digest-seed.yml`](../../.github/workflows/promote-preview-digest-seed.yml). Mirror the shape, do not re-derive.
- **Trigger**: open question — `workflow_run` on Candidate Flight success vs. an explicit step inside `candidate-flight.yml` after promote. Argue in design.
- **Tri-state digest resolution**: same as task.0349. Resolve `imagetools` → else retain main pin if still valid → else fail.
- **Skip-self prefix**: extend the existing maintenance-prefix table in `flight-preview.yml` and add the same to `candidate-flight.yml`. Use `chore(candidate-a):`, or unify under `chore(seed):` if it can replace the preview prefix without breakage (argue).
- **Canonical target list**: [`scripts/ci/lib/image-tags.sh`](../../scripts/ci/lib/image-tags.sh) `ALL_TARGETS` / `NODE_TARGETS`. Never hardcode.
- **Spec**: update [`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md) authority section to extend task.0349's axiom to candidate-a.

## Out of scope

- Touching the shipped preview seed pieces. Additive only.
- Changing the `candidate-flight.yml` rsync model. The rsync stays; the seed makes its writes harmless.
- Production / canary digest seed. Different env, different task if needed.

## Validation

### exercise

1. Land this task; observe one `chore(candidate-a): …` commit on main after the next candidate-flight that promotes any image.
2. Take an open PR whose branch predates the seed (do not rebase). Dispatch candidate-flight.
3. Confirm operator/poly/resy not promoted by the PR retain the digests from main's seed (no rollout, no bad image).
4. Confirm the promoted node flies clean (`/version.buildSha` matches PR head_sha).

### observability

- GHA: digest-seed workflow summary lists per-target resolution outcome (resolved / retained / failed).
- `kubectl rollout status deployment/<node>-node-app -n cogni-candidate-a` succeeds for all 3 nodes within `verify-candidate` timeout, including for affected-only flights.

## Success criteria

- Zero rsync-clobber incidents (operator/resy rolling to stale digests because of a stale PR overlay) on candidate-flights post-merge.
- Rebase-before-flight bandage retired from operational guidance / agent rules.

## Design

### Outcome

Every successful candidate-flight that promotes ≥1 app produces exactly one
`chore(candidate-a): …` commit on `main` updating
`infra/k8s/overlays/candidate-a/<promoted_app>/kustomization.yaml` digest pins.
Non-promoted overlays untouched. The next PR's `Sync base and catalog to deploy
branch` rsync therefore inherits a current seed from main and cannot regress an
unrelated node's digest.

### Approach

**Solution**

1. New script [`scripts/ci/promote-candidate-seed-main.sh`](../../scripts/ci/promote-candidate-seed-main.sh)
   — affected-only walk over `PROMOTED_APPS` from the flight job. For each
   promoted app: resolve the freshly-built digest from GHCR
   (`pr-${PR_NUMBER}-${HEAD_SHA}` ± per-target suffix via
   `image_tag_for_target`), then call
   `promote-k8s-image.sh --no-commit --env candidate-a --app <app> --digest <ref>`.
   Non-promoted apps are not iterated, so their main pins are untouched by
   construction.
2. New job `seed-main` inside [`.github/workflows/candidate-flight.yml`](../../.github/workflows/candidate-flight.yml)
   — `needs: [flight, verify-candidate]`,
   `if: needs.verify-candidate.result == 'success' && needs.flight.outputs.promoted_apps != ''`.
   Checks out `main` with `ACTIONS_AUTOMATION_BOT_PAT`, runs the script, commits
   `chore(candidate-a): refresh digest seed pr-${N} ${shortSha}`, and pushes —
   with the same race-safe guard pattern as
   [`promote-preview-digest-seed.yml`](../../.github/workflows/promote-preview-digest-seed.yml)
   (re-fetch `origin/main`, abort if it advanced; reset on conflict).
3. Skip rule on [`.github/workflows/flight-preview.yml`](../../.github/workflows/flight-preview.yml)
   — extend the existing maintenance-prefix table to also skip
   `chore(candidate-a):` so the new seed commits don't false-trigger a Flight
   Preview attempt.
4. Spec — extend [`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md) authority
   section to document candidate-a's CI-owned seed alongside preview's.

**Reuses**

- [`scripts/ci/lib/image-tags.sh`](../../scripts/ci/lib/image-tags.sh)
  (`image_name_for_target`, `image_tag_for_target`, `NODE_TARGETS`) —
  canonical target catalog.
- [`scripts/ci/promote-k8s-image.sh`](../../scripts/ci/promote-k8s-image.sh)
  `--no-commit` — same per-app digest writer used by preview seed.
- `resolve_digest_ref` shape (imagetools inspect → `repo@sha256:…`) lifted
  verbatim from [`promote-preview-seed-main.sh`](../../scripts/ci/promote-preview-seed-main.sh).
- `flight.outputs.promoted_apps` (already emitted) and
  `flight.outputs.head_sha` — no new flight outputs needed.

**Trigger choice (decided): inline `seed-main` job, not `workflow_run`.**

| Dimension                   | `workflow_run` (preview pattern)                                                                 | Inline `seed-main` job (chosen)                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Trigger event of source WF  | `push` to main (untrusted ref, CodeQL needs `head_sha` re-verification + artifact-passing dance) | `workflow_dispatch` only — already privileged, no untrusted ref to verify                   |
| Knowing what was promoted   | Out-of-band artifact (`preview-flight-outcome.txt`)                                              | `needs.flight.outputs.promoted_apps` directly                                               |
| Knowing the rollout was OK  | Doesn't (preview seed runs on flight success, before rollout)                                    | Gates on `needs.verify-candidate.result == 'success'` — proven-rolling digests only         |
| Files added                 | New workflow + script + outcome artifact wiring                                                  | New script + ~30-line job in existing workflow                                              |
| Pattern parity with preview | High                                                                                             | Lower — but candidate-a's trigger model (dispatch + sync flight) is intrinsically different |

The `workflow_run` indirection on preview exists to bridge from a `push`-driven
flight to a `contents:write` seed without breaking CodeQL's untrusted-ref rule.
candidate-flight already runs from `workflow_dispatch` with the PR head treated
as trusted (it promotes those digests synchronously), and the script writes to
**main**, not to PR-controlled paths — so the indirection has no security value
here. Inline wins on simplicity and lets us gate the seed on
`verify-candidate` success (a real "this digest rolls clean" signal) instead of
just "flight job exited 0".

**Skip-self prefix (decided): `chore(candidate-a):`, not unified `chore(seed):`.**
Unifying would require coordinated edits to every existing `chore(preview):`
filter (flight-preview job-level `if`, promote-preview-digest-seed gate, any
runbook docs) — regression risk for zero ergonomic benefit. Keep prefixes
parallel: `chore(preview):` for preview seed, `chore(candidate-a):` for
candidate-a seed.

**Bi-state, not tri-state.** Preview's tri-state (resolve → retain → fail)
exists because preview retag is affected-only and the seed must walk the full
catalog (untouched apps must explicitly retain). Candidate-a's seed walks only
`promoted_apps`, so:

- **Resolve** the freshly-built `pr-${N}-${HEAD_SHA}{suffix}` digest in GHCR
  → use it (must succeed; the flight job just promoted it; failure is a real
  bug, fail loud).
- Non-promoted apps are not iterated → their main pins are untouched by
  construction. No "retain" branch needed.

**Rejected**

- _Trigger via `workflow_run` mirroring preview exactly_ — adds an artifact-
  passing dance and a verified `head_sha` checkout step solving a problem
  (untrusted `push` ref) that doesn't exist for `workflow_dispatch`. Higher
  surface area, no ergonomic or security gain.
- _Reuse `promote-preview-seed-main.sh` with an `OVERLAY_ENV` env arg_ — the
  preview script's tri-state walks the full catalog (`NODE_TARGETS` +
  `scheduler-worker`); candidate-a needs an affected-only walk over
  `PROMOTED_APPS` and a different base tag (`pr-${N}-${HEAD_SHA}` vs
  `preview-${MERGE_SHA}`). The shared logic worth extracting is
  `resolve_digest_ref` (~10 lines) — duplicate it; promotion to a shared lib
  costs more than it buys today.
- _Have the seed copy digests directly out of `deploy/candidate-a` overlay
  files instead of re-resolving from GHCR_ — tighter coupling, requires
  parsing the deploy branch checkout, and breaks if `deploy/candidate-a`
  drifts. GHCR `imagetools` is the same source of truth the flight job used
  ~1 minute earlier; re-resolving is cheap and self-contained.
- _Add `chore(candidate-a):` skip to `candidate-flight.yml` itself_ — not
  needed; candidate-flight is `workflow_dispatch` only and never fires on
  pushes to main.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CANDIDATE_A_SEED_AUTHORITY: `main:infra/k8s/overlays/candidate-a/<app>/kustomization.yaml` digest fields are written **only** by the new `seed-main` job after a green candidate-flight (humans editing during a feature PR is fine; the rsync on `deploy/candidate-a` is downstream/derived). (spec: ci-cd)
- [ ] AFFECTED_ONLY_NO_CLOBBER: The seed iterates **only** `flight.outputs.promoted_apps`; non-promoted overlays must be byte-identical post-job. (spec: ci-cd)
- [ ] VERIFY_GATED_SEED: The `seed-main` job runs only when `needs.verify-candidate.result == 'success'`. A failed verify must not seed main with a digest that didn't roll. (spec: ci-cd)
- [ ] NO_NOOP_COMMIT: When digest resolution produces no working-tree change, exit 0 with no commit and no push. Mirrors preview's `git diff --cached --quiet` short-circuit. (spec: ci-cd)
- [ ] RACE_SAFE_PUSH: Re-fetch `origin/main` before commit and before push; abort (warning + reset) if it advanced. Mirrors `promote-preview-digest-seed.yml`. (spec: ci-cd)
- [ ] FLIGHT_PREVIEW_SKIPS_SEED_COMMITS: `flight-preview.yml`'s job-level `if:` skips `chore(candidate-a):` exactly as it skips `chore(preview):`. (spec: ci-cd)
- [ ] CANONICAL_TARGET_CATALOG: All target/tag derivation goes through `scripts/ci/lib/image-tags.sh`. No hardcoded app names in the new script or workflow. (spec: ci-cd)
- [ ] PREVIEW_SEED_UNTOUCHED: Diff must show zero changes to `promote-preview-seed-main.sh`, `promote-preview-digest-seed.yml`, or the preview AppSet. Additive only. (spec: ci-cd)
- [ ] SIMPLE_SOLUTION: Reuses `promote-k8s-image.sh --no-commit` + `image-tags.sh`; no new abstractions; ~30-line job + ~80-line script.
- [ ] ARCHITECTURE_ALIGNMENT: Single-writer-on-main authority (Axiom `INFRA_K8S_MAIN_DERIVED`). `deploy/candidate-a` remains machine state. (spec: ci-cd)

### Files

<!-- High-level scope -->

- Create: `scripts/ci/promote-candidate-seed-main.sh` — affected-only digest seed loop. Inputs: `PR_NUMBER`, `HEAD_SHA`, `PROMOTED_APPS` (space-separated). Resolves `pr-${PR_NUMBER}-${HEAD_SHA}{suffix}` per app, calls `promote-k8s-image.sh --no-commit --env candidate-a`. No git operations.
- Modify: `.github/workflows/candidate-flight.yml` — add `seed-main` job (needs flight + verify-candidate, gated on success + non-empty promoted_apps). Checkout main with `ACTIONS_AUTOMATION_BOT_PAT`, run script, commit `chore(candidate-a): refresh digest seed pr-${N} ${shortSha}`, race-safe push.
- Modify: `.github/workflows/flight-preview.yml` — extend job-level `if:` skip table with `chore(candidate-a):`.
- Modify: `docs/spec/ci-cd.md` — extend the task.0349 authority section to cover candidate-a; document the new maintenance prefix and the verify-gated trigger.
- Test: manual validation per the `## Validation` block — no shellcheck-only path. (Optionally add a fixture-driven unit test of `promote-candidate-seed-main.sh` if `verify-buildsha.test.sh`-style harness lands cheap; not blocking.)

## PR / Links

- Handoff: [handoff](../handoffs/task.0373.handoff.md)
- Reference design: [task.0349](task.0349.ci-owned-preview-digest-promotion.md)
- Reference impl: PR #989 (merged 2026-04-22)
