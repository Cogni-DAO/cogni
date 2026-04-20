---
id: bug.0331
type: bug
title: Overlay config drift — deploy branches are a mutable state store with no single truth source
status: needs_implement
priority: 1
rank: 5
estimate: 4
summary: The promote-and-deploy workflow treats `deploy/<env>` as a long-lived mutable copy of `infra/k8s/`. Base + catalog are rsync'd from main each promote, but `infra/k8s/overlays/**` is skipped "because overlays contain env-specific state (IPs) that provision wrote directly to the deploy branch." Side effect, any non-digest overlay change on `main` never reaches `deploy/preview` / `deploy/candidate-a` / `deploy/canary` / `deploy/production`. Surfaced 2026-04-19, preview scheduler-worker ConfigMap had `poly=http://poly-node-app:3100,resy=http://resy-node-app:3300` though `main` had `:3000` for both (fix landed in `866f6c97d` / `79f888aff`). Scheduler-worker `createGraphRunActivity` timed out with `UND_ERR_CONNECT_TIMEOUT` (Service port is 3000, pod targetPort is 3100), chat on `poly-preview.cognidao.org` hung, task.0280 HTTP delegation silently broken post-promote. Operator worked by coincidence (`targetPort == port == 3000`). Root cause is not "the port was wrong" — it is "a whole class of main→deploy-branch deltas can go live in preview/prod without anyone noticing because there is no invariant that overlays match main."
outcome: "A structural invariant — every file under `infra/k8s/` on a deploy branch is either byte-identical to `main` or deterministically generated from a single, auditable per-env truth source (`env-state.yaml`). Overlay drift is impossible by construction, not by workflow discipline."
spec_refs:
  - cd-pipeline
  - ci-cd
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: fix/bug.0331-overlay-drift
pr:
reviewer: claude-code
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-19
updated: 2026-04-19
labels: [cicd, deploy-branch, gitops, config-drift, task.0280-follow-up]
external_refs:
  - trigger: task.0280 preview validation, 2026-04-19
  - surfaced-run: https://github.com/Cogni-DAO/node-template/actions/runs/24633902426
  - related-fix: 866f6c97d
---

## Design

### Outcome

The invariant `INFRA_K8S_MAIN_DERIVED` holds after every promote: for every file under `infra/k8s/` on `deploy/<env>`, either the file is byte-identical to `main` at the promoted SHA, or the file is `env-state.yaml` (the single per-env truth source). The only non-rsync write the pipeline performs on a deploy branch is (a) the digest line(s) mutated by `promote-k8s-image.sh` and (b) the entire contents of `env-state.yaml` written by the provision script.

No "ConfigMap drifted from main" incident can recur because no overlay YAML contains values that could drift.

### Approach

**Solution**: one per-env state file, rsync everything else.

1. **Create** `infra/k8s/overlays/<env>/env-state.yaml` per env — the ONLY deploy-branch-local file under `infra/k8s/`. Minimal schema:

   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: env-state
   data:
     VM_INTERNAL_IP: "84.32.109.222"
   ```

   Written by `scripts/ci/deploy-infra.sh` (and `scripts/setup/provision-test-vm.sh` for local use) from VM facts. Never touched by promote.

2. **Wire EndpointSlice IPs through kustomize `replacements`** in each overlay's `kustomization.yaml`. `replacements` is a native kustomize v4+ feature — one `source: {kind: ConfigMap, name: env-state, fieldPath: data.VM_INTERNAL_IP}`, N `targets` each addressing `/endpoints/0/addresses/0`. No more inline `value: ["84.32.109.222"]` strings anywhere.

3. **Audit overlays** and push every byte-identical-across-envs patch value into `infra/k8s/base/<app>/configmap.yaml` (example: `COGNI_NODE_ENDPOINTS`, `LITELLM_BASE_URL`, `TEMPORAL_ADDRESS`, `REDIS_URL`, `NODE_NAME`, `AUTH_TRUST_HOST` are all identical across `preview/candidate-a/canary/production`). Overlays keep only genuinely env-varying patches (`TEMPORAL_NAMESPACE`, `NEXTAUTH_URL`).

4. **Workflow change** (`.github/workflows/promote-and-deploy.yml`, "Sync base and catalog" step): extend to rsync the entire `infra/k8s/` tree, excluding only `env-state.yaml`:

   ```bash
   rsync -a --delete --exclude='env-state.yaml' \
     app-src/infra/k8s/ deploy-branch/infra/k8s/
   ```

   Drop the separate base/catalog rsync lines — this supersedes them.

5. **Provision scripts** (`scripts/ci/deploy-infra.sh`, `scripts/setup/provision-test-vm.sh`): write only `env-state.yaml`. Delete all existing VM-IP-writing code paths that edit overlay `kustomization.yaml` inline.

6. **promote-k8s-image.sh**: unchanged. Runs after rsync, mutates the (now main-derived) digest line in `kustomization.yaml`.

7. **Deploy-branch migration**: the first promote after merge requires `env-state.yaml` to exist on every `deploy/<env>` branch before kustomize can build. Implement as an idempotent fallback in the provision script path: if `env-state.yaml` absent, generate it from the VM's current `InternalIP`. First promote runs `deploy-infra.sh`, deploy-infra writes `env-state.yaml`, workflow rsyncs everything else, kustomize builds, Argo syncs. No manual commits to deploy branches.

**Reuses**: kustomize native `replacements`, rsync `--exclude`, existing `promote-k8s-image.sh`, existing provision-script plumbing that already runs per promote.

**Rejected**:

- **Split EndpointSlice patches into a sibling `endpoints-patch.yaml`, rsync the rest with `--exclude`** (previous revision of this design): still leaves overlay files mutable on deploy branches, still couples per-VM state to a kustomize JSON-patch format. `replacements` is the intended kustomize mechanism for "one value flows into many resources," and it keeps the single truth source a data file, not a patch file.
- **Move only `COGNI_NODE_ENDPOINTS` to base**: fixes today's outage in 3 lines, leaves the class of bug intact. Ad-hoc.
- **Manual one-shot commit to `deploy/preview` to unblock chat now**: ad-hoc mutation of shared state, creates a manual action that has to be remembered + undone. Preview heals on the next promote cycle after this bug lands; acceptable.
- **Drop deploy branches entirely, point Argo at `main`**: correct end state, much larger refactor, separate work item.
- **YAML-aware merge in bash (`yq`)**: fragile, duplicates kustomize's own layering, no truth source.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] INFRA_K8S_MAIN_DERIVED: For every file under `infra/k8s/` on `deploy/<env>`, either the file matches `main` at the promoted SHA or the file is `env-state.yaml`. No exceptions. Verifiable: `git diff <promoted-sha> origin/deploy/<env> -- infra/k8s/ ':!**/env-state.yaml'` is empty modulo digest lines `promote-k8s-image.sh` writes.
- [ ] ENV_STATE_IS_TRUTH: `env-state.yaml` is the only file provision writes under `infra/k8s/`. Provision never edits `kustomization.yaml`.
- [ ] REPLACEMENTS_NOT_INLINE: No `kustomization.yaml` patches contain inline IP literals under `/endpoints/*/addresses`. All such addresses flow from `env-state.yaml` via kustomize `replacements`.
- [ ] BASE_OWNS_STATIC: Any ConfigMap value byte-identical across all overlays lives in `infra/k8s/base/<app>/configmap.yaml`, not in overlay patches.
- [ ] SIMPLE_SOLUTION: Uses only kustomize native `replacements` and rsync `--exclude`. Zero new scripts, zero YAML-merge logic.

### Files

<!-- High-level scope -->

- Create: `infra/k8s/overlays/<env>/env-state.yaml` × 4 envs (preview, candidate-a, canary, production). Schema fixed by design point 1.
- Modify: `infra/k8s/overlays/<env>/<app>/kustomization.yaml` × 16 — replace inline EndpointSlice IP patches with `replacements:` referencing `env-state.yaml`; strip any env-identical ConfigMap patches that migrated to base.
- Modify: `infra/k8s/base/<app>/configmap.yaml` — receive any ConfigMap keys audited out of overlay patches.
- Modify: `.github/workflows/promote-and-deploy.yml` — replace the base-only rsync with `rsync --exclude='env-state.yaml'` over all of `infra/k8s/`.
- Modify: `scripts/ci/deploy-infra.sh`, `scripts/setup/provision-test-vm.sh` — write only `env-state.yaml`; delete inline-patch-writing logic.
- Delete: any inline-EndpointSlice-IP sed/awk in provision scripts.
- Test: dry-run promote on `candidate-a` with a deliberate ConfigMap change on main, assert `deploy/candidate-a` picks it up, assert EndpointSlice addresses unchanged in the rendered manifest (`kustomize build`).
- CI guard (optional but recommended in follow-up): a post-promote workflow step that runs the `git diff` check from `INFRA_K8S_MAIN_DERIVED` and fails if non-allowed drift exists.

### Docs / specs to update when this lands

Owned by this work item — update at implement time:

- `docs/spec/ci-cd.md` — describe `env-state.yaml` as the single per-env truth source; strike any language implying overlays are mutable on deploy branches.
- `docs/spec/cd-pipeline-e2e.md` — update the promote-and-deploy diagram/sequence to show `rsync infra/k8s/ --exclude='env-state.yaml'` replacing the base-only rsync; call out `INFRA_K8S_MAIN_DERIVED` invariant.
- `docs/spec/cd-pipeline-e2e-legacy-canary.md` — align or mark legacy; same rsync change.
- `docs/spec/deploy.config-reconciliation.md` — record new reconciliation model (promote re-asserts main-truth; provision re-asserts VM-truth via one file).
- `docs/spec/preview-deployments.md` — note that preview self-heals from main on the next promote; no manual `deploy/preview` hand-editing is a supported operation.
- `docs/guides/multi-node-deploy.md` — update the "adding a new node" steps: provision writes `env-state.yaml`, not inline overlay patches.
- `docs/guides/node-formation-guide.md` — same; also drop any guidance telling humans to hand-edit `deploy/<env>` overlay YAML.
- `.github/workflows/promote-and-deploy.yml` comments (lines 184-192) — the comment "Overlays are NOT synced — they contain env-specific state (IPs) that provision wrote directly to the deploy branch" is the load-bearing lie; replace with the new contract.
- `scripts/ci/deploy-infra.sh` header comment — document `env-state.yaml` as the single deploy-branch-local write target.
- `scripts/setup/provision-test-vm.sh` header comment — same.
- `services/scheduler-worker/AGENTS.md` — if it currently documents `COGNI_NODE_ENDPOINTS` as overlay-patched, correct to base.

Not expected to change: `docs/spec/multi-node-tenancy.md` (tenancy invariants are unaffected), `docs/spec/scheduler.md` (HTTP delegation shape unchanged).

## Plan

- [ ] **Checkpoint 1 — Base audit: move byte-identical patches into base configmaps**
  - Milestone: `COGNI_NODE_ENDPOINTS` (scheduler-worker) + `APP_ENV` / `AUTH_TRUST_HOST` (node-app) live in base. Overlays stop patching them. `kustomize build` output is byte-identical before/after.
  - Invariants: BASE_OWNS_STATIC, SIMPLE_SOLUTION.
  - Todos:
    - [ ] Update `infra/k8s/base/scheduler-worker/configmap.yaml`: set `COGNI_NODE_ENDPOINTS` to the real (envs-identical) value, update comment.
    - [ ] Remove `COGNI_NODE_ENDPOINTS` patch from `infra/k8s/overlays/{preview,candidate-a,canary,production}/scheduler-worker/kustomization.yaml`.
    - [ ] Update `infra/k8s/base/node-app/configmap.yaml`: set `APP_ENV=production`, `AUTH_TRUST_HOST=true`.
    - [ ] Remove `APP_ENV` + `AUTH_TRUST_HOST` patches from all 12 node-app overlays.
  - Validation/Testing: `kustomize build infra/k8s/overlays/<env>/<app>` output `diff` vs pre-checkpoint baseline in `/tmp/bug0331-baseline/` must be empty (or only whitespace).

- [ ] **Checkpoint 2 — env-state.yaml + kustomize replacements for EndpointSlice IPs**
  - Milestone: `VM_INTERNAL_IP` flows from one per-env `env-state.yaml` into every EndpointSlice. No inline IP literals in `kustomization.yaml`. Same effective addresses.
  - Invariants: ENV_STATE_IS_TRUTH, REPLACEMENTS_NOT_INLINE.
  - Todos:
    - [ ] Create `infra/k8s/overlays/<env>/env-state.yaml` × 4 with `VM_INTERNAL_IP`:
      - preview: `84.32.109.222`, candidate-a: `84.32.109.160`, canary: `<current>`, production: `127.0.0.1`
      - Annotate `config.kubernetes.io/local-config: "true"` so the ConfigMap doesn't render into output.
    - [ ] Each overlay `kustomization.yaml` adds `resources: - ../env-state.yaml` (or inline resource reference) + `replacements:` section targeting every EndpointSlice `/endpoints/0/addresses/0`.
    - [ ] Delete inline `/endpoints/0/addresses` patches. Keep `/metadata/labels/kubernetes.io~1service-name` patches (they're static per-node namePrefix fixes).
  - Validation/Testing: `kustomize build` rendered EndpointSlice addresses match baseline per env.

- [ ] **Checkpoint 3 — Workflow + provision scripts (⚠ CI/CD change, confirm before)**
  - Milestone: `INFRA_K8S_MAIN_DERIVED` holds in CI.
  - Invariants: INFRA_K8S_MAIN_DERIVED, ENV_STATE_IS_TRUTH.
  - Todos:
    - [ ] `.github/workflows/promote-and-deploy.yml`: extend "Sync base and catalog" step to `rsync -a --delete --exclude='env-state.yaml' app-src/infra/k8s/ deploy-branch/infra/k8s/` (replaces the separate base/catalog rsyncs).
    - [ ] Update the step's comment block (lines 184-192) — delete the "overlays are NOT synced" lie, document new contract.
    - [ ] `scripts/ci/deploy-infra.sh`: write only `env-state.yaml`; remove inline EndpointSlice sed/awk.
    - [ ] `scripts/setup/provision-test-vm.sh`: same.
    - [ ] (Optional follow-up) CI guard step: `git diff <promoted-sha> HEAD -- infra/k8s/ ':!**/env-state.yaml'` — fail if non-digest non-env-state drift.

- [ ] **Checkpoint 4 — Docs / spec updates**
  - See "Docs / specs to update when this lands" list in the Design section.

## Validation

- `git diff <promoted-sha> origin/deploy/<env> -- infra/k8s/ ':!**/env-state.yaml'` returns empty (modulo digest lines) on every promoted env, asserted in a CI guard step.
- Deliberate ConfigMap change on main (e.g. touch `LOG_LEVEL` in `base/scheduler-worker/configmap.yaml` or a genuinely-env-varying overlay patch) reaches `deploy/candidate-a` in 1 promote cycle.
- `kubectl -n cogni-<env> get endpointslices.discovery.k8s.io -o jsonpath='{.items[*].endpoints[*].addresses}'` unchanged across a promote (IPs still pinned to the VM).
- Preview scheduler-worker `COGNI_NODE_ENDPOINTS` reads `poly=http://poly-node-app:3000,resy=http://resy-node-app:3000` without any manual poke to `deploy/preview` — self-heal is the proof.
- Reprovision a preview VM with a different IP → single commit to `deploy/preview/env-state.yaml`, no other files touched.
