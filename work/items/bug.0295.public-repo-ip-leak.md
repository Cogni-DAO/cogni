---
id: bug.0295
type: bug
title: "VM IPs in git — deploy-branch env-state.yaml drifts from reality, causes outages"
status: needs_implement
priority: 0
rank: 1
estimate: 3
summary: "VM IPs live in git (main seed + deploy-branch env-state.yaml). Git is the wrong substrate for runtime state. Silent drift on VM reprovision: main's seed IP stays stale, provision writes deploy-branch IPs, workflow rsync preserves them. Today (2026-04-20) this chain caused a 6-hour preview outage after bug.0334 / PR #943's authoritative overlay sync exposed a 2-week-old stale preview IP — scheduler-worker crashlooped on wrong Temporal IP, all user chat.completions hung. Fix: VM IPs do not belong in git; use DNS (ExternalName Service + Cloudflare A-record) as the discovery layer."
outcome: "No bare VM IPs in any file under `infra/k8s/` on main OR deploy branches. EndpointSlices removed (or reduced to name-only references). Cross-VM dependencies (Temporal, Postgres, LiteLLM, Redis) resolved by hostname via cluster DNS. VM reprovision: single DNS A-record update. Zero git commits. Fresh deploy branches are byte-identical to main under `infra/k8s/`."
spec_refs: [ci-cd, cd-pipeline]
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr_url:
created: 2026-04-06
updated: 2026-04-20
labels: [security, infra, cicd, drift, bug.0334-followup]
---

# VM IPs in git — drift → outages

## Problem

`provision-test-vm.sh` writes real VM IPs into `env-state.yaml` on deploy branches (`deploy/canary`, `deploy/preview`, `deploy/production`). main's seed copies of the same files carry IPs too. Deploy branches are public, so the security angle matters — but the operational angle is worse: **git is the wrong place to hold VM IPs** and today proved it.

## 2026-04-20 outage — the full chain

1. **2026-04-05**: preview VM reprovisioned from `84.32.109.222` → `84.32.110.92`. `.local/preview-vm-ip` updated locally. Main's overlay kept `.109.222` in inline EndpointSlice patches. Nobody noticed.
2. Running pods limped along on cached Temporal connections + in-cluster DNS for Service routing. Two weeks of latent drift.
3. **2026-04-19**: PR #943 (bug.0334) refactors — inline IP patches → per-overlay `env-state.yaml` ConfigMap + kustomize `replacements:`. Main's env-state.yaml faithfully ports the stale `.109.222`. Workflow rsync switches from base-only to authoritative full-`infra/k8s/` sync, with `--ignore-existing` protecting env-state.yaml as "provision-owned truth."
4. First promote-and-deploy after #943 rewrites deploy/preview overlays strictly from env-state.yaml. scheduler-worker boots fresh, tries Temporal at `.109.222`, `TransportError: Connection refused` crashloops.
5. Every user chat.completions submits a `GraphRunWorkflow` → scheduler-worker can't consume it → client awaits forever → 60-second edge cut.
6. Six hours of debugging ensued. Unblocked by direct commit `214ef15` to deploy/preview env-state.yaml × 4 with the correct IP (`known-hack`, not the real fix). bug.0334 / PR #943 did not cause the drift; it exposed it.

Full narrative: [`work/handoffs/task.0311.followup.md`](../handoffs/task.0311.followup.md)

## Why this keeps biting

Every path that writes a VM IP to git is a drift vector:

| Writer                      | Destination                                              | Propagation                |
| --------------------------- | -------------------------------------------------------- | -------------------------- |
| main's seed env-state.yaml  | new deploy branches (first promote, `--ignore-existing`) | seed only                  |
| `provision-test-vm.sh`      | deploy-branch env-state.yaml directly                    | authoritative for that env |
| direct commits to deploy/\* | deploy-branch env-state.yaml                             | corrections, manual        |

Three writers, one destination, no version comparison, no authority ordering. Drift compounds with every VM event that doesn't trigger a reprovision run.

Cogni's scaling vision makes this strictly worse: AI contributors spinning up candidate slots on demand, multiple concurrent flights. Every piece of environment-coupled state in git becomes a merge conflict, a drift bug, a "why did my flight fail" debugging session.

## Design

### Recommendation: ExternalName Service + DNS (option A)

Replace EndpointSlice IP patches with **ExternalName Services** whose `spec.externalName` is a stable hostname like `preview.vm.cogni.internal`. Cloudflare (or equivalent) holds the A-record. Pods resolve via cluster DNS → upstream DNS → VM IP. Provisioning updates the A-record. **Zero git commits on reprovision.**

```mermaid
flowchart LR
  PodA[poly-node-app] -->|"DNS: poly-temporal-external"| SvcA[ExternalName Service<br/>poly-temporal-external]
  SvcA -->|"externalName: temporal.preview.cogni.internal"| CoreDNS[coreDNS]
  CoreDNS -->|"resolve upstream"| CF[Cloudflare A-record]
  CF -->|"current VM IP"| VM[preview VM]
```

### Options considered

| Option                                   | Approach                                                                                      | Pros                                                                                  | Cons                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **A. ExternalName + DNS** (recommended)  | k8s ExternalName Services + Cloudflare A-record; provisioning updates DNS                     | Standard pattern; zero git state; fits existing Cloudflare infra for public hostnames | Requires DNS write creds at provision-time                                       |
| B. Name-based env vars, no EndpointSlice | Deployments reference `host:port` in env; drop EndpointSlices entirely                        | Simpler Wiring                                                                        | Hostname duplicated in every deployment env; loses kubectl-level discoverability |
| C. k3s Node annotation + downward API    | Provision annotates Node with `cogni.dev/vm-public-ip`; init-container emits /etc/hosts entry | Zero external deps                                                                    | Init-container boilerplate; annotation becomes the new drift surface             |
| D. Argo values substitution              | Store VM IP in Argo cluster secret annotations; Argo substitutes at sync                      | Lives in Argo, not git                                                                | Adds templating to otherwise-pure kustomize                                      |

## Invariants

| Rule                          | Constraint                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NO_INFRA_RUNTIME_STATE_IN_GIT | No VM IP, endpoint address, or per-deploy runtime state in `infra/k8s/` on main or deploy branches. `env-state.yaml` removed (or reduced to non-IP state). |
| DNS_IS_THE_DISCOVERY_LAYER    | Cross-VM dependencies (Temporal, Postgres, LiteLLM, Redis, Doltgres) addressed by hostname, not IP. k8s Services or ExternalName resolve via cluster DNS.  |
| PROVISION_WRITES_DNS_NOT_GIT  | `provision-test-vm.sh` updates the DNS A-record (Cloudflare API or equivalent). It does not commit any file under `infra/k8s/` on any branch.              |
| FRESH_DEPLOY_IS_MAIN_MIRROR   | `deploy/<env>` under `infra/k8s/` is byte-identical to main at the promoted SHA. `--ignore-existing` seed logic removed.                                   |

## File pointers (expected changes)

| File                                              | Change                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `infra/k8s/overlays/**/env-state.yaml` (16 files) | Deleted (or reduced to non-IP metadata)                                                                                              |
| `infra/k8s/overlays/**/kustomization.yaml` × 16   | Drop `replacements:` block; reference ExternalName Services                                                                          |
| `infra/k8s/base/node-app/external-services.yaml`  | EndpointSlices → ExternalName Services; hostname points at env-specific DNS zone                                                     |
| `scripts/setup/provision-test-vm.sh`              | Phase 4c: delete env-state.yaml writing; add Cloudflare DNS API call to update A-record                                              |
| `.github/workflows/promote-and-deploy.yml`        | Collapse two-pass rsync to a single `rsync -a --delete app-src/infra/k8s/ deploy-branch/infra/k8s/`; no `--exclude='env-state.yaml'` |
| `docs/spec/ci-cd.md`                              | Add `DNS_IS_THE_DISCOVERY_LAYER` invariant                                                                                           |

## Validation

- [ ] `git grep -E '([0-9]{1,3}\.){3}[0-9]{1,3}' infra/k8s/` on main returns zero non-comment matches
- [ ] No `env-state.yaml` files remain under `infra/k8s/overlays/**/`
- [ ] Preview + candidate-a + production continue to function end-to-end (brain V2 on poly: `core__knowledge_write` + `core__knowledge_search`)
- [ ] VM reprovision simulation: update the DNS A-record; pod restart picks up new address with zero git commits
- [ ] `promote-and-deploy.yml` rsync block is a single `rsync -a --delete`
- [ ] `deploy/preview` commit `214ef15` (known-hack) is reverted as part of the cleanup

## Blocked by / prerequisites

- Cloudflare API token with A-record write scope for the chosen internal zone (e.g., `*.vm.cogni.internal`)
- Decision: internal zone name (`vm.cogni.internal` vs subdomain under existing `cognidao.org` vs standalone)

## Related

- Predecessor: PR #943 / bug.0334 (`INFRA_K8S_MAIN_DERIVED`) — correct structural fix, wrong substrate for the IP value
- Predecessor: PR #939 / bug.0333 — moved envs-identical ConfigMap values to base; this completes the pattern
- Known-hack commit: `214ef15` on deploy/preview — unblocked preview chat today; must be reverted once this lands
- Narrative: [task.0311 followup handoff](../handoffs/task.0311.followup.md)
