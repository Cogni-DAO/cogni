---
id: task.0126
type: task
title: Fluence Provider Base — VM Provisioning via REST API
status: needs_implement
priority: 2
rank: 99
estimate: 3
summary: Create an OpenTofu provider configuration for Fluence that provisions VMs via the Fluence REST API (api.fluence.dev), mirroring the Cherry Servers base layer pattern
outcome: Fluence VMs provisionable via `tofu apply` with SSH key registration, VM creation, health polling, and bootstrap — same workflow as Cherry Servers
spec_refs: environments-spec
assignees: derekg1729
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-02
updated: 2026-03-02
labels: [infra, web3, deployment]
external_refs: https://api.fluence.dev/docs
---

# Fluence Provider Base — VM Provisioning via REST API

## Context

Fluence is a decentralized compute marketplace (DePIN) offering VMs and GPU containers via a REST API at `https://api.fluence.dev` (v0.8.98). Unlike Cherry Servers, **there is no official Fluence Terraform/OpenTofu provider**. The API must be wrapped in shell scripts orchestrated by OpenTofu `terraform_data` resources.

This task creates the base layer only (immutable VM provisioning). The existing app deployment layer (`deploy.sh`, Docker Compose stacks) is provider-agnostic and will work unchanged once SSH access to a Fluence VM is established.

### Fluence API Summary

| Concern                  | Endpoint                 | Method   |
| ------------------------ | ------------------------ | -------- |
| List marketplace offers  | `/marketplace/offers`    | `POST`   |
| List available images    | `/vms/v3/default_images` | `GET`    |
| Estimate deployment cost | `/vms/v3/estimate`       | `POST`   |
| Create VM                | `/vms/v3`                | `POST`   |
| Get VM status/IP         | `/vms/v3/status`         | `GET`    |
| Update VM                | `/vms/v3`                | `PATCH`  |
| Delete VM                | `/vms/v3`                | `DELETE` |
| Register SSH key         | `/ssh_keys`              | `POST`   |
| List SSH keys            | `/ssh_keys`              | `GET`    |
| Delete SSH key           | `/ssh_keys`              | `DELETE` |

**Auth:** Bearer token (JWT) or `X-API-KEY` header with scoped permissions.

### Fluence Payment Model

- Compute billed in **24-hour epochs**, priced in **USDC or USDT** (stablecoins)
- FLT token is for staking/governance, not direct compute payments
- **No REST endpoint for balance top-up** — funding is via Console UI or direct on-chain transfer to the Balance smart contract
- `POST /vms/v3/estimate` returns `depositAmountUsdc` before deployment
- Same pattern as Cherry Servers crypto billing: manual funding, API-driven provisioning
- **Manual server request:** Fluence currently requires manually requesting/reserving a server through their Console or sales process before API provisioning is available. Factor this into the provisioning workflow.

## Requirements

1. **Directory structure** mirrors `platform/infra/providers/cherry/base/`:
   - `platform/infra/providers/fluence/base/main.tf` — OpenTofu orchestration
   - `platform/infra/providers/fluence/base/variables.tf` — input variables
   - `platform/infra/providers/fluence/base/terraform.preview.tfvars.example` — example config
   - `platform/infra/providers/fluence/base/scripts/` — API wrapper scripts
   - `platform/infra/providers/fluence/base/keys/` — SSH public keys (same pattern as Cherry)
   - `platform/infra/providers/fluence/AGENTS.md` — directory guidance
   - `platform/infra/providers/fluence/FLUENCE_REFERENCE.md` — API quick-reference (same pattern as `CHERRY_REFERENCE.md`)

2. **API wrapper scripts** (POSIX shell, `curl` + `jq`):
   - `scripts/register-ssh-key.sh` — registers an SSH public key, outputs key ID
   - `scripts/create-vm.sh` — creates a VM from a marketplace offer, outputs VM ID
   - `scripts/poll-vm-status.sh` — polls `GET /vms/v3/status` until VM has an IP and is ready
   - `scripts/delete-vm.sh` — terminates a VM by ID
   - `scripts/estimate-cost.sh` — calls estimate endpoint, outputs deposit amount
   - All scripts: read `FLUENCE_API_KEY` from env, fail fast on missing vars, output JSON

3. **OpenTofu configuration** (`main.tf`):
   - Uses `terraform_data` (or `null_resource`) + `local-exec` provisioners calling the wrapper scripts
   - Resource lifecycle: register SSH key → create VM → poll for IP → output IP
   - `output "vm_host"` — public IP of the provisioned VM (same contract as Cherry)
   - Bootstrap health check via SSH (reuse Cherry pattern: wait for cloud-init, check Docker)
   - Workspace-based environment separation (preview/production)

4. **Bootstrap** — if Fluence VMs support cloud-init (`user_data`), reuse `bootstrap.yaml`. If not, use SSH remote-exec to run equivalent setup (Docker install, cogni-edge network, deployment dirs, swap, bootstrap marker).

5. **FLUENCE_REFERENCE.md** documents:
   - API base URL and auth method
   - Key endpoints with curl examples
   - Available regions/datacenters (from `/v1/marketplace/datacenters`)
   - VM plans and pricing model (epoch-based USDC)
   - Payment/balance: Console-based funding, no REST top-up, on-chain smart contract alternative
   - Comparison with Cherry Servers patterns

6. **No CI/CD changes** — this task is base layer only. Wiring Fluence into GitHub Actions deploy workflows is a separate task.

## Allowed Changes

- `platform/infra/providers/fluence/` — new directory, all files within
- `platform/infra/AGENTS.md` — add Fluence pointer
- `platform/runbooks/INFRASTRUCTURE_SETUP.md` — add Fluence section (or note for future)

## Plan

- [ ] Create `platform/infra/providers/fluence/` directory structure
- [ ] Write API wrapper scripts (`scripts/*.sh`) with error handling and JSON output
- [ ] Write `variables.tf` with Fluence-specific variables (`fluence_api_key`, `offer_id`, `image`, `region`, `ssh_public_key_path`, `environment`, etc.)
- [ ] Write `main.tf` using `terraform_data` + `local-exec` for full VM lifecycle
- [ ] Write `terraform.preview.tfvars.example` with documented placeholder values
- [ ] Determine bootstrap strategy (cloud-init vs SSH remote-exec) — test with a real Fluence VM
- [ ] Adapt `bootstrap.yaml` or create `bootstrap-remote.sh` for SSH-based bootstrap
- [ ] Write `FLUENCE_REFERENCE.md` with API reference, regions, pricing, payment model
- [ ] Write `platform/infra/providers/fluence/AGENTS.md`
- [ ] Update `platform/infra/AGENTS.md` pointers to include Fluence
- [ ] Test: `tofu init && tofu plan` succeeds with example tfvars
- [ ] Test: Manual `tofu apply` provisions a real Fluence VM and outputs IP

## Validation

**Command:**

```bash
cd platform/infra/providers/fluence/base && tofu init && tofu validate
```

**Expected:** Validation passes (no syntax/reference errors).

**Command:**

```bash
pnpm check:docs
```

**Expected:** AGENTS.md validation passes with new Fluence directory.

**Manual validation:**

```bash
# With real FLUENCE_API_KEY:
cd platform/infra/providers/fluence/base
export FLUENCE_API_KEY="<key>"
tofu workspace new preview || tofu workspace select preview
tofu plan -var-file=terraform.preview.tfvars
tofu apply -var-file=terraform.preview.tfvars
# Verify: outputs vm_host with a real IP
# Verify: SSH root@<ip> succeeds
# Verify: docker --version works on the VM
tofu destroy -var-file=terraform.preview.tfvars
```

## Review Checklist

- [ ] **Work Item:** `task.0126` linked in PR body
- [ ] **Spec:** environments-spec invariants upheld (same base/app split, same bootstrap contract)
- [ ] **Tests:** `tofu validate` passes; manual apply/destroy tested
- [ ] **Reviewer:** assigned and approved
- [ ] **Scripts:** All wrapper scripts handle errors (non-zero exit on API failure, missing env vars)
- [ ] **No secrets committed:** API keys via env vars only, no hardcoded tokens
- [ ] **Pattern parity:** Directory layout, variable naming, and output contract match Cherry Servers base

## PR / Links

- Fluence API docs: https://api.fluence.dev/docs
- Fluence Console: https://console.fluence.network
- Cherry Servers base (reference): `platform/infra/providers/cherry/base/`
- Akash future integration (context): `platform/infra/providers/akash/FUTURE_AKASH_INTEGRATION.md`

## Attribution

-
