# cherry · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Cherry Servers cloud provider configurations split between immutable VM provisioning and mutable app deployments.

## Pointers

- [base/](base/): VM provisioning — Docker + k3s + Argo CD (single-VM)

## Boundaries

```json
{
  "layer": "infra",
  "may_import": [],
  "must_not_import": ["*"]
}
```

## Public Surface

- **Exports:** none
- **Env/Config keys:** `CHERRY_AUTH_TOKEN`
- **Files considered API:** `base/variables.tf`

## Responsibilities

- This directory **does**: Define Cherry Servers infrastructure and deployment configurations
- This directory **does not**: Contain application logic or business rules

## Usage

Minimal local commands:

```bash
cd base && tofu init && tofu plan
```

## Standards

- Single VM: base/ provisions Docker + k3s + Argo CD via cloud-init
- SSH deploy for Compose services, Argo CD GitOps for k3s services
- Health gates required for all deployments
- base/ uses `templatefile()` for cloud-init with GHCR credentials

## Dependencies

- **Internal:** `../../files/scripts/`, Caddyfile templates
- **External:** Cherry Servers API, OpenTofu

## Change Protocol

- Update this file when **variable schemas** change
- Bump **Last reviewed** date
- Update terraform.tfvars.example when new variables added

## Notes

- Base creates VM with Docker + k3s + Argo CD (single-VM, task.0149)
- k3s module removed — merged into base/bootstrap.yaml
- App handles Compose deployment over SSH with health validation
