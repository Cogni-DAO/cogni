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
