---
id: spec.grafana-observability-access
type: spec
title: Grafana / Loki Observability Access
status: draft
trust: draft
summary: How Grafana/Loki query credentials are granted across Cogni — one provisioned admin root mints scoped consumers (validator/CI `_shared` Viewer, Alloy push, per-dev RBAC tokens). The operator is a credential ISSUER, never a query PROXY, and holds no query token for its own gate. v0 issues the shared env Viewer token on developer-RBAC grant (env-wide, not node-scoped); vNext issues per-principal label-scoped `glc_` tokens for per-node isolation.
read_when: Wiring or debating whether the operator/API should hold a Grafana token; granting a dev/agent Loki query access; designing an automated observability gate; reviewing an ExternalSecret that pulls a GRAFANA_* key into a pod; deciding between a Viewer `glsa_` and a label-scoped `glc_` token.
owner: derekg1729
created: 2026-06-16
verified: 2026-06-16
tags:
  - secrets
  - observability
  - grafana
---

# Grafana / Loki Observability Access

**Decision (2026-06-16):** the operator is a Grafana credential **ISSUER**, not a query **PROXY**.
Observability querying is a **read-only credential held directly by the consumer**, because the space
of future LogQL / dashboard / datasource queries is open-ended and proxying it through typed API routes
would never converge. The operator may **issue** a credential at grant time (a one-time, RBAC-gated act);
it must never **proxy** a query (intercept every LogQL on the consumer's behalf).

> **Issuer vs proxy — the load-bearing distinction.** A grant-time "mint/hand the dev a read token"
> route is an **issuer** and is sanctioned (it is the same shape as the node-self-serve-secrets triangle,
> `developer → can_flight → operator-held credential → one action`). A route that takes a dev's LogQL,
> runs it with an operator-held token, and returns rows is a **proxy** and is rejected. Earlier wording
> here said "**not a new API route**" — read that as "**not a query-proxy route**." An issuance route is fine.

## The one root, many consumers

Provisioning demands **one** human input — the Grafana Cloud **admin** token (`GH_GRAFANA_CLOUD_ADMIN_TOKEN`
`glc_*` + `GRAFANA_URL`, `fork-quickstart.md` §6). Phase 5e (`scripts/setup/provision-grafana-cloud-mint.sh`)
uses it to mint **derived, scoped** credentials — the admin token never leaves the runner (Invariant 13:
never written to OpenBao, never reaches the VM). From that one root:

| consumer                  | credential                                                | where it lives                                                    | who/what queries                                                           |
| ------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Validator / CI**        | child **Viewer** SA `glsa_` (read: datasource + logs)     | `cogni/<env>/_shared/{GRAFANA_URL,GRAFANA_SERVICE_ACCOUNT_TOKEN}` | `/validate-candidate` scorecard, `scripts/loki-query.sh`, agent self-trace |
| **Alloy push**            | access-policy `glc_` (write: metrics/logs)                | VM `.env` (Compose)                                               | Alloy remote-write only                                                    |
| **Devs / agents — v0**    | the **shared** env Viewer `glsa_`, ISSUED on RBAC grant   | the dev's own `.env.cogni` / session                              | anything — ad-hoc LogQL, dashboards. **Env-wide: sees every node's logs.** |
| **Devs / agents — vNext** | per-principal **label-scoped** `glc_` access-policy token | the dev's own `.env.cogni` / session                              | only their granted nodes' logs (`{node="X"}`), read-only                   |

**The admin token can spawn any of these on demand.** A new dev/agent who needs Grafana gets a **direct**
read-only token (the operator issues it after an RBAC check, or the provision lane mints it); the dev then
queries Grafana **directly**. The operator does not stand between the dev and Grafana for queries.

## v0 vs vNext — the credential the dev holds

### v0 (shipped, task.5025) — issue the shared env Viewer token

On a `developer` grant (the `node.flight` tuple), the operator **issues** the env's existing `_shared`
Viewer `glsa_` + `GRAFANA_URL` via `GET /api/v1/nodes/{id}/observability-token` (developer-RBAC-gated,
fail-closed, returns 503 `observability_unwired` until ESO wires the token into the operator pod). The dev
puts it in their `.env.cogni` and queries Loki directly.

🔴 **The v0 breach-line — state it, don't hide it.** The shared Viewer token is **read-only but NOT
node-scoped**: it can query **every** node's logs in the env. v0 is acceptable **only while every node
developer is Cogni-trusted**. The **written trigger** to vNext is _"the first external node developer not
cleared to see another node's data."_ Below that line v0 ships; above it, v0 is a cross-node data leak.

> The operator pod holding the `_shared` Viewer token to **issue** it is NOT the anti-pattern below — that
> anti-pattern is about the **gate self-querying**. Issuance ≠ self-query. Keep the issuance token in a
> distinct env var (`GRAFANA_VIEWER_TOKEN`) so the liveness gate is never tempted to query with it.

### vNext — per-principal, label-scoped, per-node isolation

The dev's token must become a **label-scoped Grafana Cloud access-policy `glc_` token**, NOT a Viewer
`glsa_`. **A Viewer `glsa_` is role-scoped (Viewer/Editor/Admin) and CANNOT carry a label policy — so it
can never isolate node X from node Y.** Per-node isolation requires:

1. **a `node` stream label on Loki** (today Alloy/pino label streams `app/env/service` only; node identity
   lives in the `pod` name prefix + a JSON field — there is nothing for a label policy to filter on); and
2. **a read-only access policy** `{ scopes: ["logs:read"], realms: [{ type: "stack", identifier: <stackId>,
labelPolicies: [{ selector: '{node="<nodeId>"}' }] }] }` with a `glc_` token minted on it, per principal.

`provision-grafana-cloud-mint.sh` already POSTs `/api/v1/accesspolicies` + `/api/v1/tokens` with the
admin root's `accesspolicies:write` scope — the only delta is a non-empty `labelPolicies` selector + the
read-only scope. The mint **trigger + delivery** (provision-time vs an operator-held scoped minter behind
the grant route) is the open vNext decision; both keep the operator out of the query path. See
[`docs/spec/substrate-access-grant.md`](./substrate-access-grant.md) for the cross-substrate plan.

## Why the operator's own gate holds no token

The operator's `flight-status` / `assertLive` gate (`task.5024`, `src/features/nodes/flight-status.ts`)
is **liveness-only**, proven by the two PUBLIC rungs — `serving` (`/readyz`) and `run-carries` (a real
graph run completes). **`run-carries` transitively proves the rest:** a completed run means the
scheduler-worker polled `scheduler-tasks-<nodeId>` (routing), the `SCHEDULER_API_TOKEN` matched (no 401 —
`bug.5021`), the graph executed, and the run was written to the DB. So the gate needs **no** Grafana token,
and the operator prober holds none.

Deeper **observability verification** (did the node's runs actually emit logs in Loki? is the worker
polling the UUID queue?) is a query against Loki, and querying belongs to whoever **directly** holds a
read token — the dev in `/validate-candidate`, or CI — **not** the operator's gate. The operator's only
role in that is to **issue** the dev a token (v0/vNext above), never to run the query.

**Anti-pattern:** wiring `cogni/<env>/_shared/GRAFANA_SERVICE_ACCOUNT_TOKEN` into the operator pod's
ExternalSecret **to make the liveness gate self-query Loki**. That turns the control plane into a Grafana
proxy for a verdict it already gets publicly, and a proxy never converges on the open-ended query space.
Don't. (Issuing a token to a dev is a different use and a distinct env var — see v0.)

## See also

- [`docs/spec/substrate-access-grant.md`](./substrate-access-grant.md) — the cross-substrate plane (Grafana/PostHog/DB/Temporal), health scorecard, sequencing
- `fork-quickstart.md` §6 (Phase 5e mint), `infra/secrets-catalog.yaml` (`GRAFANA_*` = `service: _shared`)
- `docs/spec/secrets-classification.md` (tier/routing), `.claude/skills/cicd-secrets-expert/SKILL.md`
- `nodes/operator/app/src/features/nodes/observability-access.ts` (v0 issuance), `.../api/v1/nodes/[id]/observability-token/route.ts`
- `nodes/operator/app/src/features/nodes/flight-status.ts` (`assertLive`), `task.5024`, `task.5025`
