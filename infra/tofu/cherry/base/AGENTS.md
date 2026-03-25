# base · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Immutable VM provisioning: Docker + k3s + Argo CD on a single Cherry Servers VM. Cloud-init installs Docker Compose (for infrastructure services) and k3s with Argo CD (for application services managed via GitOps).

## Pointers

- [DEPLOYMENT_ARCHITECTURE.md](../../../../docs/runbooks/DEPLOYMENT_ARCHITECTURE.md): Architecture overview
- [INFRASTRUCTURE_SETUP.md](../../../../docs/runbooks/INFRASTRUCTURE_SETUP.md): Setup guide

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
- **Env/Config keys:** `CHERRY_AUTH_TOKEN`, SSH key paths, `ghcr_deploy_token`, `sops_age_private_key`, `cogni_repo_ref`
- **Files considered API:** `variables.tf`, `terraform.tfvars.example`

## Responsibilities

- This directory **does**: VM provisioning, SSH deploy key installation, Docker + k3s + Argo CD bootstrap via cloud-init, GHCR registry auth for k3s, SOPS age key injection
- This directory **does not**: Application deployment (Compose infra via SSH from GitHub Actions; services via Argo CD GitOps)

## Usage

Minimal local commands:

```bash
tofu init
tofu plan
tofu apply
```

## Standards

- No application logic in cloud-init
- Use lifecycle ignore_changes for user_data stability
- Require SSH key configuration

## Dependencies

- **Internal:** none
- **External:** Cherry Servers API, SSH public keys

## Change Protocol

- Update this file when **VM configuration variables** change
- Bump **Last reviewed** date
- VM changes affect SSH deployment workflows

## Notes

- Single-VM architecture: Docker (containerd via dockerd) and k3s (containerd) coexist
- bootstrap.yaml is a `templatefile()` — uses `${var}` for Terraform interpolation, `$$` for bash `$`
- k3s pinned to v1.31.4+k3s1, Argo CD pinned to v2.13.4
- SOPS age private key injected from Terraform variable, never generated on-host
- See runbooks/ for setup and architecture details
