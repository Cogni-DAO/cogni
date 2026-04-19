---
id: bug.0322
type: bug
title: Runs made on poly are visible via operator's /api/v1/agent/runs (cross-node data pollution)
status: needs_triage
priority: 1
rank: 40
estimate: 3
summary: A machine agent registered on poly and invoking `POST /api/v1/chat/completions` on poly's hostname creates a run that is NOT visible via poly's `GET /api/v1/agent/runs` but IS visible via operator's `GET /api/v1/agent/runs` (same bearer key). This contradicts the multi-node-tenancy spec's "DB-per-node isolation" invariant — runs initiated on one node leak into another node's visible history.
outcome: Runs initiated on a given node are recorded in and retrievable only from that node's DB. Cross-node run visibility is either eliminated, or explicitly modeled and documented as federated read (with proper RLS-style scoping).
spec_refs:
  - multi-node-tenancy-spec
  - databases-spec
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-18
updated: 2026-04-18
labels: [multi-node, tenancy, runtime, data-isolation]
external_refs:
---

# Runs made on poly are visible via operator's `/api/v1/agent/runs`

## Repro (candidate-a, PR #916 flight validation, 2026-04-18)

1. Register a machine agent against poly:
   ```bash
   curl -sS -X POST https://poly-test.cognidao.org/api/v1/agent/register \
     -H 'Content-Type: application/json' -d '{"name":"cross-node-repro"}'
   ```
   Returns `{ userId, apiKey, billingAccountId }` — rows created in `cogni_poly`.
2. Execute a graph on poly:
   ```bash
   curl -sS -X POST https://poly-test.cognidao.org/api/v1/chat/completions \
     -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
     -d '{"model":"gpt-4o-mini","graph_name":"poet","messages":[{"role":"user","content":"hi"}]}'
   ```
   Returns `{"id":"chatcmpl-<RUN_UUID>", …}`.
3. List runs on poly:
   ```bash
   curl -sS -H "Authorization: Bearer $API_KEY" \
     https://poly-test.cognidao.org/api/v1/agent/runs
   ```
   → `{ "runs": [] }` — **empty**.
4. List runs on operator using the SAME poly-issued key:
   ```bash
   curl -sS -H "Authorization: Bearer $API_KEY" \
     https://test.cognidao.org/api/v1/agent/runs
   ```
   → includes `runId: <RUN_UUID>` from step 2, with `requestedBy` = the poly userId from step 1.

Concrete evidence (2026-04-19 00:19:47Z): poly-invoked completion `id=chatcmpl-b658787f-…` became `runId=b658787f-a4f5-4d1e-be5a-f76ec03600ae` visible on operator; poly's own `/agent/runs` showed `count: 0`.

## Why this is a bug, not "by design"

[multi-node-tenancy.md](../../docs/spec/multi-node-tenancy.md) summarizes the invariant as "DB-per-node isolation, node-local metering as authoritative source". Runs are a first-class metered artifact; they should be discoverable from the node that executed them, not from a different node.

Two specific problems this creates:

1. **Data plane exfil:** a bearer key compromised on one node gives read access to runs from other nodes. That's not what "DB-per-node isolation" promises.
2. **Telemetry confusion:** metering, cost allocation, and audit all currently assume runs live in the DB of the node that executed them. If operator is actually authoritative for all runs regardless of invocation host, that needs to be either fixed or loudly documented.

## Hypotheses (in rough likelihood order)

**H1. Graph executor routes run persistence to operator regardless of invocation host.** There may be a central `graph_runs` write path — e.g. via scheduler-worker or a `getServiceDb()` call in the graph execution pipeline that hard-connects to operator's DATABASE_URL. Would mean the per-node DATABASE_URL is respected for app-level paths but bypassed for graph execution. task.0324's schema split did not touch this code path.

**H2. Operator and poly pods on candidate-a are pointing at the same DATABASE_URL.** k8s secret misconfiguration — poly-node-app-secrets and operator-node-app-secrets both contain the same DSN. Rules out if `kubectl -n cogni-candidate-a get secret poly-node-app-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d` differs from operator's.

**H3. NextAuth / session lookup is federated across node DBs** (some cross-DB JOIN or a shared users table). Would explain why poly-issued JWT authenticates on operator; doesn't explain why resy 401s (but resy has no machine-agent auth wired yet, per user confirmation).

## Diagnosis steps

1. `kubectl -n cogni-candidate-a get secret {operator,poly}-node-app-secrets -o jsonpath='{.data.DATABASE_URL}' | base64 -d` — confirm distinct DSNs.
2. `kubectl -n cogni-candidate-a exec <postgres pod> -- psql -U postgres -c "\l"` — confirm `cogni_template_dev` AND `cogni_poly` both exist.
3. On `cogni_template_dev`: `SELECT id, graph_id, requested_by, started_at FROM graph_runs WHERE id = '<RUN_UUID>';` — does the poly-invoked run ACTUALLY live in operator's DB? If yes → H1 is confirmed.
4. Same query on `cogni_poly` — run absent confirms H1.
5. If H1 confirmed, grep the graph execution code for hard-coded `DATABASE_URL` / `DATABASE_SERVICE_URL` / `getServiceDb()` calls that might bypass per-node DSN resolution.

## Scope boundaries

- This is NOT caused by task.0324. That PR changed migration / schema layout only; runtime DB routing was untouched.
- Fix belongs with the graph execution pipeline owner, not the DB schema owner.
- Prod impact: same behavior presumably exists on preview and would ship to prod if the operator pods share a DB with node pods via this code path. Priority 1 because it's an active data-plane leak, not just a logical mistake.

## Allowed Changes

- Graph execution pipeline code path that writes `graph_runs` rows
- Any `getServiceDb()` caller that hard-wires to operator's DSN — must resolve per-request node context
- `docs/spec/multi-node-tenancy.md` — if H1 turns out to be a documented exception, the spec should say so; otherwise the fix must restore the invariant
- k8s overlay secret configuration (H2)

## Plan

- [ ] **Step 1** — Run the 5 diagnosis steps above on candidate-a. Confirm which hypothesis holds.
- [ ] **Step 2 (if H1):** identify the code path that hard-connects to operator's DB for graph run persistence. Refactor to use per-request DSN (each pod uses its own DATABASE_URL).
- [ ] **Step 2 (if H2):** fix the k8s secret pointing poly at operator's DB.
- [ ] **Step 3** — Add a regression test: invoke chat/completions on poly, assert the run is visible on poly and NOT on operator.
- [ ] **Step 4** — Update `multi-node-tenancy.md` with the concrete run-visibility invariant (currently implicit).

## Validation

**Exercise:**

```bash
# After fix: poly's runs appear on poly, not on operator
curl -sS -X POST https://poly-test.cognidao.org/api/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","graph_name":"poet","messages":[{"role":"user","content":"x"}]}'

# Expected: poly shows the run
curl -sS -H "Authorization: Bearer $KEY" https://poly-test.cognidao.org/api/v1/agent/runs \
  | python3 -c "import json,sys;print(len(json.load(sys.stdin)['runs']))"
# Expect: 1 (not 0)

# Expected: operator does NOT show poly's run
curl -sS -H "Authorization: Bearer $KEY" https://test.cognidao.org/api/v1/agent/runs \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print([r['runId'] for r in d['runs']])"
# Expect: list does NOT contain the run UUID from the poly call
```

**Observability:** graph executor logs should show which DATABASE_URL received the run insert, with node context. If a run ends up in operator's DB when poly initiated the call, that's a structured error event.

## Review Checklist

- [ ] **Work Item:** `bug.0322` linked in PR body
- [ ] **Root cause identified:** H1 vs H2 vs H3 confirmed via diagnosis steps
- [ ] **Regression test:** per-node run visibility assertion added to test suite (contract or stack test)
- [ ] **Spec updated:** `multi-node-tenancy.md` explicitly states the run-visibility invariant
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Surfaced during PR #916 task.0324 flight validation, 2026-04-18
- Related: task.0324 (independent DB schema split — proved migration layout is correct; runtime routing is this bug's domain), task.0318 (poly wallet multi-tenant auth)
- Reference: [docs/spec/multi-node-tenancy.md](../../docs/spec/multi-node-tenancy.md), [docs/guides/agent-api-validation.md](../../docs/guides/agent-api-validation.md)

## Attribution

-
