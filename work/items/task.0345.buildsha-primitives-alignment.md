---
id: task.0345
type: task
title: "Align buildSha across /readyz, /api/metrics, .well-known/agent.json"
status: needs_triage
priority: 2
rank: 50
estimate: 1
summary: "Expose the running image SHA uniformly on the three standard per-node surfaces. Pure plumbing — no consumer changes, no flight-verify rewrites."
outcome: "Every node-app publishes its buildSha on (1) /api/metrics as build_info{sha,version,node_id} gauge, (2) /readyz as required .buildSha field, (3) .well-known/agent.json as top-level buildSha. No existing consumer breaks; verify-buildsha.sh continues reading /readyz (dual field during deprecation of .version)."
spec_refs:
  - docs/spec/ci-cd.md
  - docs/spec/observability.md
assignees: []
credit:
project: proj.observability-hardening
branch: feat/task-0337-buildsha-surfaces
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-20
updated: 2026-04-20
labels: [observability, contracts]
external_refs:
---

# Align buildSha Primitives Across Standard Surfaces

## Context

Every node-app already knows its build SHA (`APP_BUILD_SHA` Docker ARG) and already exposes Prometheus metrics via `/api/metrics` and a readiness probe via `/readyz`. What's inconsistent is *where buildSha shows up*:

| Surface | Currently | Target |
| ------- | --------- | ------ |
| `/readyz.version` | optional, sometimes emitted | required `.buildSha`, `.version` deprecated alias |
| `/api/metrics` | prom-client live, no build_info gauge | `build_info{sha, version, node_id} 1` gauge |
| `.well-known/agent.json` | URLs + auth only | top-level `buildSha` field |

## Scope (narrowed — surfaces plumbing only)

### 1. `/api/metrics` — add `build_info` gauge

In `nodes/*/app/src/shared/observability/server/metrics.ts` (3 nodes: operator, poly, resy):

```ts
export const buildInfo = new client.Gauge({
  name: "build_info",
  help: "Build SHA, version, and node_id of the running process",
  labelNames: ["sha", "version", "node_id"] as const,
  registers: [metricsRegistry],
});
buildInfo.set(
  {
    sha: process.env.APP_BUILD_SHA ?? "unknown",
    version: packageJson.version ?? "unknown",
    node_id: readNodeIdForMetrics(),
  },
  1,
);
```

The `build_info{sha, version, node_id} 1` pattern is the CNCF/Prometheus convention. Fleet-wide version query becomes `build_info{env="preview"}`.

Per-node duplication is accepted — `packages/node-shared/src/observability/server/index.ts:8` explicitly marks that package `PURE_LIBRARY — logger/metrics/redact stay app-local`. Do NOT lift into node-shared.

### 2. `/readyz` — add required `.buildSha`, keep `.version` for one cycle

In `packages/node-contracts/src/meta.readyz.read.v1.contract.ts`:

```ts
export const metaReadyzOutputSchema = z.object({
  status: readyzStatusSchema,
  timestamp: z.string(),
  buildSha: z.string(), // required — 40-char hex
  version: z.string().optional(), // DEPRECATED — alias for buildSha, remove after task.0346
});
```

In all 4 nodes' `src/app/(infra)/readyz/route.ts` (operator, poly, resy, node-template):

```ts
const sha = process.env.APP_BUILD_SHA ?? "unknown";
const payload = { status: "healthy" as const, timestamp: new Date().toISOString(), buildSha: sha, version: sha };
```

### 3. `.well-known/agent.json` — add top-level `buildSha`

In each of operator / poly / node-template `src/app/.well-known/agent.json/route.ts`:

```ts
buildSha: process.env.APP_BUILD_SHA ?? "unknown",
```

3 copies ship as-is; DRY-up to a shared helper is an explicit non-goal for this task (would pull in the `publicOrigin()` helper too and bloat scope).

## Validation

- exercise:
  - `curl -s https://poly-test.cognidao.org/readyz | jq -e '.buildSha | length == 40'`
  - `curl -s -H "Authorization: Bearer $METRICS_TOKEN" https://poly-test.cognidao.org/api/metrics | grep -q '^build_info{'`
  - `curl -s https://poly-test.cognidao.org/.well-known/agent.json | jq -e '.buildSha | length == 40'`
- acceptance:
  - All three curl + jq checks exit 0 on candidate-a and preview.
  - Existing `scripts/ci/verify-buildsha.sh` continues reading `.version` and passes on all nodes (backwards compatibility during deprecation cycle).

## Non-Goals (explicitly out of scope)

- Rewriting `scripts/ci/verify-buildsha.sh` or `verify-candidate` to use `.buildSha` — task.0346.
- Retiring the Loki `app started` buildSha scrape from flight workflows — task.0346.
- Updating pr-coordinator skill or contributor guide docs — task.0347.
- Investigating Argo verify-candidate sync flakiness — task.0341.
- Shared helper for `.well-known/agent.json` — separate cleanup.
- Prometheus alert on `build_info` version-skew — future follow-up.

## Files Touched (~8 files, ~40 LOC)

```
packages/node-contracts/src/meta.readyz.read.v1.contract.ts   (+3)
nodes/{operator,poly,resy,node-template}/app/src/app/(infra)/readyz/route.ts  (+2 each, 4 nodes)
nodes/{operator,poly,resy}/app/src/shared/observability/server/metrics.ts     (+12 each, 3 nodes)
nodes/{operator,poly,node-template}/app/src/app/.well-known/agent.json/route.ts (+1 each, 3 nodes)
```

## Related

- task.0346 — retires Loki scrape from flight-verify, consumes surfaces from this task
- task.0347 — skill + guide doc updates, consumes 0337 + 0339
- task.0341 — Argo verify-candidate flakiness investigation (independent; tonight's #945/#951 failure wasn't a buildSha issue)
