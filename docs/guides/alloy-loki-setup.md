---
id: alloy-loki-setup-guide
type: guide
title: Alloy + Grafana Cloud Loki Setup
status: draft
trust: draft
summary: How to set up Alloy log forwarding to Grafana Cloud Loki, including Grafana Cloud account setup, environment config, and verification.
read_when: Setting up or troubleshooting the Alloy → Grafana Cloud Loki log pipeline.
owner: derekg1729
created: 2026-02-06
verified: 2026-02-06
tags: [observability, infra]
---

# Alloy + Grafana Cloud Loki Setup

## When to Use This

You are setting up or troubleshooting the Alloy log + metrics pipeline that forwards cluster observability data to Grafana Cloud. Two deployment targets exist:

1. **k3s (multi-node production)** — Alloy runs as a DaemonSet inside each env's k3s cluster, delivered via Argo CD. This is the primary path. See **Part 1** below.
2. **Docker Compose (legacy / local dev)** — Alloy runs as a compose service reading `/var/run/docker.sock`. See **Part 2** below.

Promtail is deprecated (EOL March 2, 2026) — Alloy is the replacement.

---

## Part 1 — K3s Deployment

### Topology

Per [docs/spec/ci-cd.md](../spec/ci-cd.md), the environment model is `candidate-a` (pre-merge PR validation lane), `preview` (post-merge validation), and `production`. `canary` and `staging` are legacy and being purged — do not add new artifacts to them.

Today (v0), a single k3s cluster hosts all three namespaces (`cogni-candidate-a`, `cogni-preview`, `cogni-production`) plus the legacy `cogni-canary` namespace. Each env gets its own Alloy DaemonSet via per-env overlays; each DaemonSet scrapes only pods on its own node (`discovery.kubernetes` + `__meta_kubernetes_pod_node_name` keep-filter) so the topology scales cleanly when the cluster splits one-per-env.

The Alloy pod:

- Tails pod logs from `/var/log/pods` (hostPath)
- Tails host `journald` (every systemd unit — containerd, k3s, docker daemon, sshd, kernel, cron) with a 12h backlog cap
- Scrapes kubelet `/metrics/cadvisor` for per-container CPU/memory/network
- Runs the `unix` exporter for host metrics (`/proc`, `/sys`, `/`)
- Scrapes each node-app pod's `/api/metrics` endpoint with a bearer token
- Ships everything to Grafana Cloud (Loki + Mimir) via `loki.write` and `prometheus.remote_write`

### File layout

```
infra/k8s/base/alloy/
├── config.alloy            # Alloy river config (merged into alloy-config configmap)
├── configmap.yaml          # alloy-config — DEPLOY_ENVIRONMENT override is overlay-patched
├── daemonset.yaml          # grafana/alloy:v1.9.2 + hostPath mounts + Grafana Cloud env
├── kustomization.yaml
└── rbac.yaml               # ServiceAccount + ClusterRole + ClusterRoleBinding (patched per overlay)

infra/k8s/overlays/{candidate-a,preview,production}/alloy/
└── kustomization.yaml      # per-env namespace + DEPLOY_ENVIRONMENT patch

infra/k8s/secrets/{candidate-a,preview,production}/alloy-secrets.enc.yaml.example
                            # Secret shape for future ksops GitOps delivery (task.0311)

infra/catalog/alloy.yaml    # type=agent catalog entry — ApplicationSets auto-generate one Argo App per env
```

### Bootstrap — create the Grafana Cloud Secret

Each cluster needs one Secret named `alloy-secrets` in the `cogni-{env}` namespace. Alloy reads seven keys from it (Loki basic auth, Prometheus basic auth, METRICS_TOKEN for `/api/metrics` scrape).

#### Current path (interim) — manual `kubectl create secret`

ksops is configured in Argo CD but has never been end-to-end activated — `.sops.yaml` still holds placeholder age keys, and no real encrypted secret file is in git. Until that bootstrap happens (task.0311), the alloy Secret is created imperatively on each cluster.

**Secret bootstrap is decoupled from the PR/Argo flow.** The Secret is a cluster-side object that persists independent of deploys; create it once and it sits waiting for the Alloy DaemonSet to reference it on first sync.

The fastest path when the VM already has Grafana Cloud credentials in `/opt/cogni-template-runtime/.env` (populated by `deploy-infra.sh` from the env's GitHub environment secrets) is to source them on the VM and feed them directly to `kubectl`. This avoids ever echoing credentials through your workstation:

```bash
ssh -i .local/<env>-vm-key root@<vm-ip> 'set -a; source /opt/cogni-template-runtime/.env; set +a; \
  kubectl -n cogni-<env> create secret generic alloy-secrets \
    --from-literal=LOKI_WRITE_URL="$LOKI_WRITE_URL" \
    --from-literal=LOKI_USERNAME="$LOKI_USERNAME" \
    --from-literal=LOKI_PASSWORD="$LOKI_PASSWORD" \
    --from-literal=PROMETHEUS_REMOTE_WRITE_URL="$PROMETHEUS_REMOTE_WRITE_URL" \
    --from-literal=PROMETHEUS_USERNAME="$PROMETHEUS_USERNAME" \
    --from-literal=PROMETHEUS_PASSWORD="$PROMETHEUS_PASSWORD" \
    --from-literal=METRICS_TOKEN="$METRICS_TOKEN"'
```

- **candidate-a** — SSH explicitly authorized. Run the command with `<env>=candidate-a` and the key at `.local/canary-vm-key` (the VM was provisioned as `canary` and now hosts candidate-a via the `cogni-candidate-a` namespace).
- **preview**, **production** — do NOT run this yet. See the ksops target path below and the scorecard row #16. These envs should receive secrets via ksops (task.0311) or ESO (task.0284), not via a second manual SSH.

Verify with:

```bash
kubectl -n cogni-candidate-a describe secret alloy-secrets
```

All 7 keys should be present with non-zero byte lengths.

#### Target path — ksops GitOps delivery

The file shape is already in place: `infra/k8s/secrets/{candidate-a,preview,production}/alloy-secrets.enc.yaml.example` templates the Secret. The follow-up task [task.0311](../../work/items/task.0311.ksops-activate-alloy-secrets.md) covers the one-time activation work:

1. Generate real age keys per env (`age-keygen`)
2. Install the private keys into each cluster's `argocd/sops-age-key` Secret
3. Replace placeholder keys in `.sops.yaml` with the real public keys
4. Encrypt each `.enc.yaml.example` → `.enc.yaml` with `sops --encrypt`
5. Add the encrypted file as a resource in each overlay's `kustomization.yaml`
6. Delete this manual section from the guide

Until task.0311 lands, treat the manual bootstrap above as the operational path. The secret delivery gap is flagged on the CI/CD scorecard as row #16 in `work/projects/proj.cicd-services-gitops.md`.

The long-term target (per [task.0284](../../work/items/task.0284-secrets-single-source-eso.md)) is External Secrets Operator — ksops is only the interim. Do not build additional automation against ksops beyond what task.0311 requires.

### Deploy via Argo CD

candidate-a is the **pre-merge** validation lane. The flow is:

1. Flight the PR (containing the alloy overlay + catalog entry) to candidate-a via the candidate-flight workflow — this pushes the PR state to `deploy/candidate-a`.
2. The `candidate-a` ApplicationSet picks up `infra/catalog/alloy.yaml`, generates a `candidate-a-alloy` Application, and syncs.
3. The `alloy-secrets` Secret you created in Phase 0 is found by the DaemonSet on first reconcile.
4. Validate observability in Grafana Cloud. If green, merge the PR to `main`.
5. Post-merge: preview and production promotion flows advance `deploy/preview` and `deploy/production` respectively. Their alloy secrets must exist in-cluster (via ksops task.0311) before the promotion completes.

Watch the rollout:

```bash
ssh -i .local/canary-vm-key root@84.32.109.160 \
  'kubectl -n argocd get applications | grep alloy; \
   kubectl -n cogni-candidate-a get daemonset alloy; \
   kubectl -n cogni-candidate-a logs -l app.kubernetes.io/name=alloy --tail=50'
```

**Known benign noise**: the legacy `canary` ApplicationSet will try to generate a `canary-alloy` Application but fail with `ComparisonError: path not found` because this repo intentionally has no `infra/k8s/overlays/canary/alloy/`. Localized — doesn't cascade to other `canary-*` Applications. Disappears when the canary ApplicationSet is retired in a separate cleanup PR.

### Verification — is health data flowing?

Once the DaemonSet is running and the secret is in place:

**1. Alloy component health (from inside the cluster):**

```bash
kubectl -n cogni-candidate-a port-forward daemonset/alloy 12345:12345
# Open http://127.0.0.1:12345 in your browser.
# Every component should show "Healthy". Red = misconfigured or auth failed.
```

**2. Grafana Cloud — Prometheus side:**

Run these in Grafana Cloud Explore → Mimir:

```promql
up{env="candidate-a"}                                                     # 4+ targets, all =1
container_cpu_usage_seconds_total{env="candidate-a", pod=~"operator-.*"}  # CPU per operator pod
http_requests_total{env="candidate-a", service=~"operator|poly|resy"}     # app-level metrics back
```

**3. Grafana Cloud — Loki side:**

```logql
{env="candidate-a", app="cogni-template"}                          # pod logs
{env="candidate-a", source="journald"}                             # host systemd logs
{env="candidate-a", source="journald", unit=~"k3s.*|containerd.*"} # k3s + containerd only
```

If the Prometheus scrape for `/api/metrics` is failing (`up{job="app_metrics"}=0`), the most common cause is the `METRICS_TOKEN` in `alloy-secrets` not matching the app's expected token. Fix by re-creating the secret with the correct value.

### Troubleshooting — k3s path

| Symptom                                          | Likely cause                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `CrashLoopBackOff` on alloy pod                  | Missing `alloy-secrets` Secret. Run the bootstrap command above.                                                                     |
| Pod runs but no metrics in Grafana Cloud         | Wrong `PROMETHEUS_REMOTE_WRITE_URL` or expired API key. Check Alloy UI.                                                              |
| `up{job="app_metrics"}=0`                        | `METRICS_TOKEN` wrong, or the target pods don't carry `app.kubernetes.io/component=node` + `app.kubernetes.io/part-of=cogni` labels. |
| No journald logs                                 | Host uses `/run/log/journal` only. Both paths are mounted — check `loki.source.journal` component status in the Alloy UI.            |
| Kubelet cAdvisor scrape 403                      | RBAC not applied. `kubectl -n cogni-candidate-a get clusterrolebinding alloy` must exist and reference the right SA namespace.       |
| `canary-alloy` Argo App stuck on ComparisonError | Expected — see "Known benign noise" above. Not a regression.                                                                         |

---

## Part 2 — Docker Compose Deployment (legacy / local dev)

### When to Use This

You are setting up or troubleshooting the Alloy log collection pipeline that forwards container logs to Grafana Cloud Loki. Promtail is deprecated (EOL March 2, 2026) — Alloy is the replacement.

## Preconditions

- [ ] Docker running
- [ ] Grafana Cloud account (free tier available)
- [ ] `.env.local` or `.env.runtime.local` configured

## Steps

### Current State

✅ **V1 Complete:** Structured logging with Pino in application code

- JSON logs to stdout
- RequestContext with reqId, session, routeId
- Event schemas (AiLlmCallEvent, PaymentsEvent)
- See: [Observability Spec](../spec/observability.md)

✅ **V2 Complete:** Log collection and aggregation

- Alloy forwards logs to Grafana Cloud Loki
- No self-hosted Loki required
- Logs queryable via Grafana Cloud interface

### Goal

Minimal viable log collection with Grafana Cloud:

1. Replace Promtail with Alloy
2. Configure Alloy to scrape container logs via Docker socket
3. Forward logs to Grafana Cloud Loki (managed service)
4. Verify logs flow: App → Docker → Alloy → Grafana Cloud
5. Query and visualize logs in Grafana Cloud

**Deferred to later PRs:**

- Grafana dashboards
- Alert rules
- Advanced filtering (health check noise)
- Structured metadata extraction
- Trace collection (OTLP)

### Design Decisions

### 1. Label Cardinality (STRICT)

**Labels** (indexed, low-cardinality):

- `app` - Application name (e.g., "cogni-template")
- `env` - Environment (dev, test, prod)
- `service` - Docker Compose service name (mapped from compose_service)
- `stream` - stdout/stderr

**JSON fields** (not labels, query with `| json`):

- `reqId` - Request ID (high cardinality)
- `userId` - User ID (high cardinality)
- `billingAccountId` - Billing account (high cardinality)
- `attemptId` - Payment attempt ID (high cardinality)
- `level` - Log level (info, warn, error)
- `msg` - Log message
- `time` - Timestamp

**Rationale:** Loki indexes labels; high-cardinality labels destroy performance. Keep cardinality < 100 per label.

### 2. Version Pinning

- **Alloy:** `grafana/alloy:v1.9.2` (Dec 2024 - stable 1.9.x branch, includes eBPF fixes and better component compatibility)
- **Grafana Cloud Loki:** Managed service (automatically updated by Grafana)

**Why these versions:**

- Alloy v1.9.2: Latest 1.9.x with fixes for validation and profile collection; avoids breaking changes from v1.9.0
- Grafana Cloud: No version management required, always up-to-date

**Update policy:** Review Alloy quarterly; test in dev before promoting to prod. Never use `:latest`.

### 3. Security

- Alloy UI: `127.0.0.1:12345` (internal only, not exposed publicly)
- Docker socket: read-only mount (`:ro`)
- No `/var/lib/docker/containers` mount (using docker discovery, not file scraping)
- Grafana Cloud: Basic auth with user ID and API key (credentials via environment variables)

### 4. Storage

- **Grafana Cloud:** Managed storage (no local volumes required for Loki)
- **Alloy positions:** Named volume `alloy_data` (offset tracking)

### Step 1: Setup Grafana Cloud Account

1. Sign up at https://grafana.com/products/cloud/ (free tier available)
2. Navigate to: **Connections → Data Sources → Loki**
3. Note the following credentials:
   - **URL**: Push endpoint (e.g., `https://logs-prod-us-central1.grafana.net/loki/api/v1/push`)
   - **User ID**: Numeric value shown in the interface
4. Generate an API key:
   - Click **"Generate now"** in the Loki data source page
   - Grant `logs:write` permission
   - Save the API key securely (starts with `glc_`)

### Step 2: Configure Environment Variables

Add to your `.env.local` or `.env.runtime.local`:

```bash
GRAFANA_CLOUD_LOKI_URL="https://logs-prod-us-central1.grafana.net/loki/api/v1/push"
GRAFANA_CLOUD_LOKI_USER="123456"  # Your numeric user ID
GRAFANA_CLOUD_LOKI_API_KEY="glc_your_api_key_here"  # API key with logs:write
```

These variables are already configured in:

- `.env.local.example` (local development template)
- `docker-compose.yml` and `docker-compose.dev.yml` (Alloy service environment section)

### Step 3: Alloy Configuration

The Alloy configuration is already created at `infra/compose/configs/alloy-config.alloy` with:

- **Container allowlist**: `(app|litellm|caddy)` only
- **Strict label cardinality**: `{app, env, service, stream}` only
- **Grafana Cloud endpoint**: Uses `sys.env("GRAFANA_CLOUD_LOKI_URL")`
- **Authentication**: Basic auth with user ID and API key from environment

See the actual config file for full implementation details.

### Step 4: Deploy Stack

```bash
cd infra/services/runtime
docker compose --env-file .env.runtime.local down
docker compose --env-file .env.runtime.local up -d
```

Wait ~30 seconds for services to stabilize.

### Implementation History

1. Setup Grafana Cloud account and get credentials
2. Update `docker-compose.yml` and `docker-compose.dev.yml`:
   - Remove `loki` service (using Grafana Cloud)
   - Replace `promtail` with `alloy`
   - Add Grafana Cloud env vars to alloy service
   - Add `alloy_data` volume definition
3. Create `configs/alloy-config.alloy` with Grafana Cloud endpoint
4. Test locally with Grafana Cloud
5. Update documentation:
   - `docs/spec/observability.md` — Complete Grafana Cloud setup guide
   - `infra/compose/AGENTS.md` — Added setup instructions
6. Standardize environment files:
   - Merge `.env.example` into `.env.local.example`
   - Delete `.env.example`
   - Update all references in docs and scripts

## Verification

**Check Alloy UI:**

Open http://127.0.0.1:12345 in your browser:

- Verify `discovery.docker.containers` shows discovered targets
- Verify `loki.write.grafana_cloud_loki` shows healthy endpoint status
- Check for any error messages in component status

**Check Grafana Cloud:**

1. Navigate to https://your-org.grafana.net/a/logs (Explore → Loki)
2. Run LogQL queries:
   - `{app="cogni-template"}` - Should show all logs
   - `{service="app"}` - Application logs only
   - `{service="app"} | json | level="error"` - Filter errors

**Validation Checklist:**

- [ ] Alloy UI accessible at http://127.0.0.1:12345
- [ ] Alloy discovers containers (check UI targets)
- [ ] Only allowlisted services shown (app, litellm, caddy)
- [ ] Grafana Cloud shows `app="cogni-template"` logs
- [ ] Labels contain exactly: `app`, `env`, `service`, `stream`
- [ ] High-cardinality fields (reqId) queryable via `| json`

## Troubleshooting

### Problem: No logs in Grafana Cloud

**Solution:**

1. Check Alloy UI (http://127.0.0.1:12345):
   - Component status shows errors?
   - Authentication failing?
2. Check Alloy logs: `docker logs alloy | tail -50`
3. Verify environment variables in container:
   ```bash
   docker exec alloy env | grep GRAFANA_CLOUD
   ```
4. Verify app is logging: `docker logs app | head`

### Problem: Authentication errors

**Solution:**

1. Verify credentials are correct in `.env` file
2. Check API key has `logs:write` permission in Grafana Cloud
3. Verify URL format includes `/loki/api/v1/push` path

### Problem: Labels missing

**Solution:**

1. Verify `APP_ENV` is set: `docker exec alloy env | grep APP_ENV`
2. Check Alloy relabeling rules in `configs/alloy-config.alloy`
3. Query in Grafana Cloud: `{app="cogni-template"}` to inspect labels

## Related

- [Observability Spec](../spec/observability.md) — structured logging, tracing, event schemas
- [Observability Hardening Project](../../work/projects/proj.observability-hardening.md) — future enhancements (filtering, dashboards, alerts, traces)
- [Official Alloy Tutorial: Send Logs to Loki](https://grafana.com/docs/alloy/latest/tutorials/send-logs-to-loki/)
- [loki.source.docker Component](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.docker/)
- [discovery.docker Component](https://grafana.com/docs/alloy/latest/reference/components/discovery/discovery.docker/)
- [Loki Label Best Practices](https://grafana.com/docs/loki/latest/best-practices/)
