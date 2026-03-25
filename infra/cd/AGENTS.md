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
├── base/                    # Kustomize bases (one per GitOps-managed service)
│   ├── scheduler-worker/    # Temporal worker service
│   └── sandbox-openclaw/    # Long-lived sandbox gateway service
├── overlays/                # Environment-specific overlays
│   ├── staging/             # Namespace + per-service overlays
│   └── production/          # Namespace + per-service overlays
├── argocd/                  # Argo CD configuration
│   ├── install.yaml         # Non-HA Argo CD install (Kustomize remote base)
│   ├── app-of-apps.yaml     # Legacy root Application pattern
│   ├── services-applicationset.yaml # Preferred service app generation
│   └── applications/        # Per-service Argo Application manifests (compatibility)
├── gitops-service-catalog.json  # Declares managed vs deferred services
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

- EndpointSlices use loopback (127.0.0.1) for single-VM k3s+Compose coexistence during task.0149
- Secret template files (.enc.yaml) contain placeholder values — encrypt with `sops` after filling real secrets
- Argo CD install is a Kustomize remote base pinned to v2.13.4 — update version deliberately
- ApplicationSet is preferred for service fan-out; app-of-apps remains for compatibility during migration

## Change Protocol

- Update this file when **directory structure changes**
- Adding a new service: create `base/<service>/`, create staging/production service overlays, create Argo Application
- Promoting an image: update overlay `images:` section with new digest, create PR
