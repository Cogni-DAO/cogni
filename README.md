# deploy/canary

Rendered deploy state for the **canary** environment.

Argo CD watches this branch. CI updates overlays via auto-merge PRs.

**Do not** commit app code here. **Do not** merge this into app branches.

## Contents

- `infra/catalog/` — ApplicationSet generator inventory
- `infra/k8s/base/` — Kustomize base templates (synced from app branch on each promotion)
- `infra/k8s/overlays/canary/` — Per-app overlay with digest-pinned image refs
