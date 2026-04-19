---
id: bug.0326
type: bug
title: wait-for-argocd.sh reports green when promoted digests never reach pods
status: needs_triage
priority: 2
rank: 60
estimate: 2
summary: Flight's Argo readiness gate passes on `sync.revision == SHA && health.status == Healthy` only. If promote-build-payload silently drops a digest (e.g. because the resolver doesn't know about a new target name), the overlay doesn't change, pods stay on the old digest, sync.revision still matches the deploy-branch SHA, health still reports Healthy because pods are running *something* — and flight reports green. No verification that promoted digests actually appear in the cluster's pod `containerStatuses[].imageID`. (Filed as bug.0321 on main while bug.0321 was already taken by the silent-green umbrella; renumbered to bug.0326 during merge. PR #921 Fix 4 partially closes this via verify-buildsha asserting /readyz.version per-app; a stronger kubectl digest-match check remains as a follow-up hardening.)
outcome: Flight fails loudly when a promoted digest does not become a running pod digest within the reconciliation window, instead of vacuously passing on revision + health alone.
spec_refs:
  - ci-cd-spec
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-18
updated: 2026-04-18
labels: [cicd, flight, argo, observability]
external_refs:
---

# wait-for-argocd.sh reports green when promoted digests never reach pods

## How this surfaced

PR #916 (task.0324) added per-node migrator targets (`operator-migrator`, `poly-migrator`, `resy-migrator`) to `build-and-push-images.sh` + detect-affected + promote-build-payload, but `resolve-pr-build-images.sh:13` still hardcoded the old flat target list `(operator migrator poly resy scheduler-worker)`. The resolver walked the old list, never looked up the new tags, emitted a payload without per-node migrator digests → `promote-build-payload.sh` had nothing to promote per node → overlay's `cogni-template-migrate` slot stayed on #920's digest.

`candidate-flight.yml` ran to completion and reported green:

- `kubectl -n argocd get application <app> -o jsonpath='{.status.sync.revision}'` → matched `EXPECTED_SHA` (because we DID push a new deploy-branch commit)
- `kubectl -n argocd get application <app> -o jsonpath='{.status.health.status}'` → `Healthy` (because pods were running fine — on the OLD digests)

Neither signal proves the intended images actually reached the cluster. The gate is vacuous when the digest-writing step silently fails upstream.

## Minimal repro

1. Dispatch `candidate-flight.yml` with a PR that introduced a new build-target name missing from `resolve-pr-build-images.sh`'s `ALL_TARGETS` list.
2. Observe: `wait-for-argocd.sh` exits 0; `gh pr checks` shows flight green.
3. `kubectl get pods -n <env> -o jsonpath='{...containerStatuses[*].imageID}'` shows imageIDs matching the PREVIOUS deploy's digests, not the PR's.

## Root cause

`scripts/ci/wait-for-argocd.sh:10-12` explicitly:

> Correctness contract: we check `status.sync.revision == EXPECTED_SHA` and
> `status.health.status == Healthy`, not `status.sync.status == Synced`. The
> top-level sync.status is noisy on this cluster…

The noise-avoidance for `sync.status` is reasonable, but the two chosen signals together still don't prove the promoted digest landed. `sync.revision` only proves the deploy-branch commit was processed, not that the manifest's image digest changed between commits. `health.status == Healthy` checks pod readiness, not image identity.

## Proposed fix

Add a post-sync digest-match check. Pseudocode:

```bash
# For each (app, expected_container_digest) pair from the promoted payload:
actual=$(kubectl -n "$NS" get pod -l app="$app" -o jsonpath='{.items[0].status.containerStatuses[?(@.name=="app")].imageID}')
# actual looks like: docker-pullable://ghcr.io/.../cogni-template@sha256:abc123
actual_digest="${actual##*@}"
if [ "$actual_digest" != "$expected_container_digest" ]; then
  log_error "Digest mismatch: $app pod running $actual_digest, expected $expected_container_digest"
  exit 1
fi
```

Data flow: `promote-build-payload.sh` writes the digests it just promoted to a file (`/tmp/promoted-digests.json` or similar). `wait-for-argocd.sh` reads that file and, after its existing revision + health check passes, asserts each promoted digest matches an actual running pod's `imageID`.

Needs to also check migration Jobs, not just Deployments — a failed Job (bad image, CrashLoopBackOff) may not be reflected in the AppSet's `health.status` if Argo's Job health assessment is lenient.

## Scope boundaries

- Do NOT switch back to `sync.status == Synced` — that's noisy for documented reasons.
- Do NOT change the `sync.revision` / `health.status` checks — keep as first-line gates.
- Add the digest-match assertion AFTER those pass, as a sharper second-line gate.

## Related

- task.0308 (deployment observability scorecard) — `getCandidateHealth` should include the same digest-match assertion as an SLO
- task.0309 (QA agent) — would catch this in its validation pass, but pre-QA flight gates should fail first

## Allowed Changes

- `scripts/ci/wait-for-argocd.sh`
- `scripts/ci/promote-build-payload.sh` — emit the list of promoted digests for the wait script to consume
- `scripts/ci/smoke-candidate.sh` — optional, surface the digest-match in the smoke summary

## Plan

- [ ] **Step 1** — `promote-build-payload.sh` writes `/tmp/promoted-digests.json` listing every `{app, container, digest}` it just wrote to the overlay
- [ ] **Step 2** — `wait-for-argocd.sh` reads the file after its existing checks pass; for each entry, asserts the corresponding pod's `containerStatuses[].imageID` ends with the expected digest
- [ ] **Step 3** — Job digest-match check: also assert the `migrate-node-app` Job's pod template image matches the promoted migrator digest (catches the exact PR #916 failure mode)
- [ ] **Step 4** — Fail the flight loudly with `[ERROR] Digest mismatch: <app> pod running <actual>, overlay promoted <expected>`

## Validation

**Exercise:**

1. Introduce a synthetic bug: remove one target from `resolve-pr-build-images.sh` ALL_TARGETS.
2. Dispatch candidate-flight on any PR that should have built that target.
3. Expect: flight fails loudly at `wait-for-argocd.sh` with a digest mismatch, pointing at the missing target.

**Observability:** flight step summary surfaces the digest-match table (each app, expected digest, actual digest, ✓/✗).

## Review Checklist

- [ ] **Work Item:** `bug.0321` linked in PR body
- [ ] **Digest check runs AFTER existing revision+health checks** (don't replace the cheap checks with a more expensive one)
- [ ] **Covers Jobs AND Deployments** (migration Job is the most likely failure mode)
- [ ] **Fails loudly** — no silent fallback or soft-failure
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Surfaced in PR #916 task.0324 flight, 2026-04-18
- Related: task.0308 (deployment observability scorecard), task.0309 (QA agent validation)

## Attribution

-
