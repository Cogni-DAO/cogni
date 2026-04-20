---
id: bug.0333
type: bug
title: Base audit — move envs-identical ConfigMap values out of overlay patches into base
status: needs_merge
priority: 1
rank: 5
estimate: 1
summary: Overlay `kustomization.yaml` patches carried envs-identical ConfigMap values (scheduler-worker `COGNI_NODE_ENDPOINTS`, node-app `APP_ENV`, `AUTH_TRUST_HOST`) that did not vary per env. Because the promote workflow rsyncs base but not overlays, any correction to these values on `main` could not reach `deploy/<env>`. Triggered by the 2026-04-19 preview outage where main's corrected `COGNI_NODE_ENDPOINTS` (ports :3000) never propagated to `deploy/preview`, which still carried the stale :3100/:3300 version. Closing the base/overlay miscategorisation eliminates this specific drift vector and shrinks the overlay surface that still drifts.
outcome: Envs-identical ConfigMap values live in base. All 16 rendered kustomize manifests are byte-identical before/after. Overlays now only patch genuinely env-varying values (`TEMPORAL_NAMESPACE`, `IMAGE_DIGEST`, per-node DNS/URLs, EndpointSlice IPs).
spec_refs:
  - cd-pipeline
  - ci-cd
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: worktree-task.0280-preview-handoff
pr: https://github.com/Cogni-DAO/node-template/pull/939
reviewer: claude-code
revision: 2
blocked_by:
deploy_verified: false
created: 2026-04-19
updated: 2026-04-19
labels:
  [cicd, deploy-branch, gitops, config-drift, task.0280-follow-up, partial]
external_refs:
  - trigger: task.0280 preview validation, 2026-04-19
  - surfaced-run: https://github.com/Cogni-DAO/node-template/actions/runs/24633902426
  - related-fix: 866f6c97d
---

> **Scope note (rev 2, 2026-04-19)**: this work item was originally scoped for the full structural fix
> (env-state.yaml + kustomize replacements + workflow rsync). During implementation we discovered
> production uses two distinct EndpointSlice IPs per env (`127.0.0.1` for scheduler-worker,
> `10.0.0.1` for node-apps) which breaks the "one `VM_INTERNAL_IP` per env" assumption.
> The env-state / replacements / workflow work is deferred to a follow-up bug (tracked in
> [Follow-ups](#follow-ups)). This item now carries only Checkpoint 1 — the base audit — which
> eliminates the specific drift vector that caused the triggering incident and shrinks the
> overlay surface the follow-up must tackle.

## Design

### Outcome

Overlay `kustomization.yaml` patches no longer carry values that are byte-identical across envs. The four scheduler-worker overlays and twelve node-app overlays each shed one or more ConfigMap patches whose values now live in `infra/k8s/base/<app>/configmap.yaml`.

### Approach

Move `COGNI_NODE_ENDPOINTS` (scheduler-worker base) and `APP_ENV` + `AUTH_TRUST_HOST` (node-app base) from overlay patches to base `configmap.yaml`. These values are byte-identical across `preview / candidate-a / canary / production`. Overlays continue to patch genuinely env-varying values: `TEMPORAL_NAMESPACE`, `IMAGE_DIGEST`, per-node DNS URLs (`TEMPORAL_ADDRESS`, `REDIS_URL`, `LITELLM_BASE_URL`, `NEXTAUTH_URL`), EndpointSlice IP addresses.

Verified byte-identical via `kustomize build` diff against a pre-change baseline, all 16 overlays × apps.

**Rejected**:

- **Full env-state.yaml + replacements + workflow rsync (original scope)**: during implementation, production's two distinct IPs (`127.0.0.1` for scheduler-worker, `10.0.0.1` for node-apps) surfaced as a hole in the "one `VM_INTERNAL_IP` per env" assumption. Needs topology investigation before the `replacements`-based fix can land safely. Deferred to the follow-up bug.
- **Move `LITELLM_BASE_URL`, `TEMPORAL_ADDRESS`, `REDIS_URL`, `NODE_NAME` to base**: these are static per node but require `namePrefix`-derived DNS names (`operator-temporal-external`, `poly-temporal-external`, etc.). Base is node-agnostic; `namePrefix` is overlay-only metadata. Kustomize doesn't rewrite arbitrary ConfigMap data values via `namePrefix`. Keeping them in overlay is correct.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [x] BASE_OWNS_STATIC: `COGNI_NODE_ENDPOINTS`, `APP_ENV`, `AUTH_TRUST_HOST` moved into `infra/k8s/base/<app>/configmap.yaml`. Overlays no longer patch them.
- [x] RENDER_INVARIANT: `kustomize build` output for all 16 overlay × app combinations is byte-identical before/after the refactor.
- [x] SIMPLE_SOLUTION: Text-level edit only; no new kustomize features, no new scripts.

### Files

<!-- Actual scope landed in this PR -->

- Modified: `infra/k8s/base/scheduler-worker/configmap.yaml` — set `COGNI_NODE_ENDPOINTS` to the real envs-identical value.
- Modified: `infra/k8s/base/node-app/configmap.yaml` — set `APP_ENV: "production"`, `AUTH_TRUST_HOST: "true"`.
- Modified: `infra/k8s/overlays/{preview,candidate-a,canary,production}/scheduler-worker/kustomization.yaml` — removed `COGNI_NODE_ENDPOINTS` patch.
- Modified: `infra/k8s/overlays/{preview,candidate-a,canary,production}/{operator,poly,resy}/kustomization.yaml` × 12 — removed `APP_ENV` and `AUTH_TRUST_HOST` patches.
- Validation: `kustomize build` × 16 overlays, diff vs baseline in `/tmp/bug0331-baseline/` → identical.

## Follow-ups

- **bug.0332 (to file)**: env-state.yaml + kustomize replacements + workflow rsync. Needs upfront investigation of production topology to decide the env-state schema (one IP per env, or per-resource IPs). Inherits the "rejected alternatives" analysis from this bug's rev 1.
- Docs/specs updates listed below are deferred to that follow-up, since they describe the full structural contract that isn't yet in place. The base audit landed here does not change the documented contract — it just reduces the drift surface.

### Docs / specs to update when the follow-up lands (NOT this PR)

- `docs/spec/ci-cd.md` — describe env-state.yaml as the single per-env truth source; strike overlay-is-mutable language.
- `docs/spec/cd-pipeline-e2e.md` — new promote sequence; `INFRA_K8S_MAIN_DERIVED`.
- `docs/spec/cd-pipeline-e2e-legacy-canary.md` — align/retire.
- `docs/spec/deploy.config-reconciliation.md` — new reconciliation model.
- `docs/spec/preview-deployments.md` — self-heal policy.
- `docs/guides/multi-node-deploy.md`, `docs/guides/node-formation-guide.md` — provisioning writes env-state.yaml.
- `.github/workflows/promote-and-deploy.yml` comments (lines 184-192) — load-bearing lie replaced.
- `scripts/ci/deploy-infra.sh`, `scripts/setup/provision-test-vm.sh` headers.
- `services/scheduler-worker/AGENTS.md` if it mentions overlay-patched endpoints.

Unaffected by either change: `docs/spec/multi-node-tenancy.md`, `docs/spec/scheduler.md`.

## Plan

- [x] **Checkpoint 1 — Base audit** — done. All 16 overlays × apps render byte-identically via `kustomize build` diff.
- Checkpoints 2–4 (env-state.yaml, workflow rsync, docs rewrite) are deferred to the follow-up (see Follow-ups section above).

## Validation

- `kustomize build infra/k8s/overlays/<env>/<app>` diff against pre-change baseline (16 combinations): **all identical**.
- `pnpm check:docs` clean.
- Once this merges: the next `main → deploy/<env>` promote (via existing rsync logic) will copy the updated `infra/k8s/base/scheduler-worker/configmap.yaml` — which now contains the corrected `COGNI_NODE_ENDPOINTS` with `:3000` across poly+resy — into every deploy branch, healing the preview outage without any manual hand-editing of a deploy branch.
- Future drift of `COGNI_NODE_ENDPOINTS`, `APP_ENV`, or `AUTH_TRUST_HOST` is impossible because no overlay patches them anymore; they flow through base, which is already rsynced.
