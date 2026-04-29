---
id: task.0425
type: task
title: "External-agent knowledge contribution API — Dolt branch-per-PR (poly + operator, v0)"
status: needs_design
priority: 0
rank: 5
estimate: 5
summary: "Let an external agent (registered via `/contribute-to-cogni`) submit schema-aligned knowledge entries that land on a `contrib/<agent>-<id>` Dolt branch (one branch per contribution = one PR-equivalent), reviewed via `dolt_diff`, and merged to `main` by an admin-session operator. Internal `core__knowledge_write` keeps writing straight to `main`. Both poly and operator nodes ship the `knowledge` table + identical routes in the same PR — surface lives in `@cogni/knowledge-store` (cross-node shared), per-node bindings are ~10-line Next route wrappers."
outcome: "An external agent can POST a knowledge contribution to poly OR operator, GET its diff, and (when authorized) POST a merge that lands the entries on `main`. Schema is enforced via shared Zod contract. Dolt-native PR semantics for knowledge — first realization of `KnowledgeClass: experimental` from the data-plane spec."
spec_refs: [knowledge-data-plane-spec, agent-contributor-protocol]
assignees: []
credit:
project: proj.agentic-interop
branch: feat/task-0425-knowledge-contribution-api
pr:
reviewer:
revision: 1
blocked_by: [task.0424]
deploy_verified: false
created: 2026-04-29
updated: 2026-04-29
labels: [knowledge, doltgres, agents, interop, api, poly, operator]
external_refs:
---

# External-agent knowledge contribution API — Dolt branch-per-PR (poly + operator, v0)

## Problem

`docs/spec/knowledge-data-plane.md` defines `KnowledgeClass: experimental` with explicit promotion, but locks v0 to "single branch (`main`), no merge workflows" — leaving external agents with no way to contribute knowledge. PR #1130 stood up the doltgres-on-operator scaffold; this task uses it to ship the inbound knowledge-contribution surface as Dolt branches that admin-session operators merge.

Design lives in [docs/design/knowledge-contribution-api.md](../../docs/design/knowledge-contribution-api.md). This work item owns scope, allowed changes, and validation only.

## Scope

- Surface lives in `@cogni/knowledge-store` (cross-node shared); per-node app code provides ~10-line Next route bindings — see design doc § Architecture.
- Both poly and operator wire the same routes in this PR. No node-asymmetry; operator gains its first `knowledge` table here.
- Dolt branch-per-PR semantics with reserved-conn pinning. Internal `core__knowledge_write` unchanged.
- Pre-implementation `AS OF` spike against Doltgres 0.56 testcontainer is **gating** — see design § Open Questions.

## Out of scope (v1+)

- Web UI for diff review (curl-only in v0)
- Long-lived per-agent branches with multi-commit PRs
- Cross-node fan-out (one contribution targets one node DB)
- Knowledge-class taxonomy enforcement (`public/shared` vs `node-private` columns)
- Real RBAC table + per-user knowledge RLS
- MCP tool for external knowledge-contribute
- Resy / ai-only / future nodes
- Auto-promotion based on outcome-validation / repeated-pattern criteria
- Branch GC for stale `contrib/*` branches
- env-var-based merge allowlist (admin-role session is the v0 gate)

## Allowed Changes

- `packages/knowledge-store/src/{port,adapters/doltgres,service,domain}/` — new contribution port, adapter, service factory, domain schemas
- `packages/node-contracts/src/knowledge.contributions.v1.contract.ts` (new — HTTP wrappers only; reuses domain types from `@cogni/knowledge-store`)
- `nodes/operator/packages/doltgres-schema/src/` — add `knowledge` re-export + new `0001_add_knowledge.sql` migration + `0002_add_knowledge_contributions.sql`
- `nodes/poly/packages/doltgres-schema/src/` — add `0002_add_knowledge_contributions.sql` (poly already has `knowledge`)
- `nodes/{poly,operator}/app/src/app/api/v1/knowledge/contributions/**/route.ts` — thin Next bindings
- `nodes/{poly,operator}/app/src/bootstrap/container.ts` — wire contribution port + service
- `docs/spec/knowledge-data-plane.md` — invariant + non-goal edits per design doc § Spec edits
- `docs/design/knowledge-contribution-api.md` (already in this PR)
- `work/items/task.0425.knowledge-contribution-api.md` (this file)

## Validation

```yaml
exercise: |
  curl -fsSL https://test.cognidao.org/.well-known/agent.json
  API_KEY=$(curl -fsSL -X POST https://test.cognidao.org/api/v1/agent/register \
    -H 'content-type: application/json' \
    -d '{"name":"task-0425-validator"}' | jq -r .apiKey)

  # Contribute to poly knowledge — agent path
  CONTRIB=$(curl -fsSL -X POST https://test.cognidao.org/api/v1/knowledge/contributions \
    -H "authorization: Bearer $API_KEY" \
    -H "content-type: application/json" \
    -d '{
      "message": "task.0425 e2e: base-rate fact for prediction-market",
      "entries": [{
        "domain": "prediction-market",
        "title": "Election-year Fed rate-cut base rate",
        "content": "Historical frequency of Fed rate cuts in election years is ~35%",
        "tags": ["base-rate","fed","macro"]
      }]
    }')
  CONTRIB_ID=$(echo "$CONTRIB" | jq -r .contributionId)

  # Read open contribution
  curl -fsSL "https://test.cognidao.org/api/v1/knowledge/contributions/$CONTRIB_ID" \
    -H "authorization: Bearer $API_KEY"

  # Diff vs main
  curl -fsSL "https://test.cognidao.org/api/v1/knowledge/contributions/$CONTRIB_ID/diff" \
    -H "authorization: Bearer $API_KEY"

  # Idempotency replay — same key returns existing record
  # 11th open contribution from same agent → 429

  # Merge — Derek with admin session cookie (NOT API key)
  curl -fsSL -X POST "https://test.cognidao.org/api/v1/knowledge/contributions/$CONTRIB_ID/merge" \
    -H "cookie: $OPERATOR_SESSION_COOKIE" \
    -H "content-type: application/json" \
    -d '{"confidencePct": 80}'

observability: |
  {app="poly", env="candidate-a"} |~ "knowledge.contributions" |~ "task-0425-validator"
  {app="poly"} |~ "dolt_commit" |~ "contrib/" |~ "task-0425"
  {app="poly"} |~ "dolt_merge" |~ "task-0425"
```

**Pass criteria:**

- Branch `contrib/task-0425-validator-*` exists in `knowledge_poly` after POST
- GET returns entries with server-stamped `source_type='external_agent'`, `confidence_pct=30` (agent default)
- Diff shows new rows as `added` against `main`
- 401 unregistered, 403 non-admin merge, 429 quota exceeded
- Idempotency-Key replay returns the original `contributionId`
- Admin merge with `confidencePct: 80` lands entry on `main` at 80
- Subsequent `core__knowledge_search` from poly agent finds the merged entry
