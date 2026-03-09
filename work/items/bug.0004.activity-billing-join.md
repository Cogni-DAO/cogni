---
id: bug.0004
type: bug
title: "/activity dashboard cost column broken — charge_receipts needs linked telemetry"
status: needs_triage
priority: 1
estimate: 3
summary: Activity join on litellm_call_id vs spend_logs.request_id fails for some providers; fix by storing telemetry in our DB at write time
outcome: /activity shows cost per row from our DB with no LiteLLM API dependency
spec_refs: billing-evolution
assignees: derekg1729
credit:
project: proj.payments-enhancements
branch:
pr:
reviewer:
created: 2026-02-08
updated: 2026-02-08
labels: [billing, activity, dashboard]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 8
---

## Problem

`/activity` shows tokens/model (from LiteLLM `/spend/logs`) but cost is "—" for every row.

The Activity facade joins `charge_receipts.litellm_call_id` against `spend_logs.request_id`. The invariant `x-litellm-call-id === spend_logs.request_id` does not hold for all providers:

- nemotron-nano-30b (OpenRouter): **matches** (both UUID)
- gemini-2.5-flash (OpenRouter): **mismatches** (`46cba7ac-...` vs `gen-1770544590-...`)

Evidence: `unjoinedLogCount: 591, fetchedLogCount: 591` — all rows unjoined.

## Root Cause

`charge_receipts` is a billing ledger (cost only). The dashboard depends on a cross-system join to LiteLLM for telemetry (model, tokens). When the join key diverges, cost disappears.

## Design

Add a detail table so charge_receipts carries its own telemetry. No external join needed for the dashboard.

```
charge_receipts (canonical ledger, always RLS)
  identity/scope  : billing_account_id, run_id, attempt
  money           : charged_credits, response_cost_usd
  idempotency     : source_system, source_reference
  classification  : charge_reason (enum), source_system (enum)
  timestamps      : created_at, provenance

llm_charge_details (type-specific, FK to charge_receipts)
  charge_receipt_id  (PK/FK → charge_receipts.id)
  provider_call_id   (litellm call id — forensic only, NOT a join key)
  model, provider, tokens_in, tokens_out
  latency_ms, cache_read_tokens, cache_write_tokens

(future: tool_charge_details, storage_charge_details, etc.)
```

**Write path:** `commitUsageFact()` already receives `fact.model`, `fact.inputTokens`, `fact.outputTokens` — pipe into `llm_charge_details` alongside `recordChargeReceipt()`.

> **CRITICAL (from task.0010 investigation, 2026-02-09):** `fact.model` may not reflect the model that was actually called. The OpenClaw gateway ignores the request-side model and always uses the agent config default (`openclaw-gateway.json` → `agents.defaults.model.primary`). LiteLLM spend logs confirmed all recent calls went to `nemotron-nano-30b` regardless of what model the graph executor requested. When writing `llm_charge_details`, the `model` field **must** be sourced from LiteLLM spend log `model_group` (what was actually called), NOT from `GraphRunRequest.model` or `fact.model` (what was requested). Same applies to `tokens_in`, `tokens_out`, `response_cost_usd` — all must come from the LiteLLM spend log entry, which is the billing source of truth per **LITELLM_IS_USAGE_TRUTH**.

**Read path:** Activity facade queries `charge_receipts JOIN llm_charge_details` — one DB query, our RLS, no LiteLLM API call.

**Invariant corrections:**

- **LITELLM_IS_USAGE_TRUTH**: LiteLLM is source of truth for raw cost/tokens at call time.
- **CHARGE_RECEIPTS_IS_LEDGER_TRUTH**: `charge_receipts` + detail tables is the system-of-record for billing/UI.
- **RECONCILIATION_WRITES_LEDGER**: `/spend/logs` is an audit/repair input, not a UI dependency.

## Execution Checklist

- [ ] Migration: create `llm_charge_details` table with FK to `charge_receipts.id`
- [ ] Write path: extend `recordChargeReceipt` (or add sibling call) to write `llm_charge_details`
- [ ] Read path: `listChargeReceipts` returns joined detail data
- [ ] Activity facade: replace dual-source fetch with single DB query
- [ ] Remove LiteLLM `/spend/logs` dependency from Activity path (`LiteLlmActivityUsageAdapter`, `ActivityUsagePort`)
- [ ] Verify RLS on new table (transitive FK via charge_receipts.billing_account_id)

## Validation

- `/activity` page shows cost per row (not "—")
- `unjoinedLogCount` drops to 0 in logs
- No LiteLLM `/spend/logs` API call in Activity path
