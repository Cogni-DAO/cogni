---
id: bug.0295
type: bug
title: "VM IPs committed to public repo via deploy branch env-endpoints.yaml"
status: needs_design
priority: 2
rank: 10
estimate: 2
summary: "Provision writes real VM IPs into env-endpoints.yaml on deploy branches, which are public. Need persistent floating IPs per environment abstracted behind DNS or a private overlay mechanism."
outcome: "No bare VM IPs in public git history. Environments use stable floating IPs or DNS-only references."
spec_refs: [ci-cd-spec]
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr_url:
created: 2026-04-06
updated: 2026-04-06
labels: [security, infra]
---

# VM IPs committed to public repo

## Problem

`provision-test-vm.sh` writes real VM IPs into `env-endpoints.yaml` files on deploy branches (`deploy/canary`, `deploy/preview`). These branches are public. Anyone can read the IPs and target the VMs directly.

Current state: IPs like `84.32.109.160` (canary) and `84.32.110.92` (preview) are in git history.

## Impact

Low-medium: VMs are firewalled and SSH-key-gated, but exposing IPs is unnecessary attack surface.

## Options

1. **Floating IPs per environment** — Cherry Servers supports floating IPs. Assign one per env, reference in DNS. VMs change, IP persists. EndpointSlices reference the floating IP.
2. **DNS-only EndpointSlices** — k8s ExternalName services instead of EndpointSlice IPs. Pods resolve via DNS, no IPs in git.
3. **Private deploy branches** — make deploy/\* branches private (requires GitHub Enterprise or separate private repo for deploy state).

## Validation

1. No bare IPs in any file on deploy branches
2. Provision still works (new VMs get correct routing)
3. Argo CD still syncs (EndpointSlices resolve correctly)
