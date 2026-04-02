# infra · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Everything about how the system runs. Split by responsibility, not by tool.

## Pointers

- [CD Pipeline E2E](../docs/spec/cd-pipeline-e2e.md): Full deployment specification
- [catalog/](catalog/): Renderer-agnostic app/node inventory
- [k8s/](k8s/): Kubernetes deployment manifests (Argo CD + Kustomize)
- [compose/](compose/): Docker Compose stacks (VM-shared infra runtime)
- [images/](images/): Infra-owned Docker image build contexts
- [provision/](provision/): Substrate/bootstrap (OpenTofu, cloud-init)
- [akash/](akash/): Future Akash SDL renderer

## Boundaries

```json
{
  "layer": "infra",
  "may_import": [],
  "must_not_import": ["*"]
}
```

## Directory Responsibilities

| Directory | Answers | Changes when... |
|-----------|---------|----------------|
| `catalog/` | What apps/nodes exist? | A new node is added |
| `k8s/` | How do apps deploy to Kubernetes? | Image digests or manifests change |
| `compose/` | What infra services run on the VM? | Infrastructure config changes |
| `images/` | How are infra-owned images built? | LiteLLM/proxy code changes |
| `provision/` | How is the VM created and bootstrapped? | Cloud provider or bootstrap changes |
| `akash/` | How do apps deploy to Akash? | (Future — SDL renderer) |

## Standards

- `catalog/` stays thin — name, type, port, env keys. No platform-specific fields.
- `k8s/` and `akash/` are peer renderers. Both read from `catalog/`.
- `compose/` is for infra services intentionally kept off-cluster.
- `images/` contains only Dockerfiles and build contexts, not runtime config.
- `provision/` owns VM lifecycle. Runtime manifests go in renderers.

## Change Protocol

- Update this file when **top-level directory structure changes**
- Adding a new renderer: create `infra/{renderer}/` as peer to `k8s/`
