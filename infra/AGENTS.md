# infra · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Infrastructure as Code configurations for cloud providers, services, and deployment stacks using OpenTofu.

## Pointers

- [tofu/cherry/](tofu/cherry/): Cherry Servers deployment configs
- [compose/](compose/): Docker Compose service stacks

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
- **CLI (if any):** tofu commands in provider directories
- **Env/Config keys:** `CHERRY_AUTH_TOKEN`, provider auth tokens, deployment variables
- **Files considered API:** `tofu/*/variables.tf`, `compose/*/docker-compose*.yml`

## Responsibilities

- This directory **does**: Define deployments, service configurations, infrastructure provisioning
- This directory **does not**: Contain application logic, business rules, or UI components

## Usage

Minimal local commands:

```bash
cd tofu/cherry/base && tofu plan
```

## Standards

- Split providers into base (VM) and app (deployment) configurations
- Use templatefile() for dynamic configurations
- All providers require example tfvars files

## Dependencies

- **Internal:** compose/, tofu/
- **External:** OpenTofu, cloud provider APIs

## Change Protocol

- Update this file when **provider interfaces** or **template formats** change
- Bump **Last reviewed** date
- Update example tfvars when variable schemas change

## Notes

- Providers split between immutable (base/) and mutable deployment resources
- Compose stacks split: runtime (app + infra), edge (Caddy TLS), sandbox-proxy (nginx)
