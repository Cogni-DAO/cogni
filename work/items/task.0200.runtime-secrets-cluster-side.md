---
id: task.0200
type: task
title: "Move runtime secrets from bootstrap/GitHub to cluster-side management"
status: backlog
priority: 2
rank: 1
estimate: 3
summary: "Keep setup-secrets as bootstrap-only for repo/env/deploy secrets and initial GitOps seed material. Introduce cluster-side runtime secret delivery so Argo syncs references while values resolve in-cluster."
outcome: "Bootstrap helper remains narrow and stable. Runtime app secrets sourced from cluster-side secret backend, not GitHub Actions secrets or bootstrap scripting. GitOps repo contains SecretStore/ExternalSecret references, not runtime values."
spec_refs:
assignees: [derekg1729]
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-25
updated: 2026-03-25
labels: [deployment, infra, secrets, gitops]
external_refs:
  - url: https://argo-cd.readthedocs.io/en/stable/operator-manual/secret-management/
    note: "Argo CD secret management guidance"
  - url: https://external-secrets.io/latest/introduction/getting-started/
    note: "External Secrets Operator — cluster-side secret delivery"
---

# Move Runtime Secrets to Cluster-Side Management

## Context

`setup-secrets.ts` is a bootstrap helper: it provisions GitHub Actions secrets, generates SOPS/age keypairs, populates and encrypts k8s secret templates, and writes tofu auto.tfvars. This is correct for initial node standup but is NOT the long-term runtime secret architecture.

Current MVP edges (acceptable for bootstrap, not permanent):
- Same secret values written to preview and production via `setSecretBoth`
- Derived DATABASE_URL/DATABASE_SERVICE_URL assume same host shape across envs
- `~/.cogni/secret-values.json` is plaintext local cache (chmod 600, sensitive)
- SOPS-encrypted secrets in repo contain actual credential ciphertext

## Goal

Pick one cluster-side secret backend (External Secrets Operator + a store, or equivalent) and wire one namespace/environment end-to-end. Keep `setup-secrets.ts` scoped to bootstrap-only.

## Acceptance

- [ ] Pick one secret backend and one integration path (don't boil the ocean)
- [ ] One namespace end-to-end: SecretStore + ExternalSecret → k8s Secret → pod env
- [ ] Bootstrap helper unchanged — still handles repo/env/deploy/initial seed
- [ ] Document trust boundary and bootstrap-vs-runtime sequence
- [ ] GitOps repo contains secret references, not runtime values

## References

- [Argo CD Secret Management](https://argo-cd.readthedocs.io/en/stable/operator-manual/secret-management/)
- [Argo CD Cluster Bootstrapping](https://argo-cd.readthedocs.io/en/latest/operator-manual/cluster-bootstrapping/)
- [External Secrets Operator](https://external-secrets.io/latest/introduction/getting-started/)
- [Infisical Guides](https://github.com/Infisical/infisical-guides)
