---
id: task.0235
type: task
title: "LLM fallback and retry in completion adapter"
status: needs_design
priority: 2
rank: 5
estimate: 2
summary: Add exponential backoff retry on transient LLM errors + optional fallback model in CogniCompletionAdapter
outcome: Agent reliability improves from ~95% to ~99.5% by surviving transient LLM API failures
spec_refs:
assignees:
credit:
project:
branch:
pr:
reviewer:
created: 2026-03-29
updated: 2026-03-29
labels: [agents, reliability, llm]
external_refs: [spike.0231]
revision: 0
blocked_by:
deploy_verified: false
---

# LLM Fallback and Retry

## Problem

`CogniCompletionAdapter` calls LiteLLM once per invocation. If the call fails due to rate limiting (429), server error (503), or timeout, the entire agent run fails. No retry, no fallback.

Production LLM APIs have transient failure rates of 1-5% depending on provider and load. Without retry, agent reliability is bounded by API reliability.

## Design

### Invariants

- **RETRY_TRANSIENT_ONLY**: Only retry on 429, 503, 408, ECONNRESET, timeout. Never retry on 400, 401, 403 (permanent errors)
- **BACKOFF_EXPONENTIAL**: Base 1s, factor 2x, max 3 retries, jitter ±20%
- **FALLBACK_IS_OPTIONAL**: Fallback model only used if explicitly configured
- **ABORT_RESPECTED**: If AbortSignal fires during retry wait, stop immediately
- **LITELLM_ALTERNATIVE**: This can alternatively be solved at the LiteLLM proxy level via fallback config — document both approaches

### Approach

#### Option A: App-level retry (recommended for MVP)

Modify `CogniCompletionAdapter._call()`:

```typescript
async _call(messages, options, runManager) {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await this.completionFn(/* ... */);
    } catch (err) {
      if (!isTransientError(err) || attempt === maxRetries - 1) throw err;
      await backoff(attempt, options?.signal);
    }
  }
}
```

- `isTransientError(err)`: Check status code or error message for 429/503/timeout
- `backoff(attempt, signal)`: `sleep(1000 * 2^attempt * jitter)`, reject on signal abort

#### Option B: LiteLLM proxy-level fallback

Configure in `litellm.config.yaml`:
```yaml
model_list:
  - model_name: primary
    litellm_params:
      model: claude-sonnet-4-20250514
    num_retries: 3
    fallbacks: ["fallback-model"]
```

Zero app code changes. Trades configurability for coupling to LiteLLM config.

**Recommendation:** Start with Option A (~50 LOC) for control and portability. Document Option B as alternative.

### Files to Modify

| File | Change |
|---|---|
| `packages/langgraph-graphs/src/runtime/cogni/completion-adapter.ts` | Add retry loop in `_call()` |
| `packages/ai-core/src/execution/retry.ts` (new) | `isTransientError()`, `backoff()` utilities |

### Validation

- Unit test: 429 on first call, success on second → returns result
- Unit test: 400 on first call → throws immediately (no retry)
- Unit test: 3 failures → throws after exhausting retries
- Unit test: AbortSignal during backoff → throws AbortError
