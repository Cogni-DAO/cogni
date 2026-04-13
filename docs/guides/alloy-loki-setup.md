---
id: alloy-loki-setup-guide
type: guide
title: Alloy + Grafana Cloud Setup (k3s)
status: draft
trust: draft
summary: Deploy Grafana Alloy as a DaemonSet in each env's k3s cluster so pod logs, kubelet metrics, host metrics, app /api/metrics, and host journald ship to Grafana Cloud. Covers bootstrap and rollout across candidate-a, preview, and production per the trunk-based CI/CD spec.
read_when: Setting up or troubleshooting Alloy observability on a k3s env, or rolling the Alloy DaemonSet out to preview or production.
owner: derekg1729
created: 2026-02-06
verified: 2026-04-13
tags: [observability, infra, k8s]
---

# Alloy + Grafana Cloud Setup (k3s)

## When to Use This

You are setting up or troubleshooting the Alloy log + metrics pipeline that forwards cluster observability data from a Cogni k3s cluster to Grafana Cloud. The target environments — per [docs/spec/ci-cd.md](../spec/ci-cd.md) — are `candidate-a` (pre-merge lane), `preview` (post-merge validation), and `production`. `canary` and `staging` are legacy and being purged.

Docker Compose–era Alloy on the VM infra side (postgres, temporal, litellm) is out of scope for this guide — see `infra/compose/runtime/configs/AGENTS.md` if you need to touch that layer.

## Topology

Each environment is a standalone k3s cluster on a dedicated Cherry Servers VM with its own Argo CD instance. One `alloy` DaemonSet runs in `cogni-{env}`. The Alloy pod is **node-local** — every discovery block keep-filters on `__meta_kubernetes_pod_node_name == sys.env("HOSTNAME")` so scaling past single-node k3s does not duplicate series.

```
┌─ cogni-{env} k3s cluster ──────────────────────────────────────────┐
│                                                                    │
│   Alloy DaemonSet  (grafana/alloy:v1.9.2)                          │
│   ├ pod logs from this node (cogni-* namespaces only)              │
│   ├ host journald (max_age=12h; k3s, containerd, sshd, kernel, …)  │
│   ├ kubelet /metrics/cadvisor (this node's kubelet only)           │
│   ├ prometheus.exporter.unix (host /proc /sys /)                   │
│   └ node-app /api/metrics (operator | poly | resy on this node)    │
│                                                                    │
│   → Grafana Cloud (Loki push + Prometheus remote_write)            │
│     labels: env, service, namespace, pod, container, unit, node    │
└────────────────────────────────────────────────────────────────────┘
```

Cluster-scoped scrape targets (kube-state-metrics, ingress-controllers, control-plane) are explicitly **not** handled by this DaemonSet. When they are added, they belong in a separate Alloy `Deployment` with `replicas: 1`.

## File layout

```
infra/k8s/base/alloy/
├── config.alloy            # river config (merged into alloy-config ConfigMap)
├── configmap.yaml          # alloy-config — DEPLOY_ENVIRONMENT is overlay-patched
├── daemonset.yaml          # grafana/alloy:v1.9.2 + hostPath mounts + envFrom alloy-secrets
├── kustomization.yaml
└── rbac.yaml               # SA + ClusterRole + ClusterRoleBinding (subject ns is overlay-patched)

infra/k8s/overlays/{candidate-a,preview,production}/alloy/
└── kustomization.yaml      # per-env namespace + DEPLOY_ENVIRONMENT patch

infra/catalog/alloy.yaml    # type=agent entry — per-env ApplicationSets auto-generate one Argo App each

infra/k8s/secrets/{candidate-a,preview,production}/alloy-secrets.enc.yaml.example
                            # Secret shape for future ksops GitOps delivery (task.0311)
```

## Bootstrap — create the `alloy-secrets` Secret per cluster

Alloy reads seven keys from a Secret named `alloy-secrets` in the `cogni-{env}` namespace:

| Key                           | Source                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| `LOKI_WRITE_URL`              | Grafana Cloud → Connections → Data Sources → Loki (push URL)     |
| `LOKI_USERNAME`               | Loki data source "User"                                          |
| `LOKI_PASSWORD`               | Loki data source "Generate now" token (starts with `glc_`)       |
| `PROMETHEUS_REMOTE_WRITE_URL` | Grafana Cloud → Connections → Data Sources → Prometheus push URL |
| `PROMETHEUS_USERNAME`         | Prometheus data source "User"                                    |
| `PROMETHEUS_PASSWORD`         | Prometheus data source "Generate now" token                      |
| `METRICS_TOKEN`               | Same bearer token the app expects on `/api/metrics` (per-env)    |

### Interim path (v0): manual `kubectl create secret`

ksops is wired into Argo CD repo-server as a CMP plugin but has never been end-to-end activated — `.sops.yaml` still holds placeholder age keys, and no real encrypted file is in git. Until that one-time bootstrap happens (task.0311), the `alloy-secrets` Secret is created imperatively per cluster.

**candidate-a** (SSH explicitly authorized for this env):

```bash
# From your workstation, targeting the candidate-a VM
ssh root@<candidate-a-vm-ip> \
  "kubectl -n cogni-candidate-a create secret generic alloy-secrets \
    --from-literal=LOKI_WRITE_URL='https://logs-prod-us-central1.grafana.net/loki/api/v1/push' \
    --from-literal=LOKI_USERNAME='123456' \
    --from-literal=LOKI_PASSWORD='glc_REPLACE_ME' \
    --from-literal=PROMETHEUS_REMOTE_WRITE_URL='https://prometheus-prod-01-us-central1.grafana.net/api/prom/push' \
    --from-literal=PROMETHEUS_USERNAME='123456' \
    --from-literal=PROMETHEUS_PASSWORD='glc_REPLACE_ME' \
    --from-literal=METRICS_TOKEN='REPLACE_WITH_APP_METRICS_TOKEN'"
```

**preview** and **production**: do NOT use the manual SSH path. See the rollout plan below.

### Target path: ksops GitOps delivery

The file shape is in place at `infra/k8s/secrets/{candidate-a,preview,production}/alloy-secrets.enc.yaml.example`. Activation is covered by [task.0311](../../work/items/task.0311.ksops-activate-alloy-secrets.md):

1. `age-keygen` per env
2. Install private keys into each cluster's `argocd/sops-age-key` Secret (one-time SSH)
3. Replace placeholder keys in `.sops.yaml` with real public keys
4. `sops --encrypt` each env's file
5. Wire the `.enc.yaml` into each overlay's `kustomization.yaml` as a resource
6. Delete the manual bootstrap section from this guide

The long-term target (per [task.0284](../../work/items/task.0284-secrets-single-source-eso.md)) is **External Secrets Operator**, not ksops. Do not invest in ksops automation beyond what task.0311 requires.

## Rollout plan

Three envs, three phases. Do not batch — validate each env end-to-end before moving to the next.

### Phase 1 — candidate-a (unblocked now)

| Step                                                                       | Action                                        | Success signal                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Merge this PR to `main`                                                 | GitHub                                        | PR green, merged                                                          |
| 2. `candidate-a` ApplicationSet generates `candidate-a-alloy`              | Argo CD auto-sync                             | `kubectl -n argocd get app candidate-a-alloy` shows Synced/Missing-Secret |
| 3. SSH to candidate-a VM and run the `kubectl create secret` command above | One-time manual bootstrap                     | `kubectl -n cogni-candidate-a get secret alloy-secrets`                   |
| 4. DaemonSet reconciles                                                    | Automatic (Argo)                              | `kubectl -n cogni-candidate-a get ds alloy` → Ready 1/1                   |
| 5. Verify data in Grafana Cloud                                            | Grafana Cloud UI — see **Verification** below | `up{env="candidate-a"}` returns ≥4 targets all =1                         |

### Phase 2 — preview (gated on Phase 1 green for ≥1 hour)

Preview must NOT get the same manual SSH treatment long-term. Two options:

**Option 2A — fast path (recommended for v0):** repeat the Phase 1 steps for preview (one-time SSH + `kubectl create secret`). Accept that this is a second manual bootstrap and track it on the CI/CD scorecard row #16. Same runbook as candidate-a, with `-n cogni-preview` and the preview VM IP.

**Option 2B — delay until task.0311 ships:** hold preview until ksops is activated end-to-end. Pod logs and metrics for preview remain dark until then.

The user's call. I recommend 2A — one more SSH action costs ~2 minutes and unblocks preview observability immediately. The scorecard red line already tracks the gap.

### Phase 3 — production (gated on Phase 2 green for ≥24 hours)

Production should **not** get manual SSH secret bootstrap. By the time production is ready, one of the following should be true:

1. **task.0311 has shipped** — ksops is end-to-end wired. Deploy production via the encrypted `alloy-secrets.enc.yaml` in git. Zero SSH, zero manual steps.
2. **task.0284 (ESO) is in progress** — use ESO instead of ksops. `ExternalSecret` CRD syncs from the secret store.

If you're forced to ship production observability before either task lands, document the exception explicitly in the PR description, flip scorecard row #16 from RED to BLACK (regression), and file a remediation task.

## Deploy via Argo CD — what happens after merge

```bash
# List alloy Applications per env (run in each env's cluster)
kubectl -n argocd get applications -l argocd.argoproj.io/application-set-name=cogni-candidate-a
kubectl -n argocd get applications -l argocd.argoproj.io/application-set-name=cogni-preview
kubectl -n argocd get applications -l argocd.argoproj.io/application-set-name=cogni-production

# Watch the DaemonSet
kubectl -n cogni-candidate-a get ds alloy -w
kubectl -n cogni-candidate-a logs -l app.kubernetes.io/name=alloy --tail=100
```

Known benign noise: the `canary` ApplicationSet will try to generate `canary-alloy` but fail because this PR intentionally does **not** include a `canary/alloy` overlay (canary is being purged per the CI/CD spec). That broken Application is localized — it does not affect other `canary-*` services. It disappears when the canary ApplicationSet is retired in a separate cleanup PR.

## Verification — is health data flowing?

Once the DaemonSet is Running and the Secret is in place, all three data paths should light up within ~60 seconds.

**1. Alloy component health — from inside the cluster:**

```bash
kubectl -n cogni-candidate-a port-forward daemonset/alloy 12345:12345
# Open http://127.0.0.1:12345 — every component should show "Healthy".
# Red = auth failed or config error.
```

**2. Grafana Cloud — Prometheus (Mimir) side:**

```promql
up{env="candidate-a"}                                                              # 4+ targets, all =1
container_cpu_usage_seconds_total{env="candidate-a", pod=~"operator-.*"}           # CPU per operator pod
http_requests_total{env="candidate-a", service=~"operator|poly|resy"}              # app-level HTTP metrics
ai_llm_cost_usd_total{env="candidate-a"}                                           # LLM spend per env
```

**3. Grafana Cloud — Loki side:**

```logql
{env="candidate-a", app="cogni-template"}                                # pod logs
{env="candidate-a", source="journald"}                                   # host systemd logs
{env="candidate-a", source="journald", unit=~"k3s.*|containerd.*"}       # k3s + containerd only
```

If `up{job="app_metrics"}=0`, the scrape against `/api/metrics` is failing. Fix the `METRICS_TOKEN` value in the Secret and restart the Alloy DaemonSet.

## Troubleshooting

| Symptom                                          | Likely cause                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `CrashLoopBackOff` on alloy pod                  | Missing `alloy-secrets` Secret. Run the Phase 1 bootstrap command.                                                                   |
| Pod Running but no metrics in Grafana            | Wrong `PROMETHEUS_REMOTE_WRITE_URL` or expired API key. Check the Alloy UI (port-forward above).                                     |
| `up{job="app_metrics"}=0`                        | `METRICS_TOKEN` wrong, or the target pods don't carry `app.kubernetes.io/component=node` + `app.kubernetes.io/part-of=cogni` labels. |
| No journald logs                                 | Host uses `/run/log/journal` only. Both paths are mounted — check `loki.source.journal` component status in the Alloy UI.            |
| Kubelet cAdvisor scrape 403                      | RBAC not applied. `kubectl -n cogni-candidate-a get clusterrolebinding alloy` must exist and reference the right SA namespace.       |
| `canary-alloy` Argo App stuck on ComparisonError | Expected — see "Known benign noise" above. Not a regression.                                                                         |

## Label cardinality policy

**Low-cardinality labels** (kept):

- `env` — `candidate-a | preview | production`
- `service` — `operator | poly | resy | scheduler-worker | alloy` (derived from pod instance label)
- `namespace` — `cogni-candidate-a | cogni-preview | cogni-production`
- `container` — container name from the pod spec
- `pod` — pod name (bounded by replica count)
- `stream` — `stdout | stderr`
- `unit` — systemd unit (journald)
- `node` — k8s node name
- `app` — `cogni-template` (static)

**High-cardinality fields** (query via `| json`, never as labels):

- `reqId`, `userId`, `billingAccountId`, `attemptId` — unbounded per request
- `route`, `status` — use `| json | route=~"..."`

**Rationale**: Loki indexes labels; high-cardinality labels destroy query performance. Cogni-template stays well under 100 unique values per label.

## Related

- [CI/CD Pipeline Spec](../spec/ci-cd.md) — trunk-based model, candidate-a semantics, environment model
- [Observability Spec](../spec/observability.md) — structured logging, tracing, event schemas
- [Observability Hardening Project](../../work/projects/proj.observability-hardening.md)
- [task.0311 — Activate ksops for alloy-secrets](../../work/items/task.0311.ksops-activate-alloy-secrets.md)
- [task.0284 — Secrets single source of truth via ESO](../../work/items/task.0284-secrets-single-source-eso.md)
- [Alloy reference — loki.source.journal](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.journal/)
- [Alloy reference — discovery.kubernetes](https://grafana.com/docs/alloy/latest/reference/components/discovery/discovery.kubernetes/)
