---
id: bug.0362
type: bug
title: "promote-and-deploy.yml: scripts checked out at source_sha can be stale (trap on old-SHA dispatch)"
status: needs_implement
priority: 2
rank: 2
estimate: 1
created: 2026-04-23
updated: 2026-04-23
project: proj.cicd-services-gitops
assignees: []
summary: "promote-and-deploy.yml checks out app-src at source_sha and invokes all CI scripts from there. Dispatching an old source_sha runs old scripts — a trap that froze preview on 2026-04-23 when a0a51da8 (pre-#1014, pre-#1016) was dispatched."
outcome: "Scripts always run from workflow ref (main) regardless of source_sha. Matches the pattern #1005 applied to candidate-flight.yml."
---

# Bug: promote-and-deploy scripts pinned to source_sha instead of workflow ref

## Symptoms

On 2026-04-23, a manual prod-recovery dispatch of `promote-and-deploy.yml` with
`source_sha=a0a51da8` (the #1006 merge — _before_ #1014 and #1016 merged) ran
the pre-#1014 `wait-for-argocd.sh`:

```
🛑 preview-poly: terminating stale Running operation ... waiting on missing hook job
⚠️  argocd terminate-op failed for preview-poly, falling back to spec.operation reset:
level=fatal msg="services is forbidden: User 'system:serviceaccount:argocd:argocd-server'
cannot list resource 'services' in API group '' in the namespace 'argocd'"
command terminated with exit code 20
```

The pre-#1014 script relied on `argocd app terminate-op` (RBAC-forbidden); #1014
replaced it with a direct `kubectl patch application ... -p '{"operation":null}'`.
But the script that actually ran came from `a0a51da8`, not `main` — because
`promote-and-deploy.yml` checks out `app-src` at `source_sha`.

The bad script couldn't clear the stale PreSync hook wedge, Argo never recreated
the migration Jobs, `verify-deploy` timed out, `unlock-preview-on-failure` fired,
preview lease bounced back to `unlocked` without advancing `current-sha`.
Preview stayed frozen at `c644f177` until a manual `kubectl patch operation=null`
on the VM unwedged it.

## Root Cause

`promote-and-deploy.yml` jobs (`promote-k8s`, `verify-deploy`) check out
`app-src` at `ref: ${{ needs.promote-k8s.outputs.head_sha }}` — i.e. the
dispatched `source_sha`. They then source scripts from that checkout
(`bash app-src/scripts/ci/wait-for-argocd.sh`, etc.). Result: the script
version is whatever shipped with the deployed commit, not whatever is on `main`
today.

PR #1005 fixed this for `candidate-flight.yml` by splitting `ci-src` (workflow
ref, for scripts) from `app-src` (source_sha, for content being deployed).
`promote-and-deploy.yml` was not brought into the pattern in the same PR.

## Scope of the trap

- **Auto flight-preview path: safe.** `flight-preview.sh` dispatches with
  `source_sha = HEAD_SHA = main tip`, so scripts are always current.
- **Manual prod dispatch: unsafe.** Operators routinely pass the preview
  `current-sha` as `source_sha`. That SHA lags main. If a critical script fix
  landed between preview-current-sha and main-tip, the prod dispatch runs the
  older buggy version.

## Fix

Mirror #1005's pattern in `promote-and-deploy.yml`:

```yaml
# in every job that invokes scripts
- name: Checkout CI scripts from workflow ref
  uses: actions/checkout@v4
  with:
    ref: ${{ github.ref }} # workflow-definition ref, always main for dispatches
    path: ci-src

- name: Checkout app source at deployed SHA (for content only)
  uses: actions/checkout@v4
  with:
    ref: ${{ needs.promote-k8s.outputs.head_sha }}
    path: app-src
```

Then every `bash app-src/scripts/ci/*` becomes `bash ci-src/scripts/ci/*`.
`app-src` is kept for content rsyncs (`infra/k8s/`, `infra/catalog/`, AppSet
YAML) because those MUST be at the deployed commit.

Affected scripts today:

- `promote-k8s-image.sh`, `lib/image-tags.sh`, `update-source-sha-map.sh` (in `promote-k8s` job)
- `wait-for-argocd.sh`, `wait-for-in-cluster-services.sh`, `verify-buildsha.sh` (in `verify-deploy` job)

Content still sourced from `app-src`:

- `infra/k8s/` + `infra/catalog/` rsync into deploy-branch (promote-k8s)
- `infra/k8s/argocd/${env}-applicationset.yaml` SCP to VM (verify-deploy, the AppSet reconcile step moved there in bug.0361)

## Validation

- exercise: dispatch `promote-and-deploy.yml` with `source_sha=<old-commit-known-to-have-buggy-scripts>` and verify the run uses main's scripts (e.g. confirm the `clearing stale Running operation` log line from #1014's wait-for-argocd rather than the old `terminate-op` + fallback pattern).
- observability: grep the job log for script paths — all script invocations use `ci-src/` prefix; `app-src/` only appears in rsync + SCP steps.

## Not a blocker for current prod deploy

The 2026-04-23 prod-unfreeze dispatches preview's healed `current-sha`
(post-#1014 + #1016) as `source_sha`, so this trap does not bite. File now
so it does not get lost; fix when hands are free or as part of the PR 2
full env unification.
