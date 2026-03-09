---
id: task.0048
type: task
title: "Sub-agent billing attribution — track which OpenClaw sub-agent made each LLM call"
status: needs_triage
priority: 2
estimate: 3
summary: "Gateway LLM calls share a single run_id and graph_id per session. When a thinking agent spawns sub-agents (e.g. Flash for research, Sonnet for reasoning), all calls are billed correctly but indistinguishable by sub-agent. Need per-call sub-agent identity in spend_logs_metadata."
outcome: "Each LLM call from an OpenClaw sub-agent carries a sub_agent_id (or equivalent) in llm_charge_details, enabling cost-per-sub-agent queries within a run."
spec_refs:
assignees:
  - derekg1729
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [openclaw, billing, observability]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 11
---

# Sub-agent billing attribution

## Problem

Today, outbound headers are set **per session** in `sandbox-graph.provider.ts:478-486`:

```typescript
const outboundHeaders = {
  "x-litellm-end-user-id": caller.billingAccountId,
  "x-litellm-spend-logs-metadata": JSON.stringify({
    run_id: runId,
    graph_id: graphId, // "sandbox:openclaw" for ALL calls
  }),
};
```

OpenClaw injects these same headers on every LLM call the agent makes. When the thinking agent spawns sub-agents using different models, all calls share the same `run_id` and `graph_id = sandbox:openclaw`.

### What we CAN see today

Per-call data in `llm_charge_details`:

- `model` — which model was used (e.g. `gemini-2.5-flash`, `claude-sonnet-4.5`)
- `provider` — e.g. `openrouter`
- `tokens_in` / `tokens_out`
- `graph_id` — always `sandbox:openclaw` for gateway calls
- `provider_call_id` — unique litellm_call_id

So you can query cost-per-model within a run:

```sql
SELECT d.model, count(*), sum(cr.response_cost_usd)
FROM charge_receipts cr
JOIN llm_charge_details d ON d.charge_receipt_id = cr.id
WHERE cr.run_id = ?
GROUP BY d.model;
```

### What we CANNOT see

- Which sub-agent made which call (no agent-level identifier)
- Parent/child relationships between calls
- The tool_use or function_call context that triggered a sub-agent

## Requirements

- Each LLM call from an OpenClaw sub-agent carries a distinguishing identifier
- The identifier is stored in `llm_charge_details` (new column or via `graph_id` enrichment)
- Cost-per-sub-agent queries are possible within a single `run_id`
- No breaking changes to existing billing pipeline

## Approach Options

### Option A: OpenClaw dynamic header mutation

OpenClaw sets a `sub_agent_id` field in `x-litellm-spend-logs-metadata` before each LLM call. Requires OpenClaw to support per-call header overrides (currently headers are set once per session via `sessions.patch`).

### Option B: OpenClaw tool_call_id passthrough

OpenClaw passes the `tool_call_id` that spawned the sub-agent as metadata on the LLM call. This naturally creates a parent→child trace. Requires OpenClaw to propagate tool context to outbound headers.

### Option C: Model-based heuristic (stopgap)

Use the `model` field in `llm_charge_details` as a proxy for sub-agent identity. Works when sub-agents use distinct models, but breaks when multiple sub-agents share a model.

## Dependencies

- OpenClaw must support per-call or per-tool-invocation header mutation (Options A/B)
- May need new column in `llm_charge_details` (e.g. `sub_agent_id text`)
- Ingest contract schema (`spend_logs_metadata`) needs optional `sub_agent_id` field

## Plan

- [ ] Confirm OpenClaw's capability for per-call header overrides (spike / check with OpenClaw dev)
- [ ] Choose approach (A vs B)
- [ ] Add optional `sub_agent_id` to `spend_logs_metadata` in contract schema
- [ ] Add `sub_agent_id` column to `llm_charge_details`
- [ ] Update `buildUsageFact()` in ingest route to pass through sub_agent_id
- [ ] Update OpenClaw session config to inject sub-agent identity
- [ ] Add observability query examples to billing spec

## Validation

**Command:**

```sql
-- After a thinking agent run with sub-agents:
SELECT d.model, d.sub_agent_id, count(*), sum(cr.response_cost_usd)
FROM charge_receipts cr
JOIN llm_charge_details d ON d.charge_receipt_id = cr.id
WHERE cr.run_id = 'test-run-id'
GROUP BY d.model, d.sub_agent_id;
```

**Expected:** Distinct rows per sub-agent showing cost attribution.

## Review Checklist

- [ ] **Work Item:** `task.0048` linked in PR body
- [ ] **Spec:** billing-ingest spec updated with sub_agent_id field
- [ ] **Tests:** contract + stack tests cover sub-agent attribution
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Depends on: OpenClaw per-call header support
- Related: task.0029 (callback-driven billing), bug.0044 (stale audit log)

## Attribution

-
