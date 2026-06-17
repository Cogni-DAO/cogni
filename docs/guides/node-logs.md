---
id: guide.node-logs
type: guide
title: Read Your Node's Logs (Grafana / Loki)
status: draft
trust: draft
summary: How a node developer reads their own node's app logs in Grafana Cloud Loki — today via the shared read-only Viewer token + a node-scoped LogQL query, and (soon) via the operator's tokenless node-pinned proxy. Names the exact credential, where it lives, and copy-paste queries.
read_when: You are a node developer (human or agent) who needs to see your node's runtime logs, debug a 500/hang, or confirm a deploy is healthy, and you do not have a Grafana login.
owner: derekg1729
created: 2026-06-17
verified: 2026-06-17
tags:
  - observability
  - grafana
  - nodes
---

# Read Your Node's Logs (Grafana / Loki)

Your node's app ships structured logs to **Grafana Cloud Loki**. There are two ways in.

## TL;DR

```bash
# 1. Put two values in ./.env.cogni (get them from your node operator — see "The credential" below):
#    GRAFANA_URL=https://<your-org>.grafana.net
#    GRAFANA_SERVICE_ACCOUNT_TOKEN=glsa_xxx        # read-only Viewer token

# 2. Query YOUR node's logs (replace the nodeId with your repo-spec node_id):
scripts/loki-query.sh '{env="production",service="app",node="<your-nodeId>"} | json | level="error"' 60 100 | jq
```

`scripts/loki-query.sh` auto-sources `./.env.cogni` (and `./.env.canary` / `./.env.local`), so once the two values are present you just run it.

## The credential — what and where

|                              |                                                                                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What**                     | `GRAFANA_URL` + `GRAFANA_SERVICE_ACCOUNT_TOKEN` — a **read-only Viewer** service-account token (`glsa_…`, scopes `datasource:read` + `logs:read`).                                                                      |
| **Where it's authoritative** | OpenBao `cogni/<env>/_shared/{GRAFANA_URL,GRAFANA_SERVICE_ACCOUNT_TOKEN}` (the env's shared Viewer, minted at provision time — `spec.grafana-observability-access`).                                                    |
| **How you get it**           | From your **node operator** (out-of-band) or your env provisioning. Paste it into your own `./.env.cogni`. It is read-only — it cannot write, deploy, or mint.                                                          |
| ⚠️ **Scope caveat**          | This shared Viewer token is **env-wide**: it can read _every_ node's logs in that env, not just yours. It is handed only to trusted node developers. The per-node-isolated, tokenless path is the operator proxy below. |

## Find your nodeId

Your node identity is the `node_id` in your repo's `.cogni/repo-spec.yaml` (a UUID). Every app log line carries it as the `nodeId` JSON field, and (since task.5028) it is a Loki **stream label** named `node`.

```bash
grep node_id .cogni/repo-spec.yaml
```

## Copy-paste queries (production)

```bash
# All errors from your node in the last hour
scripts/loki-query.sh '{env="production",service="app",node="<your-nodeId>"} | json | level="error"' 60 100 | jq -r '.data.result[].values[][1]'

# A specific request by reqId
scripts/loki-query.sh '{env="production",service="app",node="<your-nodeId>"} | json | reqId="<id>"' 60 50 | jq

# Is my node even up? (startup / crash lines, no symptom filter — look top-down)
scripts/loki-query.sh '{env="production",service="app",node="<your-nodeId>"} |~ "EnvValidation|panic|unhandled|started|ready"' 30 100 | jq
```

> **Before task.5028 reaches an env** (the `node` label needs an infra-lever deploy), fall back to the pod-name prefix:
> `{env="production",service="app",pod=~"<your-slug>-node-app-.*"}`. Once the env has the label, prefer `node="<nodeId>"` — it is exact, not a prefix guess.

Available JSON fields (`| json | …`): `reqId`, `userId`, `level`, `msg`, `event`, `durationMs`, `errorCode`, `route`, `status`. Labels: `env`, `service`, `node`, `stream`.

## The durable path — operator proxy (tokenless, node-scoped)

Holding the shared token works but is env-wide. The product path is the operator **proxy**: you authenticate with your **Cogni API key** (the one you already have), the operator checks you have the `developer` role on your node, runs your LogQL **server-side pinned to `{node="<your-nodeId>"}`**, and returns only your node's lines. **You hold no Grafana token**, and you cannot see another node.

```
GET https://cognidao.org/api/v1/nodes/{yourNodeIdOrSlug}/observability/logs
Authorization: Bearer <your COGNI_API_KEY>
```

Status: the gate ships (developer-RBAC; returns `503 observability_proxy_not_built` until the query path lands). See `spec.grafana-observability-access` and `spec.substrate-access-grant`.

## See also

- `.claude/commands/logs.md` — the operator-side deep guide (MCP path, CI logs, top-down debugging recipes)
- `scripts/loki-query.sh` — the curl helper this guide uses
- `docs/spec/grafana-observability-access.md` · `docs/spec/substrate-access-grant.md`
