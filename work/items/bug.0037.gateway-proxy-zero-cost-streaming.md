---
id: bug.0037
type: bug
title: "Gateway proxy billing records $0 cost — x-litellm-response-cost header absent for streaming"
status: needs_design
priority: 0
estimate: 2
summary: "Nginx gateway proxy captures $upstream_http_x_litellm_response_cost from LiteLLM response headers, but this header is absent for streaming (SSE) completions. All sandbox:openclaw calls record $0 cost and 0 tokens — systematic under-billing for paid models."
outcome: "All sandbox:openclaw LLM calls record accurate cost data. Stack test unskipped and passing."
spec_refs: billing-sandbox-spec
assignees: []
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
created: 2026-02-12
updated: 2026-02-12
labels: [billing, gateway, proxy, p0]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 4
---

# bug.0037 — Gateway proxy billing records $0 cost

## Requirements

### Observed

All `sandbox:openclaw` entries show $0 cost and 0 tokens in the Activity dashboard:

```
2/12/2026, 2:23:01 AM    sandbox:openclaw    gemini-2.5-flash    0    0    —
2/12/2026, 2:23:01 AM    sandbox:openclaw    gemini-2.5-flash    0    0    —
2/12/2026, 2:23:01 AM    sandbox:openclaw    gemini-2.5-flash    0    0    —
```

`gemini-2.5-flash` is **not a free model** (`is_free: false` in `platform/infra/services/runtime/configs/litellm.config.yaml:135`). Cost should be > $0.

### Expected

Each LLM call should record the actual provider cost from LiteLLM. `chargedCredits > 0` for paid models.

### Root Cause

The billing pipeline relies on the nginx variable `$upstream_http_x_litellm_response_cost` to capture cost from LiteLLM response headers (`platform/infra/services/sandbox-proxy/nginx-gateway.conf.template:30`).

**For streaming (SSE) completions, this header is absent.** HTTP response headers are sent before the response body begins streaming. LiteLLM can't include cost in headers because cost depends on total tokens, which aren't known until the stream completes.

The full data flow:

1. OpenClaw calls LiteLLM through nginx gateway proxy (streaming SSE)
2. Nginx captures `$upstream_http_x_litellm_response_cost` → logs `"-"` (absent)
   - File: `platform/infra/services/sandbox-proxy/nginx-gateway.conf.template:30`
3. `ProxyBillingReader.readOnce()` parses `litellm_response_cost: "-"` → creates entry **without** `costUsd`
   - File: `src/adapters/server/sandbox/proxy-billing-reader.ts:155-168`
4. `SandboxGraphProvider.createGatewayExecution()` emits `UsageFact` without `costUsd`
   - File: `src/adapters/server/sandbox/sandbox-graph.provider.ts:539-550`
5. `commitUsageFact()` sees `fact.costUsd === undefined` → logs `CRITICAL: UsageFact missing cost data` → writes `chargedCredits = 0n`
   - File: `src/features/ai/services/billing.ts:252-257`

The spec acknowledges this as "degraded mode" (billing-sandbox-spec invariant 4: COST_FROM_RESPONSE_HEADER).

### Test Coverage Gap

The only test that validates the full billing pipeline is **skipped**:

```typescript
// tests/stack/sandbox/sandbox-llm-roundtrip-billing.stack.test.ts:96
it.skip("proxy audit log captures billing data and commits to charge_receipts", ...)
```

Skipped due to bug.0013 (proxy container vanishes). This test DOES assert `costUsd > 0` (line 118), so it would catch this bug if it ran.

### Impact

- **All sandbox:openclaw calls are under-billed** — paid model usage at $0
- **Revenue leakage** — users consuming paid models (gemini-2.5-flash, etc.) without being charged
- **Degraded silently** — the CRITICAL log is emitted but the call succeeds, so users see responses with no cost

## Allowed Changes

This bug is a **known architectural limitation** of proxy-based billing. The fix is task.0029 (callback-driven billing via LiteLLM webhook). No point patching the proxy approach — it fundamentally cannot capture cost for streaming.

Immediate mitigations:

- `tests/stack/sandbox/sandbox-llm-roundtrip-billing.stack.test.ts` — unskip and fix the underlying bug.0013 issue
- Consider LiteLLM `/spend/logs` API as a post-hoc reconciliation source

## Plan

- [ ] Prioritize task.0029 (callback-driven billing) as the real fix
- [ ] Unskip the billing stack test once bug.0013 is resolved
- [ ] Consider interim reconciliation from LiteLLM spend logs

## Validation

**Command:**

```bash
pnpm test:stack:dev -- --grep "proxy audit log captures billing data"
```

**Expected:** Test passes with `costUsd > 0` for a paid model.

## Review Checklist

- [ ] **Work Item:** `bug.0037` linked in PR body
- [ ] **Spec:** billing-sandbox-spec invariant COST_FROM_RESPONSE_HEADER addressed
- [ ] **Tests:** billing stack test unskipped and passing
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: task.0029 (callback-driven billing — the real fix)
- Related: bug.0013 (proxy container vanishes — why the test is skipped)
- Related: bug.0004 (activity dashboard cost column broken — related display issue)
- Spec: docs/spec/billing-sandbox.md (COST_FROM_RESPONSE_HEADER invariant)

## Attribution

-
