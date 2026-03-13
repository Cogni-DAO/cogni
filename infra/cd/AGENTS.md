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
├── apps/                    # Argo CD Application CRDs (applied by cloud-init)
│   └── staging.yaml         # scheduler-worker-staging Application
├── base/                    # Kustomize bases (one per service)
│   └── scheduler-worker/    # Deployment, Service, ConfigMap, EndpointSlice
├── overlays/                # Environment-specific patches
│   ├── staging/             # Staging image digests, namespace, EndpointSlice IPs
│   └── production/          # Production image digests, namespace, EndpointSlice IPs
├── argocd/                  # Argo CD install (Kustomize: remote base + ksops patches)
│   ├── install.yaml         # Kustomization: Argo CD v2.13.4 + ksops CMP
│   ├── ksops-cmp.yaml       # ConfigManagementPlugin for SOPS/age decryption
│   └── repo-server-patch.yaml  # Strategic merge patch: ksops sidecar on repo-server
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

- Placeholder IPs (10.0.0.1) in EndpointSlices — replace with real Compose VM IP when provisioning
- Secret template files (.enc.yaml) contain placeholder values — encrypt with `sops` after `tofu apply` outputs the age public key
- Argo CD install is a Kustomize remote base pinned to v2.13.4 with ksops sidecar patches
- `apps/staging.yaml` is applied by k3s cloud-init bootstrap — Argo CD auto-syncs the staging overlay

## Change Protocol

- Update this file when **directory structure changes**
- Adding a new service: create `base/<service>/`, add overlay patches, create Argo Application
- Promoting an image: update overlay `images:` section with new digest, create PR
