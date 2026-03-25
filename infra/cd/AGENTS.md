# cd · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

GitOps deployment manifests for Kubernetes (k3s). Kustomize bases define service contracts; overlays apply environment-specific configuration. Argo CD reconciles manifests to the cluster.

## Pointers

- [CI/CD & Services GitOps](../../work/projects/proj.cicd-services-gitops.md): Parent project
- [task.0148](../../work/items/task.0148.gitops-foundation-manifests.md): Foundation task
- [Services Architecture](../../docs/spec/services-architecture.md): Service contracts

## Boundaries

```json
{
  "layer": "infra",
  "may_import": [],
  "must_not_import": ["*"]
}
```

## Public Surface

- **Exports:** Kustomize overlays consumed by Argo CD
- **CLI:** `kubectl kustomize infra/cd/overlays/{staging,production}/`

## Responsibilities

- This directory **does**: Define K8s manifests for all services (Deployments, Services, ConfigMaps, Secrets)
- This directory **does not**: Contain application code, Dockerfiles, or CI scripts

## Directory Structure

```
cd/
├── base/                    # Kustomize bases (one per service)
│   ├── scheduler-worker/    # Temporal worker — deployment, service, configmap, external-services
│   └── sandbox-openclaw/    # OpenClaw gateway + nginx proxy — deployment, service, configmaps
├── overlays/                # Per-service, per-environment patches
│   ├── staging/{service}/   # Staging image digests, namespace, EndpointSlice IPs
│   └── production/{service}/ # Production image digests, namespace
├── argocd/                  # Argo CD configuration
│   ├── install.yaml         # Non-HA Argo CD install (Kustomize, pinned v2.13.4) + ksops patches
│   ├── ksops-cmp.yaml       # SOPS CMP plugin ConfigMap
│   ├── repo-server-patch.yaml # ksops sidecar for secret decryption
│   ├── services-applicationset.yaml # Generates one Application per managed service
│   └── applications/        # Per-service Application manifests (redundant with ApplicationSet)
├── gitops-service-catalog.json # Service → managed/deferred declaration for CI checks
└── secrets/                 # SOPS/age encrypted K8s Secrets
    ├── .sops.yaml           # Encryption rules (age public keys per env)
    ├── staging/             # Encrypted secrets for staging
    └── production/          # Encrypted secrets for production
```

## Standards

- **IMAGE_IMMUTABILITY**: Overlays use `@sha256:` digests, never mutable tags
- **MANIFEST_DRIVEN_DEPLOY**: Promotion = changing image digest in overlay
- **ROLLBACK_BY_REVERT**: Git revert restores previous digest
- **NO_SECRETS_IN_MANIFESTS**: All secrets SOPS-encrypted at rest
- **AKASH_PORTABLE_SERVICES**: Service definitions must be extractable for future SDL generation

## Notes

- EndpointSlice IPs are `127.0.0.1` — single-VM architecture, k3s pods reach Compose infra via localhost
- Secret template files (.enc.yaml) contain placeholder values — encrypt with `sops` after filling real secrets
- ApplicationSet generates Applications from a list; individual Application files in `applications/` are redundant but kept for coverage validation
- Argo CD install is a Kustomize remote base pinned to v2.13.4 — update version deliberately

## Change Protocol

- Update this file when **directory structure changes**
- Adding a new service: create `base/<service>/`, add overlays, add to ApplicationSet list + service catalog
- Promoting an image: `scripts/ci/promote-k8s-image.sh` updates overlay digest, commits with `[skip ci]`
