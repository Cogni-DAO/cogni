# Handoff: validate CD deploy-infra end-to-end via Grafana MCP

**Bug:** `work/items/bug.0312.purge-canary-staging-legacy-naming.md`
**Date:** 2026-04-14
**Status:** Code is shipped in main. Runtime verification + Grafana-observed evidence pending.
**Next commit base:** `origin/main` at `c5db7f232` (post-#869, post-#870)
**Grafana MCP:** Disconnected during the session that shipped the code — must be reconnected before validation.

---

## Objective (one sentence)

Prove that **both** CD paths reach the compose layer on **both** VMs and produce observable log/metric evidence in Grafana Cloud — specifically:

1. **Pre-merge path**: `candidate-flight.yml` → `deploy-infra.sh` → candidate-a VM (84.32.109.160) → alloy picks up new config
2. **Post-merge path**: `flight-preview.yml` → `promote-and-deploy.yml env=preview` → `deploy-infra.sh` → preview VM (84.32.110.92) → alloy picks up new config

Both paths must be **automated end-to-end** (no manual SSH) and both must produce Grafana-observable evidence under the correct `env` label.

---

## What just shipped (main is at `c5db7f232`)

| PR  | Commit      | What landed                                                                                                                                                                                                         |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 870 | `5c03f3806` | Three-value lease (`unlocked → dispatching → reviewing`) for `deploy/preview`. Renamed `promote-merged-pr.yml` → `flight-preview.yml` and `promote-to-preview.sh` → `flight-preview.sh`. Unlock on any non-success. |
| 869 | `c5db7f232` | Compose alloy widened to ship `argocd` and `kube-system` pod logs via `{source="k8s", namespace=~"cogni-.\*                                                                                                         | argocd | kube-system"}`. **New**: `candidate-flight.yml`runs`deploy-infra.sh` on the candidate-a VM (closes bug.0312 Phase 2.5). |

---

## Verification matrix — what "done" looks like

| #   | Test                                                   | Expected evidence                                                                                                                                                    | Tool                                              |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | Dispatch `candidate-flight.yml` for a trivial PR       | Workflow green. All 22 steps run. The new `Deploy Compose infra to candidate-a VM` step calls `deploy-infra.sh`.                                                     | `gh run view`                                     |
| 2   | During (1), watch the candidate-a VM's alloy container | alloy reloads config; widened `stage.match` is in effect                                                                                                             | SSH + `docker logs alloy`                         |
| 3   | After (1), query Grafana Loki for candidate-a samples  | `{source="k8s", namespace="argocd", env="candidate-a"}` returns >0 samples                                                                                           | **Grafana MCP**                                   |
| 4   | Merge any PR to main                                   | `flight-preview.yml` fires on push:main. Re-tag → `flight-preview.sh` → `promote-and-deploy.yml env=preview` dispatched. Lease transitions `unlocked → dispatching`. | `gh run view`                                     |
| 5   | Watch (4)'s promote-and-deploy through completion      | `lock-preview-on-success` fires; `deploy/preview:.promote-state/review-state` = `reviewing`; `current-sha` = merged SHA                                              | `git show origin/deploy/preview:.promote-state/*` |
| 6   | Query Grafana Loki for preview samples                 | `{source="k8s", namespace="argocd", env="preview"}` returns >0 samples                                                                                               | **Grafana MCP**                                   |
| 7   | Query Grafana Prometheus for candidate-a metrics       | `up{env="candidate-a"}` returns >0 series                                                                                                                            | **Grafana MCP**                                   |
| 8   | Query Grafana Prometheus for preview metrics           | `up{env="preview"}` returns >0 series                                                                                                                                | **Grafana MCP**                                   |

Objective is met when rows 1–8 all pass.

---

## Critical pointers (file:line)

### Pre-merge path (bug.0312 Phase 2.5)

- `.github/workflows/candidate-flight.yml:152-259` — the new SSH setup + deploy-infra steps. Mirrors `promote-and-deploy.yml` deploy-infra job's env block almost verbatim. Key differences: `DEPLOY_ENVIRONMENT: candidate-a`, `LITELLM_IMAGE: cogni-litellm:latest` (pinned to skip GHCR fallback).
- `.github/workflows/candidate-flight.yml:33` — `environment: candidate-a` is what maps GitHub environment secrets into the job. **Prerequisite for row 1**: the `candidate-a` GitHub environment must have all compose-deploy secrets (see "Secret inventory" below).
- `scripts/ci/deploy-infra.sh:161-171` — accepts `candidate-a` as a valid `DEPLOY_ENVIRONMENT`. Legacy `canary` retained for backward compat.

### Post-merge path (task.0293)

- `.github/workflows/flight-preview.yml` — entry point on `push:main` + `workflow_dispatch(sha)`. Re-tags and calls `flight-preview.sh`.
- `scripts/ci/flight-preview.sh:65-118` — three-value lease claim with `push_with_retry --reread-lease`.
- `.github/workflows/promote-and-deploy.yml:251-369` — `deploy-infra` job (ran both for preview and, once upon a time, canary). Calls `scripts/ci/deploy-infra.sh`.
- `.github/workflows/promote-and-deploy.yml:516-534` — `lock-preview-on-success` (dispatching → reviewing + writes `current-sha`).
- `.github/workflows/promote-and-deploy.yml:536-564` — `unlock-preview-on-failure` (handles any non-success result including cancelled/skipped).

### Spec truth (read before editing anything)

- `docs/spec/ci-cd.md § Preview Review Lock` — three-value lease contract and transition table.
- `docs/spec/cd-pipeline-e2e.md § 4.1` — 13-row table mapping PR → candidate-a flight → merge → preview flight → preview review → release → production.
- `work/items/bug.0312.*` — Phase 2.5 recommendation and follow-up list.

---

## Secret inventory (prerequisite for row 1)

`candidate-flight.yml`'s new `Deploy Compose infra to candidate-a VM` step passes ~60 env vars from `secrets.*` to `deploy-infra.sh`. The `candidate-a` GitHub environment must have parity with `preview`. Run before dispatching:

```bash
gh api /repos/Cogni-DAO/node-template/environments/candidate-a/secrets --jq '.secrets[].name' | sort > /tmp/candidate-a-secrets
gh api /repos/Cogni-DAO/node-template/environments/preview/secrets --jq '.secrets[].name' | sort > /tmp/preview-secrets
diff /tmp/preview-secrets /tmp/candidate-a-secrets
```

Any missing secret on `candidate-a` side → add via `gh secret set --env candidate-a` before row 1. If `VM_HOST` itself is missing, the `has_vm` output gate in the SSH setup step will skip the deploy step gracefully (degrading to k8s-only flight). Everything else hard-fails loudly.

---

## Known risks / pre-existing gaps

1. **Preview VM ApplicationSet staleness (task.0293 handoff)** — the preview cluster may still be missing `syncPolicy.automated` on child Applications (bootstrapped before PR #790). If row 6 shows samples but `kubectl -n cogni-preview get pods` still shows old digests, the cluster-state fix is:

   ```bash
   ssh root@84.32.110.92 "kubectl kustomize /opt/cogni-template-runtime/infra/k8s/argocd | kubectl apply -n argocd -f -"
   ```

   Also capture into `scripts/setup/provision-test-vm.sh` so a reprovisioned VM gets it.

2. **LiteLLM image mismatch**. The new candidate-flight deploy-infra step pins `LITELLM_IMAGE: cogni-litellm:latest` to skip the `preview-{sha}-litellm` GHCR lookup that doesn't exist for PR builds. This means **litellm on candidate-a does NOT get updated when you flight a PR** — the container stays at whatever tag was last pulled at provision time. Fine for validating alloy/caddy/nginx config changes; **not fine** for validating litellm config changes. If a PR changes `infra/compose/runtime/litellm/`, the change won't take effect on candidate-a. Known tradeoff from bug.0312 Phase 2.5.

3. **Candidate-a k8s namespace assumption**. `deploy-infra.sh` uses `cogni-${DEPLOY_ENVIRONMENT}` as the k8s namespace for Temporal bootstrap (`scripts/ci/deploy-infra.sh:768,779,812`). Verified that `infra/k8s/overlays/candidate-a/*/kustomization.yaml` all use `namespace: cogni-candidate-a`. If the candidate-a VM's Argo Application points at a different namespace, Temporal bootstrap will fail on row 1. Grep and confirm before dispatching:

   ```bash
   ssh root@84.32.109.160 "kubectl get ns | grep cogni"
   ```

4. **Preview is locked right now if the last flight wedged**. Check `origin/deploy/preview:.promote-state/review-state` before row 4. If it reads `reviewing` or `dispatching` without an obvious in-flight workflow, someone will need to manually edit the file or merge a release PR to unlock before row 4 is testable.

   ```bash
   git fetch origin deploy/preview
   git show origin/deploy/preview:.promote-state/review-state
   git show origin/deploy/preview:.promote-state/current-sha
   git show origin/deploy/preview:.promote-state/candidate-sha 2>/dev/null || echo "(absent)"
   ```

5. **Canary residue in `promote-and-deploy.yml`** (non-blocking for this objective, but will surface if anyone manually dispatches with `environment=canary`):
   - `.github/workflows/promote-and-deploy.yml:18-22` — `default: canary`, `options: [canary, preview, production]`
   - `.github/workflows/promote-and-deploy.yml:44` — `|| 'canary'` dead fallback in concurrency group
   - `.github/workflows/promote-and-deploy.yml:70` — `canary) OVERLAY=canary; DEPLOY_BRANCH=deploy/canary` dead case arm
   - `.github/workflows/promote-and-deploy.yml:10-14` — dead `on.workflow_run.workflows: ["Build Multi-Node"]` trigger (fails loudly if it ever fires)

   Fix as part of bug.0312 Phase 2 after this validation lands, or bundle with row 1–3 verification if the next agent wants a clean sweep.

---

## Suggested verification sequence for the next agent

1. **Reconnect Grafana MCP.** Without it, rows 3/6/7/8 are SSH-only and less rigorous.
2. **Audit secret parity** between `candidate-a` and `preview` GitHub environments (block above).
3. **Row 4 prerequisite**: check `deploy/preview:.promote-state/review-state` — must be `unlocked` for the next merge to successfully flight.
4. **Execute row 4** (any trivial merge — use this handoff commit if convenient). Watch the full chain: `flight-preview.yml` → `promote-and-deploy.yml env=preview` → pods rolling → lease → Grafana samples under `env="preview"`.
5. **Execute row 1** (dispatch candidate-flight.yml for any open PR). Watch the new deploy-infra step, confirm alloy reloads on the candidate-a VM, grab samples under `env="candidate-a"`.
6. **File evidence**: paste the successful run URLs + Grafana Explore links into `bug.0312` acceptance checklist.

If row 4 fails at `promote-k8s`, that's the pre-existing preview ApplicationSet staleness — apply the fix in risk #1.

If row 1 fails at the new deploy-infra step, the most likely cause is a missing secret on `candidate-a` (risk #2/#3). The second-most-likely cause is that the candidate-a VM's `/opt/cogni-template-runtime` path layout drifted from what `deploy-infra.sh` expects.

---

## Out of scope for this handoff (but related)

- Three remaining bug.0312 Phase 2 items (GitHub environment rename, `deploy/canary` branch deletion, `promote-and-deploy.yml` canary residue) — separate PR after this validation.
- LiteLLM image path for candidate-flight (risk #2 above) — would need pr-build.yml to also build a `pr-{N}-{sha}-litellm` image, or a separate LiteLLM build workflow.
- Production promotion (manual `release.yml` today) — unchanged.
- Deploy-infra symmetry refactor (extract reusable workflow to dedupe env block between `candidate-flight.yml` and `promote-and-deploy.yml`) — bug.0312 Phase 2.5 Option B, deferred until both call sites are exercised.

---

## Done when

- [ ] Row 1: `candidate-flight.yml` dispatched with a real PR runs green through the new deploy-infra step
- [ ] Row 3: Grafana Loki shows `{source="k8s", namespace="argocd", env="candidate-a"}` samples from the candidate-a VM
- [ ] Row 4: a merge to main triggers `flight-preview.yml` → `promote-and-deploy.yml env=preview` end-to-end
- [ ] Row 5: `deploy/preview:.promote-state/review-state` = `reviewing` after a successful flight
- [ ] Row 6: Grafana Loki shows `{source="k8s", namespace="argocd", env="preview"}` samples
- [ ] Row 7: Grafana Prometheus shows `up{env="candidate-a"}` > 0
- [ ] Row 8: Grafana Prometheus shows `up{env="preview"}` > 0

When all eight are checked, mark bug.0312 Phase 2.5 `✅ DONE` in `work/projects/proj.cicd-services-gitops.md` row #6 and update the Environment Status table's "Compose infra healthy" cell for `Candidate-A` from `✅ (frozen at provision)` to `✅ (CI-reconciled)`.

---

## Session addendum — 2026-04-15 runtime findings

Live investigation against main `c5db7f232` (post-#869, post-#870) surfaced concrete state a fresh agent needs before running the verification matrix above.

### Confirmed state (read before acting)

| Finding                                         | Detail                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `candidate-a` env secrets                       | **0 secrets set** — complete empty state, not partial. `preview` has ~40. `gh secret list --env candidate-a` returns empty.                                                                                                                                                                                                                                                                                            |
| Deploy-infra step on candidate-flight           | ✅ live on main (`.github/workflows/candidate-flight.yml:186-259`). **Skipped on every flight** because `steps.ssh-setup.outputs.has_vm == 'false'` → `VM_HOST` unset.                                                                                                                                                                                                                                                 |
| Candidate Flight end-to-end                     | ✅ works through smoke test. Dispatched `pr_number=865` → `deploy/candidate-a` overlay updated → Argo synced → `/readyz` 200 → lease released. Missing only the compose deploy-infra step.                                                                                                                                                                                                                             |
| Flight Preview auto-trigger                     | ❌ **broken for every squash-merged PR**. Resolver builds `image_tag=pr-{N}-{mergeSHA}` but `pr-build.yml` tags as `pr-{N}-{PR_head_SHA}`. On squash merge these never match → resolver aborts at "Abort when no PR images exist". Both #869 and #870 hit this on their own post-merge auto-flight.                                                                                                                    |
| Promote and Deploy (workflow_dispatch fallback) | ⚠️ partial. With `source_sha=6d901954` (off-main, has complete `preview-*` set), `promote-k8s` ✅, `deploy-infra` ❌ cancelled at "Wait for ArgoCD sync" after 15min. Argo on preview VM never reconciled the new overlay digests. `unlock-preview-on-failure` then failed with `scripts/ci/set-preview-review-state.sh: No such file or directory` — the task.0293 script doesn't exist at the off-main checkout ref. |
| Build Multi-Node                                | Last success 2026-04-08. Has not run since. New CD chain (`flight-preview.yml`) never dispatches it as a fallback — the old `promote-merged-pr.yml` fallback path was removed in task.0293.                                                                                                                                                                                                                            |
| GHCR tag inventory                              | `pr-*` tags exist for PRs: 656, 845, 848, 849, 850, 851, 856, 857, 859, 865, 868. Complete 5-target sets for 845/848/849/850/851/857/859/865/868. **None for #869 or #870** (both are infra/CI-only — `pr-build.yml` vacuously passed without pushing images).                                                                                                                                                         |
| Main rebase consequence                         | Every SHA with a complete `preview-*` image set in GHCR except `53d9e3301e2b` (#785, ancient) is **off origin/main**. New CD dispatch to preview cannot be satisfied by existing artifacts without either re-tagging pr-_ → preview-_ or a full rebuild.                                                                                                                                                               |
| VM health                                       | All six endpoints (test/preview × operator/poly/resy) return `/readyz 200`. `preview.cognidao.org/readyz` reports `{"version":"0"}` → still serving a pre-#865 build (before the build-SHA embed).                                                                                                                                                                                                                     |
| Grafana Loki label `env`                        | Returns `["ci"]` only. No VM streams under `env=candidate-a` or `env=preview`. Compose alloy has never shipped from either VM since #869 widened the pod-log filter.                                                                                                                                                                                                                                                   |

### What worked (this session's evidence)

```bash
# Candidate Flight dispatch — ran to completion, lease released cleanly.
gh workflow run candidate-flight.yml --repo Cogni-DAO/node-template -f pr_number=865
# → run 24480504763 success
# → deploy/candidate-a HEAD: 3a8527580 candidate-flight: release pr-865 e7c23cf47302735…
# → candidate-a /readyz 200 on all three nodes
# → "Deploy Compose infra to candidate-a VM" step: SKIPPED (has_vm=false)
```

### What failed (this session's negative evidence)

```bash
# Promote and Deploy dispatched for preview with a known-complete preview-* SHA.
gh workflow run promote-and-deploy.yml --repo Cogni-DAO/node-template \
  -f environment=preview \
  -f source_sha=6d901954ea53d345e81d1526d6baa393c890d021
# → run 24480505655
# → promote-k8s  ✅  (overlay digest push to deploy/preview succeeded)
# → deploy-infra ❌  cancelled at 15min on "Wait for ArgoCD sync"
# → unlock-preview-on-failure ❌  `scripts/ci/set-preview-review-state.sh: No such file or directory`
# → preview `/readyz` still reports version=0 (unchanged)
# → preview lease ended up at `unlocked` despite the script error (previous state)
```

### Unblock sequence for the next agent

**Phase A — Secrets parity (pre-requisite for row 1 of verification matrix):**

1. Determine the candidate-a VM host. Per proj.cicd-services-gitops.md Environment Status table: `84.32.109.160` (separate VM from preview `84.32.110.92`).
2. **Confirm the target SSH pubkey is already installed on candidate-a VM's `~root/.ssh/authorized_keys`** before pushing any key secret. Per the user's security memory: _SSH keys require server-side pubkey FIRST_. Ask before writing.
3. Run the diff from "Secret inventory" section above — should show ~40 missing secrets.
4. `gh secret set --env candidate-a` for each missing name. Values must match preview's values **except** `VM_HOST` (per-VM).
5. Re-dispatch `candidate-flight.yml -f pr_number=<N>` for any PR with complete pr-\* images. Expect `Deploy Compose infra to candidate-a VM` to run this time.
6. Execute verification matrix rows 1-3 + 7.

**Phase B — Fix Flight Preview squash-merge resolver (blocks rows 4-6):**

The bug is in `scripts/ci/resolve-pr-build-images.sh` (or flight-preview.yml directly): `IMAGE_TAG=pr-${PR_NUMBER}-${HEAD_SHA}` uses the push SHA (merge commit) rather than the PR's _head_ SHA. Fix options:

- **Option 1**: Resolve PR head SHA via `gh api repos/{}/pulls/{N}` and use that in `IMAGE_TAG`.
- **Option 2**: Have `pr-build.yml` additionally tag images with the expected merge commit SHA at merge time (not viable — merge commit isn't known at build time).
- **Option 3**: Add a fallback path that dispatches `Build Multi-Node` when pr-\* lookup fails (restores pre-task.0293 behavior for infra-only PRs).

Option 1 is the smallest change. Option 3 is what task.0293's predecessor did; removed intentionally per task.0293 design.

**Phase C — Close the CI-only/infra-only PR gap:**

PRs that only touch `.github/`, `infra/`, `docs/`, `work/`, or `scripts/ci/` will NEVER produce `pr-*` images (pr-build.yml's affected-detection skips image builds). Either:

- Amend `pr-build.yml` to always produce images (kills affected-only optimization).
- Or extend Option 3 above to dispatch a from-scratch Build Multi-Node as fallback only for infra/CI-only PRs.
- Or accept this class of PR cannot be flighted to candidate-a — document that for infra-only changes, promotion happens directly on merge via Build Multi-Node dispatch + Promote and Deploy.

This is the structural gap behind proj.cicd-services-gitops.md blocker #12 and the Candidate-A Compose infra gap callout (line 68).

### Ownership handoff

A fresh agent taking this on should:

1. Read `docs/spec/ci-cd.md § Preview Review Lock` + `work/items/bug.0312.*` first (spec truth).
2. Execute Phase A (secrets parity) as an independent PR — it's the cheapest unblock and gets candidate-a deploy-infra shipping real evidence.
3. File Phase B as a separate bug against the task.0293 design hole; should not be bundled with Phase A.
4. Phase C is a design decision, not a code fix — needs an RFC-class PR against `docs/spec/ci-cd.md` that declares the policy for infra-only PRs.

Open question for the user before Phase A starts: **is `SSH_DEPLOY_KEY` shared between candidate-a and preview, or does candidate-a need its own key generated + installed?** Answer determines whether Phase A is 1 secret or 3.
