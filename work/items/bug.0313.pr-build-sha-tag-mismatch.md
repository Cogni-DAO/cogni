---
id: bug.0313
type: bug
title: "pr-build bakes BUILD_SHA from ephemeral pull_request merge commit — /readyz version ≠ image tag"
status: needs_implement
priority: 1
rank: 1
estimate: 1
created: 2026-04-15
updated: 2026-04-15
summary: "scripts/ci/build-and-push-images.sh reads BUILD_SHA from GITHUB_SHA, which for pull_request-triggered workflows is the ephemeral refs/pull/{N}/merge SHA that GitHub computes by merging the PR head onto the target base. That SHA is never reachable from main or any PR branch. The image tag meanwhile uses github.event.pull_request.head.sha (the real PR head). Result: the image is tagged pr-{N}-{headSHA} but /readyz reports version={ephemeralMergeSHA}, breaking the Proof of Rollout ritual on every candidate-flight."
outcome: "pr-build bakes BUILD_SHA from github.event.pull_request.head.sha. /readyz version on a flighted pod exactly equals the PR head SHA, making step 3a of pr-coordinator-v0's Proof of Rollout ritual a strict equality check that can pass."
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.cicd-services-gitops
initiative: ini.cicd-trunk-based
branch: fix/pr-build-sha-tag-mismatch
related:
  - PR #865
  - bug.0312
---

# bug.0313 — pr-build bakes wrong BUILD_SHA for pull_request triggers

## Evidence

Observed during a `/pr-coordinator-v0` flight of PR #868 on 2026-04-15:

```
Flighted head:     188ba63f923257a14322442fd9fd0423002420ed  (PR #868 HEAD)
Pod was serving:   2704daf5dfafd4013a1b9a4430a6e9216576caab  (unknown; git cat-file → bad object)
Pod now serving:   365a37f38532ff9de6fc29726fdcd2a0addfa01d  (unknown; git cat-file → bad object)
```

Both orphan SHAs correspond to successive `refs/pull/868/merge` ephemeral commits (one per push). Argo DID reconcile and roll the operator pod — the image `pr-868-188ba63f-operator` was pulled and deployed. But `/readyz` reports the baked `APP_BUILD_SHA` which came from `$GITHUB_SHA` at build time, and that was the ephemeral merge SHA, not the PR head.

## Root cause

`scripts/ci/build-and-push-images.sh:74`

```bash
git_sha="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
```

Then passed to docker build:

```bash
--build-arg "BUILD_SHA=${git_sha}"
```

For `pull_request`-triggered workflows, GitHub Actions sets `GITHUB_SHA` to the **ephemeral merge commit** GitHub computes by merging the PR head onto the target base. That commit exists only under `refs/pull/{N}/merge` on github.com's side and is never pushed anywhere the user can reach. Every new push to the PR produces a new ephemeral merge commit.

`.github/workflows/pr-build.yml:27` does a clean checkout at `ref: github.event.pull_request.head.sha`, so inside the build step `git rev-parse HEAD` correctly equals the PR head. But the script prefers `$GITHUB_SHA` over `git rev-parse HEAD`, so the wrong value wins.

Meanwhile the image _tag_ is derived from `github.event.pull_request.head.sha` at workflow env-block time (`pr-build.yml:16`), so the tag is correct. The tag and baked BUILD_SHA come from different sources and diverge on pull_request triggers.

## Impact

- Breaks `/pr-coordinator-v0` step 3a (Proof of Rollout) option 1 — strict equality check between `/readyz` version and flighted SHA can never pass for any PR flight.
- Forces every flight to fall back to the fresh-replicaset-fingerprint heuristic (option 3), which is weaker evidence and windowed at 90s while Argo reconciles at ~3min.
- `org.opencontainers.image.revision` label on the image is also wrong (same line 105 in the build script), polluting GHCR image metadata.
- Makes it impossible to confirm from `/readyz` alone which PR build is running — an observability regression for any operator that relies on that endpoint for deployment identification.

## Fix

Two-part, both small:

1. **`scripts/ci/build-and-push-images.sh`** — prefer an explicit `BUILD_SHA` env var over `GITHUB_SHA`, fall back to `git rev-parse HEAD` before `unknown`:

   ```bash
   git_sha="${BUILD_SHA:-${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}}"
   ```

2. **`.github/workflows/pr-build.yml`** — pass `BUILD_SHA=${{ github.event.pull_request.head.sha }}` as a build-step env var alongside the existing `HEAD_SHA` (which is defined but not forwarded to the build script).

Other callers of the script: none today. `build-multi-node.yml` calls `docker/build-push-action` directly with its own `BUILD_SHA=${{ github.sha }}` wiring; that workflow is `push`/`workflow_dispatch`-only and github.sha is correct there.

## Acceptance

- [ ] PR #868 (or any subsequent PR flight) reports `/readyz.version == <PR head SHA>` after the next candidate-flight run.
- [ ] `docker inspect ghcr.io/cogni-dao/cogni-template:pr-<N>-<sha>` shows `org.opencontainers.image.revision == <sha>`.
- [ ] Proof of Rollout option 1 (strict equality) is usable again in `/pr-coordinator-v0`.

## Non-transient

This bug affects every PR flight, repeatedly. Each force-push or commit to a PR branch generates a new ephemeral merge commit; the bug surfaces every time. Fix, don't ignore.

## Validation

- Open any PR after the fix lands. Confirm `pr-build.yml` succeeds and produces `pr-{N}-{head.sha}` image tags in GHCR.
- `docker buildx imagetools inspect ghcr.io/cogni-dao/cogni-template:pr-{N}-{head.sha}` reports `org.opencontainers.image.revision == {head.sha}`.
- Dispatch `candidate-flight.yml -f pr_number={N}`. After Argo reconciles, `curl -sS https://test.cognidao.org/readyz | jq -r .version` returns exactly `{head.sha}`.
- `/pr-coordinator-v0` Proof of Rollout option 1 (strict equality between `/readyz.version` and flighted SHA) passes without falling back to the replicaset fingerprint heuristic.

## Notes

- Surfaced during a `/pr-coordinator-v0` flight of PR #868 on 2026-04-15 — pod was serving image tagged `pr-868-188ba63f…` correctly, but `/readyz` reported `version=365a37f3…` which maps to `refs/pull/868/merge` (not reachable in git).
- Related: bug.0312 (candidate-a deploy-infra gap) — same pipeline, different blocker.
- Related: PR #865 (introduced `/readyz` build-SHA exposure that made this bug visible).
