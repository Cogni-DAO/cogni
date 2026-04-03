---
id: handoff.0247
type: handoff
work_item_id: task.0247
status: active
created: 2026-04-03
updated: 2026-04-03
branch: deploy/multi-node
last_commit: aa56ad5fc
---

# Handoff: Multi-Node Argo CD GitOps Deployment

## Context

- Cogni runs operator + poly + resy node apps. They need CD (continuous deployment) to staging/production VMs.
- Decision: Argo CD on k3s (not extending Docker Compose). Docker Compose stays for infra services (postgres, temporal, litellm, redis, caddy).
- `infra/` reorganized by responsibility: `k8s/` (Argo+Kustomize), `provision/` (OpenTofu), `compose/` (Docker), `images/` (build contexts), `catalog/` (app inventory).
- ApplicationSets read `infra/catalog/*.yaml` and auto-generate one Argo Application per entry. Adding a node = adding a catalog file.

## Current State

- **Working end-to-end:** OpenTofu provisions Cherry VM → cloud-init installs Docker + k3s + Argo CD → ApplicationSets generate 5 Applications from catalog → real GHCR operator image pulls → `/livez` returns 200 on k3s NodePort.
- **Branch `deploy/multi-node`** has all infrastructure code. Not merged to `integration/multi-node` — waiting for full green deployment scorecard.
- **Operator image runs on k3s.** Tested with existing preview GHCR image (`ghcr.io/cogni-dao/node-template@sha256:0107cf38...`). Pod boots, `/livez` responds.
- **Migration PreSync jobs block app sync** because no postgres is running on the test VM. This is by design — but means Argo won't create the Deployment until DB is available.
- **Poly/resy have no CI-built images.** Their Dockerfiles exist (`nodes/*/app/Dockerfile`) but `staging-preview.yml` only builds operator + scheduler-worker.
- **No Compose infra deployed to test VMs** — postgres, temporal, litellm, redis, caddy are not running. Apps that need DB will crash-loop.

## Decisions Made

- Single `infra/` umbrella, no separate `deploy/` — see [cd-pipeline-e2e.md §0](../docs/spec/cd-pipeline-e2e.md) for rationale
- Kustomize `namePrefix` per node (`operator-`, `poly-`, `resy-`) — configmap DNS values must match prefixed Service names
- GHCR repo is `cogni-dao/node-template` (not `cogni-template`) — all manifests use this
- Caddy routes to k3s NodePorts via `host.docker.internal:host-gateway` (operator=30000, poly=30100, resy=30300)
- Argo PreSync Jobs run drizzle migrations per-node before app Deployment syncs
- Cherry VPS max is 6GB (`B1-6-6gb-100s-shared`, €0.07/hr)
- Bootstrap needs retry loop before `kubectl wait` (k3s node registration race)

## Next Actions

- [ ] Deploy Compose infra to VM: `deploy.sh` or manual SSH to stand up postgres, temporal, litellm, redis — unblocks migration PreSync jobs
- [ ] Deploy Caddy edge stack with multi-domain Caddyfile — enables HTTPS URLs
- [ ] Fix GHCR auth: `Cogni-1729` bot token lacks access to `node-template` repo. Use personal `CR_PAT` or fix bot permissions
- [ ] Add poly + resy to CI build matrix in `staging-preview.yml` (1-line change: add Dockerfiles to matrix)
- [ ] Wire `promote-k8s-image.sh` into CI promote step (after image push, update overlays)
- [ ] Create real SOPS-encrypted secrets per node (DATABASE_URL, AUTH_SECRET)
- [ ] Move operator from Compose `app` service to k8s-only (remove from docker-compose.yml)
- [ ] Verify full green scorecard: all pods Running, all URLs 200, cost shown
- [ ] PR `deploy/multi-node` → `integration/multi-node` only after green

## Risks / Gotchas

- **Orphaned SSH keys in Cherry:** each failed `tofu apply` leaves an SSH key. Must delete via API before retry (`curl -X DELETE .../ssh-keys/{id}`). The provision script should auto-clean these.
- **ApplicationSet watches `staging`/`main` branches:** catalog files only exist on `deploy/multi-node`. For testing, must patch the ApplicationSet revision to match your branch. Production will be correct once merged.
- **6GB VM is tight:** k3s + Argo + 5 app pods + Compose infra. Monitor memory. No 8GB VPS plan exists on Cherry Cloud VPS.
- **PreSync migration jobs are blocking:** if postgres isn't running, Argo won't create the app Deployment at all. For testing without DB, you can manually create the Deployment (bypassing Argo) or temporarily remove the migration-job.yaml from the base.
- **`host.docker.internal` requires `extra_hosts` on Linux:** Caddy Compose service needs `extra_hosts: ["host.docker.internal:host-gateway"]` to reach k3s NodePorts.

## Pointers

| File / Resource                                      | Why it matters                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `docs/spec/cd-pipeline-e2e.md`                       | Full E2E spec — architecture, gaps, networking, secrets, migration strategy |
| `docs/runbooks/INFRASTRUCTURE_SETUP.md`              | Step-by-step VM provisioning guide                                          |
| `infra/catalog/*.yaml`                               | App inventory — drives ApplicationSet generation                            |
| `infra/k8s/base/node-app/`                           | Shared Kustomize base for all node apps                                     |
| `infra/k8s/overlays/staging/operator/`               | Staging overlay with real image digest                                      |
| `infra/provision/cherry/base/bootstrap.yaml`         | Cloud-init: Docker + k3s + Argo CD install                                  |
| `scripts/setup/provision-test-vm.sh`                 | One-command test VM provisioning                                            |
| `scripts/ci/promote-k8s-image.sh`                    | Update overlay with new image digest                                        |
| `.claude/skills/deploy-node/SKILL.md`                | Deployment operations skill with troubleshooting                            |
| `work/items/task.0247.multi-node-cicd-deployment.md` | Work item with full validation checklist                                    |
