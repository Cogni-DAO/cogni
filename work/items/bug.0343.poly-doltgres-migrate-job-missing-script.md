---
id: bug.0343
type: bug
title: poly-migrate-poly-doltgres Job fails — "db:migrate:poly:doltgres:container" not found in migrator image
status: needs_triage
priority: 0
rank: 99
estimate: 2
summary: Argo PreSync Job `poly-migrate-poly-doltgres` crashloops on candidate-a with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "db:migrate:poly:doltgres:container" not found`. Hits backoffLimit, flips to Failed, which blocks Argo from ever entering Sync phase. Every poly flight to candidate-a (and eventually preview/prod) is stuck — the Deployment never rolls, pods stay on the previously-flighted SHA, and verify-buildsha correctly reports the mismatch as flight failure.
outcome: PreSync Job runs the correct script and succeeds on first attempt; Argo proceeds to Sync; poly Deployment rolls the new pods; verify-buildsha passes. First flight to candidate-a after the fix lands should complete end-to-end.
spec_refs:
assignees: derekg1729
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-20
updated: 2026-04-20
labels: [ci, deploy, poly, doltgres, argo, p0]
external_refs:
---

# poly-migrate-poly-doltgres Job fails on candidate-a — script missing in migrator image

## Requirements

### Observed

`candidate-flight.yml` run [24695330251](https://github.com/Cogni-DAO/node-template/actions/runs/24695330251) for PR #965 fails at `verify-candidate` because the poly Deployment never rolled. Argo logs show PreSync hook `Job/poly-migrate-poly-doltgres` transitioning `Running → Failed` with message `"Job has reached the specified backoff limit"` → `"one or more synchronization tasks completed unsuccessfully"`. All retries of the Job emit the same container log:

```
undefined
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "db:migrate:poly:doltgres:container" not found
Did you mean "pnpm db:migrate:container"?
```

Pods examined (all show identical error):
`poly-migrate-poly-doltgres-{4cd7t,7lvx6,gtdv6,gttbk,pdqcq,r84t5,rqdbq,rqdvh,sqj5x,vbdsw}` in `cogni-candidate-a`, container `migrate-doltgres`.

Code pointers:

- **Job spec**: `infra/k8s/base/poly-doltgres/doltgres-migration-job.yaml:45` — `command: ["pnpm", "db:migrate:poly:doltgres:container"]`
- **Script definition** (exists on `main`): `package.json` — `"db:migrate:poly:doltgres:container": "tsx node_modules/drizzle-kit/bin.cjs migrate --config=nodes/poly/drizzle.doltgres.config.ts && node nodes/poly/packages/doltgres-schema/stamp-commit.mjs"`
- **Image build**: `scripts/ci/build-and-push-images.sh:155-168` — `poly-migrator` builds from `nodes/poly/app/Dockerfile --target migrator`
- **Dockerfile migrator stage**: `nodes/poly/app/Dockerfile:67-86` — COPYs `package.json` from builder stage at line 70; CMD defaults to `db:migrate:poly:container` (line 86) but the k8s Job overrides.

### Root cause (narrowed, not 100% proven)

The script exists in the source tree but is **not present in the migrator image** running in-cluster. Three candidate causes, in decreasing likelihood:

1. **Stale buildx cache for `poly-migrator`**: `--cache-from type=gha,scope=build-poly-migrator` at `build-and-push-images.sh:163` reuses the `COPY package.json` layer across builds. If the cache holds a pre-PR-#894 (eb832de78) version of `package.json` and a later buildx doesn't invalidate it correctly, the image's `/app/package.json` lacks `db:migrate:poly:doltgres:container`. PR #894 is where both the Job manifest and the script were introduced.
2. **Migrator image digest skew vs the Deployment**: `candidate-flight.yml`'s promote step may resolve the `poly-migrator` digest to a stale prior PR build (cache hit) while the poly app image resolves to the fresh digest. Worth confirming by inspecting the overlay's migrator image digest vs. expected.
3. **Doltgres inputs are not in the fingerprint**: `scripts/ci/compute_migrator_fingerprint.sh:37-48` (`poly` case) does **not** include `nodes/poly/drizzle.doltgres.config.ts`, `nodes/poly/packages/doltgres-schema/*`, `nodes/poly/app/src/adapters/server/db/doltgres-migrations/`, or `nodes/node-template/packages/knowledge/`. Although this script is currently only referenced by `ci.yaml:346` (operator context), the same omission might bite if fingerprint-based reuse lands elsewhere. Flag for audit even if not the immediate cause.

### Expected

- `pnpm db:migrate:poly:doltgres:container` exists in `/app/package.json` of every `poly-migrator` image tagged `pr-<N>-<sha>-poly-migrator` on GHCR.
- PreSync Job `poly-migrate-poly-doltgres` exits 0 on first attempt.
- Argo enters Sync phase and rolls the new Deployment.
- `verify-buildsha.sh` returns green on first poll.

### Reproduction

```bash
# Pull the migrator image that failed (use any pr-<N>-<sha>-poly-migrator
# digest from a recent failed flight, or the current candidate-a overlay digest)
docker pull ghcr.io/cogni-dao/cogni-template@sha256:<poly-migrator-digest>

# Verify the script is missing
docker run --rm --entrypoint sh ghcr.io/cogni-dao/cogni-template@sha256:<poly-migrator-digest> \
  -c 'grep -c db:migrate:poly:doltgres:container /app/package.json'
# Expected: 1   Observed (bug): 0

# Or reproduce the runtime error
docker run --rm ghcr.io/cogni-dao/cogni-template@sha256:<poly-migrator-digest> \
  pnpm db:migrate:poly:doltgres:container
# Expected: migration runs   Observed: ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL
```

Full flight reproduction is already in hand: run ID `24695330251` in `Cogni-DAO/node-template`, PR #965.

### Impact

- **Severity: P0.** Blocks all candidate-a flights that actually reconcile poly Argo state. PR #965's flight failed; the underlying cluster state means even non-poly PRs may hit the same PreSync gate whenever poly-doltgres is in the manifest.
- **Silent workaround until now**: prior flights (#934, #944, #962) appear to have passed because their poly-migrator images happened to contain the script (not yet confirmed — needs `docker inspect`). Cache state is path-dependent and unpredictable.
- **Preview and prod are unaffected for now** only because preview Argo is separately broken (see other dev's investigation) and prod hasn't received this manifest yet. This bug will block preview/prod promotion once preview Argo is fixed, unless this is resolved first.

## Allowed Changes

- `scripts/ci/build-and-push-images.sh` (poly-migrator buildx cache keys / `--no-cache` gating for package.json)
- `nodes/poly/app/Dockerfile` (explicit package.json-layer cache-bust or explicit COPY of the script source)
- `scripts/ci/compute_migrator_fingerprint.sh` (add Doltgres inputs to poly fingerprint for future-proofing)
- `infra/k8s/base/poly-doltgres/doltgres-migration-job.yaml` (if the right fix is to call a per-node-workspace script instead of root)
- `package.json` (only if moving the script into the poly workspace is the chosen fix)

Out of scope: touching non-poly migrator logic, changing Argo sync policy, altering the Job retry/backoff shape.

## Plan

- [ ] Pull the exact `poly-migrator` image from run 24695330251's promote step and `docker run ... cat /app/package.json | grep doltgres` to confirm the script is literally absent.
- [ ] If absent: check the buildx gha cache for `scope=build-poly-migrator` — inspect whether the `COPY package.json` layer hash matches pre-#894 or post-#894 `package.json`.
- [ ] Root-cause: stale cache vs. resolve-pr-build-images promoting a stale digest vs. something else entirely.
- [ ] Apply the minimal fix (likely: force cache-bust on the package.json layer, or pin migrator build to `--no-cache` for the manifests layer).
- [ ] Add Doltgres inputs to `compute_migrator_fingerprint.sh` poly section regardless — coverage gap independent of this specific bug.
- [ ] Re-flight PR #965 to candidate-a; verify `poly-migrate-poly-doltgres` Job exits 0 and Argo rolls the Deployment.
- [ ] Loki proof: `{namespace="cogni-candidate-a", pod=~"poly-node-app-.*"} |= "app started" | json | buildSha="<pr-965-head>"` returns a row.

## Validation

**Command:**

```bash
# After fix lands, re-flight PR #965 (or equivalent poly PR):
gh workflow run candidate-flight.yml --repo Cogni-DAO/node-template -f pr_number=965

# Watch run to success
gh run watch <run-id> --repo Cogni-DAO/node-template --exit-status
```

**Expected:** All 4 jobs (flight, verify-candidate, release-slot) succeed. `poly-migrate-poly-doltgres` PreSync Job completes on first attempt. Argo reports Healthy for `candidate-a-poly`. `curl https://poly-test.cognidao.org/readyz` returns `version=<pr-head-sha>` matching the flight's expected SHA.

## Review Checklist

- [ ] **Work Item:** `bug.0343` linked in PR body
- [ ] **Spec:** CI-CD invariants upheld (candidate-flight is the single app-lever; PreSync Jobs must succeed deterministically per reconcile)
- [ ] **Tests:** a smoke check validating `pnpm db:migrate:poly:doltgres:container` resolves inside the built poly-migrator image (docker run assertion)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Failing flight: https://github.com/Cogni-DAO/node-template/actions/runs/24695330251
- PR that surfaced it: https://github.com/Cogni-DAO/node-template/pull/965
- Related (where the script + manifest were introduced): #894 / eb832de78

## Attribution

- Filed from pr-coordinator-v0 flight-coordinator loop; evidence gathered via Loki queries against `cogni-candidate-a` pod logs and `argocd` reconcile logs on 2026-04-20.
