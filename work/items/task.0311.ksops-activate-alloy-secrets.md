---
id: task.0311
type: task
title: "Activate ksops end-to-end for alloy-secrets (interim before ESO)"
status: needs_design
priority: 1
rank: 5
estimate: 3
assignees: [derekg1729]
created: 2026-04-13
updated: 2026-04-13
project: proj.cicd-services-gitops
summary: "ksops CMP plugin is configured in Argo CD but has never been end-to-end activated — `.sops.yaml` holds placeholder age keys. Generate real keys per env, encrypt alloy-secrets.enc.yaml files, and wire overlays to reference them so Alloy secrets ship via GitOps instead of manual kubectl."
outcome: "Every cogni-{env} namespace gets its alloy-secrets Secret from a SOPS-encrypted file in git, decrypted by the Argo CD repo-server ksops sidecar at apply time. `kubectl create secret` bootstrap removed from the Alloy runbook."
---

# task.0311 — Activate ksops for alloy-secrets

## Context

`feat/k8s-alloy-observability` lands an Alloy DaemonSet in each env's k3s cluster per [docs/spec/ci-cd.md](../../docs/spec/ci-cd.md) — `candidate-a` (pre-merge lane), `preview` (post-merge validation), `production`. Alloy needs a `alloy-secrets` Secret with seven keys (Loki/Prometheus basic auth + METRICS_TOKEN). That PR ships `.enc.yaml.example` templates for each env under `infra/k8s/secrets/{env}/` but **does not encrypt them** — because ksops has never been end-to-end activated in this repo:

- `infra/k8s/argocd/ksops-cmp.yaml` — present, configured.
- `infra/k8s/argocd/repo-server-patch.yaml` — present, wires the sidecar.
- `infra/k8s/secrets/.sops.yaml` — has placeholder age keys.
- No real encrypted `.enc.yaml` in git.
- No cluster has a `sops-age-key` Secret in the `argocd` namespace.

So Alloy bootstrap today = manual `kubectl create secret` on each cluster. SSH is explicitly authorized for candidate-a as an interim. Preview and production should land via the flow below, not via more SSH.

This task activates ksops for the alloy-secrets use case specifically, as an interim before the larger task.0284 ESO migration.

## Scope

1. **Generate age keys** (three — one per env):
   - `age-keygen -o candidate-a-age-key.txt`
   - Same for preview, production.
2. **Install private keys** into each cluster's `argocd` namespace:
   ```bash
   kubectl --context cogni-candidate-a -n argocd create secret generic sops-age-key \
     --from-file=keys.txt=candidate-a-age-key.txt
   ```
   Repeat per cluster. Delete local private key files after install.
3. **Update `.sops.yaml`** — replace placeholder `age: "age1<env>_placeholder..."` lines with real public keys for candidate-a, preview, production.
4. **Encrypt the example files:**
   ```bash
   for env in candidate-a preview production; do
     cp infra/k8s/secrets/$env/alloy-secrets.enc.yaml.example \
        infra/k8s/secrets/$env/alloy-secrets.enc.yaml
     # Fill in real Grafana Cloud values
     sops --encrypt --in-place infra/k8s/secrets/$env/alloy-secrets.enc.yaml
   done
   ```
5. **Wire overlay reference** — each `infra/k8s/overlays/{env}/alloy/kustomization.yaml` adds the encrypted file as a resource:
   ```yaml
   resources:
     - ../../../base/alloy
     - ../../../secrets/{env}/alloy-secrets.enc.yaml # ksops decrypts via CMP
   ```
6. **Update `docs/guides/alloy-loki-setup.md`** — replace the interim `kubectl create secret` bootstrap section with the ksops flow.
7. **Update scorecard** — flip row #16 of `proj.cicd-services-gitops.md` from RED to GREEN.

## Constraints

- Do not commit plaintext. Use `git diff --stat` before every commit to confirm `.enc.yaml` files are encrypted (look for `sops:` metadata block).
- The `sops-age-key` Secret must be created before the first Argo sync after merge, or Argo will fail with `sops: no key for recipient`.
- Per task.0284, this is **interim**: ESO is the long-term target. Do not add more secrets to ksops than necessary.

## Dependencies

- Depends on: `feat/k8s-alloy-observability` merged first (so the `.enc.yaml.example` files exist).
- Blocks: nothing critical — manual kubectl bootstrap works as interim.

## Validation

- **exercise:** On a fresh cluster, after `sops-age-key` is installed and the encrypted file is in git, Argo CD syncs `canary-alloy` and the DaemonSet pod reaches Ready without any `kubectl create secret` being run.
- **observability:** `kubectl -n cogni-canary get secret alloy-secrets -o jsonpath='{.data.LOKI_WRITE_URL}' | base64 -d` matches the real Grafana Cloud Loki push URL.
- `kubectl -n cogni-canary logs -l app.kubernetes.io/name=alloy --tail=50` shows no auth errors.

## Acceptance

- Three real encrypted `.enc.yaml` files committed in `infra/k8s/secrets/{candidate-a,preview,production}/`.
- `.sops.yaml` has three real age public keys (no `placeholder` strings) for candidate-a, preview, production.
- Three `sops-age-key` Secrets installed in each env's `argocd` namespace (NOT in git — cluster-side one-time bootstrap).
- `docs/guides/alloy-loki-setup.md` replaces the interim `kubectl create secret` bootstrap section with the ksops flow.
- Scorecard row #16 flips to 🟢.
