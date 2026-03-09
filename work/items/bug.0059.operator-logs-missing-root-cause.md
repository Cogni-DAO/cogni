---
id: bug.0059
type: bug
title: "Operator logs show only 'internal' — root cause dropped in LiteLLM adapter"
status: done
priority: 0
estimate: 1
summary: "litellm.adapter.ts catches HTTP errors and deliberately strips the actual error message (comment: 'no raw provider message'). Operator-facing Loki logs show {kind: 'provider_4xx'} with zero debugging value — no response body, no provider error message. Network failures (ECONNREFUSED, ENOTFOUND) are also thrown without logging."
outcome: "Every LiteLLM failure path logs a private root-cause detail (redacted + bounded <=2KB) in operator logs. Public error codes returned to API consumers remain unchanged."
spec_refs: observability
assignees: derekg1729
credit:
project: proj.observability-hardening
branch: fix/billing-issues
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [observability, ai-graphs]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 2
---

# Operator logs show only 'internal' — root cause dropped in LiteLLM adapter

## Symptoms

1. Preview environment fails with `Completion failed: internal`
2. Loki logs show `{"kind":"provider_4xx","statusCode":404}` — no actual error message
3. Operator cannot determine root cause (model removed? auth failure? malformed request?)
4. Network errors (ECONNREFUSED to LiteLLM) are thrown but never logged at adapter boundary

## Root Cause

`litellm.adapter.ts` has 5 error paths that deliberately strip diagnostic information:

| Path                               | Issue                                                    |
| ---------------------------------- | -------------------------------------------------------- |
| `completion()` HTTP error          | Logs `statusCode` + `kind` only; response body discarded |
| `completionStream()` HTTP error    | Same — response body discarded                           |
| SSE `json.error` in stream         | Error message parsed but not included in log             |
| `completion()` network error       | No log at all — only throws                              |
| `completionStream()` network error | No log at all — only throws                              |

## Fix

- Read response body on HTTP errors, truncate to 2KB, redact via `scrubStringContent()` from `@/shared/ai/content-scrubbing`, log as `responseExcerpt`
- Log network errors with `rootCauseKind: 'network'` and `causeCode` (ECONNREFUSED/ENOTFOUND)
- Log SSE errors with `errorDetail` field
- `LlmError` thrown to callers remains unchanged (sanitized, no response body)

## Acceptance Criteria

- [ ] Every non-2xx HTTP response from LiteLLM produces a log line with `responseExcerpt` (redacted, <=2KB)
- [ ] Network failures produce a log line with `rootCauseKind` + `causeCode`
- [ ] SSE errors produce a log line with `errorDetail`
- [ ] No secrets appear in any logged excerpt (verified by `scrubStringContent`)
- [ ] Public error codes returned to API consumers are unchanged
- [ ] `pnpm check` passes

## Validation

- `pnpm check` — lint, type, format, docs
- `grep -n 'responseExcerpt\|rootCauseKind\|errorDetail' src/adapters/server/ai/litellm.adapter.ts` — confirm all 5 error paths log private details
- Manual: trigger a 404 (bad model name) in dev, confirm Loki shows the provider error message in the log line

## PR / Links

- Handoff: [handoff](../handoffs/bug.0059.handoff.md)
