# Handoff: task.0281 Phase 1 — Canary Infra Deploy Parity

**Task:** `work/items/task.0281-canary-cicd-parity-staging-promotion.md`
**Date:** 2026-04-04
**Status:** Ready for implementation (canary VM being re-provisioned)
**Branch:** Create `feat/task-0281-phase1-infra-deploy` from `canary`

---

## Problem

Canary CI/CD only deploys app pods (k8s overlay → Argo). It does NOT deploy Compose infrastructure (postgres, temporal, litellm, redis, caddy). When someone changes `docker-compose.yml`, Caddy config, or litellm config and pushes to canary — nothing happens. The change sits in git until someone SSHs in.

`staging-preview.yml` handles this via `scripts/ci/deploy.sh` which rsyncs compose files to the VM and runs `docker compose up -d`. Canary needs the same capability.

## What to build

One script + one workflow job. Port existing logic from `deploy.sh`, don't write fresh.

### 1. Create `scripts/ci/deploy-infra.sh`

**Source material — port from these exact sections of `scripts/ci/deploy.sh`:**

| deploy.sh section       | Lines   | What it does                                                     | Port to deploy-infra.sh                                                 |
| ----------------------- | ------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| rsync bundles           | 867-907 | Uploads `infra/compose/edge/` and `infra/compose/runtime/` to VM | YES — same rsync                                                        |
| .env file writing       | 503-599 | Writes `/opt/cogni-template-runtime/.env` with secrets           | YES — but only infra vars (DB creds, Temporal, LiteLLM, Redis, Grafana) |
| Network creation        | 497-498 | `docker network create cogni-edge`                               | YES — idempotent                                                        |
| Edge stack (Caddy)      | 603-626 | `docker compose up -d` for Caddy, SHA256 change detection        | YES — exact same logic                                                  |
| GHCR auth               | 655-656 | `docker login ghcr.io`                                           | YES                                                                     |
| Postgres up             | 705-722 | `docker compose up -d postgres` with fallback                    | YES                                                                     |
| DB provisioning         | 729-731 | `docker compose --profile bootstrap run --rm db-provision`       | YES — idempotent                                                        |
| Runtime stack           | 754-758 | `docker compose up -d` for all infra services                    | YES — but EXCLUDE app container (Argo handles that)                     |
| Config change detection | 790-832 | SHA256 litellm/openclaw config → restart if changed              | YES                                                                     |

**What NOT to port:**

- App image pull (lines 682-694) — Argo handles app images
- App readiness poll (lines 764-775) — verify job handles this
- Governance sync (lines 782-784) — app-level concern
- Migrator execution (lines 735-737) — k8s migration Job handles this

**Script interface:**

```bash
# Usage: scripts/ci/deploy-infra.sh
# Env vars (from GH Secrets):
#   VM_HOST, SSH_DEPLOY_KEY
#   DATABASE_URL, DATABASE_SERVICE_URL, DATABASE_ROOT_URL
#   LITELLM_MASTER_KEY, OPENROUTER_API_KEY
#   TEMPORAL_NAMESPACE (e.g. cogni-canary)
#   GRAFANA_CLOUD_* (Loki/Prometheus creds for Alloy)
#   GHCR_DEPLOY_USERNAME, GHCR_DEPLOY_TOKEN
```

### 2. Add `deploy-infra` job to `.github/workflows/build-multi-node.yml`

Insert between `promote-k8s` and `verify`:

```yaml
deploy-infra:
  runs-on: ubuntu-latest
  needs: promote-k8s
  environment: canary # or preview/production based on branch
  concurrency:
    group: deploy-infra-${{ github.ref_name }}
    cancel-in-progress: true
  env:
    VM_HOST: ${{ secrets.VM_HOST }}
    SSH_DEPLOY_KEY: ${{ secrets.SSH_DEPLOY_KEY }}
    # ... all secrets deploy-infra.sh needs
  steps:
    - uses: actions/checkout@v4
    - name: Setup SSH
      run: |
        mkdir -p ~/.ssh && chmod 700 ~/.ssh
        echo "$SSH_DEPLOY_KEY" > ~/.ssh/deploy_key
        chmod 600 ~/.ssh/deploy_key
    - name: Deploy infrastructure
      run: scripts/ci/deploy-infra.sh
```

**Environment mapping** (same pattern as promote step):

```yaml
case "${{ github.ref_name }}" in
  canary)   environment: canary ;;
  staging)  environment: preview ;;
  main)     environment: production ;;
esac
```

Each GH environment (canary/preview/production) has its own `VM_HOST` and `SSH_DEPLOY_KEY`.

## How to test end-to-end

### Test 0 (THE parity proof): Alloy k8s pod log shipping

This is the definitive test. It proves deploy-infra.sh works AND gives us observability.

1. Update `infra/compose/runtime/configs/alloy-config.metrics.alloy` to add k8s pod log scraping (Alloy supports `discovery.kubernetes` or reading k3s container logs from host `/var/log/pods/`)
2. PR to canary → merge
3. CI runs → deploy-infra.sh rsyncs new Alloy config → detects SHA256 change → restarts Alloy
4. Verify: open Grafana Cloud → query `{namespace="cogni-canary"}` → operator/poly/resy pod logs appear
5. **If pod logs show up in Grafana without SSH, Phase 1 is proven.**

### Test 1: Caddy config change deploys automatically

1. Make a visible change to `infra/compose/edge/configs/Caddyfile.tmpl` (e.g. add a comment header)
2. PR to canary → merge
3. CI runs → deploy-infra.sh rsyncs new Caddyfile → detects SHA256 change → reloads Caddy
4. Verify: deploy-infra.sh logs in GH Actions show "Caddyfile changed, reloading"

### Test 2: LiteLLM config change deploys automatically

1. Add a model alias to litellm config
2. PR to canary → merge
3. deploy-infra.sh detects config change → restarts litellm
4. Verify: `curl https://test.cognidao.org/api/v1/models` shows the new model (proxied through litellm)

### Test 3: App code change still works (no regression)

1. Make a trivial UI change
2. Push to canary
3. CI builds new image → promotes digest → Argo syncs → new pod
4. Verify: page shows the change

### Test 4: Full pipeline green

1. Push any change to canary
2. Build Multi-Node: all jobs green (build → promote → deploy-infra → verify → e2e)
3. E2E Canary: Playwright smoke passes

## Key files to read before starting

| File                                       | Why                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `scripts/ci/deploy.sh`                     | The source to port FROM. 960 lines. Read the sections listed above. |
| `.github/workflows/build-multi-node.yml`   | The workflow to add the job TO.                                     |
| `.github/workflows/staging-preview.yml`    | Reference for how deploy.sh is called (lines 220-240).              |
| `infra/compose/runtime/docker-compose.yml` | The Compose services being deployed.                                |
| `infra/compose/edge/docker-compose.yml`    | Caddy edge proxy.                                                   |

## Anti-patterns to avoid

- **Don't rewrite deploy.sh logic.** Copy the exact bash from the sections listed. Change only what's needed (remove app-specific lines).
- **Don't deploy app containers.** Argo handles k8s pods. deploy-infra.sh handles Compose infra only.
- **Don't run migrations.** k8s migration Job (Argo PreSync hook) handles DB migrations.
- **Don't add new secrets.** Use the same secrets staging-preview already has in the canary GH environment.
- **Don't block on this for poly/resy.** Poly/resy readyz depends on DB provisioning (which deploy-infra.sh handles). If provision.sh grants are correct, this should just work.

## Definition of done

Phase 1 checklist from task.0281:

- [ ] Push app code change → Argo deploys → readyz 200 on all 3 nodes
- [ ] Push Compose infra change (Caddy) → deploy-infra.sh deploys → change live without SSH
- [ ] Push litellm config change → litellm restarts
- [ ] Verify passes (parallel, all 3 nodes)
- [ ] E2E Playwright smoke passes
- [ ] Chat works (sign in → send message → get response)
