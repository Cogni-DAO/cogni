---
id: bug.0443
type: bug
title: "Admin-merge bypasses merge_group → flight-preview silently skips, promote-and-deploy reports success on no-op, scheduler-worker breaks aggregate-production"
status: done
priority: 0
rank: 1
estimate: 3
summary: "OBSERVED: PR #1166 was admin-merged at 04:25:49Z (bypassing GH merge queue), so no merge_group pr-build ran for the squash commit `db2e416f` and no `mq-1166-db2e416f` images were ever pushed to GHCR. flight-preview's PR-resolver correctly identified PR #1166 (the `(#NNNN)` parse from bug.0320 worked), but the next step `Resolve PR image digests` returned `has_images=false`. The `Re-tag merge_group images` step is gated `if: has_images == 'true'` and silently skipped. flight-preview.sh was then dispatched anyway → promote-and-deploy ran with no `preview-db2e416f` images existing → every promote-k8s leg wrote `PROMOTED=false` to its cell artifact → workflow conclusion=success while the running pod still served `8b1227d6` (pre-fix). SEPARATE BUG: aggregate-production fails on every green deploy with `Axiom 19 contradiction: scheduler-worker` because scheduler-worker's verify-deploy leg uploads a `cell-verify-scheduler-worker` artifact with no `verified-scheduler-worker.txt` (verify-buildsha.sh filters non-Ingress nodes) → aggregate-decide-outcome.sh sees `promoted=true` + missing verified marker → STRICT_FAIL exit 1. EXPECTED: (a) flight-preview hard-fails when PR resolves but no images exist, with a clear admin-merge / merge-queue-bypass error; (b) verify-buildsha.sh writes verified=true markers for non-Ingress nodes (rollout-status already gated them upstream); (c) aggregate-decide-outcome.sh exits 1 whenever `any_promoted=false`, closing the silent-success seam. REPRO: (1) admin-merge any PR (or any merge that doesn't go through merge_group); (2) any production promotion that includes scheduler-worker. IMPACT: prod outages can survive a hotfix merge silently — the fix's PR is green, main is green, deploy reports green, but the running pod is still broken. AND every production promotion CI-fails on a non-issue, making real failures impossible to distinguish from noise."
outcome: "Three structural fixes land together so we can't ship a hotfix and have it silently no-op, AND production aggregate stops false-failing on scheduler-worker: (1) flight-preview.yml hard-fails when PR resolves but `has_images != 'true'`, naming admin-merge as the likely cause and pointing to build-multi-node.yml as the recovery dispatch; (2) verify-buildsha.sh writes `verified-<node>.txt=true` markers for non-Ingress nodes (scheduler-worker today, migrators in future) since rollout-status earlier in verify-deploy already proved them; (3) aggregate-decide-outcome.sh exits 1 unconditionally when `any_promoted=false`, regardless of STRICT_FAIL — that one branch is the silent-success seam. After this PR, a clean repro admin-merging a small PR produces a loud red flight-preview run with the recovery instruction; a normal merge-queue merge of the same PR heals preview within ~5 min; and production promotions stop reporting Axiom 19 contradictions on scheduler-worker."
spec_refs: []
assignees: []
credit:
project: proj.cicd-services-gitops
branch: fix/merge-queue-preview-promote-gap
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-05-01
updated: 2026-05-01
labels: [ci, deploy, merge-queue, silent-failure, p0, preview, production]
external_refs:
---

# Admin-merge bypasses merge_group → flight-preview silent skip + scheduler-worker false-fails aggregate-production

## Observed (2026-05-01 04:25–04:39 UTC)

PR #1166 (env-validator hotfix) merged at 04:25:49 UTC, **admin-merged by derekg1729 directly to main, bypassing the GH merge queue**. Confirmed: `gh api repos/.../actions/runs?event=merge_group&head_sha=db2e416f` returns 0 runs. Most recent merge_group run was for PR #1162 → 0a7f41cd. PR #1166's squash commit `db2e416f` has no merge_group pr-build run, hence no `mq-1166-db2e416f` images.

Workflow trace from the post-merge cascade:

1. `Flight Preview` run 25202180337 fired on `push:main` for sha `db2e416fd`.
2. `Resolve target SHA and associated PR` step succeeded — log shows `Merged PR #1166: main SHA db2e416f (= queue commit), PR head SHA e59d90bb`. The squash-message `(#NNNN)` parse (added by bug.0320) worked exactly as designed.
3. `Resolve PR image digests` step ran `resolve-pr-build-images.sh` for tag `mq-1166-db2e416f`. Log: `Resolved PR images: none`. Output: `has_images=false`.
4. `Re-tag merge_group images as preview-{sha} in GHCR` was gated `if: has_images == 'true'` and **skipped silently**. No `preview-db2e416f` tag exists in GHCR.
5. `Flight to preview (lock-gate aware)` ran anyway — there's no gate on `has_images` between resolve and dispatch. flight-preview.sh dispatched promote-and-deploy with `source_sha=db2e416f` despite no images existing.
6. `Promote and Deploy` run 25202187333 was dispatched. Every `promote-k8s (<node>)` leg's `Resolve digest for this node` step emitted `::error::preview-forward: resolve-digests-from-preview emitted no digests_json` and uploaded a per-cell artifact with `PROMOTED=false`.
7. `aggregate-preview` correctly emitted `outcome=failed` ("no cell reported promoted=true — refusing to advance") AND ran `Unlock preview on failure` — but `aggregate-decide-outcome.sh` does **not** exit 1 in preview (no `STRICT_FAIL`), so the job/workflow concluded `success`.
8. Preview pods unchanged. `/version` still returns `8b1227d6` (pre-fix image). Old pod Ready 1/1, broken new pod stuck Ready 0/1, no replacement triggered.

`deploy/preview-operator` confirms: last commit is `092da711b promote preview operator: 0a7f41cd` from PR #1162. No commit was pushed for #1166's "merge".

## Separate bug — aggregate-production false-fails on scheduler-worker (every prod deploy)

Independently of the above, every production deploy CI-fails. Run 25201968147 (production promotion of `351be8e1`):

```
aggregate-production: cells promoted but did not verify — Axiom 19 contradiction: scheduler-worker
outcome=failed
promote=success verify=success verify-deploy=success e2e=success deploy-infra=success
```

All upstream jobs green. Failure cause traced via artifact download:

- `cell-scheduler-worker` contains `promoted-scheduler-worker.txt = true` and `deploy-sha-scheduler-worker.txt = 736bb3a37...`.
- `cell-verify-scheduler-worker` contains **only** the upload directory — no `verified-scheduler-worker.txt`.

Reason: `verify-buildsha.sh:161-176` filters its input set down to `NODE_APPS="operator poly resy"` (Ingress-probeable apps with `/version`). For scheduler-worker (no Ingress), the script exits 0 with `ℹ️ No Ingress-probeable apps to verify — skipping buildSha check.` and never writes a marker. The verify-deploy job's upload step `if: steps.cell.outputs.promoted == 'true'` then uploads an empty `out/` directory.

`aggregate-decide-outcome.sh:43-53` walks every `promoted-<node>.txt = true` file and asserts a corresponding `verified-<node>.txt = true` exists. scheduler-worker fails this — but the failure is bogus because rollout-status earlier in verify-deploy (`wait-for-in-cluster-services.sh`) already proved the pod is the right SHA.

## Why each existing safeguard failed

| Layer                                       | What it should catch                                            | Why it didn't                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| flight-preview PR resolution                | Find the PR head SHA + image tag                                | **Worked correctly.** The squash-message `(#NNNN)` parse (bug.0320) resolved PR #1166 immediately. **No fix needed here** — earlier diagnosis claiming this was the root cause was wrong.                                                                                                                                                                                                                                                                                    |
| flight-preview `has_images` gate            | Refuse to dispatch when no images exist                         | The re-tag step gates on `has_images == 'true'` and skips, but the next step (`Flight to preview`) has no such gate. flight-preview.sh dispatches promote-and-deploy regardless.                                                                                                                                                                                                                                                                                              |
| promote-k8s per-node                        | Either promote a new digest OR fail loudly                      | Wrote `PROMOTED=false` to a cell artifact and reported job success. Same silent-success-on-no-op shape bug.0321 was supposed to kill (cf. bug.0441 which already documented the verify-deploy half).                                                                                                                                                                                                                                                                          |
| verify-deploy step-level skips              | Fail when nothing was promoted but verification was expected    | Step-level `if: steps.cell.outputs.promoted == 'true'` skipped all real checks → job green. Same primitive as bug.0441.                                                                                                                                                                                                                                                                                                                                                      |
| aggregate-preview                           | Refuse to advance the rollup when no nodes promoted             | Correctly emitted `outcome=failed` and ran the unlock step. But `aggregate-decide-outcome.sh` only `exit 1`s when `STRICT_FAIL` is set, and STRICT_FAIL is unset for preview. The script printing `::error::` doesn't fail the GH job.                                                                                                                                                                                                                                       |
| aggregate-production scheduler-worker check | Catch promoted-but-unverified cells (Axiom 19 contradiction)    | Treats scheduler-worker as verifiable. scheduler-worker has no Ingress → no `/version` probe → no `verified-scheduler-worker.txt` artifact → flagged as a contradiction. False positive on every production deploy.                                                                                                                                                                                                                                                          |

## Approach (one PR, three fixes)

### Fix 1 — flight-preview.yml hard-fail on `has_images=false`

After `Resolve PR image digests` step in `.github/workflows/flight-preview.yml`, add a job-stopping gate:

```yaml
- name: Hard-fail when no images found for resolved PR
  if: steps.pr.outputs.skip != 'true' && steps.images.outputs.has_images != 'true'
  env:
    PR_NUMBER: ${{ steps.pr.outputs.pr_number }}
    HEAD_SHA: ${{ steps.pr.outputs.head_sha }}
  run: |
    echo "::error::flight-preview resolved PR #${PR_NUMBER} (sha ${HEAD_SHA:0:8}) but no \`mq-${PR_NUMBER}-${HEAD_SHA}\` images exist in GHCR. Most likely cause: the PR was admin-merged (bypassed merge_group), so pr-build never rebuilt against the queue commit. Recovery: dispatch \`build-multi-node.yml\` for sha ${HEAD_SHA}, then re-dispatch this workflow with the same sha."
    exit 1
```

This converts the admin-merge silent-skip into a loud red checkmark with a one-line recovery instruction. The gate fires before flight-preview.sh dispatches promote-and-deploy, so no downstream cascade.

### Fix 2 — verify-buildsha.sh writes verified markers for non-Ingress nodes

In `scripts/ci/verify-buildsha.sh`, immediately after the existing filter loop that builds `NODE_ARR` (lines 163-171), collect the filtered-out non-Ingress nodes and emit `verified-<node>.txt=true` markers for them when `MARKER_DIR` is set. Rationale: rollout-status (`wait-for-in-cluster-services.sh`) earlier in verify-deploy already proves these pods are at the correct SHA, so they're verified by a different primitive — the marker just tells the aggregator that.

```bash
NON_INGRESS_NODES=()
for app in "${!EXPECTED_BY_NODE[@]}"; do
  matched=0
  for p in $NODE_APPS; do
    [ "$app" = "$p" ] && matched=1 && break
  done
  [ "$matched" = "0" ] && NON_INGRESS_NODES+=("$app")
done

if [ -n "$MARKER_DIR" ] && [ "${#NON_INGRESS_NODES[@]}" -gt 0 ]; then
  mkdir -p "$MARKER_DIR"
  for n in "${NON_INGRESS_NODES[@]}"; do
    printf 'true' > "${MARKER_DIR}/verified-${n}.txt"
    echo "  ✅ ${n}: non-Ingress (rollout-status verified upstream) — marker written"
  done
fi
```

### Fix 3 — aggregate-decide-outcome.sh hard-fails when no cell promoted

In `scripts/ci/aggregate-decide-outcome.sh`, the `any_promoted=false` branch is the specific silent-success seam bug.0443 hunts. Make it `exit 1` regardless of `STRICT_FAIL`:

```bash
if [ "$any_promoted" != "true" ]; then
  echo "::error::aggregate-${ENV}: no cell reported promoted=true — refusing to advance"
  # ... still emit outcome=failed for downstream consumers (unlock step) ...
  echo "outcome=failed" >> "$GITHUB_OUTPUT"  # if applicable
  exit 1
fi
```

The Axiom-19 unverified-cells branch keeps `STRICT_FAIL` gating (preview e2e is routinely skipped, so we can't unconditionally hard-fail there without a separate change).

Add `if: always() && steps.outcome.outputs.outcome == 'failed'` to the `Unlock preview on failure` step in `promote-and-deploy.yml` so it survives the new exit 1 above it.

## Validation

### Positive — admin-merge no longer silent-skips
1. (Mock) push a commit to main without going through merge queue (or admin-merge a tiny PR). Wait for `Flight Preview` on the squash sha.
2. `Resolve PR image digests` returns `has_images=false`.
3. New `Hard-fail when no images found for resolved PR` step fires with the clear admin-merge error message. Workflow conclusion = `failure`.
4. Recovery: dispatch `build-multi-node.yml` for that sha → re-dispatch `Flight Preview` → preview heals.

### Positive — production deploy no longer false-fails
1. Dispatch `promote-and-deploy.yml` env=production for any green source_sha.
2. `verify-deploy (scheduler-worker)` step `Verify buildSha (per-node)` writes `out/verified-scheduler-worker.txt=true` and uploads it.
3. `aggregate-production` `Assert promoted cells were verified` exits 0. Workflow conclusion = `success`.

### Negative — aggregate-decide-outcome.sh hard-fail
1. Manually dispatch `Promote and Deploy` env=preview with `source_sha=<a-sha-with-no-built-images>` (e.g. an old SHA that never had a pr-build).
2. Every promote-k8s leg writes `PROMOTED=false`.
3. `aggregate-decide-outcome.sh` exits 1 on `any_promoted=false`. Workflow conclusion = `failure`. `Unlock preview on failure` runs (gated on `always()`). Preview lease releases cleanly.

## Related

- bug.0320 — squash-commit `(#NNNN)` parse in flight-preview's PR resolver. **Already in place; the bug.0443 incident did NOT need this fixed again.**
- bug.0321 — original silent-green primitive cleanup. This bug is the same shape leaking through a sibling code path (flight-preview ↔ promote-and-deploy seam) plus a separate aggregate-production false-fail.
- bug.0441 — verify-deploy step-level `if:` survived in promote-and-deploy.yml. Same family. Could be folded into a single "ban step-level conditional verification across all CD workflows" cleanup later.
- 2026-05-01 incident PRs: #1158 (NULLS LAST regression), #1162 (NULLS LAST fix), #1166 (env-validator hotfix). PR #1166's heal was delayed by this bug.

## Bootstrap notes for the dev picking this up

Worktree: `.claude/worktrees/bug-merge-queue-preview-promote-gap`
Branch: `fix/merge-queue-preview-promote-gap` (off latest main)

Files to touch:

- `.github/workflows/flight-preview.yml` — Fix 1 (new step after `Resolve PR image digests`)
- `scripts/ci/verify-buildsha.sh` — Fix 2 (new block after `NODE_ARR` filter)
- `scripts/ci/aggregate-decide-outcome.sh` — Fix 3 (unconditional exit 1 on no-promotion)
- `.github/workflows/promote-and-deploy.yml` — `if: always() &&` on preview unlock step

Three scoped commits, one PR. Skill: `devops-expert`.
