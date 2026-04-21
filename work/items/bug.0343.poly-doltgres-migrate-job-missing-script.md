---
id: bug.0343
type: bug
title: Candidate-a poly flights inherit ancient poly-migrator digest — doltgres PreSync hook fails intermittently
status: needs_review
priority: 1
rank: 99
estimate: 2
summary: Candidate-a's three overlay files on `main` pin `cogni-template-migrate` to `sha256:f6c723a29c…` — a poly-migrator image built 2026-04-04, 15 days before PR #894 (2026-04-19) added `db:migrate:poly:doltgres:container` to root `package.json`. `candidate-flight.yml` rsyncs `main`'s overlay onto `deploy/candidate-a` every flight, so any poly PR whose affected-only detect skips `poly-migrator` (i.e. doesn't touch `nodes/poly/app/src/{shared/db,adapters/server/db/migrations}/*` or `packages/*` or root package.json) inherits the broken digest. Argo's PreSync hook `poly-migrate-poly-doltgres` then crashloops with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "db:migrate:poly:doltgres:container" not found`, hits backoffLimit, and Argo never enters Sync — poly Deployment stays pinned to the previous flight's SHA. The symptom presents as verify-buildsha mismatch.
outcome: Any poly-touching PR rebuilds `poly-migrate` together with the poly app image. `promote-build-payload.sh` always has a fresh migrator digest to promote, overwriting the stale one that `main` re-seeds via rsync. PreSync hook succeeds; Argo completes Sync; verify-buildsha passes.
spec_refs:
assignees: derekg1729
credit:
project:
branch: fix/bug-0343-poly-doltgres-migrator
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-20
updated: 2026-04-20
labels: [ci, deploy, poly, doltgres, argo, candidate-a]
external_refs:
---

# Candidate-a poly flights inherit ancient poly-migrator digest — doltgres PreSync hook fails intermittently

## Requirements

### Observed

**Triggering run:** `candidate-flight.yml` [24695330251](https://github.com/Cogni-DAO/node-template/actions/runs/24695330251) for PR #965. `verify-candidate` failed because the poly Deployment never rolled. Argo `candidate-a-poly` Application controller log (Loki):

```
Updating operation state. phase: Running -> Failed,
  message: 'waiting for completion of hook batch/Job/poly-migrate-poly-doltgres'
       -> 'one or more synchronization tasks completed unsuccessfully'
Job has reached the specified backoff limit
```

PreSync hook pods (10 retries, all emit identical container log):

```
undefined
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "db:migrate:poly:doltgres:container" not found
Did you mean "pnpm db:migrate:container"?
```

`pod=~poly-migrate-poly-doltgres-{4cd7t,7lvx6,gtdv6,gttbk,pdqcq,r84t5,rqdbq,rqdvh,sqj5x,vbdsw}` in `cogni-candidate-a`, container `migrate-doltgres`.

### Root cause (all verified, zero guesswork)

1. **Ancient migrator image pinned in `main`'s candidate-a overlays.** All three of `infra/k8s/overlays/candidate-a/{operator,poly,resy}/kustomization.yaml` on `main` pin `cogni-template-migrate` to `sha256:f6c723a29c402c89fffd805c3707f0200d9dc0bf252418a771043027a8d3352c`. `docker inspect` confirms that image was created **2026-04-04T18:46:59Z**.
2. **Script added 2026-04-19** by PR #894 (commit `eb832de78`). 15 days AFTER the image was built — the image literally cannot contain it. Verified via `docker run --rm <digest> sh -c 'grep -c "db:migrate:poly:doltgres:container" /app/package.json'` → `0`.
3. **`candidate-flight.yml:137` rsyncs overlays from `main` on every flight:**

   ```yaml
   rsync -a --delete app-src/infra/k8s/overlays/candidate-a/ deploy-branch/infra/k8s/overlays/candidate-a/
   ```

   This wipes deploy-branch's accumulated digest updates back to whatever `main` has.

4. **`detect-affected.sh` asymmetry.** The operator catchall at `nodes/operator/*` pairs app with migrator (`add_target operator` + `add_target operator-migrator`). Poly and resy catchalls (`nodes/poly/*`, `nodes/resy/*`) **only add the app**. So poly-only PRs (UI, features, non-DB code) don't produce a `pr-<N>-<sha>-poly-migrator` image. `resolve-pr-build-images.sh` finds no migrator tag → `promote-build-payload.sh` passes no `--migrator-digest` → `promote-k8s-image.sh` leaves the migrator line untouched → the ancient digest from step 1 persists.

5. **PR #894 (eb832de78) — where the hook was introduced — also added `base/poly-doltgres` to candidate-a's poly overlay.** Flights since then exercise the hook. Flights that happened to also rebuild `poly-migrator` (because they touched `packages/*` or Postgres migrations or root `package.json`) promoted a fresh image that did contain the script; flights that didn't inherited the ancient broken one. This is why PR #964 (touched `packages/market-provider/*` → global rebuild) succeeded while PR #965 (touched only `nodes/poly/app/src/features/wallet-analysis/*`) failed — same day, same hour.

Evidence trail recorded in the flight-coordinator session (main branch checkout):

- Run logs + Loki: run 24695330251 + run 24696166119 (PR #964 success).
- Digest time-travel: `git show <flight-commit> -- infra/k8s/overlays/candidate-a/poly/kustomization.yaml` for each flight this session; migrator digest reverts to `f6c723a29c…` on flights that didn't rebuild the migrator.
- Asymmetry in `scripts/ci/detect-affected.sh:157-171` — `nodes/operator/*` pairs, `nodes/poly/*` and `nodes/resy/*` don't.

### Expected

- Every poly-touching PR builds both `poly` and `poly-migrator` images. Same for resy.
- `promote-build-payload.sh` always has a fresh migrator digest to promote to candidate-a.
- Argo PreSync Job `poly-migrate-poly-doltgres` runs against an image that contains the script; exits 0.
- Sync proceeds; Deployment rolls; verify-buildsha passes on first attempt.

### Reproduction

- Any poly-only UI/feature PR (example: #965) flighted against the current `main` before this fix lands will fail at `verify-candidate` with the migrator container log shown above. PR #964 only passed because it touched `packages/market-provider/*` which triggers `add_all_targets` (global rebuild), masking the underlying bug.

Local image-level reproduction (confirms the image really is missing the script):

```bash
docker pull --platform=linux/amd64 ghcr.io/cogni-dao/cogni-template@sha256:f6c723a29c402c89fffd805c3707f0200d9dc0bf252418a771043027a8d3352c
docker run --rm --platform=linux/amd64 --entrypoint sh \
  ghcr.io/cogni-dao/cogni-template@sha256:f6c723a29c402c89fffd805c3707f0200d9dc0bf252418a771043027a8d3352c \
  -c 'grep -c "db:migrate:poly:doltgres:container" /app/package.json'
# → 0
```

### Impact

- **Severity: P1.** Blocks random poly candidate-a flights. Reproduces on every poly-only PR that avoids the global rebuild triggers. Doesn't reach preview/prod because those run through `promote-and-deploy.yml`, which does its own digest resolution per merge and doesn't suffer the same rsync-from-main overwrite path (confirmed — the preview/prod overlays live on `deploy/preview` and `deploy/production`, not `main`).
- Not a total blocker (PRs that touch shared packages or migrations still flight cleanly), but silent intermittent — the next poly-only PR will hit it again until the fix is in.

## Allowed Changes

- `scripts/ci/detect-affected.sh` — pair poly+poly-migrator and resy+resy-migrator in their catchall cases (structural fix).
- `infra/k8s/overlays/candidate-a/{operator,poly,resy}/kustomization.yaml` — update `cogni-template-migrate` digest from the ancient `f6c723a29c…` to current known-working digests promoted by PR #964's flight (`dfa77160c4…`, `ce0582e0d4…`, `7940ebcd21…`). Defense in depth — an overlay whose digest at least matches a currently-running image limits blast radius of any future gap in the detect logic.
- `work/items/bug.0343.*.md` — this file.

Out of scope: rewriting `candidate-flight.yml`'s rsync model, changing the `promote-and-deploy.yml` flow, touching preview/prod overlays, modifying `base/poly-doltgres/doltgres-migration-job.yaml`.

## Plan

- [x] Reproduce on run 24695330251: confirm `poly-migrate-poly-doltgres` Job failed with script-not-found.
- [x] Verify image `sha256:f6c723a29c…` predates PR #894's script addition (15 days old).
- [x] Trace asymmetry in `detect-affected.sh` catchall cases (operator pairs migrator; poly/resy do not).
- [x] Trace rsync-from-main reset mechanism in `candidate-flight.yml:137` that re-seeds the ancient digest every flight.
- [x] Identify three candidate-a overlays on `main` carrying the ancient digest.
- [x] Pair poly+poly-migrator and resy+resy-migrator in `detect-affected.sh` catchalls.
- [x] Bump the three candidate-a overlay digests on `main` to the current known-working images.
- [ ] Merge this PR.
- [ ] Flight any poly-only PR to candidate-a and confirm: (a) `pr-build` produces both poly and poly-migrator images; (b) `poly-migrate-poly-doltgres` Job succeeds first try; (c) endpoint `/readyz.version` matches the PR's head SHA.
- [ ] Flag the rsync-from-main reset path to the CI/CD owner as a followup — overlays don't feel like the right place for image digests given this pattern.

## Validation

**Command:**

```bash
# Unit-level: detect-affected.sh must add poly-migrator for a poly-only path
SCRIPT_DIR=scripts/ci bash -c '
  tmp=$(mktemp -d)
  cat > "$tmp/changed" <<EOF
nodes/poly/app/src/features/wallet-analysis/components/CopyTradeToggle.tsx
EOF
  CHANGED_PATHS_FILE="$tmp/changed" bash scripts/ci/detect-affected.sh | jq -r ".targets[]" | sort
'
# Expected output: must contain both `poly` and `poly-migrator`
```

```bash
# System-level: re-flight PR #965 (or the next queued poly-only PR) after this fix lands
gh workflow run candidate-flight.yml --repo Cogni-DAO/node-template -f pr_number=965
gh run watch <new-run-id> --repo Cogni-DAO/node-template --exit-status
```

**Expected:** All four flight jobs green (`flight`, `verify-candidate`, `release-slot`). `pr-build` includes `build (poly-migrator)` in its targets. Loki query `{namespace="cogni-candidate-a", pod=~"poly-node-app-.*"} |= "app started" | json | buildSha="<pr-965-head>"` returns a row. `curl https://poly-test.cognidao.org/readyz` returns the PR head SHA.

## Review Checklist

- [ ] **Work Item:** `bug.0343` linked in PR body.
- [ ] **Spec:** no invariants modified. CI-CD invariant upheld: candidate-a flight produces a verifiable per-PR k8s state; Argo PreSync hooks receive images containing the scripts they invoke.
- [ ] **Tests:** `detect-affected.sh` is shell-only; assertion is the validation command above run against poly-only + resy-only path sets. No test file added — shell detection logic is exercised by every real PR.
- [ ] **Reviewer:** assigned and approved.

## PR / Links

- Failing flight that surfaced this: https://github.com/Cogni-DAO/node-template/actions/runs/24695330251
- Contrasting successful flight (same day, different PR): https://github.com/Cogni-DAO/node-template/actions/runs/24696166119
- PR #965 (original blocked): https://github.com/Cogni-DAO/node-template/pull/965
- PR #894 / eb832de78 — script + Doltgres Job introduced together.

## Attribution

- Filed and root-caused from the pr-coordinator-v0 flight session on 2026-04-20; diagnosis walked back from "always broken" (wrong) to "intermittent based on affected-only" (correct) once PR #964 succeeded with the same manifest.
- Hard data: Loki container logs, Argo application-controller logs, `docker run` image inspection, git log -S of the overlay files, commit history of `scripts/ci/detect-affected.sh`.
