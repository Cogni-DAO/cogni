---
id: spec.substrate-access-grant
type: spec
title: Substrate Access-Grant Plane
status: draft
trust: draft
summary: How an external node developer, on a `developer` RBAC grant for node X, gains permissioned READ access to node X's observability substrates (Grafana/Loki, PostHog, DB) WITHOUT seeing other nodes and WITHOUT the operator proxying queries. Splits substrates into runtime (operator→pod, secrets plane) vs developer-observability (dev←operator-issued); per-node isolation feasibility differs by each substrate's native primitive. v0 issues the shared env Grafana token; vNext issues per-principal node-scoped credentials.
read_when: Designing how a dev/agent gains access to a node's logs/analytics/DB; adding a substrate to the access-grant fan-out; deciding whether the operator issues vs proxies a credential; assessing per-node isolation feasibility for a substrate; reviewing the developer-grant route or `node.yaml` substrate declarations.
implements: []
owner: derekg1729
created: 2026-06-16
verified: 2026-06-16
tags:
  - secrets
  - observability
  - rbac
  - node-formation
  - multi-tenancy
---

# Substrate Access-Grant Plane

## Why this exists

The product is the **external node developer workflow**: a dev (human or agent) is granted `developer`
on node X and must be able to **debug node X** — read its logs, analytics, and operational data — **without
Derek handholding** and **without seeing node Y**. Today the grant writes only an OpenFGA tuple; it
provisions **no substrate credential**, so every dev's observability access bottoms out in Derek pasting a
shared token. This spec defines the plane that closes that gap, aligned with the BaaS invariant from
[`node-baas-architecture.md`](./node-baas-architecture.md): **node declares shape; operator wires environment.**

## The two access axes (do not conflate them)

A flat list of substrates (Temporal, Grafana, PostHog, LiteLLM…) hides that they sit on **two different
planes**:

| Axis                        | Flows                                                            | Substrates                                                                   | Status                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime substrate**       | operator → pod (the node's app consumes it)                      | LiteLLM virtual key, Temporal _connection_, DSN-write, `SCHEDULER_API_TOKEN` | the **secrets plane** ([`cicd-secrets-expert`](../../.claude/skills/cicd-secrets-expert/SKILL.md)) — a dev never "requests access" |
| **Developer-observability** | dev ← operator-**issued** (the human/agent consumes it to debug) | Grafana/Loki read, PostHog read, read-only DB                                | **this plane** — the new access-grant fan-out                                                                                      |

LiteLLM is **runtime**: a dev sees their node's LLM _cost_ via Grafana/PostHog, not by holding a LiteLLM
key. It is **out of scope** for the grant plane (its per-node isolation — a per-node virtual key + team +
budget — is a secrets-plane concern).

## Per-node isolation feasibility matrix

Isolation is **not uniform** — each substrate's **native** primitive decides whether per-node read scoping
is even possible. Grounded 2026-06-16:

| Substrate           | Per-node isolation primitive                                                                             | Feasible today?               | What's required                                                                                                                                                                                                                                               | Owner                             |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Loki / Grafana**  | Grafana Cloud **access policy** with `labelPolicies: {node="X"}` + `logs:read`, minted as a `glc_` token | ⚠️ **blocked on a label**     | (1) add a `node` **stream label** in Alloy + pino (today: `app/env/service` only; node id is only in the `pod` prefix); (2) mint label-scoped read-only `glc_` per dev — `provision-grafana-cloud-mint.sh` already POSTs the exact API with an empty selector | this plane                        |
| **Postgres (read)** | per-node DB `cogni_<node>` + a per-node read-only role                                                   | ✅ **trivial**                | add `app_<node>_readonly` to the existing per-node provision loop (the per-node DB already exists; today's `app_readonly` is **one shared BYPASSRLS role across all DBs** — a cross-node leak)                                                                | this plane                        |
| **PostHog**         | **Project** per node (the hard data-isolation boundary)                                                  | ✅ but split mint             | admin programmatically grants project-X read (default "No access" elsewhere) via the roles/access-control API; **the read key is dev-self-minted or OAuth-consent** — PostHog has no admin-mint-on-behalf and no service-account construct                    | this plane + dev step             |
| **Temporal**        | **Namespace** (Temporal's only authz/visibility unit)                                                    | ❌ **needs substrate change** | Cogni shares ONE `cogni-<env>` namespace across all nodes; task-queue-per-node (`scheduler-tasks-<nodeId>`) is throughput, **not** authz. Clean fix = **one namespace per node**. A custom authorizer fork leaks `List`/visibility.                           | **substrate dev, not this plane** |
| **LiteLLM**         | per-node virtual key + team + budget                                                                     | n/a (runtime)                 | secrets-plane concern; dev observes cost via Grafana/PostHog                                                                                                                                                                                                  | secrets plane                     |

**Key correction baked into this matrix:** a Grafana **Viewer `glsa_`** (the credential the prior spec
draft handed devs) is role-scoped and **cannot** carry a label policy — it is full-read forever. Per-node
isolation requires a **label-scoped `glc_` access-policy token**. See
[`grafana-observability-access.md`](./grafana-observability-access.md).

## Current-health scorecard

Confidence is low by design — this plane is barely built. Re-grade as each rung ships and is proven on a
real env.

| Rung                                       | Health | Existing workflow                                                                  | New workflow needed                                                                                                       |
| ------------------------------------------ | ------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| RBAC `developer` grant (the fan-out hook)  | 🟢     | `POST /api/v1/nodes/{id}/developers` + OpenFGA `node.developer`/`can_flight`       | — (grant fires; substrate fan-out is what's missing)                                                                      |
| Grafana **v0** issuance (shared env token) | 🟡     | `GET /api/v1/nodes/{id}/observability-token` (task.5025, ships graceful-`unwired`) | ESO wire of `_shared/{GRAFANA_URL,GRAFANA_SERVICE_ACCOUNT_TOKEN}` → operator pod (`GRAFANA_VIEWER_TOKEN`) to flip it live |
| Grafana **vNext** per-node isolation       | 🔴     | `provision-grafana-cloud-mint.sh` (access-policy + token API, empty selector)      | (1) `node` Loki stream label in Alloy + pino; (2) per-principal label-scoped `glc_` mint + delivery                       |
| Postgres read isolation                    | 🔴     | per-node DB + `app_<node>` write roles exist (`postgres-init/provision.sh`)        | per-node `app_<node>_readonly` role (trivial loop add); issue scoped read DSN on grant                                    |
| PostHog per-node read                      | 🔴     | PostHog Cloud (one project today)                                                  | project-per-node + admin grant via access-control API + dev self-mint / OAuth consent                                     |
| Temporal per-node read                     | 🔴     | shared `cogni-<env>` namespace; per-node task queue                                | **per-node namespace** (substrate change) — tracked on the substrate dev, not here                                        |

🔴 leads because **only the RBAC hook is green**; every substrate credential the grant should fan out to is
unbuilt or env-wide. Real confidence needs weeks of green node spawns proving the fan-out per env.

## Architecture — a grant-event fan-out, not a token broker

The reusable abstraction is the **grant _event_ + per-node _scope_**, NOT a shared token-broker port. A
generic `ObservabilityTokenBroker` would be the wrong abstraction: Grafana is admin-minted, PostHog is
dev-self-minted, Temporal can't isolate, LiteLLM is runtime — each uses its **native** primitive. So:

- The node **declares** which observability substrates it emits to (`.cogni/node.yaml`).
- On a `developer` grant (the existing `POST /nodes/{id}/developers` tuple write), the operator **issues**
  per-principal, per-node-scoped READ credentials for each declared substrate, using that substrate's
  native primitive, and delivers them to the dev's own session/`.env.cogni`.
- The operator is an **ISSUER** (one RBAC-gated act at grant time), **never a query PROXY** (the dev
  queries the substrate directly). This is the node-self-serve-secrets triangle, one plane over:
  `developer → can_flight → operator-issued read credential`.

This is a new row in the [BaaS Substrate Map](./node-baas-architecture.md#baas-substrate-map):
**Observability Access** — _node declares which substrates it emits to; operator issues per-principal,
per-node-scoped read credentials on `developer` grant._

## Sequencing (Pareto)

1. **Grafana v0** — ship the issuance route (done, task.5025) + the ESO wire to flip it live. Eliminates
   handholding for trusted devs immediately. Gated by the breach-line above.
2. **`node` Loki stream label** (Alloy + pino) — unsexy, but gates _all_ Grafana isolation. Nothing
   per-node works without it.
3. **`app_<node>_readonly` role** — trivial loop add; instant per-node DB-read isolation.
4. **Grafana vNext** — per-principal label-scoped `glc_` mint + delivery, replacing v0's shared token.
5. **PostHog project-per-node** + admin grant + dev self-mint — when analytics matters.
6. **Temporal per-node namespace** — a substrate-dev dependency on `story.5006`; explicitly **not**
   solvable by this plane (namespace is Temporal's only isolation unit and is shared today).

## See also

- [`grafana-observability-access.md`](./grafana-observability-access.md) — Grafana issuer-vs-proxy, v0/vNext credential shapes
- [`node-baas-architecture.md`](./node-baas-architecture.md) — BaaS substrate map + "node declares shape; operator wires environment"
- [`rbac.md`](./rbac.md) — OpenFGA `node.developer`/`can_flight`, the grant→approve loop
- [`docs/design/node-self-serve-secrets.md`](../design/node-self-serve-secrets.md) — the issuer triangle this mirrors
- [`.claude/skills/cicd-secrets-expert/SKILL.md`](../../.claude/skills/cicd-secrets-expert/SKILL.md) — runtime-substrate secrets plane (the other axis)
- `nodes/operator/app/src/features/nodes/observability-access.ts` + `.../api/v1/nodes/[id]/observability-token/route.ts` — v0 issuance
