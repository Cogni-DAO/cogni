---
id: bug.0363
type: bug
title: "wait-for-argocd `delete_stale_hook_jobs` kills live migration jobs → infinite stuck-Running loop"
status: needs_review
priority: 0
rank: 1
estimate: 1
created: 2026-04-23
updated: 2026-04-23
summary: "`scripts/ci/wait-for-argocd.sh:delete_stale_hook_jobs()` unconditionally deletes the named PreSync migration Jobs on kick #1 (30s into the wait). When a real migration is running and takes >30s (poly's doltgres migrate can), the script kills the live job mid-migration. Argo's sync operation is then stuck in `phase=Running` waiting for a hook Job that no longer exists, triggering `clear_stale_missing_hook_operation` → `operation=null` → Argo auto-syncs → creates new jobs → script kills them again. Infinite loop until ARGOCD_TIMEOUT. Hit on PR #1007 flight run 24859890146 / 24862082091."
outcome: "`delete_stale_hook_jobs` skips jobs whose `.status.active > 0` — only truly orphaned (completed or failed) jobs get deleted. A live migration on kick #1 is left alone; on the next kick, if it's still running, it's still protected. Stale jobs from prior syncs (no `.status.active`) are still cleaned. PR #1007 flight completes without manual kubectl intervention."
spec_refs:
  - docs/spec/ci-cd.md
assignees: [derekg1729]
credit:
project: proj.cicd-services-gitops
initiative:
branch: fix/bug-hook-job-race
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
labels: [ci-cd, candidate-flight, argocd, gitops]
external_refs:
  - bug.0359
  - bug.0360
  - pr #1005
  - pr #1014
  - run 24859890146
  - run 24862082091
---

# bug.0361 — `delete_stale_hook_jobs` kills live migration Jobs

## Why

PR #1007 flight failed three consecutive times with `candidate-a-poly` stuck in `phase=Running waiting for completion of hook batch/Job/poly-migrate-node-app and 1 more hooks`. PR #1014's fix (`operation=null` instead of `terminate-op`) correctly cleared the stuck operation, but the flight still failed because Argo immediately spawned a new sync, created fresh migration jobs, and the same script then killed them again at kick #1.

Manual SSH diagnosis on candidate-a (2026-04-23 ~22:40Z):

1. Patched `operation=null` on `candidate-a-poly`.
2. Watched Argo auto-sync → created `poly-migrate-node-app` and `poly-migrate-poly-doltgres` jobs at T+0.
3. Both completed successfully at T+20s.
4. Application went `Synced + Healthy + Succeeded`.

So the migrations themselves work. The script is the loop driver.

## Root cause

`scripts/ci/wait-for-argocd.sh:206` — `delete_stale_hook_jobs()` has no staleness check:

```bash
for job in "${jobs[@]}"; do
  echo "    🧹 deleting stale hook job ${namespace}/${job}"
  kubectl -n "$namespace" delete job "$job" --ignore-not-found >/dev/null 2>&1 || true
done
```

The function name implies a filter ("stale"), but the implementation deletes every named job unconditionally. When `ACTIVE_SYNC_AFTER=30s` elapses and the poly-doltgres migration is still running (it takes ~20-60s depending on schema drift), the script kills it mid-flight. Argo's hook-sync operation blocks forever on the missing Job, and the recovery paths added in #1005 (`clear_stale_missing_hook_operation`) can only loop the Application back through the same kill.

Previous flights survived because:

- Single-app promotions (e.g. PR #1006 was poly-only against a clean cluster) ran migrations fast enough to clear before kick #1.
- Fresh migrations on previously-migrated schemas complete in <10s.
- Apps without migration-intensive changes (operator, resy) complete hook jobs fast.

Multi-app flights with schema drift (PR #1007: operator + poly + resy + scheduler-worker, against a cluster that had been idle) crossed the 30s threshold.

## Fix

Skip deletion when `.status.active > 0`:

```bash
for job in "${jobs[@]}"; do
  active=$(kubectl -n "$namespace" get job "$job" -o jsonpath='{.status.active}' 2>/dev/null || true)
  if [ "${active:-0}" -gt 0 ]; then
    echo "    ⏭ skipping active hook job ${namespace}/${job} (still running)"
    continue
  fi
  echo "    🧹 deleting stale hook job ${namespace}/${job}"
  kubectl -n "$namespace" delete job "$job" --ignore-not-found >/dev/null 2>&1 || true
done
```

- `.status.active` is the Kubernetes-native count of running pods for a Job. `> 0` iff the Job is actively executing.
- Completed Jobs have `.status.active=0` + `.status.succeeded>=1` → deletable (truly stale from prior sync).
- Failed Jobs have `.status.active=0` + `.status.failed>=1` → deletable (stale, will be recreated on next sync).
- Missing Jobs return empty → `${active:-0}` defaults to 0 → delete attempt runs with `--ignore-not-found` and no-ops cleanly.

The guard is additive: every previously-deletable state still gets deleted. Only the "live migration running" case is newly protected.

## Validation

exercise: dispatch `candidate-flight.yml` for PR #1007 and observe the Wait-for-ArgoCD step. Expected:

- If migrations complete before ACTIVE_SYNC_AFTER (30s): no kick fires, no deletion attempt. Unchanged behavior.
- If migrations are still running at kick #1: log line `⏭ skipping active hook job ...`, deletion skipped, `clear_stale_missing_hook_operation` does not fire (operation is legitimately Running, not stuck), Argo sync completes normally.

observability: GH Actions run log for the verify-candidate job; Loki `{namespace="cogni-candidate-a"} |= "app started" | json | buildSha = "<pr-head-sha>"` confirms the promoted image booted.

## Review Feedback
