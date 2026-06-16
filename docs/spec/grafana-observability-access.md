# Grafana / Loki Observability Access

**Decision (2026-06-16):** the operator control plane does **NOT** hold a Grafana query token, and the
API is **NOT** a Grafana proxy. Observability querying is a **read-only credential granted directly to
the consumer**, because the space of future LogQL / dashboard / datasource queries is open-ended and
proxying it through typed API routes would never converge.

## The one root, three consumers

Provisioning demands **one** human input — the Grafana Cloud **admin** token (`GH_GRAFANA_URL` +
admin token, `fork-quickstart.md` §6). Phase 5e (`provision-grafana-cloud-mint.sh`) uses it to mint
**derived, scoped** credentials — never the admin token itself leaves the runner. From that one root:

| consumer                       | credential                                            | where it lives                                                    | who/what queries                                                           |
| ------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Validator / CI**             | child **Viewer** SA `glsa_` (read: datasource + logs) | `cogni/<env>/_shared/{GRAFANA_URL,GRAFANA_SERVICE_ACCOUNT_TOKEN}` | `/validate-candidate` scorecard, `scripts/loki-query.sh`, agent self-trace |
| **Alloy push**                 | access-policy `glc_` (write: metrics/logs)            | VM `.env` (Compose)                                               | Alloy remote-write only                                                    |
| **Devs / agents (open-ended)** | per-principal Viewer `glsa_`, RBAC-granted            | the dev's own `.env.cogni` / session                              | anything — ad-hoc LogQL, dashboards, datasource introspection              |

**The admin token can spawn any of these on demand** — so a new dev/agent who needs Grafana gets a
_direct_ read-only token (grant via RBAC, mint a per-principal Viewer SA), **not** a new API route.

## Why the operator holds no token

The operator's `assertLive` gate (`task.5024`, `src/features/nodes/flight-status.ts`) verifies a node
is live across five rungs, but **liveness is proven by the two PUBLIC rungs** — `serving` (`/readyz`)
and `run-carries` (a real graph run completes). **`run-carries` transitively proves the Loki rungs:** a
completed run means the scheduler-worker polled `scheduler-tasks-<nodeId>` (routing), the
`SCHEDULER_API_TOKEN` matched (no 401 — `bug.5021`), the graph executed, and the run was written to the
DB. So the gate needs **no** Grafana token.

The three Loki rungs (`log-in-Loki`, `doltgres-exists`, `worker-carries-UUID`) are
**diagnostics + observability-completeness**, not gate requirements. They are **injectable**: a caller
that _does_ hold a read token (`/validate-candidate`, CI) constructs the prober with a `LokiConfig` and
lights them up; the operator pod injects none, so they `skip` (`loki-unwired`) and **never block** the
verdict. They block **only** on an explicit `fail` — a token present and logs genuinely absent — so a
real observability gap is still loud (no silent pass).

**Anti-pattern:** wiring `cogni/<env>/_shared/GRAFANA_SERVICE_ACCOUNT_TOKEN` into the operator pod's
ExternalSecret to make `assertLive` self-query Loki. That turns the control plane into a Grafana proxy
for a verdict it already gets publicly. Don't.

## See also

- `fork-quickstart.md` §6 (Phase 5e mint), `infra/secrets-catalog.yaml` (`GRAFANA_*` = `service: _shared`)
- `docs/spec/secrets-classification.md` (tier/routing), `.claude/skills/cicd-secrets-expert/SKILL.md`
- `nodes/operator/app/src/features/nodes/flight-status.ts` (`assertLive`), `task.5024`
