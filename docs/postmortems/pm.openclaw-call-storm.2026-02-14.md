---
id: pm.openclaw-call-storm.2026-02-14
type: postmortem
title: "Postmortem: OpenClaw webchat message triggers an Opus call storm with rapid prompt growth"
status: draft
trust: draft
severity: SEV2
duration: "≈2 minutes per affected message (observed 2026-02-14)"
services_affected: [openclaw-gateway, litellm]
summary: "A single sandbox:openclaw webchat message produced ~19 sequential Claude Opus calls in one run, quickly growing prompt tokens to ~29k and incurring high cost. OpenRouter prompt caching worked for a ~9.8k-token prefix, but uncached tail growth and lack of guardrails drove unacceptable spend."
read_when: "Investigating high OpenClaw spend, multi-turn governance behavior, or prompt caching effectiveness."
owner: derekg1729
created: 2026-02-14
verified: 2026-02-14
tags: [incident, openclaw, cost, prompt-caching]
---

# Postmortem: OpenClaw webchat message triggers an Opus call storm with rapid prompt growth

**Date**: 2026-02-14  
**Severity**: SEV2  
**Status**: Active (diagnosed; fix pending)  
**Duration**: ≈2 minutes per affected message (run duration), ongoing risk until fix ships

---

## Summary

A single user message to the `sandbox:openclaw` webchat triggered a multi-step OpenClaw agent loop, resulting in **~19 sequential `claude-opus-4.5` calls** within a single run. Prompt tokens grew from ~10k to ~29k in ~90 seconds, with small outputs between calls, causing unexpectedly high spend and an unusable interactive experience.

OpenRouter prompt caching was functioning (confirmed via `cache_write_tokens` on the first call and `cached_tokens` on subsequent calls), but only for a stable **~9.8k-token prefix**. The uncached portion of the prompt grew quickly (tool output + accumulating internal turns), so total prompt tokens and cost still escalated.

## Timeline

| Time (UTC)          | Event                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| 2026-02-14 09:23:00 | OpenClaw embedded run starts (gateway log: `embedded run start`, `messageChannel=webchat`) |
| 2026-02-14 09:23:00 | 1st LiteLLM call in run: `prompt_tokens≈10127`, `cache_write_tokens≈9785` (cache write)    |
| 2026-02-14 09:23:04 | 2nd call: `cached_tokens≈9785` (cache read begins)                                         |
| 2026-02-14 09:23:27 | Call reaches `prompt_tokens≈22463` while `cached_tokens` remains ≈9785                     |
| 2026-02-14 09:24:28 | Last observed call in burst: `prompt_tokens≈28971`, `cached_tokens≈9785`                   |
| 2026-02-14 09:24:41 | OpenClaw run ends (`aborted=false`)                                                        |

## Root Cause

### What Happened

The system allowed a normal interactive webchat message to enter a multi-step, tool-heavy agent loop. Each tool step required additional model calls, and each subsequent call included an increasingly large transcript/tool tail.

Prompt caching markers existed, but only covered the stable system-prefix region. This made cache savings real but bounded, and not sufficient to offset the exploding uncached tail during the loop.

### Contributing Factors

1. **Proximate cause**: No guardrails on “LLM calls/tool steps per webchat message” for OpenClaw gateway runs.
2. **Contributing factor**: The agent behavior for normal webchat messages can enter governance-like multi-step workflows.
3. **Contributing factor**: Caching applied to a stable prefix only; uncached tail growth dominated total prompt tokens.
4. **Systemic factor**: The Activity UI does not make “calls per run” and “cached vs uncached tokens” obvious, leading to confusion about whether caching worked.

## Detection & Response

### What Worked

- LiteLLM logs retained `prompt_tokens_details.cached_tokens` / `cache_write_tokens`, enabling definitive confirmation of prompt caching.
- Correlation via `spend_logs_metadata.run_id` enabled grouping all calls from a single OpenClaw run.

### What Didn't Work

- No automatic detection/alerting for call storms (high call counts per run, rapid prompt growth slope).
- No runtime fail-closed behavior to cap work per webchat message.

## Impact

### Customer Impact

- One user message can generate many model calls and tool steps, producing high and surprising cost.
- Interactive chat becomes unreliable and financially unsafe for end users.

### Technical Impact

- ~19 Opus calls in one run; prompt tokens rose to ~29k.
- Prompt caching saved a stable ~9.8k tokens after the first call, but the uncached tail grew to ~19k+ tokens.

## Lessons Learned

### What Went Well

1. Billing metadata was sufficient to confirm caching and reconstruct call storm characteristics.

### What Went Wrong

1. Interactive webchat lacked execution budgets (calls/tools/duration) appropriate for user-driven requests.
2. Governance-style workflows were reachable without explicit gating.

### Where We Got Lucky

1. The behavior was caught in dev during interactive use and could be diagnosed from local logs/DB.

## Action Items

| Pri | Action                                                                                                                             | Owner | Work Item |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----- | --------- |
| P0  | Deep dive OpenClaw loop trigger + continuation logic; implement a real fix for safe long governance sessions without runaway spend | —     | bug.0062  |
| P0  | Add guardrails to prevent single-message call storms (cap work per message; fail closed with clear error + metric)                 | —     | bug.0062  |

## Related

- `docs/postmortems/pm.billing-observability-gaps.2026-02-14.md`
- `work/items/task.0053.token-model-optimization.md`
- `work/items/bug.0062.openclaw-govern-call-storm.md`
