---
id: task.0083
type: task
title: Governance health brief endpoint — replace broken queries.sh with app-served health data
status: needs_design
priority: 0
estimate: 3
summary: Build a server-side health brief endpoint that queries Prometheus + Loki via existing ports, replacing the broken shell-based queries.sh that the OpenClaw governance agent currently uses.
outcome: Governance agent receives accurate, structured health data via a single API call instead of shelling out curl commands that silently return empty results.
spec_refs: governance-status-api, observability
assignees: cogni-dev
credit:
project: proj.system-tenant-governance
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-17
labels: [governance, observability, health]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 16
---

# Governance Health Brief Endpoint

## Context

The OpenClaw governance agent runs a `deployment-health` skill that shells out `queries.sh` — a bash script curling Grafana Cloud APIs. Investigation on 2026-02-17 found this is fundamentally broken:

- **Trailing slash in GRAFANA_URL** causes double-slash → 301 redirect → silent empty results
- **Wrong Loki proxy path** (`/resources/` vs `/proxy/uid/`)
- **LogQL `level >= 40`** fails because level is a string, not numeric
- **cAdvisor metrics don't exist** in Grafana Cloud (all zeros)
- **Provider label shows "litellm"** not actual provider
- **No error enumeration** — counts aren't actionable for an AI agent

Meanwhile, the app already has working infrastructure:

- `get-governance-status.ts` queries DB for balance + runs (working)
- `MetricsQueryPort` + `MimirMetricsAdapter` query Prometheus (working — confirmed $0.0018 cost, 2169 tokens via MCP)
- Loki logs contain rich error patterns (confirmed 6+ distinct error types via MCP)

## Requirements

- A new feature service `get-health-brief.ts` that produces a structured health brief
- Queries Prometheus via existing `MetricsQueryPort` for: LLM cost, token count, LLM error count, HTTP error rates
- Queries Loki via a new `LogQueryPort` for: error/warn log counts by service, top N distinct error messages
- Exposed at `GET /api/v1/governance/health` (auth required, same pattern as `/status`)
- Response is a single JSON object the governance agent can consume directly
- The OpenClaw `deployment-health` skill is updated to call this endpoint instead of running `queries.sh`
- Per HEXAGONAL_ARCHITECTURE: feature service calls ports only, never imports adapters

## Allowed Changes

- `src/ports/log-query.port.ts` — new port for Loki queries
- `src/adapters/server/metrics/loki.adapter.ts` — new Loki adapter
- `src/features/governance/services/get-health-brief.ts` — new feature service
- `src/contracts/governance.health.v1.contract.ts` — Zod contract
- `src/app/api/v1/governance/health/route.ts` — route handler
- `src/adapters/server/metrics/mimir.adapter.ts` — may need new template queries
- `.openclaw/skills/deployment-health/SKILL.md` — update to call API
- `.openclaw/skills/deployment-health/queries.sh` — deprecate or delete
- Test files for the above

## Plan

- [ ] **Define LogQueryPort** — minimal interface: `queryErrorCounts(env, window)` and `queryTopErrors(env, window, limit)`. No raw LogQL exposure. Template-only, matching MetricsQueryPort pattern.
- [ ] **Implement GrafanaLokiAdapter** — HTTP client to Grafana Cloud Loki proxy. Uses `GRAFANA_URL` + `GRAFANA_SERVICE_ACCOUNT_TOKEN` env vars. Handles trailing slash normalization and correct proxy path.
- [ ] **Add health metric templates to MimirMetricsAdapter** — templates for `llm_cost`, `llm_tokens`, `llm_errors`, `http_error_rate`. These are `queryInstant` wrappers with governed PromQL.
- [ ] **Define Zod contract** `governance.health.v1` — response shape with sections: aggregate metrics, http errors, log errors. No container health (cAdvisor not available).
- [ ] **Build feature service** `get-health-brief.ts` — orchestrates MetricsQueryPort + LogQueryPort in parallel via `Promise.all`. Returns structured `HealthBrief`.
- [ ] **Wire route** `GET /api/v1/governance/health` — auth required, calls feature service, returns JSON.
- [ ] **Update OpenClaw skill** — `SKILL.md` instructions say "call `GET /api/v1/governance/health`" instead of running `queries.sh`. Keep `queries.sh` as deprecated fallback.
- [ ] **Write tests** — unit test for feature service with mocked ports. Contract test for route. Integration test for adapters if Grafana creds available in test env.

## Validation

**Command:**

```bash
pnpm check
pnpm test src/features/governance/services/get-health-brief.test.ts
pnpm test src/adapters/server/metrics/loki.adapter.test.ts
```

**Expected:** All tests pass, no type errors.

**Manual validation:**

```bash
# With dev:stack running and .env.local loaded:
curl -s http://localhost:3000/api/v1/governance/health -H "Cookie: <session>" | jq .
```

Expected: JSON with non-zero LLM cost/tokens, accurate error counts.

## Design Notes

### Why an app endpoint, not a shell script?

| Approach                           | Pros                                                                         | Cons                                                                                   | Verdict    |
| ---------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------- |
| `queries.sh` (curl from container) | No app changes                                                               | Fragile URL construction, silent failures, no types, agent can't use structured output | **Reject** |
| App endpoint via ports             | TypeScript types, proper error handling, testable, reusable for UI dashboard | Requires new port + adapter                                                            | **Use**    |
| MCP tools from gateway             | Rich query capability                                                        | Gateway container doesn't have MCP server; would need new infra                        | Defer      |

### What NOT to include (scope boundary)

- No CloudEvents / signal ingestion (that's the overengineered `ai-governance-data.md` path — defer)
- No incident routing or brief generation pipelines
- No cAdvisor container metrics (not shipping to Grafana Cloud — separate infra task)
- No Temporal orchestration — this is a simple request/response endpoint
- No historical trending — just current window (1h default)

## Review Checklist

- [ ] **Work Item:** `task.0083` linked in PR body
- [ ] **Spec:** HEXAGONAL_ARCHITECTURE upheld (ports only in feature service)
- [ ] **Spec:** GOVERNED_METRICS upheld (template queries only, no raw PromQL in feature layer)
- [ ] **Spec:** CONTRACT_FIRST upheld (Zod contract defined before implementation)
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
