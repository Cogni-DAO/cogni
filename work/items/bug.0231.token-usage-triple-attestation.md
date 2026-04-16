---
id: bug.0231
type: bug
title: "Token usage has three disagreeing sources — app logs, LiteLLM spend_logs, and billing callback"
status: needs_triage
priority: 1
rank: 5
estimate: 2
summary: "App logs tokensUsed from SSE stream usage chunk (e.g. 373), LiteLLM spend_logs records a different total (e.g. 1622), and billing callback charges credits from yet another derivation. No single source of truth for token counts per LLM call."
outcome: "One authoritative token count per LLM call, consistently reported in app logs, billing records, and observability. The billing callback (LiteLLM generic_api) is the recommended authority since it is the source that actually charges."
spec_refs: [spec.tool-use, billing-ingest-spec]
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [observability, billing, ai-graphs]
external_refs:
---

# Token usage has three disagreeing sources

## Observed

Three independent paths attest to token usage for the same LLM call, and they disagree:

| Source                  | Where                | Example Value  | Code Location                                   |
| ----------------------- | -------------------- | -------------- | ----------------------------------------------- |
| SSE stream `json.usage` | App log `tokensUsed` | 373            | `litellm.adapter.ts:673-678` → logged at `:846` |
| LiteLLM spend_logs      | LiteLLM Postgres     | 1,622          | `GET /spend/logs` API                           |
| Billing callback        | `charge_receipts` DB | 21,588 credits | `billing/ingest/route.ts:148-150`               |

Evidence from run `b8766a42` (kimi-k2.5, frontend-tester graph, 22 Playwright MCP tools):

- **App log:** `{"component":"LiteLlmAdapter","tokensUsed":373,"finishReason":"tool_calls"}`
- **LiteLLM spend_logs:** `prompt_tokens=1463, completion_tokens=159, total_tokens=1622`
- Same LLM call, same `request_id`, 4.3x discrepancy

### Attestation paths

```
Provider (kimi-k2.5 via OpenRouter)
  ↓ SSE stream chunk: usage.total_tokens = 373
  ↓
LiteLLM proxy
  ├─→ SSE passthrough → litellm.adapter.ts:674 → finalUsage → log "tokensUsed: 373"
  ├─→ Server-side computation → spend_logs: total_tokens = 1622
  └─→ generic_api callback → billing ingest → charge_receipts
```

Three paths, three numbers. Anti-pattern: multiple sources attesting to the same fact.

## Expected

One authoritative token count per LLM call. App logs, `ai_invocation_summaries`, Prometheus metrics, and billing all derive from the same source.

## Requirements

- Single source of truth for token counts — recommended: **billing callback** (LiteLLM `generic_api`), since it actually charges
- App logs must not label SSE stream usage as `tokensUsed` (misleading)
- `ai_invocation_summaries.tokens_total` populated from the authority, not SSE stream
- Prometheus `ai_llm_tokens_total` metric uses the authority

## Allowed Changes

- `apps/operator/src/adapters/server/ai/litellm.adapter.ts` — SSE usage handling
- `apps/operator/src/features/ai/services/completion.ts` — token count sourcing
- `apps/operator/src/features/ai/services/metrics.ts` — Prometheus metric source
- `apps/operator/src/app/api/internal/billing/ingest/route.ts` — token writeback if needed
- `apps/operator/src/shared/observability/events/ai.ts` — event type fields

## Plan

- [ ] Determine authoritative field in billing callback payload
- [ ] Stop using SSE `finalUsage.totalTokens` as `tokensUsed`; label it `streamReportedTokens` if kept
- [ ] Ensure `ai_invocation_summaries.tokens_total` uses the authoritative source
- [ ] Update Prometheus metric source
- [ ] Verify Langfuse generation observations get correct counts

## Validation

**Command:**

```bash
# Run LLM call with tools, then compare:
# 1. App log tokensUsed
# 2. curl http://localhost:4000/spend/logs?limit=1
# 3. SELECT tokens_total FROM ai_invocation_summaries ORDER BY created_at DESC LIMIT 1
```

**Expected:** All three agree (within rounding).

## Review Checklist

- [ ] **Work Item:** `bug.0231` linked in PR body
- [ ] **Spec:** billing-ingest-spec invariants upheld
- [ ] **Tests:** unit test comparing SSE usage vs callback usage
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: bug.0060 (OpenRouter cost authority — same family)
- Related: task.0212 (unified usage reporting — established callback pattern)
- Discovered during: task.0228 (MCP client MVP)

## Attribution

- Investigation: discovered during MCP tool integration testing, token counts 4.3x under-reported with tool-using graphs
