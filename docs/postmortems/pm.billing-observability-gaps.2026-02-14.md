---
id: pm.billing-observability-gaps.2026-02-14
type: postmortem
title: "Postmortem: Billing double-charges, $0 cost tracking, and observability blind spots"
status: draft
trust: draft
severity: SEV2
duration: "ongoing (discovered 2026-02-14, not yet resolved)"
services_affected: [app, litellm, billing-ingest]
summary: "In-process LLM calls produce duplicate charge receipts; sandbox:openclaw Opus 4.6 calls bill $0; preview environment broken with opaque errors; operator logs contain only error classifications, not causes."
read_when: "Investigating billing discrepancies, adding new billing paths, or debugging environment-specific failures."
owner: derekg1729
created: 2026-02-14
verified: 2026-02-14
tags: [incident, billing, observability, environment-parity]
---

# Postmortem: Billing double-charges, $0 cost tracking, and observability blind spots

**Date**: 2026-02-14
**Severity**: SEV2
**Status**: Active (unresolved)
**Duration**: Ongoing

---

## Summary

Production billing data revealed that every in-process LLM call (e.g., `langgraph:poet`) creates **two charge receipts** — one correct and one with garbage metadata (`callback:billing-ingest`). The in-process billing path also underreports Anthropic token counts by ~3x compared to LiteLLM's internal accounting (callback), making the "correct" inproc receipt wrong too. Separately, all `sandbox:openclaw` calls to `claude-opus-4.6` bill **$0.000000** despite consuming ~84K tokens per call (~$1.26 real cost each). Investigation uncovered that the preview environment is completely unable to execute graphs (all fail with "Completion failed: internal"), eliminating it as a pre-production validation gate. The "internal" error classification in operator-facing logs provides no actionable cause, making debugging require SSH access and code reading rather than log queries. Total untracked production spend estimated at $10-20+.

## Timeline

| Time (UTC)               | Event                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| 2026-02-13 ~16:30        | PRs #399 (callback billing) and #403 (deploy fix) deployed to production                                 |
| 2026-02-13 16:59         | LiteLLM begins logging `400 Bad Request` errors on billing ingest endpoint                               |
| 2026-02-13 17:09         | 400 errors stop; billing ingest starts accepting callbacks                                               |
| 2026-02-13 17:10-17:16   | Sandbox:openclaw runs execute via Opus 4.6 — all bill `chargedCredits: "0"`                              |
| 2026-02-13 17:15         | In-process gemini-2.5-flash call charges correctly (`chargedCredits: "2959"`) via both paths             |
| 2026-02-13 17:16         | Callback also writes a SECOND receipt for the same gemini call (`chargedCredits: "2959"` again)          |
| 2026-02-13 17:27         | Last production log entry in Grafana Cloud (Alloy pipeline stops — separate issue, bug.0017)             |
| 2026-02-14 01:14 (UTC+8) | User observes $0.000000 entries on cognidao.org /activity page for 7+ Opus 4.6 calls                     |
| 2026-02-14 03:15         | Preview environment: all graph executions fail with `errorCode: "internal"`                              |
| 2026-02-14 04:37         | Local testing on staging HEAD confirms double billing: `langgraph:poet` + `callback:billing-ingest`      |
| 2026-02-14 04:40         | Local sandbox:openclaw with gemini-2.5-flash bills correctly ($0.004713) — confirms $0 is model-specific |

## Root Cause

### What Happened

Three interconnected failures:

**1. Double billing on in-process LLM calls**

The billing ingest endpoint (PR #399 / task.0029) introduced callback-driven billing as a second receipt path alongside the existing in-process billing decorator. The design relied on idempotency via `UNIQUE(source_system, source_reference)` where `source_reference = runId/attempt/usageUnitId`.

The idempotency assumption was:

- In-process receipt: `source_reference = "${graphRunId}/0/${litellmCallId}"`
- Callback receipt: `source_reference = "${spend_logs_metadata.run_id}/0/${litellmCallId}"`
- If `run_id` matches `graphRunId`, the keys are identical → callback is a no-op

But the in-process LLM adapter (`litellm.adapter.ts`) **never sets the `x-litellm-spend-logs-metadata` header** on requests to LiteLLM. This header is only set in `sandbox-graph.provider.ts` for OpenClaw outbound headers. Without it, LiteLLM's callback has `spend_logs_metadata: null`, causing the billing ingest handler to fall back to `runId = entry.id` (litellm_call_id). This produces a **different** `source_reference`, defeating idempotency.

Result: every in-process LLM call writes **two** receipts — one from the billing decorator and one with `graphId: "callback:billing-ingest"` from the callback. PR #399 (task.0029) was titled "kill proxy log scraping" but only killed the nginx audit log path. The `BillingGraphExecutorDecorator` — the in-process billing path — was left alive, and the follow-up work to strip it was never prioritized.

**2. In-process billing underreports Anthropic tokens**

The in-process path reads token counts from the streaming response's `usage` chunk (`litellm.adapter.ts` line 597: `json.usage.prompt_tokens`). For Anthropic models via OpenRouter, this underreports input tokens by ~3x compared to LiteLLM's callback:

| Model            | inproc input tokens | callback input tokens | Match?        |
| ---------------- | ------------------- | --------------------- | ------------- |
| gemini-2.5-flash | 308                 | 308                   | Yes           |
| gemini-2.5-flash | 362                 | 362                   | Yes           |
| claude-opus-4.6  | 259                 | 880                   | **No (3.4x)** |
| claude-opus-4.6  | 344                 | 988                   | **No (2.9x)** |
| claude-opus-4.5  | 260                 | 880                   | **No (3.4x)** |

The callback numbers are authoritative (from LiteLLM's internal accounting). The streaming `usage` chunk for Anthropic models likely excludes cached/system prompt tokens. This means even the "correct" inproc receipt has wrong token counts and wrong cost (since cost is derived from the inproc usage data via `x-litellm-response-cost` header or `usage.cost`).

**3. $0 cost for Opus 4.6 — wrong cost authority**

LiteLLM's generic_api callback reports `response_cost: 0` for `claude-opus-4.6` calls through OpenRouter. The billing pipeline faithfully records `chargedCredits: 0` (since `Math.ceil(0 * markup * 10M) = 0`). Meanwhile, the same pipeline correctly reports cost for `claude-opus-4.5` ($0.006530/call), `gemini-2.5-flash` ($0.000432/call), and `nemotron-nano-30b` ($0, legitimately free).

The root cause is that **LiteLLM computes `response_cost` from its own internal pricing table, NOT from OpenRouter's actual billed cost.** OpenRouter includes the real cost and token counts in the response (including the final SSE chunk's usage object), but LiteLLM ignores the provider-reported cost and recomputes it. When a model is missing from LiteLLM's pricing table (like `claude-opus-4-6`, a very new model), LiteLLM silently falls back to `response_cost: 0` — no error, no warning.

This means OpenRouter billed us correctly the whole time ($5/M input, $25/M output for Opus 4.6), but our billing pipeline never saw that cost because LiteLLM's `response_cost` was the only cost source feeding into charge receipts. The fix isn't adding explicit pricing to `litellm.config.yaml` (bandaid that breaks with every new model) — it's ensuring OpenRouter's actual billed cost flows through LiteLLM to our callback as the cost authority.

**4. Preview environment broken — no E2E validation**

Preview (staging deployment) fails all graph executions with `errorCode: "internal"`, `errorMessage: "AiExecutionError: Completion failed: internal"`. The error is an opaque classification that tells the operator nothing about the actual cause (could be: LiteLLM unreachable, missing API key, auth failure, missing billing account, etc.).

The error chain deliberately strips actionable information:

- `litellm.adapter.ts` catches HTTP errors and logs `statusCode` + `kind` with explicit comment "no raw provider message"
- `inproc.provider.ts` propagates only the classification (`"internal"`)
- What reaches Loki: `{"errorCode": "internal"}` — zero debugging value

### Contributing Factors

1. **Proximate cause**: `x-litellm-spend-logs-metadata` header never added to in-process LLM calls in `litellm.adapter.ts`
2. **Contributing factor**: task.0029 ("kill proxy log scraping") killed the nginx audit log path but left `BillingGraphExecutorDecorator` alive — the in-process billing path was never stripped
3. **Contributing factor**: In-process billing uses streaming `usage` chunk for token counts, which Anthropic models via OpenRouter underreport by ~3x (excludes cached/system tokens)
4. **Contributing factor**: LiteLLM computes `response_cost` from its internal pricing table instead of passing through OpenRouter's actual billed cost — silently returns 0 for unknown models with no error signal
5. **Contributing factor**: Error normalization designed for external API consumers is also used for internal operator logs — the same sanitized output serves both audiences
6. **Systemic factor**: No stack test validates that a single LLM call produces exactly one charge receipt
7. **Systemic factor**: Preview environment has no smoke test for core user flows (graph execution + billing)

### 5 Whys: Double Billing

1. **Why are there duplicate receipts?** → Two billing paths coexist: `BillingGraphExecutorDecorator` (in-process) and LiteLLM callback (via billing ingest endpoint)
2. **Why do two paths coexist?** → PR #399 ("kill proxy log scraping") killed the nginx audit log path but left the in-process decorator alive
3. **Why wasn't the decorator stripped?** → task.0029 explicitly deferred "adapter stripping and old-path deletion" as follow-up work after callback proven in prod
4. **Why wasn't idempotency preventing doubles?** → The in-process adapter never sets `x-litellm-spend-logs-metadata` header, so callback falls back to `litellm_call_id` as `runId`, producing a different `source_reference`
5. **Why is the inproc path also wrong on token counts?** → Streaming `usage` chunks from Anthropic models underreport input tokens by ~3x (excludes cached/system tokens); the callback has the authoritative count

### 5 Whys: Preview Broken

1. **Why can't preview execute graphs?** → Unknown — the error is `"internal"` with no cause
2. **Why is the cause unknown?** → The error handling chain strips the actual error before logging
3. **Why does it strip the error?** → The `LlmError` classification system was designed for external API responses, not operator debugging
4. **Why is it used for operator logs?** → No separate logging path exists for internal observability vs external error responses
5. **Why hasn't this been addressed?** → Error normalization was implemented correctly for its intended purpose (API safety) but nobody tested whether operators could debug with the resulting logs

## Detection & Response

### What Worked

- User noticed $0.000000 entries on the /activity page — manual detection
- Grafana Cloud Loki had production logs (up to 17:27 UTC) that enabled root cause analysis
- `billing.commit_complete` structured events include `chargedCredits` and `sourceSystem`, enabling the double-billing pattern to be identified from logs

### What Didn't Work

- No alerting on `chargedCredits: "0"` for known-paid models — silent data loss
- No alerting on duplicate `source_reference` patterns — double billing invisible
- Preview environment failure produced no alert — broken for unknown duration
- Production log pipeline (Alloy → Grafana Cloud) stopped at 17:27 UTC with no alert (bug.0017)
- Error logs for preview failures contain only classifications, not causes — debugging required code reading

## Impact

### Customer Impact

- Users billed at $0 for expensive Opus 4.6 sandbox calls — undercharging (revenue loss)
- Users double-billed for every in-process LLM call — overcharging (incorrect invoicing)
- `callback:billing-ingest` appearing as graph name in /activity — confusing UX

### Technical Impact

- Estimated $10-20+ in untracked OpenRouter spend for Opus 4.6 calls
- Every in-process call (langgraph:poet, langgraph:brain, etc.) creates 2x charge receipts
- Preview environment provides zero E2E validation — bugs ship to production untested
- Operator debugging requires SSH + code reading instead of log queries

## Lessons Learned

### What Went Well

1. Structured billing events (`ai.billing.commit_complete`) made the double-billing pattern visible in logs
2. The callback pipeline itself works — payloads arrive, are validated, and receipts are written
3. Idempotency design was correct in principle — the gap was a missing header, not a flawed architecture

### What Went Wrong

1. "Idempotency prevents doubles" was stated as a design invariant but never tested with an assertion like `SELECT COUNT(*) FROM charge_receipts WHERE run_id = X`
2. PR #399 was titled "kill proxy log scraping" but only killed one of two redundant billing paths — `BillingGraphExecutorDecorator` was left alive, and the follow-up to strip it was never prioritized
3. The `x-litellm-spend-logs-metadata` header was added for sandbox but not for in-process — an incomplete implementation shipped as "done"
4. In-process billing uses streaming `usage` chunks that underreport Anthropic input tokens by ~3x — the "correct" inproc receipt has wrong data
5. Error normalization serves two incompatible audiences (external API consumers and internal operators) with the same output
6. Preview environment failure was invisible — no health check, no smoke test, no alert
7. Billing trusted LiteLLM's computed `response_cost` instead of OpenRouter's actual billed cost — LiteLLM silently returns 0 for models missing from its pricing table, while OpenRouter billed correctly the whole time
8. No model update workflow requires billing validation — new models can be added to config and deployed without verifying cost tracking works

### Where We Got Lucky

1. The double-billing is on the same billing account (overcharge + correct charge), not cross-account — no privacy violation
2. The $0 billing affected the system operator's own account, not external customers
3. Production logs existed in Grafana Cloud (up to 17:27 UTC) — if the log pipeline had broken earlier, root cause would have been much harder

## Action Items

| Pri | Action                                                                                                                                                                                                                              | Owner | Work Item |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- |
| P0  | Kill in-process billing path: delete `BillingGraphExecutorDecorator`, make LiteLLM callback sole billing authority. Set `x-litellm-spend-logs-metadata` header on in-process LLM calls so callback has correct `run_id`/`graph_id`. | —     | bug.0057  |
| P0  | Add stack test: single LLM call → exactly 1 charge receipt (no `callback:billing-ingest` duplicates, no `langgraph:*` inproc receipt)                                                                                               | —     | bug.0057  |
| P0  | Fix preview graph execution failures — diagnose actual error cause (requires fixing error logging first)                                                                                                                            | —     | bug.0058  |
| P0  | Fix error logging: operator-facing logs must include actual error cause, not just classification                                                                                                                                    | —     | bug.0059  |
| P1  | Fix cost authority: ensure OpenRouter's actual billed cost flows through LiteLLM to callback `response_cost`, not LiteLLM's internal pricing table recomputation                                                                    | —     | bug.0060  |
| P1  | Add alerting for `response_cost: 0` on known-paid models (Opus, Sonnet, GPT, Gemini)                                                                                                                                                | —     | bug.0060  |
| P1  | Standardized LiteLLM model update workflow — REQUIRED billing validation for all new models before production deployment                                                                                                            | —     | task.0062 |
| P2  | Add preview smoke test: scheduled graph execution + billing receipt validation on deploy                                                                                                                                            | —     | task.0061 |

## Related

- [task.0029](../../work/items/task.0029.callback-driven-billing-kill-log-scraping.md) — the PR that introduced callback billing with deferred idempotency fix
- [bug.0037](../../work/items/bug.0037.md) — original $0 gateway billing bug (partially fixed, new variant found)
- [bug.0051](../../work/items/bug.0051.gateway-model-routing-no-e2e.md) — gateway `spend_logs_metadata` missing (related but distinct)
- [bug.0017](../../work/items/bug.0017.alloy-config-reload.md) — Alloy config not reloading (caused production log gap)
- [pm.preview-disk-exhaustion.2026-02-10](./pm.preview-disk-exhaustion.2026-02-10.md) — prior preview environment incident
